import type { Task } from "./tasks";

/*
 * The Eisenhower matrix is a view of the urgent / important flags already stored on every
 * task. A task's quadrant is derived, never stored, so the matrix, the task list and every other
 * view always agree. Moving a card between quadrants simply updates the two flags.
 */

export const quadrants = ["do", "schedule", "delegate", "eliminate"] as const;
export type Quadrant = (typeof quadrants)[number];

/** Where a task sits in the matrix; "unsorted" until both flags are decided. */
export type MatrixPlacement = Quadrant | "unsorted";
export const matrixPlacements = [
  ...quadrants,
  "unsorted",
] as const satisfies readonly MatrixPlacement[];

const flagsByPlacement: Record<MatrixPlacement, Pick<Task, "isUrgent" | "isImportant">> = {
  do: { isUrgent: true, isImportant: true },
  schedule: { isUrgent: false, isImportant: true },
  delegate: { isUrgent: true, isImportant: false },
  eliminate: { isUrgent: false, isImportant: false },
  unsorted: { isUrgent: null, isImportant: null },
};

export function matrixPlacement(task: Pick<Task, "isUrgent" | "isImportant">): MatrixPlacement {
  if (task.isUrgent === null || task.isImportant === null) return "unsorted";
  if (task.isImportant) return task.isUrgent ? "do" : "schedule";
  return task.isUrgent ? "delegate" : "eliminate";
}

/** The flag values that put a task into the given placement. */
export function flagsForPlacement(
  placement: MatrixPlacement,
): Pick<Task, "isUrgent" | "isImportant"> {
  return flagsByPlacement[placement];
}
