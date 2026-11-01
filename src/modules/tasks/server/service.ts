import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { areaBelongsToUser } from "@/modules/areas/server";
import { milestones, projects } from "@/modules/projects/db";
import type { DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyBetween } from "@/shared/lib/order";

import { tasks, taskTags } from "../db";
import {
  completionInstant,
  defaultStatusFor,
  isClosedCategory,
  richTextToPlainText,
  statusTransition,
  todayIn,
  validateSchedule,
  type CompleteTaskInput,
  type CreateTaskInput,
  type StatusCategory,
  type Task,
  type UpdateTaskInput,
} from "../domain";
import { getTask } from "./repository";
import { getOwnedStatus, listStatuses } from "./statuses";
import { assertContributionsUsable, replaceContributions } from "./contributions";
import { assertTagsOwned } from "./tags";
import { timeZoneOf } from "./time-zone";

/*
 * Write side of the task module. Each command runs in one transaction; domain events are
 * published inside it, so subscribers (e.g. XP in M6) commit or roll back with the change.
 */

export interface TaskDeps {
  /** The connection, or a caller's open transaction (commands then run as a savepoint). */
  db: DbExecutor;
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
/**
 * Validates a task's project and milestone (the milestone implies its project). Also returns the
 * project's area, the default area of tasks placed in the project (not stored by this function).
 */
async function resolveProjectRefs(
  db: DbExecutor,
  userId: string,
  input: { projectId: string | null; milestoneId: string | null; isSubtask: boolean },
): Promise<{ projectId: string | null; milestoneId: string | null; projectAreaId: string | null }> {
  if (input.isSubtask) {
    if (input.projectId || input.milestoneId)
      throw new DomainError("invalid", "task.subtask_project");
    return { projectId: null, milestoneId: null, projectAreaId: null };
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
  let projectAreaId: string | null = null;
  if (projectId) {
    const [project] = await db
      .select({ id: projects.id, areaId: projects.areaId })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project) throw new DomainError("not_found", "project.not_found");
    projectAreaId = project.areaId;
  }
  return { projectId, milestoneId: input.milestoneId, projectAreaId };
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
    const { projectAreaId, ...refs } = await resolveProjectRefs(tx, userId, {
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      isSubtask: parentTaskId !== null,
    });
    // A task created in a project takes the project's area unless an area was chosen
    // (an explicit null means "no area" and is kept).
    const areaId = input.areaId !== undefined ? input.areaId : projectAreaId;

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
      { category: "unstarted", completedAt: null, cancelledAt: null, failedAt: null },
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
        areaId,
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
        failedAt: transition.failedAt,
        // The deadline is planned from the moment it is set.
        plannedAt: schedule.dueDate ? now : null,
        plannedAtInferred: false,
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
    // A recurring instance keeps a due date: the next one is scheduled from it (ADR 0023).
    if (current.recurrenceId && rest.dueDate === null) {
      throw new DomainError("invalid", "recurrence.needs_due_date");
    }
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
      const { projectAreaId, ...refs } = await resolveProjectRefs(tx, userId, {
        projectId: rest.milestoneId && rest.projectId === undefined ? null : projectId,
        milestoneId,
        isSubtask: current.parentTaskId !== null,
      });
      Object.assign(fields, refs);
      // Moved into a project without an area of its own: take the project's area. An area the
      // task already has (the user's choice) is never overwritten.
      if (
        refs.projectId !== current.projectId &&
        refs.projectId !== null &&
        rest.areaId === undefined &&
        current.areaId === null &&
        projectAreaId !== null
      ) {
        fields.areaId = projectAreaId;
      }
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

    // 自制力 planning time: set when a due date appears, cleared when it is removed, kept when the
    // date is only moved (M10.5).
    const planning =
      fields.dueDate === undefined || (fields.dueDate !== null) === (current.dueDate !== null)
        ? {}
        : { plannedAt: fields.dueDate === null ? null : new Date(), plannedAtInferred: false };
    if (Object.keys(fields).length > 0) {
      await tx
        .update(tasks)
        .set({
          ...(fields.description !== undefined
            ? { ...fields, descriptionText: richTextToPlainText(fields.description) }
            : fields),
          ...planning,
        })
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
  /** The moment of the change; a confirmed earlier completion date passes its instant. */
  at: Date = new Date(),
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
        failedAt: current.failedAt,
      },
      next.category,
      at,
    );
    await tx
      .update(tasks)
      .set({
        statusId: next.id,
        completedAt: transition.completedAt,
        cancelledAt: transition.cancelledAt,
        failedAt: transition.failedAt,
      })
      .where(and(eq(tasks.id, current.id), eq(tasks.userId, userId)));

    const task = await getTask(tx, userId, current.id);
    await bus.publish(
      {
        type: "task.status_changed",
        userId,
        payload: {
          taskId: task.id,
          fromStatusId: current.statusId,
          toStatusId: next.id,
          toCategory: next.category,
        },
      },
      { db: tx },
    );
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

/**
 * Completes a task on a confirmed date (today when omitted; an earlier day is recorded at noon
 * local time). No-op when already completed, so an existing completion date is never overwritten.
 * With `includeSubtasks`, its open subtasks are completed first, on the same date.
 */
export async function completeTask(
  deps: TaskDeps,
  userId: string,
  id: string,
  options: Omit<CompleteTaskInput, "id"> = {},
): Promise<Task> {
  const current = await getTask(deps.db, userId, id);
  if (current.statusCategory === "completed") return current;

  const timeZone = await timeZoneOf(deps.db, userId);
  const now = new Date();
  const at = completionInstant(options.completedOn, todayIn(timeZone, now), now, timeZone);
  if (!at) throw new DomainError("invalid", "task.completed_in_future");

  const statuses = await listStatuses(deps.db, userId);
  const target = options.statusId
    ? statuses.find((s) => s.id === options.statusId)
    : defaultStatusFor(statuses, "completed");
  if (!target) {
    throw options.statusId
      ? new DomainError("not_found", "status.not_found")
      : new DomainError("conflict", "status.missing_defaults");
  }
  if (target.category !== "completed") throw new DomainError("invalid", "task.not_a_completion");

  if (options.includeSubtasks) {
    for (const subtaskId of await openDescendants(deps.db, userId, current.id)) {
      await setTaskStatus(deps, userId, { id: subtaskId, statusId: target.id }, at);
    }
  }
  return setTaskStatus(deps, userId, { id: current.id, statusId: target.id }, at);
}

/** Open (not closed, not deleted) subtasks at any depth, deepest first. */
async function openDescendants(db: DbExecutor, userId: string, taskId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    with recursive down as (
      select id, 1 as depth from tasks
        where parent_task_id = ${taskId} and user_id = ${userId} and deleted_at is null
      union all
      select t.id, d.depth + 1 from tasks t join down d on t.parent_task_id = d.id
        where t.user_id = ${userId} and t.deleted_at is null
    )
    select d.id from down d
      join tasks t on t.id = d.id
      join task_statuses s on s.id = t.status_id
      where s.category in ('backlog', 'unstarted', 'started')
      order by d.depth desc
  `);
  return result.rows.map((row) => row.id);
}

/** Moves the task to the first "cancelled" status. No-op when already cancelled. */
export function cancelTask(deps: TaskDeps, userId: string, id: string): Promise<Task> {
  return moveToCategory(deps, userId, id, "cancelled", (t) => t.statusCategory !== "cancelled");
}

/** Moves the task to the first "failed" status (M10.5). No-op when already failed. */
export function failTask(deps: TaskDeps, userId: string, id: string): Promise<Task> {
  return moveToCategory(deps, userId, id, "failed", (t) => t.statusCategory !== "failed");
}

/** Moves a completed, cancelled or failed task back to the first "unstarted" status. */
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
    // A recurring instance stays a top-level task (ADR 0023).
    if (input.parentTaskId && task.recurrenceId) {
      throw new DomainError("invalid", "recurrence.subtask");
    }
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
