import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { tasksRouter } from "@/modules/tasks/server";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { projectsRouter } from "./router";

const { db, close } = createTestDb();
const TODAY = "2026-10-25";

function setup(userId: string) {
  const bus = createEventBus();
  const events: DomainEvent[] = [];
  for (const type of [
    "project.created",
    "project.completed",
    "project.reopened",
    "milestone.completed",
  ] as const) {
    bus.subscribe(type, (e) => void events.push(e), { name: `test.${type}` });
  }
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    projects: createCallerFactory(projectsRouter)(ctx),
    tasks: createCallerFactory(tasksRouter)(ctx),
    types: () => events.map((e) => e.type),
  };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("projects", () => {
  it("creates, lists, updates and completes projects with events", async () => {
    const user = await createSeededUser(db);
    const { projects, types } = setup(user.id);
    const [area] = await listAreas(db, user.id);

    const project = await projects.create({
      name: "法语 DELF B2",
      areaId: area!.id,
      startDate: "2026-09-01",
      targetDate: "2026-12-15",
      color: "violet",
      priority: 3,
    });
    expect(project).toMatchObject({
      name: "法语 DELF B2",
      status: "active",
      color: "violet",
      progress: { total: 0 },
    });
    expect((await projects.list({ today: TODAY })).map((p) => p.name)).toEqual(["法语 DELF B2"]);

    const done = await projects.update({ id: project.id, patch: { status: "completed" } });
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = await projects.update({ id: project.id, patch: { status: "active" } });
    expect(reopened.completedAt).toBeNull();
    expect(types()).toEqual(["project.created", "project.completed", "project.reopened"]);

    expect((await projects.list({ today: TODAY, statuses: ["completed"] })).length).toBe(0);
  });

  it("validates dates, including against stored values", async () => {
    const user = await createSeededUser(db);
    const { projects } = setup(user.id);
    await expect(
      projects.create({ name: "x", startDate: "2026-12-01", targetDate: "2026-11-01" }),
    ).rejects.toMatchObject({ message: "project.start_after_target" });
    const project = await projects.create({ name: "x", targetDate: "2026-11-01" });
    await expect(
      projects.update({ id: project.id, patch: { startDate: "2026-12-01" } }),
    ).rejects.toMatchObject({
      message: "project.start_after_target",
    });
  });

  it("computes progress from top-level tasks, excluding cancelled ones", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks } = setup(user.id);
    const project = await projects.create({ name: "网站改版" });
    const a = await tasks.create({ title: "设计", projectId: project.id });
    const b = await tasks.create({ title: "开发", projectId: project.id, dueDate: "2026-10-01" });
    const c = await tasks.create({ title: "取消的", projectId: project.id });
    await tasks.create({ title: "子任务", parentTaskId: a.id }); // not counted
    await tasks.complete({ id: a.id });
    const cancelled = (await tasks.statuses.list()).find((s) => s.category === "cancelled")!;
    await tasks.setStatus({ id: c.id, statusId: cancelled.id });

    const [listed] = await projects.list({ today: TODAY });
    expect(listed!.progress).toEqual({ total: 2, completed: 1, overdue: 1 });
    expect(b.projectId).toBe(project.id);
  });

  it("deletes a project but keeps its tasks", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks } = setup(user.id);
    const project = await projects.create({ name: "临时项目" });
    const milestone = await projects.milestones.create({ projectId: project.id, name: "第一阶段" });
    const task = await tasks.create({ title: "保留我", milestoneId: milestone.id });
    expect(task.projectId).toBe(project.id); // the milestone determines the project

    await projects.delete({ id: project.id });
    const kept = await tasks.byId({ id: task.id });
    expect(kept).toMatchObject({ projectId: null, milestoneId: null, title: "保留我" });
    await expect(projects.byId({ id: project.id, today: TODAY })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("milestones", () => {
  it("orders milestones by due date, tracks their progress and completion", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks, types } = setup(user.id);
    const project = await projects.create({ name: "DELF" });
    const late = await projects.milestones.create({
      projectId: project.id,
      name: "模拟考试",
      dueDate: "2026-12-01",
    });
    const soon = await projects.milestones.create({
      projectId: project.id,
      name: "报名",
      dueDate: "2026-11-01",
    });
    const undated = await projects.milestones.create({ projectId: project.id, name: "以后再说" });

    const t = await tasks.create({
      title: "填写报名表",
      projectId: project.id,
      milestoneId: soon.id,
    });
    await tasks.complete({ id: t.id });
    await tasks.create({ title: "交报名费", milestoneId: soon.id });

    const detail = await projects.byId({ id: project.id, today: TODAY });
    expect(detail.milestones.map((m) => m.name)).toEqual(["报名", "模拟考试", "以后再说"]);
    expect(detail.milestones[0]!.progress).toEqual({ total: 2, completed: 1, overdue: 0 });
    expect(detail.nextMilestone?.id).toBe(soon.id);

    await projects.milestones.setCompleted({ id: soon.id, completed: true });
    expect((await projects.byId({ id: project.id, today: TODAY })).nextMilestone?.id).toBe(late.id);
    expect(types()).toContain("milestone.completed");

    await projects.milestones.update({
      id: undated.id,
      patch: { name: "备考复盘", dueDate: "2026-12-20" },
    });
    await projects.milestones.delete({ id: late.id });
    expect(
      (await projects.byId({ id: project.id, today: TODAY })).milestones.map((m) => m.name),
    ).toEqual(["报名", "备考复盘"]);
  });
});

describe("tasks in projects", () => {
  it("keeps project and milestone consistent", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks } = setup(user.id);
    const a = await projects.create({ name: "A" });
    const b = await projects.create({ name: "B" });
    const msA = await projects.milestones.create({ projectId: a.id, name: "A1" });

    await expect(
      tasks.create({ title: "x", projectId: b.id, milestoneId: msA.id }),
    ).rejects.toMatchObject({
      message: "milestone.project_mismatch",
    });
    const task = await tasks.create({ title: "x", projectId: a.id, milestoneId: msA.id });
    // Moving to another project drops the old project's milestone.
    const moved = await tasks.update({ id: task.id, patch: { projectId: b.id } });
    expect(moved).toMatchObject({ projectId: b.id, milestoneId: null });
  });

  it("gives subtasks their parent's project, and keeps it when they become top-level", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks } = setup(user.id);
    const project = await projects.create({ name: "P" });
    const parent = await tasks.create({ title: "父", projectId: project.id });
    await expect(
      tasks.create({ title: "子", parentTaskId: parent.id, projectId: project.id }),
    ).rejects.toMatchObject({
      message: "task.subtask_project",
    });
    const child = await tasks.create({ title: "子", parentTaskId: parent.id });
    expect(child.projectId).toBeNull();

    // Project filter includes first-level subtasks.
    const listed = await tasks.list({
      today: TODAY,
      includeSubtasks: true,
      filter: { projectIds: [project.id] },
    });
    expect(listed.map((t) => t.title).sort()).toEqual(["父", "子"].sort());

    const promoted = await tasks.setParent({ id: child.id, parentTaskId: null });
    expect(promoted.projectId).toBe(project.id);
    const demoted = await tasks.setParent({ id: promoted.id, parentTaskId: parent.id });
    expect(demoted.projectId).toBeNull();
  });

  it("filters by project, by 'no project' and by milestone", async () => {
    const user = await createSeededUser(db);
    const { projects, tasks } = setup(user.id);
    const project = await projects.create({ name: "P" });
    const ms = await projects.milestones.create({ projectId: project.id, name: "M" });
    await tasks.create({ title: "项目内", projectId: project.id });
    await tasks.create({ title: "里程碑", milestoneId: ms.id });
    await tasks.create({ title: "无项目" });
    const titles = async (filter: object) =>
      (await tasks.list({ today: TODAY, filter })).map((t) => t.title);

    expect(await titles({ projectIds: [project.id] })).toEqual(["项目内", "里程碑"]);
    expect(await titles({ noProject: true })).toEqual(["无项目"]);
    expect(await titles({ milestoneIds: [ms.id] })).toEqual(["里程碑"]);
  });
});

describe("authorization", () => {
  it("never exposes or links another user's projects and milestones", async () => {
    const owner = await createSeededUser(db);
    const intruder = await createSeededUser(db);
    const ownerApi = setup(owner.id);
    const { projects, tasks } = setup(intruder.id);
    const project = await ownerApi.projects.create({ name: "私人项目" });
    const milestone = await ownerApi.projects.milestones.create({
      projectId: project.id,
      name: "M",
    });

    expect(await projects.list({ today: TODAY })).toEqual([]);
    for (const attempt of [
      () => projects.byId({ id: project.id, today: TODAY }),
      () => projects.update({ id: project.id, patch: { name: "x" } }),
      () => projects.delete({ id: project.id }),
      () => projects.milestones.create({ projectId: project.id, name: "x" }),
      () => projects.milestones.update({ id: milestone.id, patch: { name: "x" } }),
      () => projects.milestones.setCompleted({ id: milestone.id, completed: true }),
      () => projects.milestones.delete({ id: milestone.id }),
      () => tasks.create({ title: "x", projectId: project.id }),
      () => tasks.create({ title: "x", milestoneId: milestone.id }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await ownerApi.projects.byId({ id: project.id, today: TODAY })).name).toBe("私人项目");
  });
});
