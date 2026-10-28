import { z } from "zod";

import type { DependencyRef } from "./dependencies";
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
  /** Project of a top-level task (subtasks belong to their parent's project). */
  projectId: string | null;
  milestoneId: string | null;
  parentTaskId: string | null;
  /** Title of the parent task, for subtasks shown outside their parent (search, deadlines). */
  parentTitle: string | null;
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
  /**
   * Development attributes this task helps grow, with relative weights (1–3). Independent of
   * `areaId`; empty for most tasks.
   */
  contributions: TaskContribution[];
  subtaskCount: number;
  completedSubtaskCount: number;
  /** Open (not completed / cancelled) tasks this one is waiting for. */
  openBlockerCount: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** When the task was marked failed (M10.5). */
  failedAt: Date | null;
  /**
   * When the current deadline (due date) was first set (M10.5): 自制力 only scores tasks whose
   * deadline was planned in advance. Null without a due date.
   */
  plannedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskContribution {
  attributeId: string;
  weight: number;
}

export interface TaskDetail extends Task {
  parent: { id: string; title: string } | null;
  subtasks: Task[];
  /** Tasks that must finish first. */
  blockedBy: DependencyRef[];
  /** Tasks waiting for this one. */
  blocking: DependencyRef[];
}

export const MAX_ESTIMATE_MINUTES = 7 * 24 * 60;

const isoDate = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Expected HH:MM" });

/** Fields that can be set on create and changed on update. */
const editableFields = z.object({
  title: z.string().trim().min(1).max(500),
  description: richTextDoc.nullable(),
  areaId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  milestoneId: z.uuid().nullable(),
  priority: z.number().int().min(0).max(4),
  isUrgent: z.boolean().nullable(),
  isImportant: z.boolean().nullable(),
  startDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  dueTime: time.nullable(),
  estimatedMinutes: z.number().int().min(1).max(MAX_ESTIMATE_MINUTES).nullable(),
  tagIds: z.array(z.uuid()).max(20),
  contributions: z
    .array(z.object({ attributeId: z.uuid(), weight: z.number().int().min(1).max(3) }))
    .max(8)
    .refine((list) => new Set(list.map((c) => c.attributeId)).size === list.length, {
      message: "Duplicate attribute",
    }),
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

/** Places the task between two siblings (either may be null at the list edges). */
export const moveTaskInput = z.object({
  id: z.uuid(),
  afterId: z.uuid().nullable(),
  beforeId: z.uuid().nullable(),
});

/** Moves a task under another task, or to the top level (null). */
export const setTaskParentInput = z.object({ id: z.uuid(), parentTaskId: z.uuid().nullable() });

/** A deleted task as shown in the Trash: the root of one deletion. */
export interface TrashedTask {
  id: string;
  title: string;
  parentTitle: string | null;
  deletedAt: Date;
  /** Subtasks deleted together with it. */
  subtaskCount: number;
}

export const setTaskStatusInput = z.object({ id: z.uuid(), statusId: z.uuid() });
export const taskIdInput = z.object({ id: z.uuid() });

export type CreateTaskInput = z.infer<typeof createTaskInput>;
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
