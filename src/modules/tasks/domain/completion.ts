import { z } from "zod";

import { zonedInstant } from "@/shared/lib/zoned-time";

import type { IsoDate } from "./dates";

/*
 * Completing a task with a confirmed completion date (the 完成日期 dialog). Today means "now";
 * an earlier day — a completion recorded afterwards — is stored at noon local time on that day,
 * so it falls on the chosen date in the user's zone. Future dates are refused.
 */

export const completeTaskInput = z.object({
  id: z.uuid(),
  /** Local calendar date of the completion; today when omitted. */
  completedOn: z.iso.date().optional(),
  /** A specific "completed" status (quick edit); the first one when omitted. */
  statusId: z.uuid().optional(),
  /** Also complete the task's open subtasks, on the same date. */
  includeSubtasks: z.boolean().optional(),
});

export type CompleteTaskInput = z.infer<typeof completeTaskInput>;

/** The instant stored as `completed_at`, or null when the date is in the future. */
export function completionInstant(
  completedOn: IsoDate | undefined,
  today: IsoDate,
  now: Date,
  timeZone: string,
): Date | null {
  if (!completedOn || completedOn === today) return now;
  if (completedOn > today) return null;
  return new Date(zonedInstant(completedOn, "12:00", timeZone).instant);
}
