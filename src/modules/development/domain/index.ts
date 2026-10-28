import "./events";
import { z } from "zod";

import type {
  AttributeValue,
  DevelopmentAttribute,
  TrendBucket,
  TrendPoint,
  XpEntry,
} from "@/modules/character/domain";
import type { Project } from "@/modules/projects/domain";
import { createTaskInput, type StatusCategory, type Task } from "@/modules/tasks/domain";

/*
 * The personal-development planning layer (ADR 0017):
 *
 *   Vision      — who I want to become (one free-text statement).
 *   Goal        — a meaningful development outcome I consciously choose ("法语达到 B1").
 *   Attribute   — an ability I grow (character module); a goal names the ones it develops.
 *   Task        — a concrete action (tasks module); goals reference existing tasks, never copy them.
 *   Growth XP   — what the existing XP rules award for completed tasks (character module).
 *
 * Goals are planning metadata: they never create, change or multiply XP. Their progress is the
 * plain count of their linked actions, so the user can always see where a number comes from.
 */

/* ---------------------------------------------------------------- goals */

export const goalStatuses = ["active", "paused", "completed", "archived"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

/** 1 = low, 2 = medium, 3 = high. */
export const goalPriorities = [3, 2, 1] as const;
export type GoalPriority = (typeof goalPriorities)[number];

/** Same weights as task development contributions (主要 3 · 一般 2 · 少量 1). */
export const goalWeights = [3, 2, 1] as const;

const goalTitle = z.string().trim().min(1).max(120);
const goalDescription = z.string().trim().max(2000).nullable();
const goalAttribute = z.object({
  attributeId: z.uuid(),
  weight: z.number().int().min(1).max(3),
});
/** A goal develops at least one attribute; each attribute at most once. */
const goalAttributes = z
  .array(goalAttribute)
  .min(1)
  .max(12)
  .refine((list) => new Set(list.map((a) => a.attributeId)).size === list.length, {
    message: "Duplicate attribute",
  });

export const createGoalInput = z.object({
  title: goalTitle,
  description: goalDescription.optional(),
  priority: z.number().int().min(1).max(3).optional(),
  targetDate: z.iso.date().nullable().optional(),
  attributes: goalAttributes,
});
export type CreateGoalInput = z.infer<typeof createGoalInput>;

export const updateGoalInput = z.object({
  id: z.uuid(),
  patch: z
    .object({
      title: goalTitle,
      description: goalDescription,
      priority: z.number().int().min(1).max(3),
      targetDate: z.iso.date().nullable(),
      attributes: goalAttributes,
    })
    .partial(),
});
export type UpdateGoalInput = z.infer<typeof updateGoalInput>;

export const setGoalStatusInput = z.object({ id: z.uuid(), status: z.enum(goalStatuses) });
export const goalIdInput = z.object({ id: z.uuid() });
export const goalTaskInput = z.object({ goalId: z.uuid(), taskId: z.uuid() });
export const goalProjectInput = z.object({ goalId: z.uuid(), projectId: z.uuid() });
export const taskIdInput = z.object({ taskId: z.uuid() });
export const setTaskGoalsInput = z.object({
  taskId: z.uuid(),
  goalIds: z
    .array(z.uuid())
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Duplicate goal" }),
});

/**
 * A new, ordinary task created from a goal and linked to it. `useGoalAttributes` pre-fills the
 * task's development contributions with the goal's attributes — visible and editable on the task;
 * XP still only comes from the task's completion rule.
 */
export const createGoalTaskInput = z.object({
  goalId: z.uuid(),
  task: createTaskInput,
  useGoalAttributes: z.boolean().default(true),
});
export type CreateGoalTaskInput = z.infer<typeof createGoalTaskInput>;

export interface GoalStatusChange {
  status: GoalStatus;
  completedAt: Date | null;
  archivedAt: Date | null;
}

/**
 * The stored shape of a status change. Completing stamps `completedAt`; archiving stamps
 * `archivedAt` and keeps an earlier completion date; any other status clears both (restoring an
 * archived goal makes it active again).
 */
export function goalStatusChange(
  current: { status: GoalStatus; completedAt: Date | null },
  next: GoalStatus,
  now: Date,
): GoalStatusChange {
  if (next === "completed") {
    return {
      status: next,
      completedAt: current.status === "completed" ? current.completedAt : now,
      archivedAt: null,
    };
  }
  if (next === "archived")
    return { status: next, completedAt: current.completedAt, archivedAt: now };
  return { status: next, completedAt: null, archivedAt: null };
}

export interface GoalAttribute {
  attributeId: string;
  weight: number;
}

export interface DevelopmentGoal {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  priority: number;
  targetDate: string | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Heaviest first. */
  attributes: GoalAttribute[];
}

/* ---------------------------------------------------------------- progress */

/** Recent = this many days, ending today (user's timezone). */
export const RECENT_WINDOW_DAYS = 30;
/** Span of the attribute page's growth trend. */
export const ATTRIBUTE_TREND_DAYS = 90;

export interface GoalActionStats {
  /** Linked tasks not in the Trash. */
  linked: number;
  completed: number;
  cancelled: number;
  /** Not completed, not cancelled. */
  open: number;
}

/**
 * Activity-based progress: counts of the goal's linked actions by status category. The UI shows
 * "已完成 completed / (linked − cancelled)" — no estimate, no XP-derived percentage.
 */
export function goalActionStats(
  linked: readonly { statusCategory: StatusCategory }[],
): GoalActionStats {
  const completed = linked.filter((t) => t.statusCategory === "completed").length;
  // Failed tasks (M10.5) are, like cancelled ones, closed without being done.
  const cancelled = linked.filter(
    (t) => t.statusCategory === "cancelled" || t.statusCategory === "failed",
  ).length;
  return {
    linked: linked.length,
    completed,
    cancelled,
    open: linked.length - completed - cancelled,
  };
}

/** Actions that still count towards the goal: linked minus cancelled. */
export const countedActions = (stats: GoalActionStats) => stats.linked - stats.cancelled;

/* ---------------------------------------------------------------- vision & focus */

export const updateVisionInput = z.object({ vision: z.string().trim().max(2000).nullable() });

/** Default limit of chosen focus attributes. One constant, read by the server and the UI. */
export const MAX_FOCUS_ATTRIBUTES = 3;

export const setFocusInput = z.object({
  /** In the user's order. */
  attributeIds: z
    .array(z.uuid())
    .refine((ids) => new Set(ids).size === ids.length, { message: "Duplicate attribute" }),
});

/* ---------------------------------------------------------------- read models */

export interface AttributeSummary {
  attribute: AttributeValue;
  /** Lifetime Growth XP (the attribute's credits). */
  lifetimeGrowthXp: number;
  recentGrowthXp: number;
  /** Active goals naming this attribute. */
  activeGoalCount: number;
  /** Latest Growth XP credit, or null when it never grew. */
  lastActivityAt: Date | null;
  focused: boolean;
}

export interface GoalSummary {
  goal: DevelopmentGoal;
  actions: GoalActionStats;
  projectCount: number;
  /** Growth XP attributed to this goal in the recent window (M9: goal-specific, ADR 0018). */
  recentGrowthXp: number;
  /** Lifetime Growth XP attributed to this goal. */
  attributedXp: number;
  /** Non-archived plans. */
  planCount: number;
}

export interface DevelopmentOverview {
  vision: string | null;
  /** Chosen focus, in the user's order. */
  focusAttributeIds: string[];
  maxFocus: number;
  /** Every non-archived goal (active, paused, completed). */
  goals: GoalSummary[];
  archivedGoals: DevelopmentGoal[];
  /** Active (not archived, not legacy) attributes, in the user's order. */
  attributes: AttributeSummary[];
  archivedAttributes: AttributeValue[];
  /** Attributes with the most Growth XP in the recent window — measured, not chosen. */
  recentGrowth: { attributeId: string; growthXp: number }[];
  /** Non-archived plans of non-archived goals, by recent activity (M9). */
  plans: {
    goalId: string;
    goalTitle: string;
    plan: DevelopmentPlan;
    recentCompleted: number;
    taskCount: number;
  }[];
}

export interface GoalAttributeGrowth extends GoalAttribute {
  attribute: AttributeValue;
  lifetimeGrowthXp: number;
  recentGrowthXp: number;
}

export interface GoalDetail {
  goal: DevelopmentGoal;
  attributes: GoalAttributeGrowth[];
  tasks: Task[];
  actions: GoalActionStats;
  projects: Project[];
  /** Goal-specific evidence (M9). */
  evidence: {
    byAttribute: { attributeId: string; lifetimeXp: number; recentXp: number }[];
    lifetimeXp: number;
    recentXp: number;
    unattributedXp: number;
    /** Linked tasks completed in the recent window. */
    recentCompleted: number;
  };
  /** Per linked task: attributed / unattributed Growth XP, and whether it awaits allocation. */
  taskAttribution: Record<
    string,
    { attributedXp: number; unattributedXp: number; needsAllocation: boolean; goalCount: number }
  >;
  plans: PlanSummary[];
  /** Linked tasks in no non-archived plan of this goal. */
  unplannedTaskIds: string[];
}

export interface AttributeSource {
  sourceType: string;
  sourceId: string;
  title: string | null;
  growthXp: number;
}

export interface AttributeDetail {
  attribute: AttributeValue;
  lifetimeGrowthXp: number;
  recentGrowthXp: number;
  focused: boolean;
  trend: { from: string; to: string; bucket: TrendBucket; points: TrendPoint[] };
  goals: DevelopmentGoal[];
  /** Open tasks that currently name this attribute as a development contribution. */
  openTasks: Task[];
  recentEntries: XpEntry[];
  /** Where its Growth XP came from (lifetime, by source), most first. */
  sources: AttributeSource[];
  /** Labels for every attribute the entries mention. */
  allAttributes: DevelopmentAttribute[];
}

/* ================================================================ M9: attribution & plans */

/*
 * Goal attribution (ADR 0018). A linked task's Growth XP per attribute — the net of its credits,
 * computed by the character module — is allocated across the task's goals by percentage shares.
 * Allocation, never duplication: the shares of one (task, attribute) add up to at most 100 %, every
 * goal's part is truncated towards zero, and whatever is left is 未归属. Nothing here is XP.
 */

/** One stored share: `share` % of the task's Growth XP in `attributeId` counts for `goalId`. */
export interface Allocation {
  goalId: string;
  taskId: string;
  attributeId: string;
  share: number;
}

/** Net Growth XP a task earned in one attribute (lifetime and in the recent window). */
export interface TaskAttributeGrowth {
  taskId: string;
  attributeId: string;
  lifetimeXp: number;
  recentXp: number;
}

/** A goal's part of `xp` at `share` %: truncated towards zero, so parts never exceed the whole. */
export function allocatedXp(xp: number, share: number): number {
  return Math.trunc((xp * share) / 100);
}

/**
 * Splits one (task, attribute) Growth XP across goals. The parts plus `unattributed` equal `xp`
 * exactly; with shares totalling ≤ 100 % no part is ever counted twice.
 */
export function splitGrowth(
  xp: number,
  shares: readonly { goalId: string; share: number }[],
): { byGoal: Map<string, number>; unattributed: number } {
  const byGoal = new Map<string, number>();
  let allocated = 0;
  for (const { goalId, share } of shares) {
    const part = allocatedXp(xp, share);
    byGoal.set(goalId, (byGoal.get(goalId) ?? 0) + part);
    allocated += part;
  }
  return { byGoal, unattributed: xp - allocated };
}

export const allocationShare = z.number().int().min(0).max(100);

export const setTaskAllocationInput = z.object({
  taskId: z.uuid(),
  /** The complete allocation of the task (0 = not attributed). Pairs not listed become 0. */
  allocations: z
    .array(z.object({ goalId: z.uuid(), attributeId: z.uuid(), share: allocationShare }))
    .max(200),
});
export type SetTaskAllocationInput = z.infer<typeof setTaskAllocationInput>;

/** Attributes whose shares across goals add up to more than 100 % (empty when valid). */
export function overAllocated(
  allocations: readonly { goalId: string; attributeId: string; share: number }[],
): string[] {
  const totals = new Map<string, number>();
  for (const a of allocations)
    totals.set(a.attributeId, (totals.get(a.attributeId) ?? 0) + a.share);
  return [...totals].filter(([, total]) => total > 100).map(([attributeId]) => attributeId);
}

/**
 * The default when a task is linked to a goal: if this is the task's only goal, 100 % of the
 * task's growth in the goal's attributes; if the task already serves other goals, nothing — the
 * user allocates explicitly instead of the system guessing (or counting it twice).
 */
export function defaultAllocation(
  goal: { id: string; attributes: readonly { attributeId: string }[] },
  taskAttributeIds: readonly string[],
  otherGoalCount: number,
): { goalId: string; attributeId: string; share: number }[] {
  if (otherGoalCount > 0) return [];
  const relevant = new Set(goal.attributes.map((a) => a.attributeId));
  return [...new Set(taskAttributeIds)]
    .filter((id) => relevant.has(id))
    .map((attributeId) => ({ goalId: goal.id, attributeId, share: 100 }));
}

/** What one goal can claim, computed from growth rows and every allocation of its tasks. */
export interface GoalAttribution {
  /** Attributed Growth XP per attribute (lifetime / recent), heaviest first. */
  byAttribute: { attributeId: string; lifetimeXp: number; recentXp: number }[];
  lifetimeXp: number;
  recentXp: number;
  /** Growth XP of the goal's linked tasks that no goal claims (lifetime). */
  unattributedXp: number;
  /** Per linked task: what this goal claims and what nobody claims. */
  tasks: Map<string, { attributedXp: number; unattributedXp: number; needsAllocation: boolean }>;
}

export function goalAttribution(
  goalId: string,
  linkedTaskIds: readonly string[],
  growth: readonly TaskAttributeGrowth[],
  allocations: readonly Allocation[],
  /** How many goals each task is linked to. */
  goalCountOf: ReadonlyMap<string, number>,
  /** Tasks with development contributions (they will earn growth even if they have none yet). */
  contributingTaskIds: ReadonlySet<string> = new Set(),
): GoalAttribution {
  const linked = new Set(linkedTaskIds);
  const sharesOf = (taskId: string, attributeId: string) =>
    allocations.filter((a) => a.taskId === taskId && a.attributeId === attributeId);
  const byAttribute = new Map<string, { lifetimeXp: number; recentXp: number }>();
  const tasks = new Map<
    string,
    { attributedXp: number; unattributedXp: number; needsAllocation: boolean }
  >();
  let unattributedXp = 0;

  for (const taskId of linked) {
    tasks.set(taskId, { attributedXp: 0, unattributedXp: 0, needsAllocation: false });
  }
  for (const row of growth) {
    if (!linked.has(row.taskId)) continue;
    const shares = sharesOf(row.taskId, row.attributeId);
    const lifetime = splitGrowth(row.lifetimeXp, shares);
    const recent = splitGrowth(row.recentXp, shares);
    const mine = lifetime.byGoal.get(goalId) ?? 0;
    const mineRecent = recent.byGoal.get(goalId) ?? 0;
    if (mine !== 0 || mineRecent !== 0) {
      const sum = byAttribute.get(row.attributeId) ?? { lifetimeXp: 0, recentXp: 0 };
      sum.lifetimeXp += mine;
      sum.recentXp += mineRecent;
      byAttribute.set(row.attributeId, sum);
    }
    const task = tasks.get(row.taskId)!;
    task.attributedXp += mine;
    task.unattributedXp += lifetime.unattributed;
    unattributedXp += lifetime.unattributed;
  }
  for (const [taskId, task] of tasks) {
    // Shared with other goals, growth earned, and nothing of it allocated here yet.
    const mineAny = allocations.some((a) => a.taskId === taskId && a.goalId === goalId);
    task.needsAllocation =
      (goalCountOf.get(taskId) ?? 1) > 1 &&
      !mineAny &&
      (task.unattributedXp > 0 || contributingTaskIds.has(taskId));
  }
  const rows = [...byAttribute].map(([attributeId, xp]) => ({ attributeId, ...xp }));
  rows.sort((a, b) => b.lifetimeXp - a.lifetimeXp);
  return {
    byAttribute: rows,
    lifetimeXp: rows.reduce((sum, r) => sum + r.lifetimeXp, 0),
    recentXp: rows.reduce((sum, r) => sum + r.recentXp, 0),
    unattributedXp,
    tasks,
  };
}

/** For the allocation editor: one task's growth and how it is split over its goals. */
export interface TaskAttributionView {
  taskId: string;
  taskTitle: string;
  /** Attributes the task contributes to now or earned Growth XP in, with weights and XP. */
  attributes: {
    attributeId: string;
    weight: number | null;
    lifetimeXp: number;
  }[];
  goals: { id: string; title: string; status: GoalStatus }[];
  allocations: Allocation[];
}

/* ---------------------------------------------------------------- plans */

export const planStatuses = goalStatuses;
export type PlanStatus = GoalStatus;

const planTitle = z.string().trim().min(1).max(120);

export const createPlanInput = z.object({
  goalId: z.uuid(),
  title: planTitle,
  description: z.string().trim().max(2000).nullable().optional(),
});
export const updatePlanInput = z.object({
  id: z.uuid(),
  patch: z
    .object({ title: planTitle, description: z.string().trim().max(2000).nullable() })
    .partial(),
});
export const setPlanStatusInput = z.object({ id: z.uuid(), status: z.enum(planStatuses) });
export const planIdInput = z.object({ id: z.uuid() });
export const movePlanInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
export const planTaskInput = z.object({ planId: z.uuid(), taskId: z.uuid() });
export const createPlanTaskInput = z.object({
  planId: z.uuid(),
  task: createTaskInput,
  useGoalAttributes: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanInput>;
export type UpdatePlanInput = z.infer<typeof updatePlanInput>;
export type CreatePlanTaskInput = z.infer<typeof createPlanTaskInput>;

export interface DevelopmentPlan {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  status: PlanStatus;
  sortKey: string;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface PlanSummary {
  plan: DevelopmentPlan;
  taskIds: string[];
  actions: GoalActionStats;
  /** Plan tasks completed in the recent window. */
  recentCompleted: number;
}
