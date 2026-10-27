import { z } from "zod";

import type { IsoDate } from "./dates";
import type { StatusCategory } from "./statuses";

/**
 * Finish-to-start dependency: the blocked task should not start before the blocking task is done.
 * Stored once (`task_dependencies`); "blocked by" and "blocking" are the two directions of it.
 */
export interface TaskDependency {
  blockingTaskId: string;
  blockedTaskId: string;
}

export const dependencyInput = z.object({ blockingTaskId: z.uuid(), blockedTaskId: z.uuid() });
export type DependencyInput = z.infer<typeof dependencyInput>;

/** The other end of a dependency, as listed in the task detail panel. */
export interface DependencyRef {
  id: string;
  title: string;
  statusCategory: StatusCategory;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
}

/**
 * True when adding `blocking → blocked` would close a cycle, i.e. `blocked` already (directly or
 * transitively) blocks `blocking`. The server runs the same check in SQL.
 */
export function wouldCreateCycle(
  edges: readonly TaskDependency[],
  { blockingTaskId, blockedTaskId }: TaskDependency,
): boolean {
  if (blockingTaskId === blockedTaskId) return true;
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    next.set(edge.blockingTaskId, [...(next.get(edge.blockingTaskId) ?? []), edge.blockedTaskId]);
  }
  const seen = new Set<string>();
  const stack = [blockedTaskId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === blockingTaskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

type Dated = { startDate: IsoDate | null; dueDate: IsoDate | null };

/** First and last day a task occupies on a timeline; one date alone is a one-day span. */
export function scheduleSpan(task: Dated): { start: IsoDate; end: IsoDate } | null {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  return start && end ? { start, end } : null;
}

/**
 * A blocked task scheduled to start before its blocker is due. Finishing and starting on the same
 * day is allowed (dates have no time of day here).
 */
export function hasScheduleConflict(blocking: Dated, blocked: Dated): boolean {
  const blocker = scheduleSpan(blocking);
  const dependent = scheduleSpan(blocked);
  return Boolean(blocker && dependent && dependent.start < blocker.end);
}
