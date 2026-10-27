import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { developmentAttributes } from "@/modules/character/db";
import { isLegacyAttribute } from "@/modules/character/domain";
import { projects } from "@/modules/projects/db";
import { tasks, taskStatuses } from "@/modules/tasks/db";
import type { StatusCategory } from "@/modules/tasks/domain";
import { createTask, getTask, type TaskDeps } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import {
  developmentGoalAttributes,
  developmentGoalProjects,
  developmentGoals,
  developmentGoalTasks,
} from "../db";
import {
  goalStatusChange,
  type CreateGoalInput,
  type CreateGoalTaskInput,
  type DevelopmentGoal,
  type GoalAttribute,
  type GoalStatus,
  type UpdateGoalInput,
} from "../domain";

/*
 * Development goals: planning metadata. Every command checks that each referenced goal, attribute,
 * task and project belongs to the signed-in user; links are references with primary keys, so a
 * pair can only be linked once. Nothing here touches XP.
 */

type GoalRow = typeof developmentGoals.$inferSelect;

function toGoal(row: GoalRow, attributes: GoalAttribute[]): DevelopmentGoal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as GoalStatus,
    priority: row.priority,
    targetDate: row.targetDate,
    completedAt: row.completedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attributes,
  };
}

/** The user's goals (optionally only some ids or statuses), with their attributes. */
export async function listGoals(
  db: DbExecutor,
  userId: string,
  filter: { ids?: string[]; statuses?: GoalStatus[] } = {},
): Promise<DevelopmentGoal[]> {
  if (filter.ids?.length === 0) return [];
  const rows = await db
    .select()
    .from(developmentGoals)
    .where(
      and(
        eq(developmentGoals.userId, userId),
        filter.ids ? inArray(developmentGoals.id, filter.ids) : undefined,
        filter.statuses ? inArray(developmentGoals.status, filter.statuses) : undefined,
      ),
    )
    .orderBy(desc(developmentGoals.priority), asc(developmentGoals.createdAt));
  if (rows.length === 0) return [];
  const links = await db
    .select()
    .from(developmentGoalAttributes)
    .where(
      inArray(
        developmentGoalAttributes.goalId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(desc(developmentGoalAttributes.weight), asc(developmentGoalAttributes.createdAt));
  const attributesOf = new Map<string, GoalAttribute[]>();
  for (const link of links) {
    const list = attributesOf.get(link.goalId) ?? [];
    list.push({ attributeId: link.attributeId, weight: link.weight });
    attributesOf.set(link.goalId, list);
  }
  return rows.map((row) => toGoal(row, attributesOf.get(row.id) ?? []));
}

async function getOwnedGoal(db: DbExecutor, userId: string, id: string, lock = false) {
  const select = db
    .select()
    .from(developmentGoals)
    .where(and(eq(developmentGoals.id, id), eq(developmentGoals.userId, userId)));
  const [row] = lock ? await select.for("update") : await select;
  if (!row) throw new DomainError("not_found", "goal.not_found");
  return row;
}

export async function getGoal(db: DbExecutor, userId: string, id: string) {
  await getOwnedGoal(db, userId, id);
  const [goal] = await listGoals(db, userId, { ids: [id] });
  return goal!;
}

/**
 * Attributes a goal may name: the user's own, not legacy, and not archived — unless the goal
 * already names it (an attribute archived later stays on its goals).
 */
async function assertAttributesUsable(
  db: DbExecutor,
  userId: string,
  attributes: readonly GoalAttribute[],
  existing: readonly GoalAttribute[] = [],
) {
  const ids = attributes.map((a) => a.attributeId);
  const rows = await db
    .select({
      id: developmentAttributes.id,
      systemKey: developmentAttributes.systemKey,
      archivedAt: developmentAttributes.archivedAt,
    })
    .from(developmentAttributes)
    .where(and(eq(developmentAttributes.userId, userId), inArray(developmentAttributes.id, ids)));
  if (rows.length !== new Set(ids).size) throw new DomainError("not_found", "attribute.not_found");
  const kept = new Set(existing.map((a) => a.attributeId));
  if (rows.some((row) => (row.archivedAt || isLegacyAttribute(row)) && !kept.has(row.id))) {
    throw new DomainError("invalid", "attribute.archived");
  }
}

async function replaceGoalAttributes(
  db: DbExecutor,
  goalId: string,
  attributes: readonly GoalAttribute[],
) {
  await db.delete(developmentGoalAttributes).where(eq(developmentGoalAttributes.goalId, goalId));
  await db
    .insert(developmentGoalAttributes)
    .values(attributes.map((a) => ({ goalId, attributeId: a.attributeId, weight: a.weight })));
}

export function createGoal(
  db: DbExecutor,
  userId: string,
  input: CreateGoalInput,
): Promise<DevelopmentGoal> {
  return db.transaction(async (tx) => {
    await assertAttributesUsable(tx, userId, input.attributes);
    const [row] = await tx
      .insert(developmentGoals)
      .values({
        userId,
        title: input.title,
        description: input.description || null,
        priority: input.priority ?? 2,
        targetDate: input.targetDate ?? null,
      })
      .returning();
    await replaceGoalAttributes(tx, row!.id, input.attributes);
    return getGoal(tx, userId, row!.id);
  });
}

export function updateGoal(
  db: DbExecutor,
  userId: string,
  { id, patch }: UpdateGoalInput,
): Promise<DevelopmentGoal> {
  return db.transaction(async (tx) => {
    await getOwnedGoal(tx, userId, id, true);
    const { attributes, ...fields } = patch;
    if (attributes) {
      const current = await getGoal(tx, userId, id);
      await assertAttributesUsable(tx, userId, attributes, current.attributes);
      await replaceGoalAttributes(tx, id, attributes);
    }
    const values = {
      ...fields,
      ...(fields.description !== undefined ? { description: fields.description || null } : {}),
    };
    await tx
      .update(developmentGoals)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(developmentGoals.id, id), eq(developmentGoals.userId, userId)));
    return getGoal(tx, userId, id);
  });
}

/** active ⇄ paused, → completed, → archived, and restore (archived → active). */
export function setGoalStatus(
  db: DbExecutor,
  userId: string,
  id: string,
  status: GoalStatus,
): Promise<DevelopmentGoal> {
  return db.transaction(async (tx) => {
    const row = await getOwnedGoal(tx, userId, id, true);
    const change = goalStatusChange(
      { status: row.status as GoalStatus, completedAt: row.completedAt },
      status,
      new Date(),
    );
    await tx
      .update(developmentGoals)
      .set({ ...change, updatedAt: new Date() })
      .where(and(eq(developmentGoals.id, id), eq(developmentGoals.userId, userId)));
    return getGoal(tx, userId, id);
  });
}

/** Permanent. Links go with it; tasks, projects, attributes and XP are untouched. */
export async function deleteGoal(db: DbExecutor, userId: string, id: string): Promise<void> {
  await getOwnedGoal(db, userId, id);
  await db
    .delete(developmentGoals)
    .where(and(eq(developmentGoals.id, id), eq(developmentGoals.userId, userId)));
}

/* ---------------------------------------------------------------- task links */

async function assertTaskOwned(db: DbExecutor, userId: string, taskId: string) {
  // getTask is scoped by user and excludes the Trash.
  await getTask(db, userId, taskId);
}

async function assertGoalOpenForLinks(db: DbExecutor, userId: string, goalId: string) {
  const row = await getOwnedGoal(db, userId, goalId);
  if (row.status === "archived") throw new DomainError("invalid", "goal.archived");
}

export async function linkTask(db: DbExecutor, userId: string, goalId: string, taskId: string) {
  await assertGoalOpenForLinks(db, userId, goalId);
  await assertTaskOwned(db, userId, taskId);
  await db.insert(developmentGoalTasks).values({ goalId, taskId }).onConflictDoNothing();
}

export async function unlinkTask(db: DbExecutor, userId: string, goalId: string, taskId: string) {
  await getOwnedGoal(db, userId, goalId);
  await db
    .delete(developmentGoalTasks)
    .where(and(eq(developmentGoalTasks.goalId, goalId), eq(developmentGoalTasks.taskId, taskId)));
}

/** Ids of the tasks linked to a goal (Trash included: the read side hides those). */
export async function linkedTaskIds(db: DbExecutor, goalId: string): Promise<string[]> {
  const rows = await db
    .select({ taskId: developmentGoalTasks.taskId })
    .from(developmentGoalTasks)
    .where(eq(developmentGoalTasks.goalId, goalId))
    .orderBy(asc(developmentGoalTasks.createdAt));
  return rows.map((row) => row.taskId);
}

/** Non-archived goals a task is linked to. */
export async function goalsForTask(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<DevelopmentGoal[]> {
  await assertTaskOwned(db, userId, taskId);
  const rows = await db
    .select({ goalId: developmentGoalTasks.goalId })
    .from(developmentGoalTasks)
    .innerJoin(developmentGoals, eq(developmentGoals.id, developmentGoalTasks.goalId))
    .where(
      and(
        eq(developmentGoalTasks.taskId, taskId),
        eq(developmentGoals.userId, userId),
        sql`${developmentGoals.status} <> 'archived'`,
      ),
    );
  return listGoals(db, userId, { ids: rows.map((row) => row.goalId) });
}

/**
 * Sets the (non-archived) goals of a task from the task's side. Links to archived goals are kept:
 * they are not shown on the task and come back if the goal is restored.
 */
export function setTaskGoals(
  db: DbExecutor,
  userId: string,
  taskId: string,
  goalIds: string[],
): Promise<DevelopmentGoal[]> {
  return db.transaction(async (tx) => {
    await assertTaskOwned(tx, userId, taskId);
    const open = goalIds.length
      ? await tx
          .select({ id: developmentGoals.id, status: developmentGoals.status })
          .from(developmentGoals)
          .where(and(eq(developmentGoals.userId, userId), inArray(developmentGoals.id, goalIds)))
      : [];
    if (open.length !== goalIds.length) throw new DomainError("not_found", "goal.not_found");
    if (open.some((goal) => goal.status === "archived")) {
      throw new DomainError("invalid", "goal.archived");
    }
    const userOpenGoals = tx
      .select({ id: developmentGoals.id })
      .from(developmentGoals)
      .where(
        and(eq(developmentGoals.userId, userId), sql`${developmentGoals.status} <> 'archived'`),
      );
    await tx
      .delete(developmentGoalTasks)
      .where(
        and(
          eq(developmentGoalTasks.taskId, taskId),
          inArray(developmentGoalTasks.goalId, userOpenGoals),
          goalIds.length ? notInArray(developmentGoalTasks.goalId, goalIds) : undefined,
        ),
      );
    if (goalIds.length) {
      await tx
        .insert(developmentGoalTasks)
        .values(goalIds.map((goalId) => ({ goalId, taskId })))
        .onConflictDoNothing();
    }
    return goalsForTask(tx, userId, taskId);
  });
}

/**
 * Creates an ordinary task (the tasks module's own command, events included) and links it, in one
 * transaction. Optionally the task's development contributions start as the goal's attributes —
 * active ones only; the user can change them on the task like any other.
 */
export function createGoalTask(deps: TaskDeps, userId: string, input: CreateGoalTaskInput) {
  return deps.db.transaction(async (tx) => {
    await assertGoalOpenForLinks(tx, userId, input.goalId);
    let contributions = input.task.contributions;
    if (input.useGoalAttributes && !contributions?.length) {
      const goal = await getGoal(tx, userId, input.goalId);
      const usable = await tx
        .select({
          id: developmentAttributes.id,
          systemKey: developmentAttributes.systemKey,
        })
        .from(developmentAttributes)
        .where(
          and(
            eq(developmentAttributes.userId, userId),
            isNull(developmentAttributes.archivedAt),
            inArray(
              developmentAttributes.id,
              goal.attributes.map((a) => a.attributeId),
            ),
          ),
        );
      const ok = new Set(usable.filter((a) => !isLegacyAttribute(a)).map((a) => a.id));
      contributions = goal.attributes.filter((a) => ok.has(a.attributeId));
    }
    const task = await createTask({ db: tx, bus: deps.bus }, userId, {
      ...input.task,
      contributions,
    });
    await tx
      .insert(developmentGoalTasks)
      .values({ goalId: input.goalId, taskId: task.id })
      .onConflictDoNothing();
    return task;
  });
}

/* ---------------------------------------------------------------- project links */

export async function linkProject(
  db: DbExecutor,
  userId: string,
  goalId: string,
  projectId: string,
) {
  await assertGoalOpenForLinks(db, userId, goalId);
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!project) throw new DomainError("not_found", "project.not_found");
  await db.insert(developmentGoalProjects).values({ goalId, projectId }).onConflictDoNothing();
}

export async function unlinkProject(
  db: DbExecutor,
  userId: string,
  goalId: string,
  projectId: string,
) {
  await getOwnedGoal(db, userId, goalId);
  await db
    .delete(developmentGoalProjects)
    .where(
      and(
        eq(developmentGoalProjects.goalId, goalId),
        eq(developmentGoalProjects.projectId, projectId),
      ),
    );
}

export async function linkedProjectIds(db: DbExecutor, goalId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: developmentGoalProjects.projectId })
    .from(developmentGoalProjects)
    .where(eq(developmentGoalProjects.goalId, goalId))
    .orderBy(asc(developmentGoalProjects.createdAt));
  return rows.map((row) => row.projectId);
}

/** Per goal: linked tasks (with status category, Trash excluded) and linked project count. */
export async function goalLinkCounts(db: DbExecutor, userId: string, goalIds: string[]) {
  const tasksOf = new Map<string, { statusCategory: StatusCategory }[]>();
  const projectsOf = new Map<string, number>();
  if (goalIds.length === 0) return { tasksOf, projectsOf };
  const [taskRows, projectRows] = await Promise.all([
    db
      .select({ goalId: developmentGoalTasks.goalId, statusCategory: taskStatuses.category })
      .from(developmentGoalTasks)
      .innerJoin(tasks, eq(tasks.id, developmentGoalTasks.taskId))
      .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
      .where(
        and(
          inArray(developmentGoalTasks.goalId, goalIds),
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
        ),
      ),
    db
      .select({
        goalId: developmentGoalProjects.goalId,
        count: sql<number>`count(*)::int`,
      })
      .from(developmentGoalProjects)
      .innerJoin(projects, eq(projects.id, developmentGoalProjects.projectId))
      .where(and(inArray(developmentGoalProjects.goalId, goalIds), eq(projects.userId, userId)))
      .groupBy(developmentGoalProjects.goalId),
  ]);
  for (const row of taskRows) {
    const list = tasksOf.get(row.goalId) ?? [];
    list.push({ statusCategory: row.statusCategory as StatusCategory });
    tasksOf.set(row.goalId, list);
  }
  for (const row of projectRows) projectsOf.set(row.goalId, row.count);
  return { tasksOf, projectsOf };
}
