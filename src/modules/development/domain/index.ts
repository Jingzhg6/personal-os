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
  const cancelled = linked.filter((t) => t.statusCategory === "cancelled").length;
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
  /** Growth XP of the goal's attributes in the recent window (not weighted, not goal-specific). */
  recentGrowthXp: number;
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
