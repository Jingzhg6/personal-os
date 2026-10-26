import { z } from "zod";

import type { AreaSystemKey } from "@/modules/areas/domain";

import { addDays, type IsoDate } from "./dates";

/*
 * Task views behind navigation items (工作, 业务, 行政任务, 个人生活). Each view shows the
 * tasks of the areas the user assigns to it. Navigation stays independent of area rows: a view
 * is a stored scope, defaulting to the matching seeded area.
 */

export const scopedViewKeys = ["work", "business", "admin", "personal"] as const;
export type ScopedViewKey = (typeof scopedViewKeys)[number];

export const defaultViewAreas: Record<ScopedViewKey, AreaSystemKey[]> = {
  work: ["work"],
  business: ["business"],
  admin: ["admin"],
  personal: ["personal"],
};

export interface TaskViewScope {
  key: ScopedViewKey;
  areaIds: string[];
  /** False while the view still uses its default areas. */
  customized: boolean;
}

export const taskViewKeyInput = z.object({ key: z.enum(scopedViewKeys) });
export const updateTaskViewInput = z.object({
  key: z.enum(scopedViewKeys),
  areaIds: z.array(z.uuid()).max(100),
});

/* -------------------------------------------------------------- deadlines */

export const deadlineGroups = ["overdue", "today", "tomorrow", "week", "later"] as const;
export type DeadlineGroup = (typeof deadlineGroups)[number];

/** Buckets a due date relative to today: overdue, today, tomorrow, next 7 days, later. */
export function deadlineGroup(dueDate: IsoDate, today: IsoDate): DeadlineGroup {
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate === addDays(today, 1)) return "tomorrow";
  if (dueDate <= addDays(today, 6)) return "week";
  return "later";
}
