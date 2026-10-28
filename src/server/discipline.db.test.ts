import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { developmentAttributes, disciplineLedger, xpLedger } from "@/modules/character/db";
import {
  ensureDisciplineAttribute,
  reconcileTaskDiscipline,
  seedDevelopmentAttributes,
  sweepOverdueDiscipline,
} from "@/modules/character/server";
import { tasks } from "@/modules/tasks/db";
import { workerTick } from "@/modules/automation/server";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * M10.5 自制力, end to end through the real routers and the real event bus (XP, rewards, capture
 * and discipline handlers registered). Planning times are moved into the past with direct
 * updates of `tasks.planned_at` — the only way to simulate "planned two days ago" in a test.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const DAY = 86_400_000;

async function setup(timeZone = "UTC") {
  const user = await createSeededUser(db);
  const api = createCallerFactory(appRouter)({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone });
  return { user, api };
}
type Api = Awaited<ReturnType<typeof setup>>["api"];

const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** A task whose deadline (due date `dueOffset` days from today, UTC) was planned 3 days ago. */
async function plannedTask(api: Api, title: string, dueOffset: number, dueTime?: string) {
  const task = await api.tasks.create({ title, dueDate: isoDay(dueOffset), dueTime });
  await db
    .update(tasks)
    .set({ plannedAt: new Date(Date.now() - 3 * DAY) })
    .where(eq(tasks.id, task.id));
  return task;
}

const entries = (taskId: string) =>
  db
    .select({
      points: disciplineLedger.points,
      outcome: disciplineLedger.outcome,
      reason: disciplineLedger.reason,
    })
    .from(disciplineLedger)
    .where(eq(disciplineLedger.taskId, taskId))
    .orderBy(asc(disciplineLedger.seq));

const net = async (taskId: string) => (await entries(taskId)).reduce((s, e) => s + e.points, 0);

const discipline = async (api: Api) =>
  (await api.character.attributes.list()).find((a) => a.systemKey === "discipline")!;

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ cause: { code } });

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("the 自制力 attribute", () => {
  it("is created exactly once, however often seeding or ensuring runs", async () => {
    const { user } = await setup();
    await seedDevelopmentAttributes(db, user.id);
    await seedDevelopmentAttributes(db, user.id);
    await Promise.all(Array.from({ length: 5 }, () => ensureDisciplineAttribute(db, user.id)));
    const rows = await db
      .select()
      .from(developmentAttributes)
      .where(
        and(
          eq(developmentAttributes.userId, user.id),
          eq(developmentAttributes.systemKey, "discipline"),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("can be hidden from the radar (persisted) without stopping scoring", async () => {
    const { api } = await setup();
    const attribute = await discipline(api);
    await api.character.attributes.update({ id: attribute.id, patch: { onRadar: false } });
    const task = await plannedTask(api, "按时完成", 0);
    await api.tasks.complete({ id: task.id });
    const after = await discipline(api);
    expect(after).toMatchObject({ onRadar: false, points: 10, xp: 0 });
    expect(
      (await api.character.overview()).attributes.find((a) => a.id === attribute.id)?.onRadar,
    ).toBe(false);
  });

  it("cannot be renamed, recoloured, archived or deleted (server and database)", async () => {
    const { api } = await setup();
    const { id } = await discipline(api);
    for (const patch of [
      { name: "别的名字" },
      { archived: true },
      { icon: "x" },
      { color: "red" as const },
    ]) {
      await rejects(api.character.attributes.update({ id, patch }), "attribute.system_locked");
    }
    await rejects(api.character.attributes.delete({ id }), "attribute.system_locked");
    await expect(
      db
        .update(developmentAttributes)
        .set({ name: "改名" })
        .where(eq(developmentAttributes.id, id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(developmentAttributes)
        .set({ archivedAt: new Date() })
        .where(eq(developmentAttributes.id, id)),
    ).rejects.toThrow();
  });

  it("never receives Growth XP: not a contribution, goal or focus target", async () => {
    const { api } = await setup();
    const { id } = await discipline(api);
    await rejects(
      api.tasks.create({ title: "x", contributions: [{ attributeId: id, weight: 2 }] }),
      "attribute.system_scored",
    );
    await rejects(
      api.development.goals.create({ title: "目标", attributes: [{ attributeId: id, weight: 2 }] }),
      "attribute.system_scored",
    );
    await rejects(api.development.setFocus({ attributeIds: [id] }), "attribute.system_scored");
  });
});

describe("scoring", () => {
  it("scores early (+15), on time (+10) and late (+3) completion", async () => {
    const { api } = await setup();
    const early = await plannedTask(api, "提前", 2);
    const onTime = await plannedTask(api, "按时", 0);
    const late = await plannedTask(api, "逾期完成", -1);
    for (const t of [early, onTime, late]) await api.tasks.complete({ id: t.id });
    expect(await entries(early.id)).toEqual([
      { points: 15, outcome: "early", reason: "completed_early" },
    ]);
    expect(await entries(onTime.id)).toEqual([
      { points: 10, outcome: "on_time", reason: "completed_on_time" },
    ]);
    expect(await entries(late.id)).toEqual([
      { points: 3, outcome: "late", reason: "completed_late" },
    ]);
    expect((await discipline(api)).points).toBe(28);
  });

  it("ignores tasks without a deadline and tasks done on the spot", async () => {
    const { api } = await setup();
    const noDeadline = await api.tasks.create({ title: "没有截止日期", startDate: isoDay(-2) });
    const adHoc = await api.tasks.create({ title: "随手做", dueDate: isoDay(0) });
    await api.tasks.complete({ id: noDeadline.id });
    await api.tasks.complete({ id: adHoc.id });
    await sweepOverdueDiscipline(db);
    expect(await entries(noDeadline.id)).toEqual([]);
    expect(await entries(adHoc.id)).toEqual([]);
    expect((await discipline(api)).points).toBe(0);
  });

  it("penalises an overdue task exactly once, even with overlapping sweeps and worker ticks", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "拖延", -1);
    await Promise.all([
      sweepOverdueDiscipline(db),
      sweepOverdueDiscipline(db),
      workerTick({ db, bus }),
    ]);
    await sweepOverdueDiscipline(db);
    expect(await entries(task.id)).toEqual([{ points: -3, outcome: "overdue", reason: "overdue" }]);
    // A task whose deadline has not passed is not touched.
    const future = await plannedTask(api, "还没到期", 1);
    await sweepOverdueDiscipline(db);
    expect(await entries(future.id)).toEqual([]);
  });

  it("turns overdue then late completion into a net +3, and overdue then failure into −5", async () => {
    const { api } = await setup();
    const late = await plannedTask(api, "逾期后完成", -1);
    const failed = await plannedTask(api, "逾期后失败", -1);
    await sweepOverdueDiscipline(db);
    await api.tasks.complete({ id: late.id });
    await api.tasks.fail({ id: failed.id });
    expect((await entries(late.id)).map((e) => e.points)).toEqual([-3, 6]);
    expect(await net(late.id)).toBe(3);
    expect((await entries(failed.id)).map((e) => [e.points, e.outcome])).toEqual([
      [-3, "overdue"],
      [-2, "failed"],
    ]);
    expect(await net(failed.id)).toBe(-5);
  });

  it("gives cancellation 0 and never a failure penalty, but keeps an earned overdue −3 (M10.6)", async () => {
    const { api } = await setup();
    const fresh = await plannedTask(api, "取消（未逾期）", 2);
    const overdue = await plannedTask(api, "取消（已逾期）", -1);
    await sweepOverdueDiscipline(db);
    const statuses = await api.tasks.statuses.list();
    const cancelled = statuses.find((s) => s.category === "cancelled")!;
    await api.tasks.setStatus({ id: fresh.id, statusId: cancelled.id });
    await api.tasks.setStatus({ id: overdue.id, statusId: cancelled.id });
    await sweepOverdueDiscipline(db);
    expect(await entries(fresh.id)).toEqual([]);
    // Cancelling neither adds a penalty nor erases the one already earned.
    expect((await entries(overdue.id)).map((e) => [e.points, e.outcome])).toEqual([
      [-3, "overdue"],
    ]);
    expect(await net(overdue.id)).toBe(-3);
  });

  it("keeps the score stable through repeated cancellation events", async () => {
    const { api, user } = await setup();
    const overdue = await plannedTask(api, "反复取消", -1);
    const fresh = await plannedTask(api, "反复取消（未逾期）", 2);
    await sweepOverdueDiscipline(db);
    const statuses = await api.tasks.statuses.list();
    const cancelled = statuses.find((s) => s.category === "cancelled")!;
    const second = await api.tasks.statuses.create({
      name: "放弃了",
      category: "cancelled",
      color: "gray",
    });
    for (const task of [overdue, fresh]) {
      await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
      // Another cancelled status, a redelivered event, a sweep, and reopen + cancel again.
      await api.tasks.setStatus({ id: task.id, statusId: second.id });
      await reconcileTaskDiscipline(db, { userId: user.id, taskId: task.id, sourceKey: "again" });
      await sweepOverdueDiscipline(db);
      await api.tasks.reopen({ id: task.id });
      await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
    }
    expect(await net(overdue.id)).toBe(-3);
    expect((await entries(overdue.id)).map((e) => e.points)).toEqual([-3]);
    expect(await net(fresh.id)).toBe(0);
    expect(await entries(fresh.id)).toEqual([]);
  });

  it("restores the right net when an overdue task is cancelled, reopened and completed", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "取消后又完成", -1);
    await sweepOverdueDiscipline(db);
    const cancelled = (await api.tasks.statuses.list()).find((s) => s.category === "cancelled")!;
    await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
    await api.tasks.reopen({ id: task.id });
    await api.tasks.complete({ id: task.id });
    expect((await entries(task.id)).map((e) => [e.points, e.reason])).toEqual([
      [-3, "overdue"],
      [6, "completed_late"],
    ]);
    await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
    // Cancelling the completed task: its completion is withdrawn, the earned −3 stays.
    expect((await entries(task.id)).map((e) => [e.points, e.reason, e.outcome])).toEqual([
      [-3, "overdue", "overdue"],
      [6, "completed_late", "late"],
      [-6, "cancelled", "overdue"],
    ]);
    expect(await net(task.id)).toBe(-3);
  });

  it("scores completion on the due date as on time (+10), never early", async () => {
    const { api } = await setup();
    const dateOnly = await plannedTask(api, "当天完成", 0);
    const timed = await plannedTask(api, "当天截止时间前完成", 0, "23:59");
    await api.tasks.complete({ id: dateOnly.id });
    await api.tasks.complete({ id: timed.id });
    expect(await entries(dateOnly.id)).toEqual([
      { points: 10, outcome: "on_time", reason: "completed_on_time" },
    ]);
    expect(await entries(timed.id)).toEqual([
      { points: 10, outcome: "on_time", reason: "completed_on_time" },
    ]);
  });

  it("does not score tasks whose planning time was back-filled, nor touch their history (M10.6)", async () => {
    const { api, user } = await setup();
    // A deadline that existed before M10.5: migration 0014 set planned_at = created_at, 0015 marks it.
    const legacy = await api.tasks.create({ title: "旧任务", dueDate: isoDay(-5) });
    const [row] = await db
      .select({ createdAt: tasks.createdAt })
      .from(tasks)
      .where(eq(tasks.id, legacy.id));
    await db
      .update(tasks)
      .set({ plannedAt: row!.createdAt, plannedAtInferred: true })
      .where(eq(tasks.id, legacy.id));
    // An entry recorded for it before M10.6 (e.g. by an M10.5 sweep) stays as it is.
    await db.update(tasks).set({ plannedAtInferred: false }).where(eq(tasks.id, legacy.id));
    await db
      .update(tasks)
      .set({ plannedAt: new Date(Date.now() - 10 * DAY) })
      .where(eq(tasks.id, legacy.id));
    await sweepOverdueDiscipline(db, { userId: user.id });
    expect(await net(legacy.id)).toBe(-3);
    await db
      .update(tasks)
      .set({ plannedAt: row!.createdAt, plannedAtInferred: true })
      .where(eq(tasks.id, legacy.id));
    const untouched = await api.tasks.create({ title: "旧任务（未计分）", dueDate: isoDay(-5) });
    await db.update(tasks).set({ plannedAtInferred: true }).where(eq(tasks.id, untouched.id));

    await sweepOverdueDiscipline(db, { userId: user.id });
    await api.tasks.complete({ id: legacy.id });
    await api.tasks.complete({ id: untouched.id });
    expect((await entries(legacy.id)).map((e) => e.points)).toEqual([-3]);
    expect(await entries(untouched.id)).toEqual([]);
    // Setting a deadline anew records real planning again (new tasks follow the normal rules).
    await api.tasks.reopen({ id: untouched.id });
    await api.tasks.update({ id: untouched.id, patch: { dueDate: null } });
    await api.tasks.update({ id: untouched.id, patch: { dueDate: isoDay(3) } });
    const [fresh] = await db
      .select({ inferred: tasks.plannedAtInferred, plannedAt: tasks.plannedAt })
      .from(tasks)
      .where(eq(tasks.id, untouched.id));
    expect(fresh).toMatchObject({ inferred: false });
    expect(fresh!.plannedAt).not.toBeNull();
  });

  it("keeps a failure's −5 through deletion and restoration, without scoring again", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "失败后删除", 1);
    await api.tasks.fail({ id: task.id });
    expect(await net(task.id)).toBe(-5);
    await api.tasks.delete({ id: task.id });
    await sweepOverdueDiscipline(db);
    await api.tasks.trash.restore({ id: task.id });
    await sweepOverdueDiscipline(db);
    expect(await entries(task.id)).toEqual([{ points: -5, outcome: "failed", reason: "failed" }]);
    // History survives permanent deletion too.
    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.purge({ id: task.id });
    expect(await net(task.id)).toBe(-5);
  });

  it("reverses a completion on reopening and never pays a completion twice", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "完成再打开", 0);
    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });
    await api.tasks.complete({ id: task.id });
    await api.tasks.complete({ id: task.id }); // no-op
    expect((await entries(task.id)).map((e) => [e.points, e.reason])).toEqual([
      [10, "completed_on_time"],
      [-10, "reopened"],
      [10, "completed_on_time"],
    ]);
    expect(await net(task.id)).toBe(10);
  });

  it("keeps a missed deadline missed when the date is moved after a late completion", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "改日期", -1);
    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });
    await api.tasks.update({ id: task.id, patch: { dueDate: isoDay(5) } });
    await api.tasks.complete({ id: task.id });
    expect(await net(task.id)).toBe(3);
  });

  it("scores concurrent duplicate deliveries once", async () => {
    const { api, user } = await setup();
    const task = await plannedTask(api, "并发", 0);
    await api.tasks.complete({ id: task.id });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        reconcileTaskDiscipline(db, { userId: user.id, taskId: task.id, sourceKey: `dup-${i}` }),
      ),
    );
    expect(await entries(task.id)).toHaveLength(1);
  });

  it("uses the user's time zone for the deadline", async () => {
    const { api, user } = await setup("Asia/Shanghai");
    const task = await api.tasks.create({ title: "上海", dueDate: "2026-10-28" });
    await db
      .update(tasks)
      .set({ plannedAt: new Date("2026-10-20T00:00:00Z") })
      .where(eq(tasks.id, task.id));
    // 2026-10-29 00:00 in Shanghai = 2026-10-28 16:00 UTC.
    await sweepOverdueDiscipline(db, { userId: user.id, now: new Date("2026-10-28T15:59:00Z") });
    expect(await entries(task.id)).toEqual([]);
    await sweepOverdueDiscipline(db, { userId: user.id, now: new Date("2026-10-28T16:01:00Z") });
    expect(await net(task.id)).toBe(-3);
  });
});

describe("integrity", () => {
  it("is invisible to other users and their actions", async () => {
    const owner = await setup();
    const other = await setup();
    const task = await plannedTask(owner.api, "我的任务", 0);
    await owner.api.tasks.complete({ id: task.id });
    expect(await other.api.character.discipline.forTask({ taskId: task.id })).toEqual({
      net: 0,
      outcome: null,
      entries: [],
    });
    expect((await other.api.character.discipline.summary({})).score).toBe(0);
    await rejects(other.api.tasks.fail({ id: task.id }), "task.not_found");
    expect(
      await reconcileTaskDiscipline(db, { userId: other.user.id, taskId: task.id, sourceKey: "x" }),
    ).toBeNull();
    expect(await net(task.id)).toBe(10);
  });

  it("leaves XP, Level XP, rewards and other attributes exactly as without 自制力", async () => {
    const { api, user } = await setup();
    const [french] = (await api.character.attributes.list()).filter(
      (a) => a.systemKey === "french",
    );
    const plannedOne = await plannedTask(api, "有计划", 0);
    await api.tasks.update({
      id: plannedOne.id,
      patch: { contributions: [{ attributeId: french!.id, weight: 2 }] },
    });
    const unplanned = await api.tasks.create({
      title: "没计划",
      contributions: [{ attributeId: french!.id, weight: 2 }],
    });
    await api.tasks.complete({ id: plannedOne.id });
    await api.tasks.complete({ id: unplanned.id });
    const ledger = await db.select().from(xpLedger).where(eq(xpLedger.userId, user.id));
    const byTask = (id: string) =>
      ledger.filter((e) => e.sourceId === id).map((e) => [e.ruleKey, e.amount]);
    // Same XP for the planned task (+10 自制力) as for the unplanned one (no 自制力).
    expect(byTask(plannedOne.id)).toEqual(byTask(unplanned.id));
    const overview = await api.character.overview();
    expect((await discipline(api)).points).toBe(10);
    // Totals come only from the XP ledger and credits.
    const credited = ledger.reduce((s, e) => s + e.amount, 0);
    expect(overview.totals.lifetimeActiveXp).toBe(credited);
    expect(overview.attributes.find((a) => a.systemKey === "discipline")!.xp).toBe(0);
    // Spendable balances are exactly the XP totals: 自制力 points are not a currency.
    const balances = await api.rewards.balances();
    expect(balances).toMatchObject({
      lifetimeActiveXp: overview.totals.lifetimeActiveXp,
      spendableActiveXp: overview.totals.lifetimeActiveXp,
      lifetimeLevelXp: overview.totals.lifetimeLevelXp,
      spendableLevelXp: overview.totals.lifetimeLevelXp,
    });
  });

  it("keeps the ledger append-only", async () => {
    const { api } = await setup();
    const task = await plannedTask(api, "不可改", 0);
    await api.tasks.complete({ id: task.id });
    await expect(db.update(disciplineLedger).set({ points: 15 })).rejects.toThrow();
    await expect(db.delete(disciplineLedger)).rejects.toThrow();
    await expect(db.execute(sql`delete from discipline_ledger`)).rejects.toThrow();
    expect(await net(task.id)).toBe(10);
  });
});
