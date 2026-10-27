import {
  buildTrend,
  getLevelProgress,
  isActiveAttribute,
  isLegacyAttribute,
} from "@/modules/character/domain";
import {
  getAttributeLastActivity,
  getAttributeSources,
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
  type AttributeDetail,
  type DevelopmentOverview,
  type GoalDetail,
} from "../domain";
import { getGoal, goalLinkCounts, linkedProjectIds, linkedTaskIds, listGoals } from "./goals";
import { getFocus, getVision } from "./profile";

/*
 * Read side of the development system. Growth figures come from the character module (ledger and
 * credits), task states from the tasks module, projects from the projects module; this module
 * adds only its own planning data (vision, focus, goals, links). Nothing here writes.
 */

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
  const { tasksOf, projectsOf } = await goalLinkCounts(
    db,
    userId,
    open.map((goal) => goal.id),
  );
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
      recentGrowthXp: goal.attributes.reduce(
        (sum, link) => sum + (recentOf.get(link.attributeId) ?? 0),
        0,
      ),
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
  const [linkedTasks, projects] = await Promise.all([
    getTasksByIds(db, userId, taskIds),
    projectIds.length ? listProjects(db, userId, { today }) : Promise.resolve([]),
  ]);
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
