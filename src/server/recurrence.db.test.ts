import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { xpLedger } from "@/modules/character/db";
import { taskRecurrences, tasks } from "@/modules/tasks/db";
import { todayIn, type RecurrenceRuleInput } from "@/modules/tasks/domain";
import {
  listInstances,
  refreshRecurrences,
  topUpAllRecurrences,
  topUpSeries,
} from "@/modules/tasks/server";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * Recurring tasks V2 (ADR 0023, ADR 0028) through the real routers, services and event bus:
 * calendar series create one independent instance per date up to 30 days ahead; completion
 * series keep one open instance and create the next when it is closed. History never changes.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);
const HORIZON = 30;

async function setup(timeZone = "UTC") {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone });
  return { user, api };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: { code?: unknown; cause?: { code?: unknown } }) =>
      error.code === code || error.cause?.code === code,
  );

const today = () => todayIn("UTC");
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daily: RecurrenceRuleInput = { frequency: "daily", interval: 1 };

async function series(
  { api }: Ctx,
  title: string,
  options: {
    rule?: RecurrenceRuleInput;
    mode?: "fixed" | "after_completion";
    startDate?: string;
    extra?: Record<string, unknown>;
  } = {},
) {
  const task = await api.tasks.create({ title, ...(options.extra ?? {}) });
  const recurrence = await api.tasks.recurrence.set({
    taskId: task.id,
    rule: options.rule ?? daily,
    mode: options.mode ?? "fixed",
    startDate: options.startDate ?? today(),
  });
  return { task, recurrence };
}

const instances = (userId: string, recurrenceId: string) => listInstances(db, userId, recurrenceId);
const live = async (userId: string, recurrenceId: string) =>
  (await instances(userId, recurrenceId)).filter((i) => !i.deletedAt);

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("calendar series (按日历周期生成)", () => {
  it("creates one independent single-day instance per date up to 30 days ahead", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "每日法语学习");
    const rows = await live(ctx.user.id, recurrence.id);
    expect(rows.map((r) => r.dueDate)).toEqual(
      Array.from({ length: HORIZON + 1 }, (_, i) => shift(today(), i)),
    );
    // Each instance is a day of its own, not a span; the original task is the first one.
    expect(rows.every((r) => r.startDate === r.dueDate)).toBe(true);
    expect(rows[0]!.id).toBe(task.id);
    expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i + 1));
    expect(recurrence).toMatchObject({ mode: "fixed", startDate: today(), openInstances: 31 });
  });

  it("needs no due date beforehand and starts on the first matching day on or after the start", async () => {
    const ctx = await setup();
    // 2026-11-02 is a Monday; Mon/Wed/Fri from Tuesday the 3rd.
    const start = "2026-11-03";
    const { recurrence } = await series(ctx, "跑步", {
      rule: { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] },
      startDate: start,
    });
    const now = new Date("2026-11-03T08:00:00Z");
    await topUpSeries({ db, bus }, ctx.user.id, recurrence.id, now);
    const dates = (await live(ctx.user.id, recurrence.id)).map((r) => r.dueDate!);
    expect(dates[0]).toBe("2026-11-04");
    for (const d of dates) expect([1, 3, 5]).toContain(new Date(`${d}T00:00:00Z`).getUTCDay());
  });

  it("is idempotent: refreshing, the worker and concurrency never create a date twice", async () => {
    const ctx = await setup();
    const { recurrence } = await series(ctx, "冥想");
    const before = (await instances(ctx.user.id, recurrence.id)).length;
    expect((await refreshRecurrences({ db, bus }, ctx.user.id)).created).toBe(0);
    await Promise.all([
      ctx.api.tasks.recurrence.refresh(),
      ctx.api.tasks.recurrence.refresh(),
      topUpAllRecurrences({ db, bus }),
    ]);
    const rows = await instances(ctx.user.id, recurrence.id);
    expect(rows).toHaveLength(before);
    expect(new Set(rows.map((r) => r.dueDate)).size).toBe(rows.length);
  });

  it("keeps generating whether or not earlier instances are done; each instance is independent", async () => {
    const ctx = await setup();
    const { recurrence } = await series(ctx, "背单词", { startDate: shift(today(), -2) });
    // The task itself is the first instance, on the start date; yesterday is not created (no
    // backlog); today onwards are.
    const rows = await live(ctx.user.id, recurrence.id);
    expect(rows.slice(0, 3).map((r) => r.dueDate)).toEqual([
      shift(today(), -2),
      today(),
      shift(today(), 1),
    ]);
    const [first, second] = rows;
    await ctx.api.tasks.complete({ id: second!.id });
    expect((await ctx.api.tasks.byId({ id: first!.id })).statusCategory).not.toBe("completed");
    await ctx.api.tasks.complete({ id: first!.id });
    // Two completions, two XP entries; nothing else changed.
    for (const id of [first!.id, second!.id]) {
      const [xp] = await db.select({ n: count() }).from(xpLedger).where(eq(xpLedger.sourceId, id));
      expect(xp!.n).toBe(1);
    }
    // A day later the horizon has moved on by one instance.
    await topUpSeries({ db, bus }, ctx.user.id, recurrence.id, new Date(Date.now() + 86_400_000));
    expect((await live(ctx.user.id, recurrence.id)).at(-1)!.dueDate).toBe(
      shift(today(), HORIZON + 1),
    );
  });

  it("skips one occurrence without touching the others", async () => {
    const ctx = await setup();
    const { recurrence } = await series(ctx, "健身");
    const [, second, third] = await live(ctx.user.id, recurrence.id);
    const skipped = await ctx.api.tasks.recurrence.skip({ taskId: second!.id });
    expect(skipped.statusCategory).toBe("cancelled");
    expect((await ctx.api.tasks.byId({ id: third!.id })).statusCategory).toBe("unstarted");
  });

  it("ends after COUNT instances or after the UNTIL date", async () => {
    const ctx = await setup();
    const counted = await series(ctx, "五次", {
      rule: { ...daily, end: { type: "count", count: 5 } },
    });
    expect(await live(ctx.user.id, counted.recurrence.id)).toHaveLength(5);
    const until = await series(ctx, "到周末", {
      rule: { ...daily, end: { type: "until", date: shift(today(), 3) } },
    });
    expect((await live(ctx.user.id, until.recurrence.id)).map((r) => r.dueDate)).toEqual(
      [0, 1, 2, 3].map((i) => shift(today(), i)),
    );
    for (const id of [counted.recurrence.id, until.recurrence.id]) {
      const [row] = await db.select().from(taskRecurrences).where(eq(taskRecurrences.id, id));
      expect(row!.endedAt).not.toBeNull();
    }
  });
});

describe("completion series (完成上一次后再生成)", () => {
  it("keeps one open instance and creates the next only after completion, counted from that day", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "换床单", {
      mode: "after_completion",
      rule: { frequency: "daily", interval: 4 },
      startDate: shift(today(), -3),
    });
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(1);
    // Not completed: nothing new, however often the views refresh.
    await ctx.api.tasks.recurrence.refresh();
    await topUpAllRecurrences({ db, bus });
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(1);

    await ctx.api.tasks.complete({ id: task.id, completedOn: shift(today(), -1) });
    const rows = await live(ctx.user.id, recurrence.id);
    expect(rows.map((r) => r.dueDate)).toEqual([shift(today(), -3), shift(today(), 3)]);
    // The completed one keeps its history.
    const done = await ctx.api.tasks.byId({ id: task.id });
    expect(done).toMatchObject({ statusCategory: "completed", dueDate: shift(today(), -3) });

    // Reopening and completing again never creates a second successor.
    await ctx.api.tasks.reopen({ id: task.id });
    await ctx.api.tasks.complete({ id: task.id });
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(2);
  });

  it("every N weeks counts whole weeks from the completion day", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "体检提醒", {
      mode: "after_completion",
      rule: { frequency: "weekly", interval: 2 },
    });
    await ctx.api.tasks.complete({ id: task.id });
    expect((await live(ctx.user.id, recurrence.id)).at(-1)!.dueDate).toBe(shift(today(), 14));
  });
});

describe("changing, pausing and stopping a series", () => {
  it("replaces only future untouched instances; history and planned instances stay", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "写日记");
    const rows = await live(ctx.user.id, recurrence.id);
    await ctx.api.tasks.complete({ id: task.id }); // today's: history
    const planned = rows[5]!; // has a schedule block: kept
    await ctx.api.schedule.create({
      taskId: planned.id,
      startAt: new Date(`${planned.dueDate}T09:00:00Z`),
      endAt: new Date(`${planned.dueDate}T10:00:00Z`),
      allDay: false,
    });

    // Every other day from tomorrow, applied to future instances.
    await ctx.api.tasks.recurrence.set({
      taskId: rows[1]!.id,
      rule: { frequency: "daily", interval: 2 },
      mode: "fixed",
      startDate: shift(today(), 1),
      applyTo: "future",
    });
    const after = await live(ctx.user.id, recurrence.id);
    const ids = after.map((r) => r.id);
    expect(ids).toContain(task.id);
    expect(ids).toContain(rows[1]!.id); // the instance being edited
    expect(ids).toContain(planned.id);
    expect((await ctx.api.tasks.byId({ id: task.id })).statusCategory).toBe("completed");
    // New instances follow the new rule; no date appears twice.
    const dates = after.map((r) => r.dueDate!);
    expect(new Set(dates).size).toBe(dates.length);
    expect(after.filter((r) => !rows.some((o) => o.id === r.id)).length).toBeGreaterThan(0);

    // "new": nothing existing changes.
    const snapshot = (await live(ctx.user.id, recurrence.id)).map((r) => r.id);
    await ctx.api.tasks.recurrence.set({
      taskId: rows[1]!.id,
      rule: daily,
      mode: "fixed",
      startDate: shift(today(), 1),
      applyTo: "new",
    });
    const kept = (await live(ctx.user.id, recurrence.id)).map((r) => r.id);
    for (const id of snapshot) expect(kept).toContain(id);
  });

  it("pauses (removing untouched future instances, creating nothing) and resumes from today", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "晨跑");
    await ctx.api.tasks.recurrence.pause({ taskId: task.id });
    expect((await live(ctx.user.id, recurrence.id)).map((r) => r.id)).toEqual([task.id]);
    await ctx.api.tasks.recurrence.refresh();
    await topUpAllRecurrences({ db, bus });
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(1);
    const resumed = await ctx.api.tasks.recurrence.resume({ taskId: task.id });
    expect(resumed.pausedAt).toBeNull();
    expect((await live(ctx.user.id, recurrence.id)).at(-1)!.dueDate).toBe(shift(today(), HORIZON));
  });

  it("resuming a completion series whose instances are all closed creates one due today", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "浇花", {
      mode: "after_completion",
      rule: { frequency: "daily", interval: 3 },
    });
    await ctx.api.tasks.recurrence.pause({ taskId: task.id });
    await ctx.api.tasks.complete({ id: task.id }); // paused: no successor
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(1);
    await ctx.api.tasks.recurrence.resume({ taskId: task.id });
    expect((await live(ctx.user.id, recurrence.id)).map((r) => r.dueDate)).toEqual([
      today(),
      today(),
    ]);
  });

  it("stops for good: future untouched instances go, the rest stays, nothing more is created", async () => {
    const ctx = await setup();
    const { task, recurrence } = await series(ctx, "背诵", { startDate: shift(today(), -1) });
    const stopped = await ctx.api.tasks.recurrence.stop({ taskId: task.id });
    expect(stopped.endedAt).not.toBeNull();
    // Yesterday's (the task itself) and today's stay; the untouched future ones go.
    expect((await live(ctx.user.id, recurrence.id)).map((r) => r.dueDate)).toEqual([
      shift(today(), -1),
      today(),
    ]);
    await ctx.api.tasks.recurrence.refresh();
    expect(await live(ctx.user.id, recurrence.id)).toHaveLength(2);
    await rejects(
      ctx.api.tasks.recurrence.set({
        taskId: task.id,
        rule: daily,
        mode: "fixed",
        startDate: today(),
      }),
      "recurrence.ended",
    );
  });

  it("refuses a completion series with several open instances", async () => {
    const ctx = await setup();
    const { recurrence } = await series(ctx, "多实例", { startDate: shift(today(), -1) });
    const [first] = await live(ctx.user.id, recurrence.id);
    // Make an earlier open instance exist (as if yesterday's was left undone).
    await db
      .update(tasks)
      .set({ dueDate: shift(today(), -1), startDate: shift(today(), -1) })
      .where(eq(tasks.id, first!.id));
    const other = (await live(ctx.user.id, recurrence.id))[1]!;
    await rejects(
      ctx.api.tasks.recurrence.set({
        taskId: other.id,
        rule: daily,
        mode: "after_completion",
        startDate: today(),
      }),
      "recurrence.too_many_open",
    );
  });
});

describe("existing data and edge cases", () => {
  it("continues a series created before V2 without re-creating its dates", async () => {
    const ctx = await setup();
    // A Phase 1 series: one open instance due today, nothing ahead.
    const task = await ctx.api.tasks.create({ title: "旧系列", dueDate: today() });
    const [old] = await db
      .insert(taskRecurrences)
      .values({
        userId: ctx.user.id,
        rrule: `DTSTART;VALUE=DATE:${shift(today(), -10).replaceAll("-", "")}\nRRULE:FREQ=DAILY`,
        mode: "fixed",
        timezone: "UTC",
      })
      .returning();
    await db
      .update(tasks)
      .set({ recurrenceId: old!.id, recurrenceIndex: 4 })
      .where(eq(tasks.id, task.id));
    await ctx.api.tasks.recurrence.refresh();
    const rows = await live(ctx.user.id, old!.id);
    expect(rows[0]).toMatchObject({ id: task.id, dueDate: today(), index: 4 });
    expect(rows.map((r) => r.dueDate)).toEqual(
      Array.from({ length: HORIZON + 1 }, (_, i) => shift(today(), i)),
    );
  });

  it("uses the series' time zone for today", async () => {
    const ctx = await setup("Asia/Shanghai");
    const task = await ctx.api.tasks.create({ title: "上海" });
    const { id } = await ctx.api.tasks.recurrence.set({
      taskId: task.id,
      rule: daily,
      mode: "fixed",
      startDate: "2026-12-01",
    });
    // 2026-12-01 17:00 UTC is already the 2nd in Shanghai: the horizon runs from the 2nd.
    await topUpSeries({ db, bus }, ctx.user.id, id, new Date("2026-12-01T17:00:00Z"));
    const rows = await live(ctx.user.id, id);
    expect(rows.at(-1)!.dueDate).toBe(shift("2026-12-02", HORIZON));
  });

  it("keeps other users' series out of reach", async () => {
    const a = await setup();
    const b = await setup();
    const { task, recurrence } = await series(a, "A 的任务");
    for (const call of [
      () => b.api.tasks.recurrence.get({ taskId: task.id }),
      () => b.api.tasks.recurrence.pause({ taskId: task.id }),
      () => b.api.tasks.recurrence.resume({ taskId: task.id }),
      () => b.api.tasks.recurrence.stop({ taskId: task.id }),
      () => b.api.tasks.recurrence.skip({ taskId: task.id }),
      () =>
        b.api.tasks.recurrence.set({
          taskId: task.id,
          rule: daily,
          mode: "fixed",
          startDate: today(),
        }),
    ]) {
      await rejects(call(), "task.not_found");
    }
    const before = (await instances(a.user.id, recurrence.id)).length;
    await b.api.tasks.recurrence.refresh();
    expect(await instances(a.user.id, recurrence.id)).toHaveLength(before);
    const [{ n }] = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from tasks where user_id = ${b.user.id} and recurrence_id is not null`,
      )
    ).rows as [{ n: number }];
    expect(n).toBe(0);
    expect(
      (
        await db
          .select({ n: count() })
          .from(tasks)
          .where(and(eq(tasks.userId, b.user.id)))
      )[0]!.n,
    ).toBeGreaterThanOrEqual(0);
  });
});
