import {
  buildTrend,
  getLevelProgress,
  isActiveAttribute,
  isLegacyAttribute,
} from "@/modules/character/domain";
import {
  getAttributeLastActivity,
  getAttributeSources,
  getTaskGrowth,
  getXpActivity,
  listAttributes,
  listHistory,
} from "@/modules/character/server";
import { rankGrowth } from "@/modules/dashboard/domain";
import { listProjects } from "@/modules/projects/server";
import { getUserSettings } from "@/modules/settings/server";
import { addDays, todayIn } from "@/modules/tasks/domain";
import { getTasksByIds, listOpenTasksDeveloping } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";

import {
  ATTRIBUTE_TREND_DAYS,
  MAX_FOCUS_ATTRIBUTES,
  RECENT_WINDOW_DAYS,
  goalActionStats,
  goalAttribution,
  type AttributeDetail,
  type DevelopmentOverview,
  type GoalDetail,
} from "../domain";
import { listAllocations } from "./attribution";
import {
  getGoal,
  goalLinkCounts,
  goalTaskLinks,
  linkedProjectIds,
  linkedTaskIds,
  listGoals,
} from "./goals";
import { listPlans, planTaskIds } from "./plans";
import { getFocus, getVision } from "./profile";

/*
 * Read side of the development system. Growth figures come from the character module (ledger and
 * credits), task states from the tasks module, projects from the projects module; this module
 * adds only its own planning data (vision, focus, goals, plans, links, allocations). Goal XP is
 * the allocated part of the linked tasks' credits (ADR 0018), computed here at read time. Nothing
 * here writes.
 */

/** Links, growth and allocations of the user's goals — everything goal attribution reads. */
async function attributionContext(
  db: DbExecutor,
  userId: string,
  range: { from: string; timeZone: string },
) {
  const links = await goalTaskLinks(db, userId, range);
  const taskIds = [...new Set(links.map((link) => link.taskId))];
  const [growth, allocations] = await Promise.all([
    getTaskGrowth(db, userId, taskIds, range),
    listAllocations(db, taskIds),
  ]);
  const goalCountOf = new Map<string, number>();
  for (const link of links) goalCountOf.set(link.taskId, (goalCountOf.get(link.taskId) ?? 0) + 1);
  const linksOf = (goalId: string) => links.filter((link) => link.goalId === goalId);
  const attribution = (goalId: string, contributing?: ReadonlySet<string>) =>
    goalAttribution(
      goalId,
      linksOf(goalId).map((link) => link.taskId),
      growth,
      allocations,
      goalCountOf,
      contributing,
    );
  return { links, linksOf, goalCountOf, attribution };
}

const RECENT_GROWTH_SIZE = 3;

async function calendar(db: DbExecutor, userId: string) {
  const settings = await getUserSettings(db, userId);
  const timeZone = settings.timeZone ?? defaultTimeZone;
  const today = todayIn(timeZone);
  return { timeZone, today, recentFrom: addDays(today, -(RECENT_WINDOW_DAYS - 1)) };
}

export async function getDevelopmentOverview(
  db: DbExecutor,
  userId: string,
): Promise<DevelopmentOverview> {
  const { timeZone, recentFrom } = await calendar(db, userId);
  const [vision, focus, goals, attributes, recent, lastActivity] = await Promise.all([
    getVision(db, userId),
    getFocus(db, userId),
    listGoals(db, userId),
    listAttributes(db, userId),
    getXpActivity(db, userId, { from: recentFrom, timeZone }),
    getAttributeLastActivity(db, userId),
  ]);
  const open = goals.filter((goal) => goal.status !== "archived");
  const [{ tasksOf, projectsOf }, context, plans] = await Promise.all([
    goalLinkCounts(
      db,
      userId,
      open.map((goal) => goal.id),
    ),
    attributionContext(db, userId, { from: recentFrom, timeZone }),
    listPlans(
      db,
      userId,
      open.map((goal) => goal.id),
    ),
  ]);
  const openPlans = plans.filter((plan) => plan.status !== "archived");
  const tasksOfPlan = await planTaskIds(
    db,
    openPlans.map((plan) => plan.id),
  );
  const linkOf = new Map(context.links.map((link) => [`${link.goalId}:${link.taskId}`, link]));
  const goalTitle = new Map(open.map((goal) => [goal.id, goal.title]));
  const recentOf = new Map(recent.byAttribute.map((row) => [row.attributeId, row.growthXp]));
  const active = attributes.filter(isActiveAttribute);
  const focused = new Set(focus);

  return {
    vision,
    focusAttributeIds: focus,
    maxFocus: MAX_FOCUS_ATTRIBUTES,
    goals: open.map((goal) => ({
      goal,
      actions: goalActionStats(tasksOf.get(goal.id) ?? []),
      projectCount: projectsOf.get(goal.id) ?? 0,
      ...(() => {
        const attributed = context.attribution(goal.id);
        return { recentGrowthXp: attributed.recentXp, attributedXp: attributed.lifetimeXp };
      })(),
      planCount: openPlans.filter((plan) => plan.goalId === goal.id).length,
    })),
    archivedGoals: goals.filter((goal) => goal.status === "archived"),
    attributes: active.map((attribute) => ({
      attribute: { ...attribute, progress: getLevelProgress(attribute.xp) },
      lifetimeGrowthXp: attribute.xp,
      recentGrowthXp: recentOf.get(attribute.id) ?? 0,
      activeGoalCount: goals.filter(
        (goal) =>
          goal.status === "active" && goal.attributes.some((a) => a.attributeId === attribute.id),
      ).length,
      lastActivityAt: lastActivity.get(attribute.id) ?? null,
      focused: focused.has(attribute.id),
    })),
    archivedAttributes: attributes
      .filter((attribute) => attribute.archivedAt && !isLegacyAttribute(attribute))
      .map((attribute) => ({ ...attribute, progress: getLevelProgress(attribute.xp) })),
    recentGrowth: rankGrowth(recent.byAttribute, active, RECENT_GROWTH_SIZE),
    plans: openPlans
      .map((plan) => {
        const linked = (tasksOfPlan.get(plan.id) ?? []).flatMap((taskId) => {
          const link = linkOf.get(`${plan.goalId}:${taskId}`);
          return link ? [link] : [];
        });
        return {
          goalId: plan.goalId,
          goalTitle: goalTitle.get(plan.goalId) ?? "",
          plan,
          taskCount: linked.length,
          recentCompleted: linked.filter((link) => link.recentlyCompleted).length,
        };
      })
      .sort((a, b) => b.recentCompleted - a.recentCompleted),
  };
}

export async function getGoalDetail(
  db: DbExecutor,
  userId: string,
  goalId: string,
): Promise<GoalDetail> {
  const goal = await getGoal(db, userId, goalId);
  const { timeZone, today, recentFrom } = await calendar(db, userId);
  const [taskIds, projectIds, attributes, recent] = await Promise.all([
    linkedTaskIds(db, goalId),
    linkedProjectIds(db, goalId),
    listAttributes(db, userId),
    getXpActivity(db, userId, { from: recentFrom, timeZone }),
  ]);
  const [linkedTasks, projects, context, plans] = await Promise.all([
    getTasksByIds(db, userId, taskIds),
    projectIds.length ? listProjects(db, userId, { today }) : Promise.resolve([]),
    attributionContext(db, userId, { from: recentFrom, timeZone }),
    listPlans(db, userId, [goalId]),
  ]);
  const tasksOfPlan = await planTaskIds(
    db,
    plans.map((plan) => plan.id),
  );
  const visibleTasks = new Map(linkedTasks.map((task) => [task.id, task]));
  const contributing = new Set(
    linkedTasks.filter((task) => task.contributions.length > 0).map((task) => task.id),
  );
  const attribution = context.attribution(goalId, contributing);
  const recentlyCompleted = new Set(
    context
      .linksOf(goalId)
      .filter((link) => link.recentlyCompleted)
      .map((link) => link.taskId),
  );
  const planned = new Set(
    plans
      .filter((plan) => plan.status !== "archived")
      .flatMap((plan) => tasksOfPlan.get(plan.id) ?? []),
  );
  const attributeOf = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const recentOf = new Map(recent.byAttribute.map((row) => [row.attributeId, row.growthXp]));
  const linkedProjects = new Set(projectIds);
  // Open actions first (in link order), then completed, then cancelled.
  const rank = { completed: 1, cancelled: 2 } as Record<string, number>;
  const order = new Map(taskIds.map((id, index) => [id, index]));
  const sortedTasks = [...linkedTasks].sort(
    (a, b) =>
      (rank[a.statusCategory] ?? 0) - (rank[b.statusCategory] ?? 0) ||
      order.get(a.id)! - order.get(b.id)!,
  );

  return {
    goal,
    attributes: goal.attributes.flatMap((link) => {
      const attribute = attributeOf.get(link.attributeId);
      if (!attribute) return [];
      return [
        {
          ...link,
          attribute: { ...attribute, progress: getLevelProgress(attribute.xp) },
          lifetimeGrowthXp: attribute.xp,
          recentGrowthXp: recentOf.get(attribute.id) ?? 0,
        },
      ];
    }),
    tasks: sortedTasks,
    actions: goalActionStats(linkedTasks),
    projects: projects.filter((project) => linkedProjects.has(project.id)),
    evidence: {
      byAttribute: attribution.byAttribute,
      lifetimeXp: attribution.lifetimeXp,
      recentXp: attribution.recentXp,
      unattributedXp: attribution.unattributedXp,
      recentCompleted: recentlyCompleted.size,
    },
    taskAttribution: Object.fromEntries(
      [...attribution.tasks].map(([taskId, task]) => [
        taskId,
        { ...task, goalCount: context.goalCountOf.get(taskId) ?? 1 },
      ]),
    ),
    plans: plans.map((plan) => {
      const planTasks = (tasksOfPlan.get(plan.id) ?? []).flatMap((taskId) => {
        const task = visibleTasks.get(taskId);
        return task ? [task] : [];
      });
      return {
        plan,
        taskIds: planTasks.map((task) => task.id),
        actions: goalActionStats(planTasks),
        recentCompleted: planTasks.filter((task) => recentlyCompleted.has(task.id)).length,
      };
    }),
    unplannedTaskIds: sortedTasks.filter((task) => !planned.has(task.id)).map((task) => task.id),
  };
}

export async function getAttributeDetail(
  db: DbExecutor,
  userId: string,
  attributeId: string,
): Promise<AttributeDetail> {
  const attributes = await listAttributes(db, userId);
  const attribute = attributes.find((a) => a.id === attributeId);
  if (!attribute || isLegacyAttribute(attribute)) {
    throw new DomainError("not_found", "attribute.not_found");
  }
  const { timeZone, today, recentFrom } = await calendar(db, userId);
  const trendFrom = addDays(today, -(ATTRIBUTE_TREND_DAYS - 1));
  const [activity, goals, openTasks, history, sources, focus] = await Promise.all([
    getXpActivity(db, userId, { from: trendFrom, timeZone, attributeId }),
    listGoals(db, userId, { statuses: ["active", "paused", "completed"] }),
    listOpenTasksDeveloping(db, userId, attributeId),
    listHistory(db, userId, { attributeId, limit: 10 }),
    getAttributeSources(db, userId, attributeId),
    getFocus(db, userId),
  ]);
  const { bucket, points } = buildTrend(activity.days, trendFrom, today);

  return {
    attribute: { ...attribute, progress: getLevelProgress(attribute.xp) },
    lifetimeGrowthXp: attribute.xp,
    recentGrowthXp: activity.days
      .filter((day) => day.date >= recentFrom)
      .reduce((sum, day) => sum + day.growthXp, 0),
    focused: focus.includes(attributeId),
    trend: { from: trendFrom, to: today, bucket, points },
    goals: goals.filter((goal) => goal.attributes.some((a) => a.attributeId === attributeId)),
    openTasks,
    recentEntries: history.entries,
    sources,
    allAttributes: attributes,
  };
}
