import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { projectsRouter } from "@/modules/projects/server";
import { tasksRouter } from "@/modules/tasks/server";
import { users } from "@/shared/auth/schema";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { xpLedger } from "../db";
import { MILESTONE_XP, PROJECT_XP, TASK_XP, xpEventTypes } from "../domain";
import { registerCharacterEventHandlers } from "./events";
import { characterRouter } from "./router";
import { applyXpEvent } from "./xp";

const { db, close } = createTestDb();

/** Routers wired to a bus with the real XP handlers; `events` records what was published. */
function setup(userId: string, options: { failAfterXp?: () => boolean } = {}) {
  const bus = createEventBus();
  registerCharacterEventHandlers(bus);
  const events: DomainEvent[] = [];
  for (const type of xpEventTypes) {
    bus.subscribe(
      type,
      (event) => {
        events.push(event);
        if (options.failAfterXp?.()) throw new Error("downstream handler failed");
      },
      { name: "test.recorder" },
    );
  }
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    projects: createCallerFactory(projectsRouter)(ctx),
    character: createCallerFactory(characterRouter)(ctx),
    events,
  };
}

const ledger = (userId: string) =>
  db
    .select()
    .from(xpLedger)
    .where(sql`${xpLedger.userId} = ${userId}`)
    .orderBy(xpLedger.createdAt, xpLedger.id);

async function seeded() {
  const user = await createSeededUser(db);
  const areas = await listAreas(db, user.id);
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  return { user, api: setup(user.id), area };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("task XP", () => {
  it("grants XP for a completion, traceable to its event, rule and source", async () => {
    const { user, api, area } = await seeded();
    const task = await api.tasks.create({
      title: "写周报",
      areaId: area("work"),
      priority: 2,
      isImportant: true,
    });
    await api.tasks.complete({ id: task.id });

    const expected = TASK_XP.base + 2 * TASK_XP.perPriority + TASK_XP.important;
    const event = api.events.find((e) => e.type === "task.completed")!;
    const work = (await api.character.attributes.list()).find((a) => a.systemKey === "work")!;
    const [entry] = await ledger(user.id);
    expect(entry).toMatchObject({
      kind: "grant",
      amount: expected,
      ruleKey: "task.completion",
      sourceEventId: event.id,
      sourceEventType: "task.completed",
      sourceType: "task",
      sourceId: task.id,
      sourceTitle: "写周报",
      attributeId: work.id,
      cycle: 0,
      reversalOf: null,
    });
    expect(entry!.createdAt).toEqual(event.occurredAt);

    const { entries } = await api.character.history({});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: entry!.id, sourceEventId: event.id, reversed: false });
    expect((await api.character.overview()).progress.xp).toBe(expected);
  });

  it("is idempotent under duplicate event delivery, independent of row locking", async () => {
    const { user, api } = await seeded();
    const task = await api.tasks.create({ title: "一次" });
    await api.tasks.complete({ id: task.id });
    const event = api.events.find((e) => e.type === "task.completed")!;

    // The exact same event delivered again, twice, straight to the handler.
    await applyXpEvent(db, event);
    await applyXpEvent(db, event);
    // Concurrently, too.
    await Promise.all(Array.from({ length: 5 }, () => applyXpEvent(db, event)));
    // A second, distinct event for the same completion (e.g. a replayed publish).
    await applyXpEvent(db, { ...event, id: crypto.randomUUID() });

    const rows = await ledger(user.id);
    expect(rows).toHaveLength(1);
    expect((await api.character.overview()).progress.xp).toBe(TASK_XP.base);

    // The same holds for reversals.
    await api.tasks.reopen({ id: task.id });
    const reopened = api.events.find((e) => e.type === "task.reopened")!;
    await applyXpEvent(db, reopened);
    await applyXpEvent(db, { ...reopened, id: crypto.randomUUID() });
    expect((await ledger(user.id)).map((r) => r.kind)).toEqual(["grant", "reversal"]);
    expect((await api.character.overview()).progress.xp).toBe(0);
  });

  it("grants once when a failed attempt is retried", async () => {
    const user = await createSeededUser(db);
    let fail = true;
    const api = setup(user.id, { failAfterXp: () => fail });
    const task = await api.tasks.create({ title: "重试" });

    // XP is written, then a later handler fails: the whole transaction rolls back.
    await expect(api.tasks.complete({ id: task.id })).rejects.toThrow();
    expect(await ledger(user.id)).toHaveLength(0);
    expect((await api.tasks.byId({ id: task.id })).statusCategory).toBe("unstarted");

    fail = false;
    await api.tasks.complete({ id: task.id });
    await api.tasks.complete({ id: task.id });
    expect(await ledger(user.id)).toHaveLength(1);
  });

  it("reverses on reopen and grants a new cycle on the next completion", async () => {
    const { user, api } = await seeded();
    const task = await api.tasks.create({ title: "反复", priority: 1 });
    const amount = TASK_XP.base + TASK_XP.perPriority;

    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });
    let rows = await ledger(user.id);
    expect(rows.map((r) => [r.kind, r.amount, r.cycle])).toEqual([
      ["grant", amount, 0],
      ["reversal", -amount, 0],
    ]);
    expect(rows[1]!.reversalOf).toBe(rows[0]!.id);
    expect(rows[1]!.sourceEventType).toBe("task.reopened");

    // Reopening again has nothing left to reverse.
    await api.tasks.reopen({ id: task.id });
    await api.tasks.complete({ id: task.id });
    rows = await ledger(user.id);
    expect(rows.map((r) => [r.kind, r.cycle])).toEqual([
      ["grant", 0],
      ["reversal", 0],
      ["grant", 1],
    ]);
    const history = await api.character.history({});
    expect(history.entries.map((e) => [e.kind, e.reversed])).toEqual([
      ["grant", false],
      ["reversal", false],
      ["grant", true],
    ]);
    expect((await api.character.overview()).progress.xp).toBe(amount);
  });

  it("treats completed → cancelled as a reversal of the completion", async () => {
    const { user, api } = await seeded();
    const statuses = await api.tasks.statuses.list();
    const cancelled = statuses.find((s) => s.systemKey === "cancelled")!;
    const done = statuses.find((s) => s.systemKey === "done")!;
    const task = await api.tasks.create({ title: "取消", priority: 2 });
    const amount = TASK_XP.base + 2 * TASK_XP.perPriority;

    await api.tasks.setStatus({ id: task.id, statusId: done.id });
    await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
    expect((await ledger(user.id)).map((r) => r.amount)).toEqual([amount, -amount]);
    expect((await api.character.overview()).progress.xp).toBe(0);

    // A task cancelled without ever being completed earns and loses nothing.
    const other = await api.tasks.create({ title: "直接取消" });
    await api.tasks.setStatus({ id: other.id, statusId: cancelled.id });
    expect(await ledger(user.id)).toHaveLength(2);
  });

  it("keeps XP when a completed task is deleted, restored or purged", async () => {
    const { user, api } = await seeded();
    const task = await api.tasks.create({ title: "保留经验" });
    await api.tasks.complete({ id: task.id });

    await api.tasks.delete({ id: task.id });
    expect((await api.character.overview()).progress.xp).toBe(TASK_XP.base);
    await api.tasks.trash.restore({ id: task.id });
    expect((await api.tasks.byId({ id: task.id })).statusCategory).toBe("completed");
    expect(await ledger(user.id)).toHaveLength(1);

    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.purge({ id: task.id });
    const rows = await ledger(user.id);
    expect(rows).toHaveLength(1);
    // History outlives the task.
    expect((await api.character.history({})).entries[0]).toMatchObject({
      sourceId: task.id,
      sourceTitle: "保留经验",
    });
  });

  it("gives subtasks a flat amount", async () => {
    const { api } = await seeded();
    const parent = await api.tasks.create({ title: "父", priority: 4 });
    const child = await api.tasks.create({ title: "子", parentTaskId: parent.id });
    await api.tasks.complete({ id: child.id });
    expect((await api.character.overview()).progress.xp).toBe(TASK_XP.subtask);
  });
});

describe("project and milestone XP", () => {
  it("grants and reverses project completions", async () => {
    const { user, api, area } = await seeded();
    const project = await api.projects.create({
      name: "官网改版",
      areaId: area("business"),
      priority: 2,
    });
    const amount = PROJECT_XP.base + 2 * PROJECT_XP.perPriority;

    await api.projects.update({ id: project.id, patch: { status: "completed" } });
    await api.projects.update({ id: project.id, patch: { name: "官网改版 v2" } });
    await api.projects.update({ id: project.id, patch: { status: "active" } });
    const rows = await ledger(user.id);
    expect(rows.map((r) => [r.kind, r.amount, r.sourceType, r.sourceTitle])).toEqual([
      ["grant", amount, "project", "官网改版"],
      ["reversal", -amount, "project", "官网改版"],
    ]);
    const business = (await api.character.attributes.list()).find(
      (a) => a.systemKey === "business",
    )!;
    expect(rows.every((r) => r.attributeId === business.id)).toBe(true);

    // completed → cancelled is a reversal as well.
    await api.projects.update({ id: project.id, patch: { status: "completed" } });
    await api.projects.update({ id: project.id, patch: { status: "cancelled" } });
    expect((await api.character.overview()).progress.xp).toBe(0);
  });

  it("grants milestone completions and reverses them on milestone.reopened", async () => {
    const { user, api, area } = await seeded();
    const project = await api.projects.create({ name: "DELF", areaId: area("learning") });
    const milestone = await api.projects.milestones.create({
      projectId: project.id,
      name: "完成报名",
    });

    await api.projects.milestones.setCompleted({ id: milestone.id, completed: true });
    expect(api.events.map((e) => e.type)).toEqual(["milestone.completed"]);
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: false });
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: false });
    expect(api.events.map((e) => e.type)).toEqual(["milestone.completed", "milestone.reopened"]);

    const learning = (await api.character.attributes.list()).find(
      (a) => a.systemKey === "learning",
    )!;
    const rows = await ledger(user.id);
    expect(rows.map((r) => [r.kind, r.amount, r.sourceTitle, r.attributeId])).toEqual([
      ["grant", MILESTONE_XP, "完成报名", learning.id],
      ["reversal", -MILESTONE_XP, "完成报名", learning.id],
    ]);
  });

  it("keeps XP when a completed project or milestone is deleted", async () => {
    const { api } = await seeded();
    const project = await api.projects.create({ name: "P", status: "completed" });
    const other = await api.projects.create({ name: "Q" });
    const milestone = await api.projects.milestones.create({ projectId: other.id, name: "M" });
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: true });
    const before = (await api.character.overview()).progress.xp;
    expect(before).toBe(PROJECT_XP.base + MILESTONE_XP);

    await api.projects.milestones.delete({ id: milestone.id });
    await api.projects.delete({ id: project.id });
    await api.projects.delete({ id: other.id });
    const overview = await api.character.overview();
    expect(overview.progress.xp).toBe(before);
    expect(overview.reversalCount).toBe(0);
  });
});

describe("totals, levels and attributes", () => {
  it("sums independent events into the total, level and history", async () => {
    const { api, area } = await seeded();
    const project = await api.projects.create({ name: "P", areaId: area("work") });
    const milestone = await api.projects.milestones.create({ projectId: project.id, name: "M" });
    const tasks = await Promise.all(
      [0, 1, 2, 3, 4].map((priority) =>
        api.tasks.create({ title: `任务${priority}`, priority, areaId: area("learning") }),
      ),
    );
    for (const task of tasks) await api.tasks.complete({ id: task.id });
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: true });
    await api.projects.update({ id: project.id, patch: { status: "completed" } });

    const taskXp = [0, 1, 2, 3, 4].reduce((sum, p) => sum + TASK_XP.base + p * 5, 0);
    const total = taskXp + MILESTONE_XP + PROJECT_XP.base;
    const overview = await api.character.overview();
    expect(total).toBe(230);
    expect(overview.progress).toMatchObject({ xp: total, level: 2, xpForNext: 200 }); // 100 ≤ 230 < 300
    expect(overview.progress.xpIntoLevel).toBe(total - 100);
    expect(overview.grantCount).toBe(7);

    const learning = overview.attributes.find((a) => a.systemKey === "learning")!;
    const work = overview.attributes.find((a) => a.systemKey === "work")!;
    expect(learning.xp).toBe(taskXp);
    expect(work.xp).toBe(MILESTONE_XP + PROJECT_XP.base);
    expect(learning.progress.level).toBe(2); // 50 ≤ 100 < 150 at the attribute step
    expect(overview.attributes.find((a) => a.systemKey === "fitness")!.xp).toBe(0);

    const page1 = await api.character.history({ limit: 4 });
    const page2 = await api.character.history({ limit: 4, cursor: page1.nextCursor! });
    expect(page1.entries).toHaveLength(4);
    expect(page2.entries).toHaveLength(3);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.entries, ...page2.entries].map((e) => e.id)).size).toBe(7);
    expect([...page1.entries, ...page2.entries].reduce((s, e) => s + e.amount, 0)).toBe(total);
  });

  it("credits attributes only through area links; overall XP includes everything", async () => {
    const { api, area } = await seeded();
    const attributes = await api.character.attributes.list();
    const life = attributes.find((a) => a.systemKey === "life")!;
    const fitness = attributes.find((a) => a.systemKey === "fitness")!;
    expect(fitness.areaIds).toEqual([area("health")]);

    const loose = await api.tasks.create({ title: "无领域" });
    await api.tasks.complete({ id: loose.id });
    // Re-link 个人生活 to 健身: only later completions follow the new link.
    const before = await api.tasks.create({ title: "之前", areaId: area("personal") });
    await api.tasks.complete({ id: before.id });
    await api.character.attributes.setArea({ areaId: area("personal"), attributeId: fitness.id });
    const after = await api.tasks.create({ title: "之后", areaId: area("personal") });
    await api.tasks.complete({ id: after.id });

    const overview = await api.character.overview();
    const value = (id: string) => overview.attributes.find((a) => a.id === id)!.xp;
    expect(overview.progress.xp).toBe(3 * TASK_XP.base);
    expect(value(life.id)).toBe(TASK_XP.base);
    expect(value(fitness.id)).toBe(TASK_XP.base);
    expect(overview.attributes.reduce((s, a) => s + a.xp, 0)).toBe(2 * TASK_XP.base);

    // Unlinking leaves an area crediting overall XP only.
    await api.character.attributes.setArea({ areaId: area("personal"), attributeId: null });
    expect(
      (await api.character.attributes.list()).find((a) => a.id === fitness.id)!.areaIds,
    ).toEqual([area("health")]);
  });
});

describe("ledger integrity and ownership", () => {
  it("rejects updates and direct deletes, but follows the user cascade", async () => {
    const { user, api } = await seeded();
    const task = await api.tasks.create({ title: "账本" });
    await api.tasks.complete({ id: task.id });

    await expect(db.update(xpLedger).set({ amount: 999 })).rejects.toThrow();
    await expect(db.delete(xpLedger)).rejects.toThrow();
    expect((await ledger(user.id))[0]!.amount).toBe(TASK_XP.base);

    await db.delete(users).where(sql`${users.id} = ${user.id}`);
    expect(await ledger(user.id)).toHaveLength(0);
  });

  it("never shows or changes another user's XP data", async () => {
    const a = await seeded();
    const b = await seeded();
    const task = await a.api.tasks.create({ title: "A 的任务" });
    await a.api.tasks.complete({ id: task.id });
    const [entry] = await ledger(a.user.id);
    const aAttribute = (await a.api.character.attributes.list())[0]!;

    expect((await b.api.character.overview()).progress.xp).toBe(0);
    expect((await b.api.character.history({})).entries).toEqual([]);
    expect((await b.api.character.history({ cursor: entry!.id })).entries).toEqual([]);
    expect((await b.api.character.history({ attributeId: aAttribute.id })).entries).toEqual([]);
    await expect(
      b.api.character.attributes.setArea({ areaId: a.area("work"), attributeId: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.api.character.attributes.setArea({ areaId: b.area("work"), attributeId: aAttribute.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A's events never credit B, even when replayed under B's bus.
    await expect(b.api.tasks.complete({ id: task.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await ledger(b.user.id)).toHaveLength(0);
    expect((await a.api.character.overview()).progress.xp).toBe(TASK_XP.base);
  });
});

describe("registration", () => {
  it("seeds attributes linked to the seeded areas", async () => {
    const { api, area } = await seeded();
    const attributes = await api.character.attributes.list();
    expect(attributes.map((a) => a.systemKey)).toEqual([
      "learning",
      "work",
      "fitness",
      "business",
      "admin",
      "life",
    ]);
    expect(attributes.find((a) => a.systemKey === "work")!.areaIds).toEqual([area("work")]);
    expect((await api.character.overview()).progress).toMatchObject({ level: 1, xp: 0 });
  });
});
