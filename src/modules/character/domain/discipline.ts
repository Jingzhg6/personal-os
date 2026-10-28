import { z } from "zod";

import { localDate, zonedInstant } from "@/shared/lib/zoned-time";

/*
 * 自制力 (Discipline), M10.5, ADR 0021: a fixed, system-managed attribute that measures how
 * planned tasks are carried out. Its rules are code, not user data. Pure: no clock, no database.
 *
 * Accounting model: every task has a *target outcome* derived from its current state. The
 * discipline ledger is append-only; whenever the target changes, one entry records the difference
 * between the target's points and the task's current net, so a task's net always equals the
 * points of its current outcome — penalties never stack and corrections are explicit entries.
 */

export const DISCIPLINE_KEY = "discipline";

/** Seed of the system attribute (label from the translation catalogue; never renamed). */
export const disciplineAttributeSeed = {
  systemKey: DISCIPLINE_KEY,
  icon: "🎯",
  color: "violet",
} as const;

export const disciplineOutcomes = [
  "none",
  "early",
  "on_time",
  "late",
  "overdue",
  "failed",
  "cancelled",
] as const;
export type DisciplineOutcome = (typeof disciplineOutcomes)[number];

/** The fixed scoring table. */
export const DISCIPLINE_POINTS: Record<DisciplineOutcome, number> = {
  none: 0,
  early: 15,
  on_time: 10,
  late: 3,
  overdue: -3,
  failed: -5,
  cancelled: 0,
};

/**
 * A deadline counts as planned only if it was set at least this long before the moment that is
 * judged (completion, failure, or the deadline itself): a task created and done on the spot is
 * not a planned task.
 */
export const PLANNING_LEAD_MS = 60 * 60_000;

export type DisciplineCategory =
  "backlog" | "unstarted" | "started" | "completed" | "cancelled" | "failed";

export interface DisciplineTask {
  category: DisciplineCategory;
  /** Local calendar date of the deadline. */
  dueDate: string | null;
  /** Optional local "HH:MM"; without it the deadline is the end of the due date. */
  dueTime: string | null;
  plannedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The deadline instant in the user's time zone: the due time on the due date, or the end of the
 * due date (the start of the next local day) without a due time. DST: see `zonedInstant`.
 */
export function deadlineOf(
  task: Pick<DisciplineTask, "dueDate" | "dueTime">,
  timeZone: string,
): number | null {
  if (!task.dueDate) return null;
  return task.dueTime
    ? zonedInstant(task.dueDate, task.dueTime, timeZone).instant
    : zonedInstant(nextDay(task.dueDate), "00:00", timeZone).instant;
}

/** Planned: the deadline was set at least PLANNING_LEAD_MS before both `at` and the deadline. */
export function isPlanned(task: DisciplineTask, at: number, timeZone: string): boolean {
  const deadline = deadlineOf(task, timeZone);
  if (deadline === null || task.plannedAt === null) return false;
  const planned = task.plannedAt.getTime() + PLANNING_LEAD_MS;
  return planned <= at && planned <= deadline;
}

/**
 * The outcome a task deserves now.
 *
 * - Completed: late if after the deadline or if the deadline was ever missed before (`missed`:
 *   an earlier overdue or late outcome — moving the date afterwards does not undo it); early if
 *   completed on a local date before the due date; otherwise on time. Unplanned → none.
 * - Failed: failed if planned (judged at the failure time; a missed task is planned). Else none.
 * - Cancelled: cancelled (0) — never a failure penalty.
 * - Open: overdue once the deadline has passed (planned before it), or if it was missed before;
 *   otherwise none.
 */
export function disciplineOutcome(
  task: DisciplineTask,
  context: { now: number; timeZone: string; missed: boolean },
): DisciplineOutcome {
  const { now, timeZone, missed } = context;
  const deadline = deadlineOf(task, timeZone);
  switch (task.category) {
    case "cancelled":
      return "cancelled";
    case "completed": {
      const at = task.completedAt?.getTime() ?? now;
      if (missed) return "late";
      if (deadline === null || !isPlanned(task, at, timeZone)) return "none";
      if (at > deadline) return "late";
      return localDate(at, timeZone) < task.dueDate! ? "early" : "on_time";
    }
    case "failed": {
      const at = task.failedAt?.getTime() ?? now;
      return missed || isPlanned(task, at, timeZone) ? "failed" : "none";
    }
    default: {
      if (missed) return "overdue";
      if (deadline === null || now < deadline) return "none";
      return isPlanned(task, deadline, timeZone) ? "overdue" : "none";
    }
  }
}

/** Outcomes that mean the deadline was missed (sticky for later outcomes). */
export const isMissedOutcome = (outcome: DisciplineOutcome) =>
  outcome === "overdue" || outcome === "late";

export const disciplineReasons = [
  "completed_early",
  "completed_on_time",
  "completed_late",
  "overdue",
  "failed",
  "cancelled",
  "reopened",
  "not_eligible",
] as const;
export type DisciplineReason = (typeof disciplineReasons)[number];

/** Why the net changed, from the new outcome. */
export function reasonFor(
  outcome: DisciplineOutcome,
  category: DisciplineCategory,
): DisciplineReason {
  switch (outcome) {
    case "early":
      return "completed_early";
    case "on_time":
      return "completed_on_time";
    case "late":
      return "completed_late";
    case "overdue":
      return "overdue";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "none":
      return category === "completed" || category === "failed" ? "not_eligible" : "reopened";
  }
}

/**
 * The single entry needed to move a task's net to its target, or null when nothing changes.
 * Never trusts a client value: the points always come from DISCIPLINE_POINTS.
 */
export function adjustmentFor(
  current: { net: number; outcome: DisciplineOutcome | null },
  target: DisciplineOutcome,
): { points: number } | null {
  const points = DISCIPLINE_POINTS[target] - current.net;
  if (points === 0) return null;
  return { points };
}

/* ---------------------------------------------------------------- read models */

export interface DisciplineEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  reason: DisciplineReason;
  outcome: DisciplineOutcome;
  points: number;
  netAfter: number;
  createdAt: Date;
}

export interface DisciplineSummary {
  attributeId: string;
  score: number;
  onRadar: boolean;
  scoredTasks: number;
  entries: DisciplineEntry[];
}

export interface TaskDiscipline {
  net: number;
  outcome: DisciplineOutcome | null;
  entries: DisciplineEntry[];
}

export const disciplineHistoryInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});
export const taskDisciplineInput = z.object({ taskId: z.uuid() });
