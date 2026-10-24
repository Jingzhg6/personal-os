/**
 * Priority is independent of the Eisenhower flags (urgent / important).
 * Stored as 0–4; the identifiers below are used for i18n labels.
 */
export const priorities = ["none", "low", "medium", "high", "highest"] as const;
export type PriorityId = (typeof priorities)[number];
export type Priority = 0 | 1 | 2 | 3 | 4;

export function priorityId(priority: number): PriorityId {
  return priorities[priority] ?? "none";
}
