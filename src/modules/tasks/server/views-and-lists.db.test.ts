import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import type { TaskListQuery } from "../domain";
import { tasksRouter } from "./router";

const { db, close } = createTestDb();
const TODAY = "2026-10-25";

function setup(userId: string) {
  const bus = createEventBus();
  const events: DomainEvent[] = [];
  bus.subscribe("task.deleted", (e) => void events.push(e), { name: "test.deleted" });
  bus.subscribe("task.restored", (e) => void events.push(e), { name: "test.restored" });
  const api = createCallerFactory(tasksRouter)({ db, bus, userId, resHeaders: null });
  const list = (query: Partial<TaskListQuery> = {}) => api.list({ today: TODAY, ...query });
  const titles = async (query: Partial<TaskListQuery> = {}) =>
    (await list(query)).map((t) => t.title);
  return { api, list, titles, events };
}

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("filtering", () => {
  it("filters by status category, priority, flags and due date", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    await api.create({ title: "逾期", dueDate: "2026-10-20", priority: 4, isUrgent: true });
    await api.create({ title: "今天", dueDate: TODAY, priority: 2, isImportant: true });
    await api.create({ title: "本周", dueDate: "2026-10-31", isImportant: false });
    await api.create({ title: "以后", dueDate: "2026-12-01" });
    const done = await api.create({ title: "已完成", priority: 4 });
    await api.complete({ id: done.id });

    expect(await titles({ filter: { due: "overdue" } })).toEqual(["逾期"]);
    expect(await titles({ filter: { due: "today" } })).toEqual(["今天"]);
    expect(await titles({ filter: { due: "week" } })).toEqual(["今天", "本周"]);
    expect(await titles({ filter: { due: "none" } })).toEqual(["已完成"]);
    expect(await titles({ filter: { due: "any" } })).toHaveLength(4);
    expect(await titles({ filter: { priorities: [4] } })).toEqual(["逾期", "已完成"]);
    expect(await titles({ filter: { categories: ["completed"] } })).toEqual(["已完成"]);
    expect(await titles({ filter: { urgent: "yes" } })).toEqual(["逾期"]);
    expect(await titles({ filter: { important: "no" } })).toEqual(["本周"]);
    expect(await titles({ filter: { important: "unset", due: "any" } })).toEqual(["逾期", "以后"]);
  });

  it("filters by areas (including 'no area') and tags", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const [personal, learning] = await listAreas(db, user.id);
    const french = await api.tags.create({ name: "法语" });
    const exam = await api.tags.create({ name: "考试" });
    await api.create({ title: "学习任务", areaId: learning!.id, tagIds: [french.id] });
    await api.create({ title: "生活任务", areaId: personal!.id, tagIds: [exam.id] });
    await api.create({ title: "无领域" });

    expect(await titles({ filter: { areaIds: [learning!.id] } })).toEqual(["学习任务"]);
    expect(await titles({ filter: { areaIds: [learning!.id], noArea: true } })).toEqual([
      "学习任务",
      "无领域",
    ]);
    expect(await titles({ filter: { noArea: true } })).toEqual(["无领域"]);
    expect(await titles({ filter: { tagIds: [french.id, exam.id] } })).toEqual([
      "学习任务",
      "生活任务",
    ]);
    expect(await titles({ filter: { tagIds: [exam.id], areaIds: [learning!.id] } })).toEqual([]);
  });
});

describe("search", () => {
  it("finds tasks by title or description at any level, including two-character Chinese", async () => {
    const user = await createSeededUser(db);
    const { api, list, titles } = setup(user.id);
    const parent = await api.create({ title: "准备 DELF 考试" });
    await api.create({ title: "听力练习", parentTaskId: parent.id });
    await api.create({ title: "买菜", description: doc("记得买法语课本") });
    await api.create({ title: "100% 完成" });

    expect(await titles({ search: "听力" })).toEqual(["听力练习"]);
    expect((await list({ search: "听力" }))[0]!.parentTitle).toBe("准备 DELF 考试");
    expect(await titles({ search: "法语" })).toEqual(["买菜"]);
    expect(await titles({ search: "delf" })).toEqual(["准备 DELF 考试"]);
    expect(await titles({ search: "%" })).toEqual(["100% 完成"]); // LIKE wildcards are escaped
    expect(await titles({ search: "不存在" })).toEqual([]);
  });

  it("keeps the search text in sync when a description changes", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const task = await api.create({ title: "任务", description: doc("旧内容") });
    await api.update({ id: task.id, patch: { description: doc("新的笔记") } });
    expect(await titles({ search: "旧内容" })).toEqual([]);
    expect(await titles({ search: "新的笔记" })).toEqual(["任务"]);
    await api.update({ id: task.id, patch: { description: null } });
    expect(await titles({ search: "新的笔记" })).toEqual([]);
  });

  it("returns subtasks only when asked (or searching)", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const parent = await api.create({ title: "父任务" });
    await api.create({ title: "子任务", parentTaskId: parent.id, dueDate: TODAY });
    expect(await titles({ filter: { due: "today" } })).toEqual([]);
    expect(await titles({ filter: { due: "today" }, includeSubtasks: true })).toEqual(["子任务"]);
  });
});

describe("sorting", () => {
  it("sorts manually, by due date, priority, creation and update time", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const a = await api.create({ title: "A", priority: 1, dueDate: "2026-11-02" });
    await api.create({ title: "B", priority: 4 });
    await api.create({ title: "C", priority: 2, dueDate: "2026-10-26", dueTime: "09:00" });
    await api.update({ id: a.id, patch: { title: "A2" } });

    expect(await titles()).toEqual(["A2", "B", "C"]);
    expect(await titles({ sort: "due" })).toEqual(["C", "A2", "B"]);
    expect(await titles({ sort: "priority" })).toEqual(["B", "C", "A2"]);
    expect(await titles({ sort: "created" })).toEqual(["C", "B", "A2"]);
    expect((await titles({ sort: "updated" }))[0]).toBe("A2");
  });
});

describe("reordering", () => {
  it("moves a task between neighbours and to the edges", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const [a, b, c] = [
      await api.create({ title: "A" }),
      await api.create({ title: "B" }),
      await api.create({ title: "C" }),
    ];

    await api.move({ id: c.id, afterId: a.id, beforeId: b.id });
    expect(await titles()).toEqual(["A", "C", "B"]);
    await api.move({ id: a.id, afterId: b.id, beforeId: null });
    expect(await titles()).toEqual(["C", "B", "A"]);
    await api.move({ id: a.id, afterId: null, beforeId: c.id });
    expect(await titles()).toEqual(["A", "C", "B"]);
  });

  it("rejects stale or cross-parent neighbours", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const [a, b, c] = [
      await api.create({ title: "A" }),
      await api.create({ title: "B" }),
      await api.create({ title: "C" }),
    ];
    const sub = await api.create({ title: "sub", parentTaskId: a.id });
    await expect(api.move({ id: a.id, afterId: c.id, beforeId: b.id })).rejects.toMatchObject({
      message: "task.order_conflict",
    });
    await expect(api.move({ id: a.id, afterId: sub.id, beforeId: null })).rejects.toMatchObject({
      message: "task.order_conflict",
    });
  });

  it("reorders subtasks within their parent", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const parent = await api.create({ title: "P" });
    const one = await api.create({ title: "1", parentTaskId: parent.id });
    const two = await api.create({ title: "2", parentTaskId: parent.id });
    await api.move({ id: two.id, afterId: null, beforeId: one.id });
    expect((await api.byId({ id: parent.id })).subtasks.map((s) => s.title)).toEqual(["2", "1"]);
  });
});

describe("changing the parent", () => {
  it("moves tasks under another task and back to the top level", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const parent = await api.create({ title: "P" });
    const task = await api.create({ title: "T" });

    await api.setParent({ id: task.id, parentTaskId: parent.id });
    expect(await titles()).toEqual(["P"]);
    expect((await api.byId({ id: parent.id })).subtasks.map((s) => s.title)).toEqual(["T"]);

    await api.setParent({ id: task.id, parentTaskId: null });
    expect(await titles()).toEqual(["P", "T"]);
  });

  it("prevents cycles", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const a = await api.create({ title: "A" });
    const b = await api.create({ title: "B", parentTaskId: a.id });
    const c = await api.create({ title: "C", parentTaskId: b.id });
    await expect(api.setParent({ id: a.id, parentTaskId: c.id })).rejects.toMatchObject({
      message: "task.parent_cycle",
    });
    await expect(api.setParent({ id: a.id, parentTaskId: a.id })).rejects.toMatchObject({
      message: "task.parent_cycle",
    });
  });
});

describe("trash", () => {
  it("lists deletions, restores them with their subtasks and publishes events", async () => {
    const user = await createSeededUser(db);
    const { api, titles, events } = setup(user.id);
    const parent = await api.create({ title: "父任务" });
    await api.create({ title: "子任务", parentTaskId: parent.id });
    await api.delete({ id: parent.id });

    const trash = await api.trash.list();
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ title: "父任务", subtaskCount: 1, parentTitle: null });

    await api.trash.restore({ id: parent.id });
    expect(await titles()).toEqual(["父任务"]);
    expect((await api.byId({ id: parent.id })).subtaskCount).toBe(1);
    expect(await api.trash.list()).toEqual([]);
    expect(
      events.map((e) => [e.type, (e.payload as { taskIds: string[] }).taskIds.length]),
    ).toEqual([
      ["task.deleted", 2],
      ["task.restored", 2],
    ]);
  });

  it("restores a subtask as a top-level task when its parent is still deleted", async () => {
    const user = await createSeededUser(db);
    const { api, titles } = setup(user.id);
    const parent = await api.create({ title: "P" });
    const child = await api.create({ title: "C", parentTaskId: parent.id });
    await api.delete({ id: child.id });
    await api.delete({ id: parent.id });
    expect((await api.trash.list()).map((t) => t.title).sort()).toEqual(["C", "P"]);

    await api.trash.restore({ id: child.id });
    expect(await titles()).toEqual(["C"]);
    expect((await api.byId({ id: child.id })).parentTaskId).toBeNull();
  });

  it("purges single tasks and empties the trash", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const a = await api.create({ title: "A" });
    const b = await api.create({ title: "B" });
    await api.delete({ id: a.id });
    await api.delete({ id: b.id });

    await api.trash.purge({ id: a.id });
    expect((await api.trash.list()).map((t) => t.title)).toEqual(["B"]);
    await expect(api.trash.purge({ id: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await api.trash.empty()).toBe(1);
    expect(await api.trash.list()).toEqual([]);
  });

  it("does not let active tasks be purged or restored", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const task = await api.create({ title: "active" });
    await expect(api.trash.purge({ id: task.id })).rejects.toMatchObject({
      message: "task.not_in_trash",
    });
    await expect(api.trash.restore({ id: task.id })).rejects.toMatchObject({
      message: "task.not_in_trash",
    });
  });
});

describe("scoped views", () => {
  it("defaults each view to its seeded area and can be customised", async () => {
    const user = await createSeededUser(db);
    const { api } = setup(user.id);
    const areas = await listAreas(db, user.id);
    const bySystemKey = (key: string) => areas.find((a) => a.systemKey === key)!.id;

    expect(await api.views.get({ key: "work" })).toEqual({
      key: "work",
      areaIds: [bySystemKey("work")],
      customized: false,
    });

    const updated = await api.views.update({
      key: "work",
      areaIds: [bySystemKey("work"), bySystemKey("business")],
    });
    expect(updated.customized).toBe(true);
    expect((await api.views.get({ key: "work" })).areaIds).toHaveLength(2);

    await api.views.update({ key: "admin", areaIds: [] });
    expect(await api.views.get({ key: "admin" })).toMatchObject({ areaIds: [], customized: true });
  });
});

describe("authorization", () => {
  it("keeps lists, search, trash, reordering, parents and views per user", async () => {
    const owner = await createSeededUser(db);
    const intruder = await createSeededUser(db);
    const ownerApi = setup(owner.id).api;
    const { api, titles } = setup(intruder.id);
    const [ownerArea] = await listAreas(db, owner.id);

    const secret = await ownerApi.create({ title: "秘密任务", description: doc("机密") });
    const other = await ownerApi.create({ title: "另一个" });
    const mine = await api.create({ title: "我的任务" });
    await ownerApi.delete({ id: other.id });

    expect(await titles({ search: "秘密" })).toEqual([]);
    expect(await titles({ search: "机密" })).toEqual([]);
    expect(await titles({ filter: { areaIds: [ownerArea!.id] } })).toEqual([]);
    expect(await api.trash.list()).toEqual([]);
    for (const attempt of [
      () => api.move({ id: secret.id, afterId: null, beforeId: null }),
      () => api.move({ id: mine.id, afterId: secret.id, beforeId: null }),
      () => api.setParent({ id: mine.id, parentTaskId: secret.id }),
      () => api.setParent({ id: secret.id, parentTaskId: null }),
      () => api.trash.restore({ id: other.id }),
      () => api.trash.purge({ id: other.id }),
      () => api.views.update({ key: "work", areaIds: [ownerArea!.id] }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await api.trash.empty()).toBe(0);
    expect((await ownerApi.trash.list()).map((t) => t.title)).toEqual(["另一个"]);
  });
});
