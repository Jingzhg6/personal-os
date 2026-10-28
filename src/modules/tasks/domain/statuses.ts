import { z } from "zod";

import { colorIds, type ColorId } from "@/shared/lib/colors";

/**
 * Fixed status categories. Users can add, rename, recolour and reorder statuses, but every
 * status belongs to exactly one category, and all behaviour (completion, XP, progress)
 * depends on the category, never on a status name.
 */
export const statusCategories = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
  /** M10.5: the task was given up — a distinct outcome from cancellation (自制力 −5). */
  "failed",
] as const;
export type StatusCategory = (typeof statusCategories)[number];

export const defaultStatuses = [
  { systemKey: "backlog", category: "backlog", color: "gray" },
  { systemKey: "todo", category: "unstarted", color: "blue" },
  { systemKey: "in_progress", category: "started", color: "amber" },
  { systemKey: "done", category: "completed", color: "green" },
  { systemKey: "cancelled", category: "cancelled", color: "gray" },
  { systemKey: "failed", category: "failed", color: "red" },
] as const satisfies readonly { systemKey: string; category: StatusCategory; color: ColorId }[];

export type StatusSystemKey = (typeof defaultStatuses)[number]["systemKey"];

export interface TaskStatus {
  id: string;
  systemKey: StatusSystemKey | null;
  name: string | null;
  category: StatusCategory;
  color: ColorId;
  sortKey: string;
}

export function isClosedCategory(category: StatusCategory): boolean {
  return category === "completed" || category === "cancelled" || category === "failed";
}

/** Statuses ordered by category (workflow order), then by their position inside the category. */
export function sortStatuses<T extends Pick<TaskStatus, "category" | "sortKey">>(
  statuses: T[],
): T[] {
  return [...statuses].sort(
    (a, b) =>
      statusCategories.indexOf(a.category) - statusCategories.indexOf(b.category) ||
      (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0),
  );
}

/** The status used when a task is completed / reopened: the first status of that category. */
export function defaultStatusFor<T extends Pick<TaskStatus, "category" | "sortKey">>(
  statuses: T[],
  category: StatusCategory,
): T | undefined {
  return sortStatuses(statuses).find((status) => status.category === category);
}

export interface StatusTransition {
  completedAt: Date | null;
  cancelledAt: Date | null;
  failedAt: Date | null;
  /** Domain event implied by the transition. */
  event: "task.completed" | "task.reopened" | null;
}

/**
 * Derives timestamps and events when a task moves between categories.
 * `task.reopened` means "was completed, no longer is" (so XP can be reversed later).
 */
export function statusTransition(
  previous: {
    category: StatusCategory;
    completedAt: Date | null;
    cancelledAt: Date | null;
    failedAt?: Date | null;
  },
  next: StatusCategory,
  now: Date,
): StatusTransition {
  const wasCompleted = previous.category === "completed";
  if (next === "completed") {
    return {
      completedAt: wasCompleted ? (previous.completedAt ?? now) : now,
      cancelledAt: null,
      failedAt: null,
      event: wasCompleted ? null : "task.completed",
    };
  }
  return {
    completedAt: null,
    cancelledAt:
      next === "cancelled"
        ? previous.category === "cancelled"
          ? (previous.cancelledAt ?? now)
          : now
        : null,
    failedAt:
      next === "failed"
        ? previous.category === "failed"
          ? (previous.failedAt ?? now)
          : now
        : null,
    event: wasCompleted ? "task.reopened" : null,
  };
}

const statusName = z.string().trim().min(1).max(40);

export const createStatusInput = z.object({
  name: statusName,
  category: z.enum(statusCategories),
  color: z.enum(colorIds),
});

export const updateStatusInput = z.object({
  id: z.uuid(),
  name: statusName.nullable().optional(),
  color: z.enum(colorIds).optional(),
});

export const moveStatusInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });

export const deleteStatusInput = z.object({
  id: z.uuid(),
  /** Required when tasks use the status: they are moved here first. */
  replacementStatusId: z.uuid().optional(),
});

export type CreateStatusInput = z.infer<typeof createStatusInput>;
export type UpdateStatusInput = z.infer<typeof updateStatusInput>;
export type DeleteStatusInput = z.infer<typeof deleteStatusInput>;
