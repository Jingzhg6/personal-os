import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { areaBelongsToUser } from "@/modules/areas/server";
import { milestoneProgress, projectProgress } from "@/modules/tasks/server";
import { tasks } from "@/modules/tasks/db";
import type { Database, DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter } from "@/shared/lib/order";

import { milestones, projects } from "../db";
import {
  emptyProgress,
  validateProjectDates,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type Milestone,
  type Project,
  type ProjectDetail,
  type ProjectStatus,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from "../domain";

export interface ProjectDeps {
  db: Database;
  bus: EventBus;
}

type ProjectRow = typeof projects.$inferSelect;
type MilestoneRow = typeof milestones.$inferSelect;

function toProject(
  row: ProjectRow,
  progress = emptyProgress,
  nextMilestone: Project["nextMilestone"] = null,
): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    areaId: row.areaId,
    status: row.status as ProjectStatus,
    priority: row.priority,
    color: row.color as Project["color"],
    startDate: row.startDate,
    targetDate: row.targetDate,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    progress,
    nextMilestone,
  };
}

const milestoneOrder = [sql`${milestones.dueDate} asc nulls last`, asc(milestones.sortKey)];

async function getOwnedRow(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!row) throw new DomainError("not_found", "project.not_found");
  return row;
}

async function assertArea(db: DbExecutor, userId: string, areaId: string | null | undefined) {
  if (areaId && !(await areaBelongsToUser(db, userId, areaId))) {
    throw new DomainError("not_found", "area.not_found");
  }
}

export async function listProjects(
  db: DbExecutor,
  userId: string,
  input: { today: string; statuses?: ProjectStatus[] },
): Promise<Project[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.userId, userId),
        input.statuses?.length ? inArray(projects.status, input.statuses) : undefined,
      ),
    )
    .orderBy(asc(projects.sortKey), asc(projects.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [progress, openMilestones] = await Promise.all([
    projectProgress(db, userId, input.today, ids),
    db
      .select()
      .from(milestones)
      .where(
        and(
          eq(milestones.userId, userId),
          inArray(milestones.projectId, ids),
          isNull(milestones.completedAt),
        ),
      )
      .orderBy(...milestoneOrder),
  ]);
  const next = new Map<string, MilestoneRow>();
  for (const milestone of openMilestones)
    if (!next.has(milestone.projectId)) next.set(milestone.projectId, milestone);

  return rows.map((row) => {
    const milestone = next.get(row.id);
    return toProject(
      row,
      progress.get(row.id),
      milestone ? { id: milestone.id, name: milestone.name, dueDate: milestone.dueDate } : null,
    );
  });
}

export async function getProjectDetail(
  db: DbExecutor,
  userId: string,
  input: { id: string; today: string },
): Promise<ProjectDetail> {
  const [project] = (await listProjects(db, userId, { today: input.today })).filter(
    (p) => p.id === input.id,
  );
  if (!project) throw new DomainError("not_found", "project.not_found");
  const [rows, progress] = await Promise.all([
    db
      .select()
      .from(milestones)
      .where(and(eq(milestones.projectId, input.id), eq(milestones.userId, userId)))
      .orderBy(...milestoneOrder),
    milestoneProgress(db, userId, input.today, input.id),
  ]);
  const toMilestone = (row: MilestoneRow): Milestone => ({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    progress: progress.get(row.id) ?? emptyProgress,
  });
  return { ...project, milestones: rows.map(toMilestone) };
}

async function publishStatusChange(
  bus: EventBus,
  db: DbExecutor,
  userId: string,
  before: ProjectStatus | null,
  row: ProjectRow,
) {
  if (row.status === "completed" && before !== "completed") {
    await bus.publish(
      {
        type: "project.completed",
        userId,
        payload: {
          projectId: row.id,
          priority: row.priority,
          areaId: row.areaId,
          completedAt: row.completedAt!,
        },
      },
      { db },
    );
  } else if (before === "completed" && row.status !== "completed") {
    await bus.publish({ type: "project.reopened", userId, payload: { projectId: row.id } }, { db });
  }
}

export function createProject(
  { db, bus }: ProjectDeps,
  userId: string,
  input: CreateProjectInput,
): Promise<Project> {
  return db.transaction(async (tx) => {
    await assertArea(tx, userId, input.areaId);
    const dates = { startDate: input.startDate ?? null, targetDate: input.targetDate ?? null };
    const dateError = validateProjectDates(dates);
    if (dateError) throw new DomainError("invalid", dateError);

    const [last] = await tx
      .select({ sortKey: projects.sortKey })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.sortKey))
      .limit(1);
    const status = input.status ?? "active";
    const [row] = await tx
      .insert(projects)
      .values({
        userId,
        name: input.name,
        description: input.description ?? null,
        areaId: input.areaId ?? null,
        status,
        priority: input.priority ?? 0,
        color: input.color ?? "indigo",
        ...dates,
        completedAt: status === "completed" ? new Date() : null,
        sortKey: keyAfter(last?.sortKey ?? null),
      })
      .returning();
    await bus.publish(
      { type: "project.created", userId, payload: { projectId: row!.id } },
      { db: tx },
    );
    await publishStatusChange(bus, tx, userId, null, row!);
    return toProject(row!);
  });
}

export function updateProject(
  { db, bus }: ProjectDeps,
  userId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  return db.transaction(async (tx) => {
    const current = await getOwnedRow(tx, userId, input.id);
    const patch = input.patch;
    await assertArea(tx, userId, patch.areaId);
    const dateError = validateProjectDates({
      startDate: patch.startDate !== undefined ? patch.startDate : current.startDate,
      targetDate: patch.targetDate !== undefined ? patch.targetDate : current.targetDate,
    });
    if (dateError) throw new DomainError("invalid", dateError);

    const completedAt =
      patch.status === undefined || patch.status === current.status
        ? current.completedAt
        : patch.status === "completed"
          ? new Date()
          : null;
    const [row] = await tx
      .update(projects)
      .set({ ...patch, completedAt })
      .where(and(eq(projects.id, current.id), eq(projects.userId, userId)))
      .returning();
    await publishStatusChange(bus, tx, userId, current.status as ProjectStatus, row!);
    return toProject(row!);
  });
}

/** Deletes the project and its milestones. Its tasks are kept and simply leave the project. */
export function deleteProject({ db }: ProjectDeps, userId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    await getOwnedRow(tx, userId, id);
    // Clear both references in one statement (the FK actions would otherwise run one at a time).
    await tx
      .update(tasks)
      .set({ projectId: null, milestoneId: null })
      .where(and(eq(tasks.projectId, id), eq(tasks.userId, userId)));
    await tx.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  });
}

/* ------------------------------------------------------------------ milestones */

async function getOwnedMilestone(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.id, id), eq(milestones.userId, userId)));
  if (!row) throw new DomainError("not_found", "milestone.not_found");
  return row;
}

export async function createMilestone(db: DbExecutor, userId: string, input: CreateMilestoneInput) {
  await getOwnedRow(db, userId, input.projectId);
  const [last] = await db
    .select({ sortKey: milestones.sortKey })
    .from(milestones)
    .where(eq(milestones.projectId, input.projectId))
    .orderBy(desc(milestones.sortKey))
    .limit(1);
  const [row] = await db
    .insert(milestones)
    .values({
      userId,
      projectId: input.projectId,
      name: input.name,
      dueDate: input.dueDate ?? null,
      sortKey: keyAfter(last?.sortKey ?? null),
    })
    .returning();
  return row!;
}

export async function updateMilestone(db: DbExecutor, userId: string, input: UpdateMilestoneInput) {
  await getOwnedMilestone(db, userId, input.id);
  const [row] = await db
    .update(milestones)
    .set(input.patch)
    .where(and(eq(milestones.id, input.id), eq(milestones.userId, userId)))
    .returning();
  return row!;
}

export function setMilestoneCompleted(
  { db, bus }: ProjectDeps,
  userId: string,
  input: { id: string; completed: boolean },
) {
  return db.transaction(async (tx) => {
    const current = await getOwnedMilestone(tx, userId, input.id);
    if (Boolean(current.completedAt) === input.completed) return current;
    const [row] = await tx
      .update(milestones)
      .set({ completedAt: input.completed ? new Date() : null })
      .where(eq(milestones.id, current.id))
      .returning();
    if (input.completed) {
      await bus.publish(
        {
          type: "milestone.completed",
          userId,
          payload: {
            milestoneId: row!.id,
            projectId: row!.projectId,
            completedAt: row!.completedAt!,
          },
        },
        { db: tx },
      );
    }
    return row!;
  });
}

/** Deletes a milestone; its tasks stay in the project (FK sets milestone_id to null). */
export async function deleteMilestone(db: DbExecutor, userId: string, id: string): Promise<void> {
  await getOwnedMilestone(db, userId, id);
  await db.delete(milestones).where(and(eq(milestones.id, id), eq(milestones.userId, userId)));
}
