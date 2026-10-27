import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { areaBelongsToUser } from "@/modules/areas/server";
import { milestones, projects } from "@/modules/projects/db";
import type { Database, DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyBetween } from "@/shared/lib/order";

import { tasks, taskTags } from "../db";
import {
  defaultStatusFor,
  isClosedCategory,
  richTextToPlainText,
  statusTransition,
  validateSchedule,
  type CreateTaskInput,
  type StatusCategory,
  type Task,
  type UpdateTaskInput,
} from "../domain";
import { getTask } from "./repository";
import { getOwnedStatus, listStatuses } from "./statuses";
import { assertContributionsUsable, replaceContributions } from "./contributions";
import { assertTagsOwned } from "./tags";

/*
 * Write side of the task module. Each command runs in one transaction; domain events are
 * published inside it, so subscribers (e.g. XP in M6) commit or roll back with the change.
 */

export interface TaskDeps {
  db: Database;
  bus: EventBus;
}

async function assertAreaOwned(db: DbExecutor, userId: string, areaId: string | null | undefined) {
  if (areaId && !(await areaBelongsToUser(db, userId, areaId))) {
    throw new DomainError("not_found", "area.not_found");
  }
}

/**
 * Validates project / milestone references for a task and returns the values to store.
 * Subtasks have no project of their own; a milestone must belong to the task's project.
 */
async function resolveProjectRefs(
  db: DbExecutor,
  userId: string,
  input: { projectId: string | null; milestoneId: string | null; isSubtask: boolean },
): Promise<{ projectId: string | null; milestoneId: string | null }> {
  if (input.isSubtask) {
    if (input.projectId || input.milestoneId)
      throw new DomainError("invalid", "task.subtask_project");
    return { projectId: null, milestoneId: null };
  }
  let { projectId } = input;
  if (input.milestoneId) {
    const [milestone] = await db
      .select({ projectId: milestones.projectId })
      .from(milestones)
      .where(and(eq(milestones.id, input.milestoneId), eq(milestones.userId, userId)));
    if (!milestone) throw new DomainError("not_found", "milestone.not_found");
    if (projectId && projectId !== milestone.projectId) {
      throw new DomainError("invalid", "milestone.project_mismatch");
    }
    projectId = milestone.projectId;
  }
  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) throw new DomainError("not_found", "project.not_found");
  }
  return { projectId, milestoneId: input.milestoneId };
}

/** Project of the top-level ancestor of a task. */
async function rootProjectId(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<string | null> {
  const result = await db.execute<{ project_id: string | null }>(sql`
    with recursive up as (
      select id, parent_task_id, project_id from tasks where id = ${taskId} and user_id = ${userId}
      union all
      select t.id, t.parent_task_id, t.project_id from tasks t join up on t.id = up.parent_task_id
    )
    select project_id from up where parent_task_id is null limit 1
  `);
  return result.rows[0]?.project_id ?? null;
}

/**
 * Locks the task row for the rest of the transaction. Commands that publish events read the
 * current state after this, so concurrent requests (double clicks, a drag and a click) are
 * serialised and a logical change publishes its event once.
 */
async function lockTask(db: DbExecutor, userId: string, id: string) {
  await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
    .for("update");
}

function assertSchedule(schedule: Pick<Task, "startDate" | "dueDate" | "dueTime">) {
  const error = validateSchedule(schedule);
  if (error) throw new DomainError("invalid", error);
}

/** Sort key placing a task last among the children of `parentTaskId` (or the top level). */
async function lastSiblingKey(db: DbExecutor, userId: string, parentTaskId: string | null) {
  const [last] = await db
    .select({ sortKey: tasks.sortKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        parentTaskId ? eq(tasks.parentTaskId, parentTaskId) : isNull(tasks.parentTaskId),
      ),
    )
    .orderBy(desc(tasks.sortKey))
    .limit(1);
  return keyAfter(last?.sortKey ?? null);
}

/** Ids of the task and all its descendants (any deletion state). */
async function subtreeIds(db: DbExecutor, userId: string, id: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive tree as (
      select id from tasks where id = ${id} and user_id = ${userId}
      union all
      select t.id from tasks t join tree on t.parent_task_id = tree.id
    )
    select id from tree
  `);
  return result.rows.map((row) => row.id);
}

async function replaceTags(db: DbExecutor, taskId: string, tagIds: string[]) {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await db.insert(taskTags).values(unique.map((tagId) => ({ taskId, tagId })));
  }
}

async function publishCompletion(
  bus: EventBus,
  db: DbExecutor,
  userId: string,
  event: "task.completed" | "task.reopened" | null,
  task: Task,
) {
  if (event === "task.completed") {
    await bus.publish(
      {
        type: "task.completed",
        userId,
        payload: {
          taskId: task.id,
          title: task.title,
          parentTaskId: task.parentTaskId,
          contributions: task.contributions,
          areaId: task.areaId,
          priority: task.priority,
          isUrgent: task.isUrgent,
          isImportant: task.isImportant,
          estimatedMinutes: task.estimatedMinutes,
          completedAt: task.completedAt!,
        },
      },
      { db },
    );
  } else if (event === "task.reopened") {
    await bus.publish({ type: "task.reopened", userId, payload: { taskId: task.id } }, { db });
  }
}

export function createTask(
  { db, bus }: TaskDeps,
  userId: string,
  input: CreateTaskInput,
): Promise<Task> {
  return db.transaction(async (tx) => {
    const parentTaskId = input.parentTaskId ?? null;
    if (parentTaskId) await getTask(tx, userId, parentTaskId);
    await assertAreaOwned(tx, userId, input.areaId);
    await assertTagsOwned(tx, userId, input.tagIds ?? []);
    await assertContributionsUsable(tx, userId, input.contributions ?? []);
    const refs = await resolveProjectRefs(tx, userId, {
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      isSubtask: parentTaskId !== null,
    });

    const status = input.statusId
      ? await getOwnedStatus(tx, userId, input.statusId)
      : defaultStatusFor(await listStatuses(tx, userId), "unstarted");
    if (!status) throw new DomainError("conflict", "status.missing_defaults");

    const schedule = {
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
    };
    assertSchedule(schedule);

    const now = new Date();
    const transition = statusTransition(
      { category: "unstarted", completedAt: null, cancelledAt: null },
      status.category,
      now,
    );

    const [row] = await tx
      .insert(tasks)
      .values({
        userId,
        title: input.title,
        description: input.description ?? null,
        descriptionText: richTextToPlainText(input.description),
        areaId: input.areaId ?? null,
        ...refs,
        parentTaskId,
        statusId: status.id,
        priority: input.priority ?? 0,
        isUrgent: input.isUrgent ?? null,
        isImportant: input.isImportant ?? null,
        ...schedule,
        estimatedMinutes: input.estimatedMinutes ?? null,
        sortKey: await lastSiblingKey(tx, userId, parentTaskId),
        completedAt: transition.completedAt,
        cancelledAt: transition.cancelledAt,
      })
      .returning({ id: tasks.id });
    await replaceTags(tx, row!.id, input.tagIds ?? []);
    await replaceContributions(tx, row!.id, input.contributions ?? []);

    const task = await getTask(tx, userId, row!.id);
    await bus.publish(
      { type: "task.created", userId, payload: { taskId: task.id, parentTaskId } },
      { db: tx },
    );
    await publishCompletion(bus, tx, userId, transition.event, task);
    return task;
  });
}

export function updateTask(
  { db }: TaskDeps,
  userId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  return db.transaction(async (tx) => {
    const current = await getTask(tx, userId, input.id);
    const { tagIds, contributions, ...rest } = input.patch;
    const fields: typeof rest = { ...rest };
    if (rest.projectId !== undefined || rest.milestoneId !== undefined) {
      const projectId = rest.projectId !== undefined ? rest.projectId : current.projectId;
      const projectChanged = projectId !== current.projectId;
      // Changing the project drops a milestone that belonged to the old one.
      const milestoneId =
        rest.milestoneId !== undefined
          ? rest.milestoneId
          : projectChanged
            ? null
            : current.milestoneId;
      Object.assign(
        fields,
        await resolveProjectRefs(tx, userId, {
          projectId: rest.milestoneId && rest.projectId === undefined ? null : projectId,
          milestoneId,
          isSubtask: current.parentTaskId !== null,
        }),
      );
    }

    await assertAreaOwned(tx, userId, fields.areaId);
    if (tagIds) await assertTagsOwned(tx, userId, tagIds);
    if (contributions) {
      await assertContributionsUsable(tx, userId, contributions, current.contributions);
    }
    assertSchedule({
      startDate: fields.startDate !== undefined ? fields.startDate : current.startDate,
      dueDate: fields.dueDate !== undefined ? fields.dueDate : current.dueDate,
      dueTime: fields.dueTime !== undefined ? fields.dueTime : current.dueTime,
    });

    if (Object.keys(fields).length > 0) {
      await tx
        .update(tasks)
        .set(
          fields.description !== undefined
            ? { ...fields, descriptionText: richTextToPlainText(fields.description) }
            : fields,
        )
        .where(and(eq(tasks.id, current.id), eq(tasks.userId, userId)));
    } else {
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, current.id));
    }
    if (tagIds) await replaceTags(tx, current.id, tagIds);
    if (contributions) await replaceContributions(tx, current.id, contributions);
    return getTask(tx, userId, current.id);
  });
}

export function setTaskStatus(
  { db, bus }: TaskDeps,
  userId: string,
  input: { id: string; statusId: string },
): Promise<Task> {
  return db.transaction(async (tx) => {
    await lockTask(tx, userId, input.id);
    const current = await getTask(tx, userId, input.id);
    const next = await getOwnedStatus(tx, userId, input.statusId);
    if (next.id === current.statusId) return current;

    const transition = statusTransition(
      {
        category: current.statusCategory,
        completedAt: current.completedAt,
        cancelledAt: current.cancelledAt,
      },
      next.category,
      new Date(),
    );
    await tx
      .update(tasks)
      .set({
        statusId: next.id,
        completedAt: transition.completedAt,
        cancelledAt: transition.cancelledAt,
      })
      .where(and(eq(tasks.id, current.id), eq(tasks.userId, userId)));

    const task = await getTask(tx, userId, current.id);
    await publishCompletion(bus, tx, userId, transition.event, task);
    return task;
  });
}

async function moveToCategory(
  deps: TaskDeps,
  userId: string,
  id: string,
  category: StatusCategory,
  shouldMove: (current: Task) => boolean,
): Promise<Task> {
  const current = await getTask(deps.db, userId, id);
  if (!shouldMove(current)) return current;
  const target = defaultStatusFor(await listStatuses(deps.db, userId), category);
  if (!target) throw new DomainError("conflict", "status.missing_defaults");
  return setTaskStatus(deps, userId, { id, statusId: target.id });
}

/** Moves the task to the first "completed" status. No-op when already completed. */
export function completeTask(deps: TaskDeps, userId: string, id: string): Promise<Task> {
  return moveToCategory(deps, userId, id, "completed", (t) => t.statusCategory !== "completed");
}

/** Moves a completed or cancelled task back to the first "unstarted" status. */
export function reopenTask(deps: TaskDeps, userId: string, id: string): Promise<Task> {
  return moveToCategory(deps, userId, id, "unstarted", (t) => isClosedCategory(t.statusCategory));
}

/**
 * Moves a task between two siblings (same parent). Used by drag-and-drop; the neighbours are
 * the items around the drop position in the list the user sees.
 */
export function moveTask(
  { db }: TaskDeps,
  userId: string,
  input: { id: string; afterId: string | null; beforeId: string | null },
): Promise<Task> {
  return db.transaction(async (tx) => {
    const task = await getTask(tx, userId, input.id);
    const neighbour = async (id: string | null) => {
      if (!id) return null;
      if (id === task.id) throw new DomainError("invalid", "task.order_conflict");
      const other = await getTask(tx, userId, id);
      if (other.parentTaskId !== task.parentTaskId)
        throw new DomainError("invalid", "task.order_conflict");
      return other.sortKey;
    };
    const after = await neighbour(input.afterId);
    const before = await neighbour(input.beforeId);
    if (after !== null && before !== null && !(after < before)) {
      throw new DomainError("conflict", "task.order_conflict");
    }
    await tx
      .update(tasks)
      .set({ sortKey: keyBetween(after, before) })
      .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
    return getTask(tx, userId, task.id);
  });
}

/** Makes the task a subtask of another task, or a top-level task (null). Prevents cycles. */
export function setTaskParent(
  { db }: TaskDeps,
  userId: string,
  input: { id: string; parentTaskId: string | null },
): Promise<Task> {
  return db.transaction(async (tx) => {
    const task = await getTask(tx, userId, input.id);
    if (task.parentTaskId === input.parentTaskId) return task;
    if (input.parentTaskId) {
      await getTask(tx, userId, input.parentTaskId);
      if ((await subtreeIds(tx, userId, task.id)).includes(input.parentTaskId)) {
        throw new DomainError("invalid", "task.parent_cycle");
      }
    }
    // Subtasks belong to their parent's project; a task moved to the top level stays in the
    // project it was part of.
    const projectId = input.parentTaskId ? null : await rootProjectId(tx, userId, task.id);
    await tx
      .update(tasks)
      .set({
        parentTaskId: input.parentTaskId,
        projectId,
        milestoneId: input.parentTaskId ? null : task.milestoneId,
        sortKey: await lastSiblingKey(tx, userId, input.parentTaskId),
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
    return getTask(tx, userId, task.id);
  });
}

/** Moves the task and all of its subtasks to the Trash (one shared `deleted_at`). */
export function deleteTask({ db, bus }: TaskDeps, userId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    await lockTask(tx, userId, id);
    await getTask(tx, userId, id);
    const ids = await subtreeIds(tx, userId, id);
    const deleted = await tx
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, ids), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    await bus.publish(
      { type: "task.deleted", userId, payload: { taskId: id, taskIds: deleted.map((r) => r.id) } },
      { db: tx },
    );
  });
}

async function getTrashed(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select({ id: tasks.id, parentTaskId: tasks.parentTaskId, deletedAt: tasks.deletedAt })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
    .for("update");
  if (!row) throw new DomainError("not_found", "task.not_in_trash");
  return row as typeof row & { deletedAt: Date };
}

/**
 * Restores a task and the subtasks deleted together with it. If its parent is still in the
 * Trash, the task comes back as a top-level task.
 */
export function restoreTask({ db, bus }: TaskDeps, userId: string, id: string): Promise<Task> {
  return db.transaction(async (tx) => {
    const trashed = await getTrashed(tx, userId, id);
    const batch = await subtreeIds(tx, userId, id);
    const restored = await tx
      .update(tasks)
      .set({ deletedAt: null })
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.id, batch),
          eq(tasks.deletedAt, trashed.deletedAt),
        ),
      )
      .returning({ id: tasks.id });

    if (trashed.parentTaskId) {
      const [parentRow] = await tx
        .select({ deletedAt: tasks.deletedAt })
        .from(tasks)
        .where(eq(tasks.id, trashed.parentTaskId));
      if (!parentRow || parentRow.deletedAt) {
        // Promoted to the top level: it keeps the project of its (deleted) root, as setTaskParent
        // does for a subtask moved to the top level.
        await tx
          .update(tasks)
          .set({
            parentTaskId: null,
            projectId: await rootProjectId(tx, userId, id),
            sortKey: await lastSiblingKey(tx, userId, null),
          })
          .where(eq(tasks.id, id));
      }
    }

    await bus.publish(
      {
        type: "task.restored",
        userId,
        payload: { taskId: id, taskIds: restored.map((r) => r.id) },
      },
      { db: tx },
    );
    return getTask(tx, userId, id);
  });
}

/** Permanently deletes a task from the Trash (subtasks cascade). */
export function purgeTask({ db }: TaskDeps, userId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    await getTrashed(tx, userId, id);
    await tx.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  });
}

/** Permanently deletes everything in the user's Trash. Returns the number of tasks removed. */
export async function emptyTrash({ db }: TaskDeps, userId: string): Promise<number> {
  const removed = await db
    .delete(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.deletedAt)))
    .returning({ id: tasks.id });
  return removed.length;
}
