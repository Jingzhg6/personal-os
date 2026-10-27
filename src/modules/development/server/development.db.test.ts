import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { TASK_XP } from "@/modules/character/domain";
import { characterRouter, registerCharacterEventHandlers } from "@/modules/character/server";
import { dashboardRouter } from "@/modules/dashboard/server";
import { projectsRouter } from "@/modules/projects/server";
import { rewardsRouter } from "@/modules/rewards/server";
import { tasksRouter } from "@/modules/tasks/server";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { developmentGoalTasks } from "../db";
import { MAX_FOCUS_ATTRIBUTES } from "../domain";
import { developmentRouter } from "./router";

const { db, close } = createTestDb();

function setup(userId: string) {
  const bus = createEventBus();
  registerCharacterEventHandlers(bus);
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    projects: createCallerFactory(projectsRouter)(ctx),
    character: createCallerFactory(characterRouter)(ctx),
    rewards: createCallerFactory(rewardsRouter)(ctx),
    dashboard: createCallerFactory(dashboardRouter)(ctx),
    development: createCallerFactory(developmentRouter)(ctx),
  };
}

async function seeded() {
  const user = await createSeededUser(db);
  const api = setup(user.id);
  const attributes = await api.character.attributes.list();
  const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  return { user, api, attr };
}

type Api = ReturnType<typeof setup>;

const goal = (api: Api, attributeId: string, title = "法语达到 B1") =>
  api.development.goals.create({ title, attributes: [{ attributeId, weight: 3 }] });

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ cause: { code } });

async function rowCounts() {
  const result = await db.execute<Record<string, number>>(
    sql`select (select count(*) from xp_ledger)::int as ledger,
               (select count(*) from xp_attribute_credits)::int as credits,
               (select count(*) from reward_ledger)::int as spent`,
  );
  return result.rows[0];
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("development goals", () => {
  it("creates a goal with one or more weighted attributes", async () => {
    const { api, attr } = await seeded();
    const created = await api.development.goals.create({
      title: "  提升数据分析能力 ",
      description: "能独立完成一份分析报告",
      priority: 3,
      targetDate: "2027-06-30",
      attributes: [
        { attributeId: attr("reading"), weight: 1 },
        { attributeId: attr("english"), weight: 3 },
      ],
    });
    expect(created).toMatchObject({
      title: "提升数据分析能力",
      description: "能独立完成一份分析报告",
      status: "active",
      priority: 3,
      targetDate: "2027-06-30",
      completedAt: null,
      archivedAt: null,
      // Heaviest first.
      attributes: [
        { attributeId: attr("english"), weight: 3 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
  });

  it("requires at least one attribute and rejects duplicates, archived and unknown ones", async () => {
    const { api, attr } = await seeded();
    await expect(api.development.goals.create({ title: "x", attributes: [] })).rejects.toThrow();
    await expect(
      api.development.goals.create({
        title: "x",
        attributes: [
          { attributeId: attr("french"), weight: 1 },
          { attributeId: attr("french"), weight: 2 },
        ],
      }),
    ).rejects.toThrow();
    await rejects(goal(api, crypto.randomUUID()), "attribute.not_found");
    await api.character.attributes.update({ id: attr("cardio"), patch: { archived: true } });
    await rejects(goal(api, attr("cardio")), "attribute.archived");
  });

  it("updates fields and attributes; an attribute archived later may stay", async () => {
    const { api, attr } = await seeded();
    const created = await api.development.goals.create({
      title: "提升心肺耐力",
      attributes: [
        { attributeId: attr("cardio"), weight: 3 },
        { attributeId: attr("strength"), weight: 1 },
      ],
    });
    await api.character.attributes.update({ id: attr("strength"), patch: { archived: true } });
    const updated = await api.development.goals.update({
      id: created.id,
      patch: {
        title: "跑完半程马拉松",
        description: "",
        targetDate: null,
        priority: 1,
        attributes: [
          { attributeId: attr("cardio"), weight: 2 },
          { attributeId: attr("strength"), weight: 2 },
        ],
      },
    });
    expect(updated).toMatchObject({ title: "跑完半程马拉松", description: null, priority: 1 });
    expect(updated.attributes.map((a) => a.weight)).toEqual([2, 2]);
    // But it cannot be added to another goal.
    await rejects(goal(api, attr("strength")), "attribute.archived");
  });

  it("completes, pauses, archives and restores a goal", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("french"));
    const paused = await api.development.goals.setStatus({ id, status: "paused" });
    expect(paused).toMatchObject({ status: "paused", completedAt: null, archivedAt: null });
    const completed = await api.development.goals.setStatus({ id, status: "completed" });
    expect(completed.completedAt).toBeInstanceOf(Date);
    const archived = await api.development.goals.setStatus({ id, status: "archived" });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.completedAt).toEqual(completed.completedAt); // kept while archived

    let overview = await api.development.overview();
    expect(overview.goals).toEqual([]);
    expect(overview.archivedGoals.map((g) => g.id)).toEqual([id]);

    const restored = await api.development.goals.setStatus({ id, status: "active" });
    expect(restored).toMatchObject({ status: "active", completedAt: null, archivedAt: null });
    overview = await api.development.overview();
    expect(overview.goals.map((g) => g.goal.id)).toEqual([id]);
  });

  it("deletes a goal with its links, leaving tasks and XP alone", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("french"));
    const task = await api.tasks.create({ title: "法语听力" });
    await api.development.goals.linkTask({ goalId: id, taskId: task.id });
    await api.tasks.complete({ id: task.id });
    const before = await rowCounts();
    await api.development.goals.delete({ id });
    await rejects(api.development.goals.detail({ id }), "goal.not_found");
    expect(await api.tasks.byId({ id: task.id })).toMatchObject({ statusCategory: "completed" });
    expect(await rowCounts()).toEqual(before);
    expect(await db.select().from(developmentGoalTasks)).toEqual([]);
  });
});

describe("goal ↔ task links", () => {
  it("links existing tasks once, counts actions and unlinks", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("french"));
    const a = await api.tasks.create({ title: "法语口语 30 分钟" });
    const b = await api.tasks.create({ title: "背 50 个单词" });
    const c = await api.tasks.create({ title: "报名 DELF B1" });
    for (const task of [a, b, c])
      await api.development.goals.linkTask({ goalId: id, taskId: task.id });
    await api.development.goals.linkTask({ goalId: id, taskId: a.id }); // duplicate: no-op
    await api.tasks.complete({ id: a.id });
    const cancelled = (await api.tasks.statuses.list()).find((s) => s.category === "cancelled")!;
    await api.tasks.setStatus({ id: c.id, statusId: cancelled.id });

    const detail = await api.development.goals.detail({ id });
    expect(detail.tasks.map((t) => t.title)).toEqual([
      "背 50 个单词",
      "法语口语 30 分钟",
      "报名 DELF B1",
    ]);
    expect(detail.actions).toEqual({ linked: 3, completed: 1, cancelled: 1, open: 1 });
    const [summary] = (await api.development.overview()).goals;
    expect(summary!.actions).toEqual(detail.actions);

    await api.development.goals.unlinkTask({ goalId: id, taskId: b.id });
    expect((await api.development.goals.detail({ id })).actions.linked).toBe(2);
    expect(await api.tasks.byId({ id: b.id })).toMatchObject({ title: "背 50 个单词" });
  });

  it("a task can serve several goals; the task side sets its goals", async () => {
    const { api, attr } = await seeded();
    const french = await goal(api, attr("french"));
    const reading = await goal(api, attr("reading"), "建立稳定的阅读习惯");
    const archived = await goal(api, attr("english"), "英语 C1");
    const task = await api.tasks.create({ title: "读一本法语小说" });
    await api.development.goals.linkTask({ goalId: archived.id, taskId: task.id });
    await api.development.goals.setStatus({ id: archived.id, status: "archived" });

    const linked = await api.development.goals.setForTask({
      taskId: task.id,
      goalIds: [french.id, reading.id],
    });
    expect(linked.map((g) => g.title).sort()).toEqual(["建立稳定的阅读习惯", "法语达到 B1"]);
    expect(
      await api.development.goals.setForTask({ taskId: task.id, goalIds: [reading.id] }),
    ).toHaveLength(1);
    // The archived goal's link is kept (hidden) and comes back with a restore.
    await api.development.goals.setStatus({ id: archived.id, status: "active" });
    expect(
      (await api.development.goals.forTask({ taskId: task.id })).map((g) => g.title).sort(),
    ).toEqual(["建立稳定的阅读习惯", "英语 C1"]);
    await expect(
      api.development.goals.setForTask({ taskId: task.id, goalIds: [french.id, french.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses links to archived goals", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("french"));
    await api.development.goals.setStatus({ id, status: "archived" });
    const task = await api.tasks.create({ title: "法语" });
    await rejects(api.development.goals.linkTask({ goalId: id, taskId: task.id }), "goal.archived");
    await rejects(
      api.development.goals.setForTask({ taskId: task.id, goalIds: [id] }),
      "goal.archived",
    );
  });

  it("hides trashed tasks, restores them with the task, and drops the link on purge", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("french"));
    const task = await api.tasks.create({ title: "法语作文" });
    await api.development.goals.linkTask({ goalId: id, taskId: task.id });
    await api.tasks.delete({ id: task.id });
    expect((await api.development.goals.detail({ id })).actions.linked).toBe(0);
    await api.tasks.trash.restore({ id: task.id });
    expect((await api.development.goals.detail({ id })).tasks.map((t) => t.id)).toEqual([task.id]);
    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.purge({ id: task.id });
    expect(await db.select().from(developmentGoalTasks)).toEqual([]);
  });

  it("creates an ordinary task from a goal, linked, with the goal's attributes as contributions", async () => {
    const { api, attr } = await seeded();
    const created = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
    const task = await api.development.goals.createTask({
      goalId: created.id,
      task: { title: "学习 30 分钟法语", priority: 2 },
    });
    expect(task.contributions).toEqual([
      { attributeId: attr("french"), weight: 3 },
      { attributeId: attr("reading"), weight: 1 },
    ]);
    // A normal task: in the task list, completable, earning XP by the usual rule.
    const list = await api.tasks.list({ today: "2026-10-27" });
    expect(list.map((t) => t.id)).toContain(task.id);
    await api.tasks.complete({ id: task.id });
    const { totals } = await api.character.overview();
    expect(totals).toMatchObject({
      lifetimeActiveXp: TASK_XP.base + 2 * TASK_XP.perPriority,
      growthXp: TASK_XP.base + 2 * TASK_XP.perPriority,
    });
    expect((await api.development.goals.detail({ id: created.id })).actions).toMatchObject({
      linked: 1,
      completed: 1,
    });

    const plain = await api.development.goals.createTask({
      goalId: created.id,
      task: { title: "整理笔记" },
      useGoalAttributes: false,
    });
    expect(plain.contributions).toEqual([]);
  });
});

describe("goal ↔ project links", () => {
  it("links the user's projects once and unlinks them", async () => {
    const { api, attr } = await seeded();
    const { id } = await goal(api, attr("english"));
    const project = await api.projects.create({ name: "SQL 课程" });
    await api.development.goals.linkProject({ goalId: id, projectId: project.id });
    await api.development.goals.linkProject({ goalId: id, projectId: project.id });
    expect((await api.development.goals.detail({ id })).projects.map((p) => p.name)).toEqual([
      "SQL 课程",
    ]);
    expect((await api.development.overview()).goals[0]!.projectCount).toBe(1);
    await api.development.goals.unlinkProject({ goalId: id, projectId: project.id });
    expect((await api.development.goals.detail({ id })).projects).toEqual([]);
  });
});

describe("vision and focus", () => {
  it("saves, edits and clears the vision", async () => {
    const { api } = await seeded();
    expect((await api.development.overview()).vision).toBeNull();
    const vision = "我希望成为一个能够流利使用法语和英语、身体健康并且能够长期保持专注的人。";
    expect(await api.development.updateVision({ vision: `  ${vision}  ` })).toBe(vision);
    expect((await api.development.overview()).vision).toBe(vision);
    await api.development.updateVision({ vision: "更短的版本" });
    expect((await api.development.overview()).vision).toBe("更短的版本");
    expect(await api.development.updateVision({ vision: "   " })).toBeNull();
  });

  it("chooses up to the maximum focus attributes, in order", async () => {
    const { api, attr } = await seeded();
    const chosen = [attr("french"), attr("reading"), attr("cardio")];
    expect(await api.development.setFocus({ attributeIds: chosen })).toEqual(chosen);
    const overview = await api.development.overview();
    expect(overview.focusAttributeIds).toEqual(chosen);
    expect(overview.maxFocus).toBe(MAX_FOCUS_ATTRIBUTES);
    expect(
      overview.attributes
        .filter((a) => a.focused)
        .map((a) => a.attribute.id)
        .sort(),
    ).toEqual([...chosen].sort());

    await rejects(
      api.development.setFocus({ attributeIds: [...chosen, attr("english")] }),
      "focus.too_many",
    );
    expect((await api.development.overview()).focusAttributeIds).toEqual(chosen);
    expect(await api.development.setFocus({ attributeIds: [] })).toEqual([]);
  });

  it("rejects unknown and archived focus attributes; archiving drops one from the focus", async () => {
    const { api, attr } = await seeded();
    await rejects(
      api.development.setFocus({ attributeIds: [crypto.randomUUID()] }),
      "attribute.not_found",
    );
    await api.development.setFocus({ attributeIds: [attr("french"), attr("cardio")] });
    await api.character.attributes.update({ id: attr("cardio"), patch: { archived: true } });
    expect((await api.development.overview()).focusAttributeIds).toEqual([attr("french")]);
    await rejects(
      api.development.setFocus({ attributeIds: [attr("cardio")] }),
      "attribute.archived",
    );
  });
});

describe("read models", () => {
  it("summarises attributes: lifetime and recent Growth XP, active goals, latest activity", async () => {
    const { api, attr } = await seeded();
    await goal(api, attr("french"));
    const paused = await goal(api, attr("french"), "法语 C1");
    await api.development.goals.setStatus({ id: paused.id, status: "paused" });
    const task = await api.tasks.create({
      title: "法语阅读",
      priority: 2, // 20 XP → 法语 15 · 阅读 5
      contributions: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
    await api.tasks.complete({ id: task.id });

    const overview = await api.development.overview();
    const french = overview.attributes.find((a) => a.attribute.id === attr("french"))!;
    expect(french).toMatchObject({ lifetimeGrowthXp: 15, recentGrowthXp: 15, activeGoalCount: 1 });
    expect(french.lastActivityAt).toBeInstanceOf(Date);
    expect(overview.attributes.find((a) => a.attribute.id === attr("cardio"))).toMatchObject({
      lifetimeGrowthXp: 0,
      lastActivityAt: null,
    });
    expect(overview.recentGrowth).toEqual([
      { attributeId: attr("french"), growthXp: 15 },
      { attributeId: attr("reading"), growthXp: 5 },
    ]);
    // Since M9 a goal's recent Growth XP is only what is attributed to it (ADR 0018): these goals
    // have no linked tasks, so nothing — even though their attribute 法语 grew.
    expect(overview.goals.map((g) => g.recentGrowthXp)).toEqual([0, 0]);
  });

  it("returns the goal detail with growth per linked attribute", async () => {
    const { api, attr } = await seeded();
    const created = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
    const task = await api.development.goals.createTask({
      goalId: created.id,
      task: { title: "法语阅读", priority: 2 },
    });
    await api.tasks.complete({ id: task.id });
    const detail = await api.development.goals.detail({ id: created.id });
    expect(
      detail.attributes.map((a) => [
        a.attribute.systemKey,
        a.weight,
        a.lifetimeGrowthXp,
        a.recentGrowthXp,
      ]),
    ).toEqual([
      ["french", 3, 15, 15],
      ["reading", 1, 5, 5],
    ]);
  });

  it("returns the attribute detail: trend, goals, open tasks, entries and sources", async () => {
    const { api, attr } = await seeded();
    const created = await goal(api, attr("french"));
    const done = await api.tasks.create({
      title: "法语听力",
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.tasks.complete({ id: done.id });
    await api.tasks.create({
      title: "法语口语（待办）",
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.development.setFocus({ attributeIds: [attr("french")] });

    const detail = await api.development.attribute({ id: attr("french") });
    expect(detail).toMatchObject({ lifetimeGrowthXp: 10, recentGrowthXp: 10, focused: true });
    expect(detail.trend.points).toHaveLength(90);
    expect(detail.trend.points.at(-1)).toMatchObject({ growthXp: 10 });
    expect(detail.goals.map((g) => g.id)).toEqual([created.id]);
    expect(detail.openTasks.map((t) => t.title)).toEqual(["法语口语（待办）"]);
    expect(detail.recentEntries.map((e) => e.sourceTitle)).toEqual(["法语听力"]);
    expect(detail.sources).toEqual([
      { sourceType: "task", sourceId: done.id, title: "法语听力", growthXp: 10 },
    ]);
    // Reopening nets the source out.
    await api.tasks.reopen({ id: done.id });
    expect((await api.development.attribute({ id: attr("french") })).sources).toEqual([]);
  });
});

describe("authorization", () => {
  it("never reads, links, changes or deletes another user's data", async () => {
    const owner = await seeded();
    const other = await seeded();
    const ownerGoal = await goal(owner.api, owner.attr("french"));
    const ownerTask = await owner.api.tasks.create({ title: "私人任务" });
    const ownerProject = await owner.api.projects.create({ name: "私人项目" });
    const otherGoal = await goal(other.api, other.attr("french"));
    const g = other.api.development.goals;

    await rejects(g.detail({ id: ownerGoal.id }), "goal.not_found");
    await rejects(g.update({ id: ownerGoal.id, patch: { title: "x" } }), "goal.not_found");
    await rejects(g.setStatus({ id: ownerGoal.id, status: "archived" }), "goal.not_found");
    await rejects(g.delete({ id: ownerGoal.id }), "goal.not_found");
    await rejects(g.linkTask({ goalId: ownerGoal.id, taskId: ownerTask.id }), "goal.not_found");
    // Their own goal, someone else's task / project / attribute.
    await rejects(g.linkTask({ goalId: otherGoal.id, taskId: ownerTask.id }), "task.not_found");
    await rejects(
      g.linkProject({ goalId: otherGoal.id, projectId: ownerProject.id }),
      "project.not_found",
    );
    await rejects(goal(other.api, owner.attr("reading")), "attribute.not_found");
    await rejects(
      g.update({
        id: otherGoal.id,
        patch: { attributes: [{ attributeId: owner.attr("reading"), weight: 1 }] },
      }),
      "attribute.not_found",
    );
    await rejects(
      other.api.development.setFocus({ attributeIds: [owner.attr("french")] }),
      "attribute.not_found",
    );
    await rejects(g.forTask({ taskId: ownerTask.id }), "task.not_found");
    await rejects(g.setForTask({ taskId: ownerTask.id, goalIds: [] }), "task.not_found");
    await rejects(
      g.createTask({ goalId: ownerGoal.id, task: { title: "侵入" } }),
      "goal.not_found",
    );
    await rejects(
      other.api.development.attribute({ id: owner.attr("french") }),
      "attribute.not_found",
    );

    const theirs = await other.api.development.overview();
    expect(theirs.goals.map((s) => s.goal.id)).toEqual([otherGoal.id]);
    expect((await owner.api.development.goals.detail({ id: ownerGoal.id })).goal.title).toBe(
      "法语达到 B1",
    );
  });
});

describe("existing behaviour is unchanged", () => {
  it("goals create no XP; XP, level, rewards and the dashboard read the same with or without them", async () => {
    const { api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "法语听力",
      priority: 4,
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    const reward = await api.rewards.create({ name: "奶茶", value: 50 });

    const snapshot = async () => ({
      counts: await rowCounts(),
      totals: (await api.character.overview()).totals,
      level: (await api.character.overview()).level,
      balances: await api.rewards.balances(),
      rewards: (await api.rewards.list()).map((r) => [r.activeXpCost, r.levelXpCost]),
      dashboard: await api.dashboard.overview().then((d) => ({
        totals: d.totals,
        balances: d.balances,
        week: d.week,
        level: d.level,
        focus: d.focus,
      })),
    });
    const before = await snapshot();

    const created = await goal(api, attr("french"));
    await api.development.goals.linkTask({ goalId: created.id, taskId: task.id });
    await api.development.setFocus({ attributeIds: [attr("french")] });
    await api.development.updateVision({ vision: "成为更好的自己" });
    await api.development.goals.setStatus({ id: created.id, status: "completed" });
    await api.development.overview();
    await api.development.goals.detail({ id: created.id });
    await api.development.attribute({ id: attr("french") });

    expect(await snapshot()).toEqual(before);

    // A linked task earns exactly what an unlinked one does.
    const linked = await api.development.goals.createTask({
      goalId: (await goal(api, attr("cardio"), "耐力")).id,
      task: { title: "跑步", priority: 4 },
      useGoalAttributes: false,
    });
    await api.tasks.complete({ id: linked.id });
    expect((await api.character.history({ limit: 1 })).entries[0]).toMatchObject({
      sourceTitle: "跑步",
      amount: TASK_XP.base + 4 * TASK_XP.perPriority,
      credits: [],
    });
    void reward;
  });
});
