import { count, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { xpLedger } from "@/modules/character/db";
import { tasks } from "@/modules/tasks/db";
import { localDate } from "@/shared/lib/zoned-time";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * Task UX round (2026-11): a project's area as the default for its tasks, moving tasks into
 * projects in place, and completion with a confirmed (possibly earlier) date — through the real
 * routers, with the user's data intact around each change.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);

async function setup(timeZone = "Asia/Shanghai") {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone });
  const [work, learning] = await listAreas(db, user.id);
  return { user, api, areaA: work!.id, areaB: learning!.id };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(
    (error: { code?: unknown; cause?: { code?: unknown } }) =>
      error.code === code || error.cause?.code === code,
  );

const taskCount = async (userId: string) =>
  (await db.select({ n: count() }).from(tasks).where(eq(tasks.userId, userId)))[0]!.n;

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("a project's area as the default for its tasks", () => {
  it("applies when a task is created in a project, unless an area was chosen", async () => {
    const { api, areaA, areaB }: Ctx = await setup();
    const project = await api.projects.create({ name: "官网改版", areaId: areaA });
    expect((await api.tasks.create({ title: "继承", projectId: project.id })).areaId).toBe(areaA);
    expect(
      (await api.tasks.create({ title: "自选", projectId: project.id, areaId: areaB })).areaId,
    ).toBe(areaB);
    // An explicit "no area" is a choice too.
    expect(
      (await api.tasks.create({ title: "无领域", projectId: project.id, areaId: null })).areaId,
    ).toBeNull();
    // A project without an area gives none; tasks outside projects are unchanged.
    const bare = await api.projects.create({ name: "无领域项目" });
    expect((await api.tasks.create({ title: "空", projectId: bare.id })).areaId).toBeNull();
    expect((await api.tasks.create({ title: "独立" })).areaId).toBeNull();
  });

  it("fills only an empty area when a task is moved into a project, and never overwrites", async () => {
    const { api, areaA, areaB } = await setup();
    const project = await api.projects.create({ name: "报税", areaId: areaA });
    const empty = await api.tasks.create({ title: "无领域任务" });
    const chosen = await api.tasks.create({ title: "已选领域", areaId: areaB });

    expect(
      (await api.tasks.update({ id: empty.id, patch: { projectId: project.id } })).areaId,
    ).toBe(areaA);
    expect(
      (await api.tasks.update({ id: chosen.id, patch: { projectId: project.id } })).areaId,
    ).toBe(areaB);

    // The user changes the area afterwards: later edits keep it.
    await api.tasks.update({ id: empty.id, patch: { areaId: areaB } });
    await api.tasks.update({ id: empty.id, patch: { title: "改了标题", priority: 2 } });
    await api.tasks.update({ id: empty.id, patch: { dueDate: "2026-12-01" } });
    expect((await api.tasks.byId({ id: empty.id })).areaId).toBe(areaB);
    // Leaving the project keeps the area as it is.
    expect((await api.tasks.update({ id: empty.id, patch: { projectId: null } })).areaId).toBe(
      areaB,
    );
    // Setting project and area together: the given area wins.
    const both = await api.tasks.create({ title: "同时设置" });
    expect(
      (await api.tasks.update({ id: both.id, patch: { projectId: project.id, areaId: null } }))
        .areaId,
    ).toBeNull();
  });

  it("moves a task into a project in place: same record, links and history", async () => {
    const { api, user, areaA } = await setup();
    const project = await api.projects.create({ name: "搬家", areaId: areaA });
    const [attribute] = (await api.character.attributes.list()).filter((a) => a.systemKey);
    const tag = await api.tasks.tags.create({ name: "纸箱" });
    const task = await api.tasks.create({
      title: "打包书籍",
      tagIds: [tag.id],
      contributions: [{ attributeId: attribute!.id, weight: 2 }],
      startDate: "2026-10-20",
      dueDate: "2026-11-20",
      priority: 3,
    });
    const subtask = await api.tasks.create({ title: "买胶带", parentTaskId: task.id });
    const blocker = await api.tasks.create({ title: "订纸箱" });
    await api.tasks.dependencies.add({ blockingTaskId: blocker.id, blockedTaskId: task.id });
    const before = await api.tasks.byId({ id: task.id });
    const rows = await taskCount(user.id);

    await api.tasks.update({ id: task.id, patch: { projectId: project.id } });

    const after = await api.tasks.byId({ id: task.id });
    expect(await taskCount(user.id)).toBe(rows); // nothing recreated
    expect(after).toMatchObject({
      id: before.id,
      projectId: project.id,
      areaId: areaA,
      tagIds: [tag.id],
      contributions: before.contributions,
      startDate: "2026-10-20",
      dueDate: "2026-11-20",
      priority: 3,
      createdAt: before.createdAt,
    });
    expect(after.subtasks.map((s) => s.id)).toEqual([subtask.id]);
    expect(after.blockedBy.map((b) => b.id)).toEqual([blocker.id]);
    expect((await api.projects.byId({ id: project.id, today: "2026-11-01" })).progress.total).toBe(
      1,
    );
  });

  it("never sets a start date on its own, on create or on edit", async () => {
    const { api } = await setup();
    const task = await api.tasks.create({ title: "无开始日期" });
    expect(task.startDate).toBeNull();
    await api.tasks.update({ id: task.id, patch: { title: "改名", dueDate: "2026-12-24" } });
    expect((await api.tasks.byId({ id: task.id })).startDate).toBeNull();
  });
});

describe("completion with a confirmed date", () => {
  it("records today as now, and an earlier day at noon local time on that day", async () => {
    const { api } = await setup("Asia/Shanghai");
    const today = await api.tasks.create({ title: "今天完成" });
    const before = Date.now();
    const done = await api.tasks.complete({ id: today.id });
    expect(done.statusCategory).toBe("completed");
    expect(done.completedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const late = await api.tasks.create({ title: "补录" });
    const recorded = await api.tasks.complete({ id: late.id, completedOn: "2026-10-20" });
    expect(recorded.completedAt!.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(localDate(recorded.completedAt!.getTime(), "Asia/Shanghai")).toBe("2026-10-20");
    // Completed once: one XP entry, like any completion.
    const xp = await db.select({ n: count() }).from(xpLedger).where(eq(xpLedger.sourceId, late.id));
    expect(xp[0]!.n).toBe(1);
  });

  it("refuses a future date and leaves the task open", async () => {
    const { api } = await setup("UTC");
    const task = await api.tasks.create({ title: "未来" });
    await rejects(
      api.tasks.complete({ id: task.id, completedOn: "2999-01-01" }),
      "task.completed_in_future",
    );
    expect((await api.tasks.byId({ id: task.id })).statusCategory).not.toBe("completed");
  });

  it("never overwrites an existing completion", async () => {
    const { api } = await setup();
    const task = await api.tasks.create({ title: "早已完成" });
    const first = await api.tasks.complete({ id: task.id, completedOn: "2026-10-01" });
    const again = await api.tasks.complete({ id: task.id, completedOn: "2026-10-15" });
    expect(again.completedAt).toEqual(first.completedAt);
  });

  it("completes open subtasks on the same date only when asked; closed ones are left alone", async () => {
    const { api } = await setup();
    const parent = await api.tasks.create({ title: "父任务" });
    const open = await api.tasks.create({ title: "子一", parentTaskId: parent.id });
    const nested = await api.tasks.create({ title: "孙", parentTaskId: open.id });
    const cancelled = await api.tasks.create({ title: "子二", parentTaskId: parent.id });
    const cancelledStatus = (await api.tasks.statuses.list()).find(
      (s) => s.category === "cancelled",
    )!;
    await api.tasks.setStatus({ id: cancelled.id, statusId: cancelledStatus.id });

    const plain = await api.tasks.create({ title: "另一个父任务" });
    const plainChild = await api.tasks.create({ title: "保持打开", parentTaskId: plain.id });
    await api.tasks.complete({ id: plain.id, completedOn: "2026-10-30" });
    expect((await api.tasks.byId({ id: plainChild.id })).statusCategory).not.toBe("completed");

    const done = await api.tasks.complete({
      id: parent.id,
      completedOn: "2026-10-30",
      includeSubtasks: true,
    });
    for (const id of [open.id, nested.id]) {
      const child = await api.tasks.byId({ id });
      expect(child.statusCategory).toBe("completed");
      expect(child.completedAt).toEqual(done.completedAt);
    }
    expect((await api.tasks.byId({ id: cancelled.id })).statusCategory).toBe("cancelled");
  });

  it("completes into a chosen completed status, and refuses a status of another kind", async () => {
    const { api } = await setup();
    const statuses = await api.tasks.statuses.list();
    const completed = statuses.filter((s) => s.category === "completed");
    const started = statuses.find((s) => s.category === "started")!;
    const task = await api.tasks.create({ title: "选择状态" });
    await rejects(
      api.tasks.complete({ id: task.id, statusId: started.id }),
      "task.not_a_completion",
    );
    const done = await api.tasks.complete({ id: task.id, statusId: completed.at(-1)!.id });
    expect(done.statusId).toBe(completed.at(-1)!.id);
  });
});
