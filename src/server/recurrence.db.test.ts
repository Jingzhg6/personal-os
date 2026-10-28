import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { disciplineLedger } from "@/modules/character/db";
import { taskRecurrences, tasks } from "@/modules/tasks/db";
import { todayIn, type RecurrenceRuleInput, type Task } from "@/modules/tasks/domain";
import { generateNextInstance, listInstances } from "@/modules/tasks/server";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * Recurring tasks (ADR 0023) through the real routers, services and event bus: instances are
 * ordinary tasks, created once per closed instance, in the user's time zone.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);

async function setup(timeZone = "UTC") {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone });
  return { user, api };
}
type Api = Awaited<ReturnType<typeof setup>>["api"];

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

async function series(api: Api, title: string, dueDate: string, rule = daily, extra = {}) {
  const task = await api.tasks.create({ title, dueDate, ...extra });
  const recurrence = await api.tasks.recurrence.set({ taskId: task.id, rule, mode: "fixed" });
  return { task, recurrence };
}

/** Every task of a series, by position. */
async function instances(userId: string, recurrenceId: string) {
  return listInstances(db, userId, recurrenceId);
}

/** The instance after `task` in its series, read through the ordinary task API. */
async function successorOf(api: Api, task: Task) {
  const own = await api.tasks.byId({ id: task.id });
  const all = await api.tasks.list({
    today: today(),
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  const recurrence = await api.tasks.recurrence.get({ taskId: task.id });
  const next = all.find(
    (t) => t.recurrenceId === own.recurrenceId && t.id !== task.id && t.completedAt === null,
  );
  return recurrence && next ? next : null;
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("setting a rule", () => {
  it("needs a top-level task with a due date", async () => {
    const { api } = await setup();
    const undated = await api.tasks.create({ title: "无日期" });
    await rejects(
      api.tasks.recurrence.set({ taskId: undated.id, rule: daily, mode: "fixed" }),
      "recurrence.needs_due_date",
    );
    const parent = await api.tasks.create({ title: "父任务", dueDate: today() });
    const child = await api.tasks.create({
      title: "子任务",
      parentTaskId: parent.id,
      dueDate: today(),
    });
    await rejects(
      api.tasks.recurrence.set({ taskId: child.id, rule: daily, mode: "fixed" }),
      "recurrence.subtask",
    );
    expect(await api.tasks.recurrence.get({ taskId: undated.id })).toBeNull();
  });

  it("makes the task the first instance, and previews the schedule", async () => {
    const { api } = await setup();
    const { task, recurrence } = await series(api, "晨跑", today(), {
      frequency: "weekly",
      interval: 1,
      weekdays: [1, 3, 5],
    });
    expect(recurrence).toMatchObject({ index: 1, isLatest: true, instances: 1, endedAt: null });
    expect(recurrence.upcoming).toHaveLength(3);
    expect((await api.tasks.byId({ id: task.id })).recurrenceId).toBe(recurrence.id);
  });

  it("keeps a recurring task top-level and dated", async () => {
    const { api } = await setup();
    const { task } = await series(api, "周报", today());
    const parent = await api.tasks.create({ title: "父任务" });
    await rejects(
      api.tasks.setParent({ id: task.id, parentTaskId: parent.id }),
      "recurrence.subtask",
    );
    await rejects(
      api.tasks.update({ id: task.id, patch: { dueDate: null } }),
      "recurrence.needs_due_date",
    );
  });
});

describe("generating instances", () => {
  it("creates the next instance when one is completed, copying its fields", async () => {
    const { api } = await setup();
    const attributes = await api.character.attributes.list();
    const french = attributes.find((a) => a.systemKey === "french")!.id;
    const project = await api.projects.create({ name: "法语课" });
    const milestone = await api.projects.milestones.create({
      projectId: project.id,
      name: "第一单元",
      dueDate: shift(today(), 30),
    });
    const tag = await api.tasks.tags.create({ name: "学习" });
    const { task } = await series(api, "法语听写", today(), daily, {
      projectId: project.id,
      milestoneId: milestone.id,
      priority: 3,
      isUrgent: true,
      isImportant: true,
      startDate: shift(today(), -2),
      dueTime: "20:00",
      estimatedMinutes: 30,
      tagIds: [tag.id],
      contributions: [{ attributeId: french, weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });

    const next = (await successorOf(api, task))!;
    expect(next).toMatchObject({
      title: "法语听写",
      projectId: project.id,
      milestoneId: milestone.id,
      priority: 3,
      isUrgent: true,
      isImportant: true,
      dueDate: shift(today(), 1),
      startDate: shift(today(), -1),
      dueTime: "20:00",
      estimatedMinutes: 30,
      tagIds: [tag.id],
      contributions: [{ attributeId: french, weight: 2 }],
      statusCategory: "unstarted",
      completedAt: null,
    });
    const recurrence = (await api.tasks.recurrence.get({ taskId: next.id }))!;
    expect(recurrence).toMatchObject({ index: 2, isLatest: true, instances: 2 });
    expect((await api.tasks.recurrence.get({ taskId: task.id }))!.isLatest).toBe(false);

    // One record, in every view: the project counts it, the timeline (Gantt) shows it.
    const detail = await api.projects.byId({ id: project.id, today: today() });
    expect(detail.progress).toMatchObject({ total: 2, completed: 1 });
    const timeline = await api.tasks.timeline({
      today: today(),
      sort: "manual",
      includeSubtasks: false,
      filter: {},
    });
    expect(JSON.stringify(timeline)).toContain(next.id);
  });

  it("is idempotent: repeated closes, reopen-and-complete and concurrency create one successor", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "喝水", today());
    await api.tasks.complete({ id: task.id });
    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });
    await api.tasks.complete({ id: task.id });
    // A direct, repeated generation finds the successor and does nothing.
    expect(await generateNextInstance({ db, bus }, user.id, task.id)).toBeNull();
    expect(await instances(user.id, recurrence.id)).toHaveLength(2);

    // Concurrent closes of the open instance.
    const second = (await successorOf(api, task))!;
    await Promise.all([
      api.tasks.complete({ id: second.id }),
      api.tasks.complete({ id: second.id }),
      api.tasks.complete({ id: second.id }),
    ]);
    expect(await instances(user.id, recurrence.id)).toHaveLength(3);
    // The database refuses a second instance at the same position.
    await expect(
      db
        .update(tasks)
        .set({ recurrenceId: recurrence.id, recurrenceIndex: 2 })
        .where(eq(tasks.id, task.id)),
    ).rejects.toThrow();
  });

  it("skips an occurrence (cancelled, no failure) and continues", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "健身", today());
    const skipped = await api.tasks.recurrence.skip({ taskId: task.id });
    expect(skipped.statusCategory).toBe("cancelled");
    const next = (await successorOf(api, task))!;
    expect(next.dueDate).toBe(shift(today(), 1));
    await rejects(api.tasks.recurrence.skip({ taskId: task.id }), "recurrence.not_open");
    const penalties = await db
      .select({ n: count() })
      .from(disciplineLedger)
      .where(and(eq(disciplineLedger.userId, user.id), eq(disciplineLedger.outcome, "failed")));
    expect(penalties[0]!.n).toBe(0);
    // A failed instance is followed too.
    await api.tasks.fail({ id: next.id });
    expect(await instances(user.id, recurrence.id)).toHaveLength(3);
  });

  it("applies a changed rule from the newest instance on", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "复盘", today());
    await api.tasks.complete({ id: task.id });
    // Older instances are history.
    await rejects(
      api.tasks.recurrence.set({
        taskId: task.id,
        rule: { frequency: "weekly", interval: 1 },
        mode: "fixed",
      }),
      "recurrence.not_latest",
    );
    const second = (await successorOf(api, task))!;
    await api.tasks.recurrence.set({
      taskId: second.id,
      rule: { frequency: "weekly", interval: 1 },
      mode: "fixed",
    });
    expect((await api.tasks.byId({ id: second.id })).dueDate).toBe(shift(today(), 1));
    await api.tasks.complete({ id: second.id });
    const third = (await instances(user.id, recurrence.id))[2]!;
    expect(third.dueDate).toBe(shift(today(), 8));
  });

  it("stops: no further instances, and a stopped series cannot be edited", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "背单词", today());
    const stopped = await api.tasks.recurrence.stop({ taskId: task.id });
    expect(stopped.endedAt).not.toBeNull();
    await api.tasks.complete({ id: task.id });
    expect(await instances(user.id, recurrence.id)).toHaveLength(1);
    await rejects(
      api.tasks.recurrence.set({ taskId: task.id, rule: daily, mode: "fixed" }),
      "recurrence.ended",
    );
  });

  it("ends after COUNT instances or the UNTIL date", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "三次", today(), {
      frequency: "daily",
      interval: 1,
      end: { type: "count", count: 2 },
    });
    await api.tasks.complete({ id: task.id });
    const second = (await successorOf(api, task))!;
    await api.tasks.complete({ id: second.id });
    expect(await instances(user.id, recurrence.id)).toHaveLength(2);
    expect((await api.tasks.recurrence.get({ taskId: second.id }))!.endedAt).not.toBeNull();

    const until = await series(api, "截止", today(), {
      frequency: "daily",
      interval: 1,
      end: { type: "until", date: today() },
    });
    await api.tasks.complete({ id: until.task.id });
    expect(await instances(user.id, until.recurrence.id)).toHaveLength(1);
  });

  it("pauses while the open instance is in the Trash, and continues after restore", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "浇花", today());
    await api.tasks.delete({ id: task.id });
    expect(await instances(user.id, recurrence.id)).toHaveLength(1);
    await api.tasks.trash.restore({ id: task.id });
    await api.tasks.complete({ id: task.id });
    expect(await instances(user.id, recurrence.id)).toHaveLength(2);
    // Deleting a closed instance does not affect the series.
    await api.tasks.delete({ id: task.id });
    expect((await instances(user.id, recurrence.id)).filter((i) => !i.deletedAt)).toHaveLength(1);
  });

  it("does not let a closed project, completed milestone or archived attribute stop the series", async () => {
    const { api } = await setup();
    const attributes = await api.character.attributes.list();
    const reading = attributes.find((a) => a.systemKey === "reading")!.id;
    const project = await api.projects.create({ name: "读书会" });
    const { task } = await series(api, "读一章", today(), daily, {
      projectId: project.id,
      contributions: [{ attributeId: reading, weight: 1 }],
    });
    await api.projects.update({ id: project.id, patch: { status: "completed" } });
    await api.character.attributes.update({ id: reading, patch: { archived: true } });
    await api.tasks.complete({ id: task.id });
    const next = (await successorOf(api, task))!;
    expect(next).toMatchObject({ projectId: null, contributions: [] });
  });
});

describe("dates and time zones", () => {
  it("skips missed occurrences instead of creating a backlog (fixed)", async () => {
    const { api, user } = await setup();
    const { task, recurrence } = await series(api, "日记", shift(today(), -10));
    await api.tasks.complete({ id: task.id });
    const [, next] = await instances(user.id, recurrence.id);
    expect(next!.dueDate).toBe(today());
  });

  it("counts from the completion day (after completion)", async () => {
    const { api } = await setup();
    const task = await api.tasks.create({ title: "换床单", dueDate: shift(today(), 5) });
    await api.tasks.recurrence.set({
      taskId: task.id,
      rule: { frequency: "daily", interval: 7 },
      mode: "after_completion",
    });
    await api.tasks.complete({ id: task.id });
    expect((await successorOf(api, task))!.dueDate).toBe(shift(today(), 7));
  });

  it("uses the series' time zone for 'today'", async () => {
    const { api, user } = await setup("Asia/Shanghai");
    const { task, recurrence } = await series(api, "冥想", "2026-10-20");
    // 2026-11-04 17:00 UTC is already 2026-11-05 01:00 in Shanghai.
    const now = new Date("2026-11-04T17:00:00Z");
    await db
      .update(tasks)
      .set({
        completedAt: now,
        statusId: (await api.tasks.statuses.list()).find((s) => s.category === "completed")!.id,
      })
      .where(eq(tasks.id, task.id));
    await generateNextInstance({ db, bus }, user.id, task.id, now);
    const [, next] = await instances(user.id, recurrence.id);
    expect(next!.dueDate).toBe("2026-11-05");
    const [row] = await db
      .select()
      .from(taskRecurrences)
      .where(eq(taskRecurrences.id, recurrence.id));
    expect(row!.timezone).toBe("Asia/Shanghai");
    // next_due_at is the start of that local day: 2026-11-04 16:00 UTC.
    expect(row!.nextDueAt!.toISOString()).toBe("2026-11-04T16:00:00.000Z");
  });
});

describe("isolation", () => {
  it("keeps another user's series out of reach", async () => {
    const a = await setup();
    const b = await setup();
    const { task } = await series(a.api, "A 的重复任务", today());
    for (const call of [
      () => b.api.tasks.recurrence.get({ taskId: task.id }),
      () => b.api.tasks.recurrence.set({ taskId: task.id, rule: daily, mode: "fixed" }),
      () => b.api.tasks.recurrence.skip({ taskId: task.id }),
      () => b.api.tasks.recurrence.stop({ taskId: task.id }),
    ]) {
      await rejects(call(), "task.not_found");
    }
    // Generation for B never touches A's task.
    expect(await generateNextInstance({ db, bus }, b.user.id, task.id)).toBeNull();
  });
});
