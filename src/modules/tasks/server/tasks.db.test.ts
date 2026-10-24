import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { tasks } from "../db";
import { registerTasksEventHandlers } from "./events";
import { tasksRouter } from "./router";

const { db, close } = createTestDb();

function setup(userId: string | null) {
  const bus = createEventBus();
  const events: DomainEvent[] = [];
  const record = (event: DomainEvent) => void events.push(event);
  bus.subscribe("task.created", record, { name: "test.created" });
  bus.subscribe("task.completed", record, { name: "test.completed" });
  bus.subscribe("task.reopened", record, { name: "test.reopened" });
  const api = createCallerFactory(tasksRouter)({ db, bus, userId, resHeaders: null });
  return { api, bus, events, types: () => events.map((e) => e.type) };
}

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("statuses", () => {
  it("seeds the five default statuses on registration", async () => {
    const bus = createEventBus();
    registerTasksEventHandlers(bus);
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    expect((await api.statuses.list()).map((s) => [s.systemKey, s.category])).toEqual([
      ["backlog", "backlog"],
      ["todo", "unstarted"],
      ["in_progress", "started"],
      ["done", "completed"],
      ["cancelled", "cancelled"],
    ]);
  });

  it("creates custom statuses inside a fixed category and reorders within it", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const review = await api.statuses.create({
      name: "待审核",
      category: "started",
      color: "violet",
    });
    let started = (await api.statuses.list()).filter((s) => s.category === "started");
    expect(started.map((s) => s.id).at(-1)).toBe(review.id);

    await api.statuses.move({ id: review.id, direction: "up" });
    started = (await api.statuses.list()).filter((s) => s.category === "started");
    expect(started[0]!.id).toBe(review.id);
  });

  it("protects the last status of a category and requires a same-category replacement when in use", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const statuses = await api.statuses.list();
    const done = statuses.find((s) => s.systemKey === "done")!;
    const todo = statuses.find((s) => s.systemKey === "todo")!;
    await expect(api.statuses.delete({ id: done.id })).rejects.toMatchObject({
      message: "status.last_in_category",
    });

    const next = await api.statuses.create({
      name: "下一步",
      category: "unstarted",
      color: "teal",
    });
    const task = await api.create({ title: "任务", statusId: todo.id });
    await expect(api.statuses.delete({ id: todo.id })).rejects.toMatchObject({
      message: "status.in_use",
    });
    await expect(
      api.statuses.delete({ id: todo.id, replacementStatusId: done.id }),
    ).rejects.toMatchObject({
      message: "status.replacement_category_mismatch",
    });

    await api.statuses.delete({ id: todo.id, replacementStatusId: next.id });
    expect((await api.byId({ id: task.id })).statusId).toBe(next.id);
  });
});

describe("tags", () => {
  it("creates, renames and deletes tags; names are unique per user, case-insensitively", async () => {
    const user = await createSeededUser(db);
    const other = await createSeededUser(db);
    const { api } = setup(user.id);

    const tag = await api.tags.create({ name: "French", color: "blue" });
    await expect(api.tags.create({ name: "french" })).rejects.toMatchObject({ code: "CONFLICT" });
    await setup(other.id).api.tags.create({ name: "French" }); // fine for another user

    expect((await api.tags.update({ id: tag.id, name: "法语" })).name).toBe("法语");
    const task = await api.create({ title: "听力", tagIds: [tag.id] });
    await api.tags.delete({ id: tag.id });
    expect((await api.byId({ id: task.id })).tagIds).toEqual([]);
  });
});

describe("tasks", () => {
  it("creates a task with defaults and publishes task.created", async () => {
    const user = await createSeededUser(db);
    const { api, events } = setup(user.id);
    const task = await api.create({ title: "完成法语听力练习" });

    expect(task).toMatchObject({
      title: "完成法语听力练习",
      statusCategory: "unstarted",
      priority: 0,
      isUrgent: null,
      isImportant: null,
      areaId: null,
      completedAt: null,
      subtaskCount: 0,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "task.created",
      userId: user.id,
      payload: { taskId: task.id, parentTaskId: null },
    });
  });

  it("stores every M1 field on create and update", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const [area] = await listAreas(db, user.id);
    const tag = await api.tags.create({ name: "法语" });

    const task = await api.create({
      title: "背单词",
      description: doc("每天 30 个"),
      areaId: area!.id,
      priority: 3,
      isUrgent: true,
      isImportant: false,
      startDate: "2026-10-25",
      dueDate: "2026-10-27",
      dueTime: "19:30",
      estimatedMinutes: 45,
      tagIds: [tag.id],
    });
    expect(task).toMatchObject({
      description: doc("每天 30 个"),
      areaId: area!.id,
      priority: 3,
      isUrgent: true,
      isImportant: false,
      startDate: "2026-10-25",
      dueDate: "2026-10-27",
      dueTime: "19:30",
      estimatedMinutes: 45,
      tagIds: [tag.id],
    });

    const updated = await api.update({
      id: task.id,
      patch: {
        title: "背 50 个单词",
        dueTime: null,
        dueDate: null,
        areaId: null,
        isImportant: true,
        tagIds: [],
      },
    });
    expect(updated).toMatchObject({
      title: "背 50 个单词",
      dueDate: null,
      dueTime: null,
      areaId: null,
      isImportant: true,
      tagIds: [],
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(task.updatedAt.getTime());
  });

  it("rejects inconsistent schedules, including when combined with stored values", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    await expect(api.create({ title: "x", dueTime: "10:00" })).rejects.toMatchObject({
      message: "task.due_time_without_date",
    });
    const task = await api.create({ title: "x", dueDate: "2026-10-27", dueTime: "10:00" });
    await expect(api.update({ id: task.id, patch: { dueDate: null } })).rejects.toMatchObject({
      message: "task.due_time_without_date",
    });
    await expect(
      api.update({ id: task.id, patch: { startDate: "2026-10-30" } }),
    ).rejects.toMatchObject({
      message: "task.start_after_due",
    });
  });

  it("completes and reopens tasks with timestamps and events", async () => {
    const user = await createSeededUser(db);
    const { api, types } = setup(user.id);
    const task = await api.create({ title: "跑步", priority: 2, estimatedMinutes: 30 });

    const done = await api.complete({ id: task.id });
    expect(done.statusCategory).toBe("completed");
    expect(done.completedAt).toBeInstanceOf(Date);

    await api.complete({ id: task.id }); // idempotent: no second event
    const reopened = await api.reopen({ id: task.id });
    expect(reopened).toMatchObject({ statusCategory: "unstarted", completedAt: null });
    await api.reopen({ id: task.id }); // no-op

    expect(types()).toEqual(["task.created", "task.completed", "task.reopened"]);
  });

  it("includes task facts in task.completed for future XP rules", async () => {
    const user = await createSeededUser(db);
    const { api, events } = setup(user.id);
    const task = await api.create({
      title: "x",
      priority: 4,
      isImportant: true,
      estimatedMinutes: 50,
    });
    await api.complete({ id: task.id });
    expect(events.at(-1)).toMatchObject({
      type: "task.completed",
      payload: {
        taskId: task.id,
        priority: 4,
        isImportant: true,
        isUrgent: null,
        estimatedMinutes: 50,
      },
    });
  });

  it("changes status through any category", async () => {
    const user = await createSeededUser(db);
    const { api, types } = setup(user.id);
    const statuses = await api.statuses.list();
    const byKey = (k: string) => statuses.find((s) => s.systemKey === k)!.id;
    const task = await api.create({ title: "x" });

    expect(
      (await api.setStatus({ id: task.id, statusId: byKey("in_progress") })).statusCategory,
    ).toBe("started");
    const cancelled = await api.setStatus({ id: task.id, statusId: byKey("cancelled") });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect((await api.reopen({ id: task.id })).cancelledAt).toBeNull();
    expect(types()).toEqual(["task.created"]);
  });

  it("supports subtasks with progress counts", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const parent = await api.create({ title: "准备 DELF 考试" });
    const a = await api.create({ title: "听力", parentTaskId: parent.id });
    await api.create({ title: "阅读", parentTaskId: parent.id });
    await api.complete({ id: a.id });

    const detail = await api.byId({ id: parent.id });
    expect(detail.subtasks.map((s) => s.title)).toEqual(["听力", "阅读"]);
    expect(detail).toMatchObject({ subtaskCount: 2, completedSubtaskCount: 1 });
    expect((await api.byId({ id: a.id })).parent).toEqual({
      id: parent.id,
      title: "准备 DELF 考试",
    });

    // Subtasks are not listed at the top level.
    expect((await api.list()).map((t) => t.title)).toEqual(["准备 DELF 考试"]);
  });

  it("lists tasks in creation order", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    for (const title of ["一", "二", "三"]) await api.create({ title });
    expect((await api.list()).map((t) => t.title)).toEqual(["一", "二", "三"]);
  });

  it("soft-deletes a task together with its subtasks", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const parent = await api.create({ title: "parent" });
    const child = await api.create({ title: "child", parentTaskId: parent.id });
    await api.create({ title: "grandchild", parentTaskId: child.id });
    await api.create({ title: "keep" });

    await api.delete({ id: parent.id });

    expect((await api.list()).map((t) => t.title)).toEqual(["keep"]);
    await expect(api.byId({ id: child.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rows = await db.select().from(tasks).where(eq(tasks.userId, user.id));
    expect(rows.filter((r) => r.deletedAt).length).toBe(3); // still stored, only hidden
    await expect(api.create({ title: "x", parentTaskId: parent.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("clears the area of tasks when the area is deleted", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const [area] = await listAreas(db, user.id);
    const task = await api.create({ title: "x", areaId: area!.id });
    const { areasRouter } = await import("@/modules/areas/server");
    await createCallerFactory(areasRouter)({
      db,
      bus: createEventBus(),
      userId: user.id,
      resHeaders: null,
    }).delete({
      id: area!.id,
    });
    expect((await api.byId({ id: task.id })).areaId).toBeNull();
  });

  it("rolls back the change when an event handler fails", async () => {
    const user = await createSeededUser(db);
    const { api, bus } = setup(user.id);
    const task = await api.create({ title: "x" });
    bus.subscribe("task.completed", vi.fn().mockRejectedValue(new Error("xp failed")), {
      name: "test.failing",
    });

    await expect(api.complete({ id: task.id })).rejects.toThrow();
    expect((await api.byId({ id: task.id })).statusCategory).toBe("unstarted");
  });
});

describe("authorization", () => {
  it("never reads or writes another user's tasks or references", async () => {
    const owner = await createSeededUser(db);
    const intruder = await createSeededUser(db);
    const ownerApi = setup(owner.id).api;
    const { api } = setup(intruder.id);

    const [ownerArea] = await listAreas(db, owner.id);
    const ownerTag = await ownerApi.tags.create({ name: "secret" });
    const ownerStatus = (await ownerApi.statuses.list())[0]!;
    const task = await ownerApi.create({ title: "私人任务" });

    expect(await api.list()).toEqual([]);
    for (const attempt of [
      () => api.byId({ id: task.id }),
      () => api.update({ id: task.id, patch: { title: "hacked" } }),
      () => api.complete({ id: task.id }),
      () => api.reopen({ id: task.id }),
      () => api.delete({ id: task.id }),
      () => api.create({ title: "x", parentTaskId: task.id }),
      () => api.create({ title: "x", areaId: ownerArea!.id }),
      () => api.create({ title: "x", tagIds: [ownerTag.id] }),
      () => api.create({ title: "x", statusId: ownerStatus.id }),
      () => api.tags.update({ id: ownerTag.id, name: "x" }),
      () => api.tags.delete({ id: ownerTag.id }),
      () => api.statuses.update({ id: ownerStatus.id, name: "x" }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await ownerApi.byId({ id: task.id })).title).toBe("私人任务");
  });

  it("requires authentication", async () => {
    await expect(setup(null).api.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
