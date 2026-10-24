import { z } from "zod";

import type { RichTextDoc } from "./rich-text";
import { richTextDoc } from "./rich-text";
import type { StatusCategory } from "./statuses";

/**
 * The single Task entity. Every view (list, Eisenhower matrix, project list, Kanban, Gantt,
 * dashboard, calendar) reads this same record; later milestones add columns (project,
 * milestone, recurrence) additively.
 */
export interface Task {
  id: string;
  title: string;
  description: RichTextDoc | null;
  areaId: string | null;
  parentTaskId: string | null;
  statusId: string;
  statusCategory: StatusCategory;
  priority: number;
  /** null = not yet sorted into the Eisenhower matrix. */
  isUrgent: boolean | null;
  isImportant: boolean | null;
  startDate: string | null;
  dueDate: string | null;
  /** "HH:MM", only together with dueDate. */
  dueTime: string | null;
  estimatedMinutes: number | null;
  sortKey: string;
  tagIds: string[];
  subtaskCount: number;
  completedSubtaskCount: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskDetail extends Task {
  parent: { id: string; title: string } | null;
  subtasks: Task[];
}

export const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;

const isoDate = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Expected HH:MM" });

/** Fields that can be set on create and changed on update. */
const editableFields = z.object({
  title: z.string().trim().min(1).max(500),
  description: richTextDoc.nullable(),
  areaId: z.uuid().nullable(),
  priority: z.number().int().min(0).max(4),
  isUrgent: z.boolean().nullable(),
  isImportant: z.boolean().nullable(),
  startDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  dueTime: time.nullable(),
  estimatedMinutes: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable(),
  tagIds: z.array(z.uuid()).max(20),
});

export type TaskSchedule = Pick<Task, "startDate" | "dueDate" | "dueTime">;

/** Returns an error code when the date fields are inconsistent, otherwise null. */
export function validateSchedule(schedule: TaskSchedule): string | null {
  if (schedule.dueTime && !schedule.dueDate) return "task.due_time_without_date";
  if (schedule.startDate && schedule.dueDate && schedule.startDate > schedule.dueDate) {
    return "task.start_after_due";
  }
  return null;
}

export const createTaskInput = editableFields.partial().extend({
  title: editableFields.shape.title,
  parentTaskId: z.uuid().nullable().optional(),
  statusId: z.uuid().optional(),
});

export const updateTaskInput = z.object({
  id: z.uuid(),
  patch: editableFields.partial(),
});

export const setTaskStatusInput = z.object({ id: z.uuid(), statusId: z.uuid() });
export const taskIdInput = z.object({ id: z.uuid() });

export type CreateTaskInput = z.infer<typeof createTaskInput>;
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
