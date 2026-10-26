import "./events";

import { z } from "zod";

import { colorIds, type ColorId } from "@/shared/lib/colors";

/*
 * Projects group tasks towards an outcome. A project does not own copies of tasks: tasks point
 * at it (`tasks.project_id`), and every project view (list, board, later Gantt) is a query over
 * the one tasks table. Progress is always computed, never entered by hand.
 */

export const projectStatuses = ["planned", "active", "paused", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

/** Statuses shown under "进行中" in the project list. */
export const openProjectStatuses = [
  "planned",
  "active",
  "paused",
] as const satisfies readonly ProjectStatus[];

export interface Progress {
  /** Countable tasks: top-level, not deleted, not cancelled. */
  total: number;
  completed: number;
  /** Open tasks whose due date has passed. */
  overdue: number;
}

export const emptyProgress: Progress = { total: 0, completed: 0, overdue: 0 };

/** Completion ratio 0–1, or null when there is nothing to count. */
export function progressRatio(progress: Progress): number | null {
  return progress.total === 0 ? null : progress.completed / progress.total;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  dueDate: string | null;
  completedAt: Date | null;
  progress: Progress;
}

export interface Project {
  id: string;
  name: string;
  description: { type: "doc"; content?: unknown[]; [key: string]: unknown } | null;
  areaId: string | null;
  status: ProjectStatus;
  priority: number;
  color: ColorId;
  startDate: string | null;
  targetDate: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  progress: Progress;
  /** Next open milestone by due date. */
  nextMilestone: Pick<Milestone, "id" | "name" | "dueDate"> | null;
}

export interface ProjectDetail extends Project {
  milestones: Milestone[];
}

const isoDate = z.iso.date();
const richText = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .loose()
  .refine((doc) => JSON.stringify(doc).length <= 100_000, { message: "Description is too long" });

const projectFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: richText.nullable(),
  areaId: z.uuid().nullable(),
  status: z.enum(projectStatuses),
  priority: z.number().int().min(0).max(4),
  color: z.enum(colorIds),
  startDate: isoDate.nullable(),
  targetDate: isoDate.nullable(),
});

export const createProjectInput = projectFields
  .partial()
  .extend({ name: projectFields.shape.name });
export const updateProjectInput = z.object({ id: z.uuid(), patch: projectFields.partial() });
export const projectIdInput = z.object({ id: z.uuid() });
export const listProjectsInput = z
  .object({ statuses: z.array(z.enum(projectStatuses)).max(projectStatuses.length).optional() })
  .default({});

export type CreateProjectInput = z.infer<typeof createProjectInput>;
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;

/** Returns an error code when the dates are inconsistent, otherwise null. */
export function validateProjectDates(dates: {
  startDate: string | null;
  targetDate: string | null;
}) {
  return dates.startDate && dates.targetDate && dates.startDate > dates.targetDate
    ? "project.start_after_target"
    : null;
}

const milestoneName = z.string().trim().min(1).max(120);

export const createMilestoneInput = z.object({
  projectId: z.uuid(),
  name: milestoneName,
  dueDate: isoDate.nullable().optional(),
});
export const updateMilestoneInput = z.object({
  id: z.uuid(),
  patch: z.object({ name: milestoneName, dueDate: isoDate.nullable() }).partial(),
});
export const milestoneIdInput = z.object({ id: z.uuid() });

export type CreateMilestoneInput = z.infer<typeof createMilestoneInput>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInput>;
