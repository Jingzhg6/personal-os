import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { projectsRouter } from "@/modules/projects/server";
import { matrixPlacement, type Task, type TaskListQuery } from "@/modules/tasks/domain";
import { tasksRouter } from "@/modules/tasks/server";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

/*
 * M0–M5 integration audit: one task record seen through every view, cross-view changes,
 * lifecycle, ownership and event integrity (the events M6 XP will consume).
 */

const { db, close } = createTestDb();
const TODAY = "2026-10-25";

const watched = [
  "task.completed",
  "task.reopened",
  "task.deleted",
  "task.restored",
  "project.completed",
  "project.reopened",
  "milestone.completed",
] as const;

function setup(userId: string) {
  const bus = createEventBus();
  const events: DomainEvent[] = [];
  for (const type of watched) {
    bus.subscribe(type, (e) => void events.push(e), { name: `audit.${type}` });
  }
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    projects: createCallerFactory(projectsRouter)(ctx),
    count: (type: (typeof watched)[number]) => events.filter((e) => e.type === type).length,
  };
}

type Api = ReturnType<typeof setup>;

const query = (patch: Partial<TaskListQuery> = {}): TaskListQuery => ({
  today: TODAY,
  sort: "manual",
  includeSubtasks: false,
  filter: {},
  ...patch,
});

/** The task as every screen fetches it (same queries the UI sends). */
async function everywhere(api: Api, id: string, extra: { areaId?: string; projectId?: string }) {
  const pick = (list: Task[]) => list.find((t) => t.id === id);
  const open = ["backlog", "unstarted", "started"] as const;
  return {
    all: pick(await api.tasks.list(query())),
    matrix: pick(
      await api.tasks.list(query({ includeSubtasks: true, filter: { categories: [...open] } })),
    ),
    scoped: extra.areaId
      ? pick(await api.tasks.list(query({ filter: { areaIds: [extra.areaId] } })))
      : undefined,
    project: extra.projectId
      ? pick(await api.tasks.list(query({ filter: { projectIds: [extra.projectId] } })))
      : undefined,
    gantt: pick(
      (await api.tasks.timeline(query({ filter: { categories: [...open, "completed"] } }))).tasks,
    ),
    detail: await api.tasks.byId({ id }),
  };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("one task, every view", () => {
  it("shows the same record everywhere and propagates every change", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const [area] = await listAreas(db, user.id);
    const p1 = await api.projects.create({ name: "P1" });
    const p2 = await api.projects.create({ name: "P2" });
    const m1 = await api.projects.milestones.create({ projectId: p1.id, name: "M1" });
    const statuses = await api.tasks.statuses.list();
    const doing = statuses.find((s) => s.systemKey === "in_progress")!;
    const done = statuses.find((s) => s.systemKey === "done")!;

    const task = await api.tasks.create({
      title: "统一任务",
      areaId: area!.id,
      milestoneId: m1.id, // implies P1
      startDate: "2026-11-01",
      dueDate: "2026-11-05",
    });
    const blocker = await api.tasks.create({ title: "前置", dueDate: "2026-11-03" });
    const ids = { areaId: area!.id, projectId: p1.id };

    let views = await everywhere(api, task.id, ids);
    for (const [view, seen] of Object.entries(views)) {
      expect(seen?.id, view).toBe(task.id);
      expect(seen?.projectId, view).toBe(p1.id);
      expect(seen?.milestoneId, view).toBe(m1.id);
    }
    expect((await api.tasks.list(query({ search: "统一" }))).map((t) => t.id)).toEqual([task.id]);

    // Matrix: flags are the only stored state; the quadrant is derived.
    await api.tasks.update({ id: task.id, patch: { isUrgent: true, isImportant: false } });
    views = await everywhere(api, task.id, ids);
    for (const seen of Object.values(views)) {
      expect(matrixPlacement(seen!)).toBe("delegate");
    }

    // Kanban: a status change is seen everywhere, with project progress following.
    await api.tasks.setStatus({ id: task.id, statusId: doing.id });
    views = await everywhere(api, task.id, ids);
    for (const seen of Object.values(views)) expect(seen!.statusCategory).toBe("started");

    // Gantt: date changes.
    await api.tasks.update({
      id: task.id,
      patch: { startDate: "2026-11-02", dueDate: "2026-11-09" },
    });
    views = await everywhere(api, task.id, ids);
    for (const seen of Object.values(views)) {
      expect([seen!.startDate, seen!.dueDate]).toEqual(["2026-11-02", "2026-11-09"]);
    }

    // Dependencies: detail, blocked state and Gantt edges.
    await api.tasks.dependencies.add({ blockingTaskId: blocker.id, blockedTaskId: task.id });
    views = await everywhere(api, task.id, ids);
    for (const seen of Object.values(views)) expect(seen!.openBlockerCount).toBe(1);
    expect(views.detail.blockedBy.map((d) => d.id)).toEqual([blocker.id]);
    expect((await api.tasks.timeline(query())).dependencies).toEqual([
      { blockingTaskId: blocker.id, blockedTaskId: task.id },
    ]);
    await api.tasks.complete({ id: blocker.id });
    expect((await api.tasks.byId({ id: task.id })).openBlockerCount).toBe(0);
    await api.tasks.dependencies.remove({ blockingTaskId: blocker.id, blockedTaskId: task.id });
    expect((await api.tasks.byId({ id: task.id })).blockedBy).toEqual([]);
    expect((await api.tasks.timeline(query())).dependencies).toEqual([]);

    // Project / milestone: moving to P2 drops the P1 milestone and moves the progress.
    await api.tasks.update({ id: task.id, patch: { projectId: p2.id } });
    views = await everywhere(api, task.id, { areaId: area!.id, projectId: p2.id });
    for (const seen of Object.values(views)) {
      expect(seen!.projectId).toBe(p2.id);
      expect(seen!.milestoneId).toBeNull();
    }
    const progress = async (id: string) =>
      (await api.projects.byId({ id, today: TODAY })).progress.total;
    expect(await progress(p1.id)).toBe(0);
    expect(await progress(p2.id)).toBe(1);
    expect((await api.tasks.list(query({ filter: { projectIds: [p1.id] } }))).length).toBe(0);

    // Completing (from the Kanban column) and reopening.
    await api.tasks.setStatus({ id: task.id, statusId: done.id });
    views = await everywhere(api, task.id, { areaId: area!.id, projectId: p2.id });
    expect(views.matrix).toBeUndefined(); // the matrix shows open tasks only
    expect(views.all!.completedAt).not.toBeNull();
    expect((await api.projects.byId({ id: p2.id, today: TODAY })).progress.completed).toBe(1);
    await api.tasks.reopen({ id: task.id });
    expect((await api.tasks.byId({ id: task.id })).completedAt).toBeNull();
    expect(api.count("task.completed")).toBe(2); // blocker + task
    expect(api.count("task.reopened")).toBe(1);

    // Trash: gone from every view, back after restore with the same id.
    await api.tasks.delete({ id: task.id });
    expect((await api.tasks.list(query())).some((t) => t.id === task.id)).toBe(false);
    expect((await api.tasks.timeline(query())).tasks.some((t) => t.id === task.id)).toBe(false);
    expect((await api.tasks.trash.list()).map((t) => t.id)).toContain(task.id);
    await expect(api.tasks.byId({ id: task.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await api.tasks.trash.restore({ id: task.id })).id).toBe(task.id);
  });
});

describe("event integrity", () => {
  it("fires task.completed / task.reopened once per logical change, even concurrently", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const done = (await api.tasks.statuses.list()).find((s) => s.systemKey === "done")!;
    const task = await api.tasks.create({ title: "并发" });

    await Promise.all([
      ...Array.from({ length: 4 }, () => api.tasks.complete({ id: task.id })),
      ...Array.from({ length: 4 }, () => api.tasks.setStatus({ id: task.id, statusId: done.id })),
    ]);
    expect(api.count("task.completed")).toBe(1);

    // Repeating a completion is a no-op.
    await api.tasks.complete({ id: task.id });
    await api.tasks.setStatus({ id: task.id, statusId: done.id });
    expect(api.count("task.completed")).toBe(1);

    await Promise.all(Array.from({ length: 6 }, () => api.tasks.reopen({ id: task.id })));
    expect(api.count("task.reopened")).toBe(1);

    // Delete / restore: concurrent duplicates fail instead of publishing a second event.
    await Promise.allSettled(Array.from({ length: 4 }, () => api.tasks.delete({ id: task.id })));
    expect(api.count("task.deleted")).toBe(1);
    await Promise.allSettled(
      Array.from({ length: 4 }, () => api.tasks.trash.restore({ id: task.id })),
    );
    expect(api.count("task.restored")).toBe(1);
  });

  it("fires project.completed and milestone.completed once, even concurrently", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const project = await api.projects.create({ name: "P" });
    const milestone = await api.projects.milestones.create({ projectId: project.id, name: "M" });

    await Promise.all(
      Array.from({ length: 6 }, () =>
        api.projects.update({ id: project.id, patch: { status: "completed" } }),
      ),
    );
    await api.projects.update({ id: project.id, patch: { name: "P2" } });
    expect(api.count("project.completed")).toBe(1);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        api.projects.milestones.setCompleted({ id: milestone.id, completed: true }),
      ),
    );
    expect(api.count("milestone.completed")).toBe(1);

    await Promise.all(
      Array.from({ length: 6 }, () =>
        api.projects.update({ id: project.id, patch: { status: "active" } }),
      ),
    );
    expect(api.count("project.reopened")).toBe(1);
  });

  it("keeps completedAt when moving between two completed statuses (no second event)", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const archived = await api.tasks.statuses.create({
      name: "已归档",
      category: "completed",
      color: "gray",
    });
    const task = await api.tasks.create({ title: "归档" });
    const completed = await api.tasks.complete({ id: task.id });
    const moved = await api.tasks.setStatus({ id: task.id, statusId: archived.id });
    expect(moved.completedAt).toEqual(completed.completedAt);
    expect(api.count("task.completed")).toBe(1);
  });
});

describe("lifecycle", () => {
  it("keeps the project of a subtask restored as a top-level task", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const project = await api.projects.create({ name: "P" });
    const parent = await api.tasks.create({ title: "父任务", projectId: project.id });
    const child = await api.tasks.create({ title: "子任务", parentTaskId: parent.id });

    // Child deleted first, then its parent: restoring only the child promotes it.
    await api.tasks.delete({ id: child.id });
    await api.tasks.delete({ id: parent.id });
    const restored = await api.tasks.trash.restore({ id: child.id });
    expect(restored.parentTaskId).toBeNull();
    expect(restored.projectId).toBe(project.id);
    expect(
      (await api.tasks.list(query({ filter: { projectIds: [project.id] } }))).map((t) => t.id),
    ).toEqual([child.id]);
  });

  it("clears project references on trashed tasks and drops dependencies on purge", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const project = await api.projects.create({ name: "P" });
    const milestone = await api.projects.milestones.create({ projectId: project.id, name: "M" });
    const trashed = await api.tasks.create({ title: "已删除", milestoneId: milestone.id });
    const other = await api.tasks.create({ title: "保留" });
    await api.tasks.dependencies.add({ blockingTaskId: trashed.id, blockedTaskId: other.id });
    await api.tasks.delete({ id: trashed.id });

    await api.projects.delete({ id: project.id });
    const restored = await api.tasks.trash.restore({ id: trashed.id });
    expect([restored.projectId, restored.milestoneId]).toEqual([null, null]);
    expect((await api.tasks.byId({ id: other.id })).blockedBy.map((d) => d.id)).toEqual([
      trashed.id,
    ]);

    await api.tasks.delete({ id: trashed.id });
    await api.tasks.trash.empty();
    const after = await api.tasks.byId({ id: other.id });
    expect(after.blockedBy).toEqual([]);
    expect(after.openBlockerCount).toBe(0);
  });

  it("moves subtasks in and out of projects consistently", async () => {
    const user = await createSeededUser(db);
    const api = setup(user.id);
    const project = await api.projects.create({ name: "P" });
    const milestone = await api.projects.milestones.create({ projectId: project.id, name: "M" });
    const root = await api.tasks.create({ title: "根", projectId: project.id });
    const loose = await api.tasks.create({ title: "独立", milestoneId: milestone.id });

    const nested = await api.tasks.setParent({ id: loose.id, parentTaskId: root.id });
    expect([nested.projectId, nested.milestoneId]).toEqual([null, null]);
    await expect(
      api.tasks.update({ id: loose.id, patch: { projectId: project.id } }),
    ).rejects.toMatchObject({ message: "task.subtask_project" });
    // Counted as progress within the parent, not as a project task of its own.
    expect((await api.projects.byId({ id: project.id, today: TODAY })).progress.total).toBe(1);

    const promoted = await api.tasks.setParent({ id: loose.id, parentTaskId: null });
    expect(promoted.projectId).toBe(project.id);
  });
});

describe("ownership", () => {
  it("never reads or changes another user's tasks, projects or dependencies", async () => {
    const owner = await createSeededUser(db);
    const intruder = await createSeededUser(db);
    const a = setup(owner.id);
    const b = setup(intruder.id);
    const project = await a.projects.create({ name: "A 的项目" });
    const milestone = await a.projects.milestones.create({ projectId: project.id, name: "M" });
    const t1 = await a.tasks.create({ title: "A1", projectId: project.id, dueDate: "2026-11-01" });
    const t2 = await a.tasks.create({ title: "A2" });
    await a.tasks.dependencies.add({ blockingTaskId: t1.id, blockedTaskId: t2.id });
    const mine = await b.tasks.create({ title: "B1" });
    const bDone = (await b.tasks.statuses.list()).find((s) => s.systemKey === "done")!;
    const aDone = (await a.tasks.statuses.list()).find((s) => s.systemKey === "done")!;

    const notFound = { code: "NOT_FOUND" };
    const attempts: (() => Promise<unknown>)[] = [
      () => b.tasks.byId({ id: t1.id }),
      () => b.tasks.update({ id: t1.id, patch: { title: "x" } }),
      () => b.tasks.setStatus({ id: t1.id, statusId: bDone.id }),
      () => b.tasks.setStatus({ id: mine.id, statusId: aDone.id }),
      () => b.tasks.complete({ id: t1.id }),
      () => b.tasks.delete({ id: t1.id }),
      () => b.tasks.setParent({ id: mine.id, parentTaskId: t1.id }),
      () => b.tasks.create({ title: "x", parentTaskId: t1.id }),
      () => b.tasks.create({ title: "x", projectId: project.id }),
      () => b.tasks.create({ title: "x", milestoneId: milestone.id }),
      () => b.tasks.update({ id: mine.id, patch: { projectId: project.id } }),
      () => b.tasks.move({ id: mine.id, afterId: t1.id, beforeId: null }),
      () => b.tasks.dependencies.add({ blockingTaskId: t1.id, blockedTaskId: t2.id }),
      () => b.tasks.dependencies.add({ blockingTaskId: mine.id, blockedTaskId: t1.id }),
      () => b.projects.byId({ id: project.id, today: TODAY }),
      () => b.projects.update({ id: project.id, patch: { status: "completed" } }),
      () => b.projects.delete({ id: project.id }),
      () => b.projects.milestones.create({ projectId: project.id, name: "x" }),
      () => b.projects.milestones.update({ id: milestone.id, patch: { name: "x" } }),
      () => b.projects.milestones.setCompleted({ id: milestone.id, completed: true }),
      () => b.projects.milestones.delete({ id: milestone.id }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject(notFound);

    // Removing someone else's edge is a silent no-op; lists never include their data.
    await b.tasks.dependencies.remove({ blockingTaskId: t1.id, blockedTaskId: t2.id });
    expect((await a.tasks.byId({ id: t2.id })).blockedBy.map((d) => d.id)).toEqual([t1.id]);
    expect((await b.tasks.list(query())).map((t) => t.id)).toEqual([mine.id]);
    const timeline = await b.tasks.timeline(query({ filter: { projectIds: [project.id] } }));
    expect([timeline.tasks, timeline.dependencies]).toEqual([[], []]);
    expect(await b.projects.list({ today: TODAY })).toEqual([]);
    expect(await b.projects.milestones.list()).toEqual([]);

    // Trash actions are scoped too.
    await a.tasks.delete({ id: t2.id });
    await expect(b.tasks.trash.restore({ id: t2.id })).rejects.toMatchObject(notFound);
    await expect(b.tasks.trash.purge({ id: t2.id })).rejects.toMatchObject(notFound);
    expect(await b.tasks.trash.empty()).toBe(0);
    expect((await a.tasks.trash.list()).map((t) => t.id)).toEqual([t2.id]);
    expect(b.count("project.completed") + b.count("milestone.completed")).toBe(0);
    expect(a.count("task.completed")).toBe(0);
  });
});
