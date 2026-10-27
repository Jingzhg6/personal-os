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

import { developmentGoalAllocations, developmentPlanTasks } from "../db";
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

type Api = ReturnType<typeof setup>;

async function seeded() {
  const user = await createSeededUser(db);
  const api = setup(user.id);
  const sqlAttr = await api.character.attributes.create({ name: "SQL", color: "teal" });
  const focusAttr = await api.character.attributes.create({ name: "专注力", color: "violet" });
  const python = await api.character.attributes.create({ name: "Python", color: "green" });
  const seededAttrs = await api.character.attributes.list();
  const attr = (key: string) =>
    ({ sql: sqlAttr.id, focus: focusAttr.id, python: python.id })[key] ??
    seededAttrs.find((a) => a.systemKey === key)!.id;
  return { user, api, attr };
}

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ cause: { code } });

/** A task with contributions, worth `priority` (10 + 5 × priority XP). */
async function task(
  api: Api,
  title: string,
  contributions: { attributeId: string; weight: number }[],
  priority = 2,
) {
  return api.tasks.create({ title, priority, contributions });
}

async function ledgerCounts() {
  const result = await db.execute<Record<string, number>>(
    sql`select (select count(*) from xp_ledger)::int as ledger,
               (select coalesce(sum(amount), 0) from xp_ledger)::int as active,
               (select count(*) from xp_attribute_credits)::int as credits,
               (select coalesce(sum(amount), 0) from xp_attribute_credits)::int as growth,
               (select count(*) from reward_ledger)::int as spent`,
  );
  return result.rows[0];
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("goal attribution", () => {
  it("one task → one goal: 100 % of the goal's attributes by default, the rest unattributed", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "成为数据分析师",
      attributes: [
        { attributeId: attr("sql"), weight: 3 },
        { attributeId: attr("python"), weight: 2 },
      ],
    });
    const t = await task(api, "学习 SQL 30 分钟", [
      { attributeId: attr("sql"), weight: 3 },
      { attributeId: attr("focus"), weight: 1 },
    ]);
    await api.development.goals.linkTask({ goalId: goal.id, taskId: t.id });
    await api.tasks.complete({ id: t.id }); // 20 XP → SQL 15, 专注力 5

    const view = await api.development.attribution.forTask({ taskId: t.id });
    expect(view.allocations).toEqual([
      { goalId: goal.id, taskId: t.id, attributeId: attr("sql"), share: 100 },
    ]);
    const detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.evidence).toMatchObject({
      lifetimeXp: 15,
      recentXp: 15,
      unattributedXp: 5,
      recentCompleted: 1,
      byAttribute: [{ attributeId: attr("sql"), lifetimeXp: 15, recentXp: 15 }],
    });
    expect(detail.taskAttribution[t.id]).toEqual({
      attributedXp: 15,
      unattributedXp: 5,
      needsAllocation: false,
      goalCount: 1,
    });
    const [summary] = (await api.development.overview()).goals;
    expect(summary).toMatchObject({ attributedXp: 15, recentGrowthXp: 15 });
  });

  it("goal XP counts only attributed tasks, not the attribute's growth in general", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const study = await api.development.goals.createTask({
      goalId: goal.id,
      task: { title: "学习法语", priority: 2 },
    });
    const trip = await task(api, "法国旅游准备", [{ attributeId: attr("french"), weight: 2 }]);
    await api.tasks.complete({ id: study.id });
    await api.tasks.complete({ id: trip.id });

    const detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.evidence.lifetimeXp).toBe(20); // not 40
    // The attribute itself grew by 40 — shown separately, as the attribute's growth.
    expect(detail.attributes[0]!.lifetimeGrowthXp).toBe(40);
  });

  it("one task → several goals: no automatic shares, then an explicit allocation that adds up", async () => {
    const { api, attr } = await seeded();
    const pythonGoal = await api.development.goals.create({
      title: "掌握 Python",
      attributes: [{ attributeId: attr("python"), weight: 3 }],
    });
    const analyst = await api.development.goals.create({
      title: "成为数据分析师",
      attributes: [{ attributeId: attr("python"), weight: 2 }],
    });
    const t = await task(api, "写一个 Python 数据分析项目", [
      { attributeId: attr("python"), weight: 2 },
    ]);
    // Linked to both at once: nothing allocated, both goals see the task as needing allocation.
    await api.development.goals.setForTask({ taskId: t.id, goalIds: [pythonGoal.id, analyst.id] });
    expect(await db.select().from(developmentGoalAllocations)).toEqual([]);
    await api.tasks.complete({ id: t.id }); // 20 XP Python
    let detail = await api.development.goals.detail({ id: pythonGoal.id });
    expect(detail.evidence).toMatchObject({ lifetimeXp: 0, unattributedXp: 20 });
    expect(detail.taskAttribution[t.id]).toMatchObject({ needsAllocation: true, goalCount: 2 });

    await api.development.attribution.set({
      taskId: t.id,
      allocations: [
        { goalId: pythonGoal.id, attributeId: attr("python"), share: 60 },
        { goalId: analyst.id, attributeId: attr("python"), share: 40 },
      ],
    });
    detail = await api.development.goals.detail({ id: pythonGoal.id });
    const other = await api.development.goals.detail({ id: analyst.id });
    expect(detail.evidence).toMatchObject({ lifetimeXp: 12, unattributedXp: 0 });
    expect(other.evidence).toMatchObject({ lifetimeXp: 8, unattributedXp: 0 });
    // 12 + 8 = 20: the same XP is never counted twice.
    expect(detail.evidence.lifetimeXp + other.evidence.lifetimeXp).toBe(20);
  });

  it("partial attribution leaves an unattributed remainder, truncated so parts never exceed the whole", async () => {
    const { api, attr } = await seeded();
    const a = await api.development.goals.create({
      title: "A",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const b = await api.development.goals.create({
      title: "B",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const t = await task(api, "法语", [{ attributeId: attr("french"), weight: 2 }], 3); // 25 XP
    await api.development.goals.setForTask({ taskId: t.id, goalIds: [a.id, b.id] });
    await api.development.attribution.set({
      taskId: t.id,
      allocations: [
        { goalId: a.id, attributeId: attr("french"), share: 33 },
        { goalId: b.id, attributeId: attr("french"), share: 33 },
      ],
    });
    await api.tasks.complete({ id: t.id });
    const [da, dbb] = await Promise.all([
      api.development.goals.detail({ id: a.id }),
      api.development.goals.detail({ id: b.id }),
    ]);
    // trunc(25 × 0.33) = 8 each; 25 − 16 = 9 unattributed.
    expect([da.evidence.lifetimeXp, dbb.evidence.lifetimeXp]).toEqual([8, 8]);
    expect(da.evidence.unattributedXp).toBe(9);

    // A reversal nets the goal's part back to zero (truncation is symmetric).
    await api.tasks.reopen({ id: t.id });
    expect((await api.development.goals.detail({ id: a.id })).evidence.lifetimeXp).toBe(0);
  });

  it("full attribution of every contribution, including a non-goal attribute", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "SQL",
      attributes: [{ attributeId: attr("sql"), weight: 3 }],
    });
    const t = await api.development.goals.createTask({
      goalId: goal.id,
      task: {
        title: "SQL + 专注",
        priority: 2,
        contributions: [
          { attributeId: attr("sql"), weight: 3 },
          { attributeId: attr("focus"), weight: 1 },
        ],
      },
    });
    await api.tasks.complete({ id: t.id });
    await api.development.attribution.set({
      taskId: t.id,
      allocations: [
        { goalId: goal.id, attributeId: attr("sql"), share: 100 },
        { goalId: goal.id, attributeId: attr("focus"), share: 100 },
      ],
    });
    const detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.evidence).toMatchObject({ lifetimeXp: 20, unattributedXp: 0 });
  });

  it("refuses over 100 %, negative shares, unknown attributes and unlinked goals — also at the database", async () => {
    const { api, attr } = await seeded();
    const a = await api.development.goals.create({
      title: "A",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const b = await api.development.goals.create({
      title: "B",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const unlinked = await api.development.goals.create({
      title: "C",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const t = await task(api, "法语", [{ attributeId: attr("french"), weight: 2 }]);
    await api.development.goals.setForTask({ taskId: t.id, goalIds: [a.id, b.id] });

    await rejects(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [
          { goalId: a.id, attributeId: attr("french"), share: 70 },
          { goalId: b.id, attributeId: attr("french"), share: 40 },
        ],
      }),
      "allocation.over_limit",
    );
    await expect(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: a.id, attributeId: attr("french"), share: -10 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: a.id, attributeId: attr("french"), share: 101 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await rejects(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: a.id, attributeId: attr("cardio"), share: 50 }],
      }),
      "attribute.not_found",
    );
    await rejects(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: unlinked.id, attributeId: attr("french"), share: 50 }],
      }),
      "goal.not_found",
    );

    // The database enforces the same rules on its own.
    await db.insert(developmentGoalAllocations).values({
      goalId: a.id,
      taskId: t.id,
      attributeId: attr("french"),
      share: 70,
    });
    await expect(
      db.insert(developmentGoalAllocations).values({
        goalId: b.id,
        taskId: t.id,
        attributeId: attr("french"),
        share: 40,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(developmentGoalAllocations).values({
        goalId: b.id,
        taskId: t.id,
        attributeId: attr("french"),
        share: 0,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(developmentGoalAllocations).values({
        goalId: unlinked.id,
        taskId: t.id,
        attributeId: attr("french"),
        share: 10,
      }),
    ).rejects.toThrow(); // no goal ↔ task link
  });

  it("unlinking a task removes its allocations; archived goals keep theirs but cannot change", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const other = await api.development.goals.create({
      title: "旅行",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const t = await task(api, "法语", [{ attributeId: attr("french"), weight: 2 }]);
    await api.development.goals.linkTask({ goalId: goal.id, taskId: t.id });
    await api.development.goals.linkTask({ goalId: other.id, taskId: t.id });
    await api.development.goals.setStatus({ id: goal.id, status: "archived" });
    await rejects(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: goal.id, attributeId: attr("french"), share: 50 }],
      }),
      "goal.archived",
    );
    // The archived goal's 100 % still counts towards the total.
    await rejects(
      api.development.attribution.set({
        taskId: t.id,
        allocations: [{ goalId: other.id, attributeId: attr("french"), share: 10 }],
      }),
      "allocation.over_limit",
    );
    await api.development.goals.setStatus({ id: goal.id, status: "active" });
    await api.development.goals.unlinkTask({ goalId: goal.id, taskId: t.id });
    expect(await db.select().from(developmentGoalAllocations)).toEqual([]);
  });

  it("attribution creates no XP: ledger, credits, totals, level, rewards and dashboard stay the same", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const other = await api.development.goals.create({
      title: "旅行",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const t = await task(api, "法语", [{ attributeId: attr("french"), weight: 2 }], 4);
    await api.tasks.complete({ id: t.id });
    const reward = await api.rewards.create({ name: "奶茶", value: 50 });
    const snapshot = async () => ({
      counts: await ledgerCounts(),
      totals: (await api.character.overview()).totals,
      level: (await api.character.overview()).level,
      attributes: (await api.character.attributes.list()).map((a) => [a.id, a.xp]),
      balances: await api.rewards.balances(),
      prices: (await api.rewards.list()).map((r) => [r.id, r.activeXpCost, r.levelXpCost]),
      dashboard: await api.dashboard.overview().then((d) => ({
        totals: d.totals,
        balances: d.balances,
        week: d.week,
        level: d.level,
        focus: d.focus,
      })),
    });
    const before = await snapshot();

    await api.development.goals.setForTask({ taskId: t.id, goalIds: [goal.id, other.id] });
    await api.development.attribution.set({
      taskId: t.id,
      allocations: [
        { goalId: goal.id, attributeId: attr("french"), share: 50 },
        { goalId: other.id, attributeId: attr("french"), share: 50 },
      ],
    });
    const plan = await api.development.plans.create({ goalId: goal.id, title: "每日法语" });
    await api.development.plans.linkTask({ planId: plan.id, taskId: t.id });
    await api.development.plans.setStatus({ id: plan.id, status: "completed" });
    await api.development.goals.setStatus({ id: goal.id, status: "completed" });
    await api.development.overview();
    await api.development.goals.detail({ id: goal.id });

    expect(await snapshot()).toEqual(before);
    void reward;

    // And a completion still earns exactly the rule's XP.
    const next = await api.development.plans.createTask({
      planId: (await api.development.plans.create({ goalId: other.id, title: "x" })).id,
      task: { title: "下一次", priority: 4 },
      useGoalAttributes: false,
    });
    await api.tasks.complete({ id: next.id });
    expect((await api.character.history({ limit: 1 })).entries[0]).toMatchObject({
      amount: TASK_XP.base + 4 * TASK_XP.perPriority,
      credits: [],
    });
  });
});

describe("growth plans", () => {
  it("creates, edits, orders, pauses, completes, archives and restores plans", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const daily = await api.development.plans.create({
      goalId: goal.id,
      title: "  建立每日法语输入习惯 ",
      description: "每天至少 30 分钟。",
    });
    const speaking = await api.development.plans.create({ goalId: goal.id, title: "提高口语" });
    expect(daily).toMatchObject({ title: "建立每日法语输入习惯", status: "active" });

    await api.development.plans.update({
      id: speaking.id,
      patch: { title: "提高法语口语", description: "" },
    });
    await api.development.plans.move({ id: speaking.id, direction: "up" });
    let detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.plans.map((p) => p.plan.title)).toEqual(["提高法语口语", "建立每日法语输入习惯"]);
    expect(detail.plans[0]!.plan.description).toBeNull();

    expect((await api.development.plans.setStatus({ id: daily.id, status: "paused" })).status).toBe(
      "paused",
    );
    const done = await api.development.plans.setStatus({ id: daily.id, status: "completed" });
    expect(done.completedAt).toBeInstanceOf(Date);
    const archived = await api.development.plans.setStatus({ id: daily.id, status: "archived" });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((await api.development.plans.setStatus({ id: daily.id, status: "active" })).status).toBe(
      "active",
    );

    await api.development.plans.delete({ id: speaking.id });
    detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.plans.map((p) => p.plan.id)).toEqual([daily.id]);
  });

  it("links existing tasks (and thereby to the goal), unlinks, and creates ordinary tasks", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const plan = await api.development.plans.create({ goalId: goal.id, title: "每日法语" });
    const existing = await task(api, "背单词", [{ attributeId: attr("french"), weight: 2 }]);
    await api.development.plans.linkTask({ planId: plan.id, taskId: existing.id });
    await api.development.plans.linkTask({ planId: plan.id, taskId: existing.id }); // no-op
    const created = await api.development.plans.createTask({
      planId: plan.id,
      task: { title: "学习法语 30 分钟", priority: 2 },
    });
    expect(created.contributions).toEqual([{ attributeId: attr("french"), weight: 3 }]);
    await api.tasks.complete({ id: created.id });

    let detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.tasks.map((t) => t.id).sort()).toEqual([existing.id, created.id].sort());
    expect(detail.plans[0]).toMatchObject({
      taskIds: [existing.id, created.id],
      actions: { linked: 2, completed: 1 },
      recentCompleted: 1,
    });
    expect(detail.unplannedTaskIds).toEqual([]);
    // Both got the default allocation for the goal.
    expect(detail.evidence.lifetimeXp).toBe(20);

    // Plans are not tasks: completing the plan leaves the task open.
    await api.development.plans.setStatus({ id: plan.id, status: "completed" });
    expect((await api.tasks.byId({ id: existing.id })).statusCategory).toBe("unstarted");

    await api.development.plans.unlinkTask({ planId: plan.id, taskId: existing.id });
    detail = await api.development.goals.detail({ id: goal.id });
    expect(detail.plans[0]!.taskIds).toEqual([created.id]);
    expect(detail.unplannedTaskIds).toEqual([existing.id]); // still on the goal
    // Unlinking from the goal removes it from the goal's plans too.
    await api.development.goals.unlinkTask({ goalId: goal.id, taskId: created.id });
    expect(await db.select().from(developmentPlanTasks)).toEqual([]);

    // The overview lists the plan with its recent activity.
    const overview = await api.development.overview();
    expect(overview.plans).toEqual([
      expect.objectContaining({ goalTitle: "法语达到 B1", taskCount: 0, recentCompleted: 0 }),
    ]);
    expect(overview.goals[0]!.planCount).toBe(1);
  });

  it("archived plans and goals accept no new tasks or plans", async () => {
    const { api, attr } = await seeded();
    const goal = await api.development.goals.create({
      title: "法语",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const plan = await api.development.plans.create({ goalId: goal.id, title: "每日法语" });
    const t = await api.tasks.create({ title: "x" });
    await api.development.plans.setStatus({ id: plan.id, status: "archived" });
    await rejects(
      api.development.plans.linkTask({ planId: plan.id, taskId: t.id }),
      "plan.archived",
    );
    await rejects(
      api.development.plans.createTask({ planId: plan.id, task: { title: "y" } }),
      "plan.archived",
    );
    await api.development.goals.setStatus({ id: goal.id, status: "archived" });
    await rejects(
      api.development.plans.create({ goalId: goal.id, title: "新计划" }),
      "goal.archived",
    );
    await rejects(
      api.development.plans.setStatus({ id: plan.id, status: "active" }),
      "goal.archived",
    );
  });
});

describe("history", () => {
  it("backfills single-goal links at 100 % of the goal's attributes and leaves shared tasks unallocated", async () => {
    const { api, attr } = await seeded();
    const single = await api.development.goals.create({
      title: "法语",
      attributes: [{ attributeId: attr("french"), weight: 3 }],
    });
    const a = await api.development.goals.create({
      title: "A",
      attributes: [{ attributeId: attr("reading"), weight: 3 }],
    });
    const b = await api.development.goals.create({
      title: "B",
      attributes: [{ attributeId: attr("reading"), weight: 3 }],
    });
    const solo = await task(api, "法语", [
      { attributeId: attr("french"), weight: 2 },
      { attributeId: attr("reading"), weight: 1 },
    ]);
    const shared = await task(api, "读书", [{ attributeId: attr("reading"), weight: 2 }]);
    await api.tasks.complete({ id: solo.id });
    // Simulate M8 data: links without allocations.
    await db.execute(sql`insert into development_goal_tasks (goal_id, task_id) values
      (${single.id}, ${solo.id}), (${a.id}, ${shared.id}), (${b.id}, ${shared.id})`);
    // The backfill statement of migration 0011.
    const migration = await import("node:fs").then((fs) =>
      fs.readFileSync("drizzle/0011_growth_planning_attribution.sql", "utf8"),
    );
    const backfill = migration.slice(migration.lastIndexOf("INSERT INTO"));
    await db.execute(sql.raw(backfill));

    expect(
      (await db.select().from(developmentGoalAllocations)).map((r) => [
        r.goalId,
        r.taskId,
        r.attributeId,
        r.share,
      ]),
    ).toEqual([[single.id, solo.id, attr("french"), 100]]);
    const detail = await api.development.goals.detail({ id: single.id });
    // 20 XP split 2 : 1 → 法语 13 (attributed), 阅读 7 (unattributed).
    expect(detail.evidence).toMatchObject({ lifetimeXp: 13, unattributedXp: 7 });
    expect(
      (await api.development.goals.detail({ id: a.id })).taskAttribution[shared.id],
    ).toMatchObject({ needsAllocation: true, goalCount: 2 });
  });
});

describe("authorization", () => {
  it("never reads or links another user's goals, plans, tasks, attributes or projects", async () => {
    const owner = await seeded();
    const other = await seeded();
    const goal = await owner.api.development.goals.create({
      title: "私人目标",
      attributes: [{ attributeId: owner.attr("french"), weight: 3 }],
    });
    const plan = await owner.api.development.plans.create({ goalId: goal.id, title: "私人计划" });
    const ownerTask = await task(owner.api, "私人任务", [
      { attributeId: owner.attr("french"), weight: 2 },
    ]);
    await owner.api.development.goals.linkTask({ goalId: goal.id, taskId: ownerTask.id });
    const ownerProject = await owner.api.projects.create({ name: "私人项目" });

    const theirGoal = await other.api.development.goals.create({
      title: "他人目标",
      attributes: [{ attributeId: other.attr("french"), weight: 3 }],
    });
    const theirPlan = await other.api.development.plans.create({
      goalId: theirGoal.id,
      title: "他人计划",
    });
    const theirTask = await other.api.tasks.create({ title: "他人任务" });
    const d = other.api.development;

    // Goals and plans
    await rejects(d.goals.detail({ id: goal.id }), "goal.not_found");
    await rejects(d.plans.create({ goalId: goal.id, title: "x" }), "goal.not_found");
    await rejects(d.plans.update({ id: plan.id, patch: { title: "x" } }), "plan.not_found");
    await rejects(d.plans.setStatus({ id: plan.id, status: "archived" }), "plan.not_found");
    await rejects(d.plans.move({ id: plan.id, direction: "up" }), "plan.not_found");
    await rejects(d.plans.delete({ id: plan.id }), "plan.not_found");
    await rejects(d.plans.linkTask({ planId: plan.id, taskId: theirTask.id }), "plan.not_found");
    await rejects(d.plans.createTask({ planId: plan.id, task: { title: "x" } }), "plan.not_found");
    // Their own plan, someone else's task
    await rejects(
      d.plans.linkTask({ planId: theirPlan.id, taskId: ownerTask.id }),
      "task.not_found",
    );
    // Attribution
    await rejects(d.attribution.forTask({ taskId: ownerTask.id }), "task.not_found");
    await rejects(
      d.attribution.set({
        taskId: ownerTask.id,
        allocations: [{ goalId: goal.id, attributeId: owner.attr("french"), share: 50 }],
      }),
      "task.not_found",
    );
    await d.goals.linkTask({ goalId: theirGoal.id, taskId: theirTask.id });
    await rejects(
      d.attribution.set({
        taskId: theirTask.id,
        allocations: [{ goalId: goal.id, attributeId: other.attr("french"), share: 50 }],
      }),
      "goal.not_found",
    );
    await rejects(
      d.attribution.set({
        taskId: theirTask.id,
        allocations: [{ goalId: theirGoal.id, attributeId: owner.attr("french"), share: 50 }],
      }),
      "attribute.not_found",
    );
    // Projects and attributes on goals (M8 rules still hold)
    await rejects(
      d.goals.linkProject({ goalId: theirGoal.id, projectId: ownerProject.id }),
      "project.not_found",
    );
    await rejects(
      d.goals.create({
        title: "x",
        attributes: [{ attributeId: owner.attr("reading"), weight: 1 }],
      }),
      "attribute.not_found",
    );
    expect((await d.overview()).plans.map((p) => p.plan.id)).toEqual([theirPlan.id]);
  });
});
