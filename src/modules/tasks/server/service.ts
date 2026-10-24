import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { areaBelongsToUser } from "@/modules/areas/server";
import type { Database, DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter } from "@/shared/lib/order";

import { tasks, taskTags } from "../db";
import {
  defaultStatusFor,
  isClosedCategory,
  statusTransition,
  validateSchedule,
  type CreateTaskInput,
  type StatusCategory,
  type Task,
  type UpdateTaskInput,
} from "../domain";
import { getTask } from "./repository";
import { getOwnedStatus, listStatuses } from "./statuses";
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

function assertSchedule(schedule: Pick<Task, "startDate" | "dueDate" | "dueTime">) {
  const error = validateSchedule(schedule);
  if (error) throw new DomainError("invalid", error);
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

    const [last] = await tx
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
        areaId: input.areaId ?? null,
        parentTaskId,
        statusId: status.id,
        priority: input.priority ?? 0,
        isUrgent: input.isUrgent ?? null,
        isImportant: input.isImportant ?? null,
        ...schedule,
        estimatedMinutes: input.estimatedMinutes ?? null,
        sortKey: keyAfter(last?.sortKey ?? null),
        completedAt: transition.completedAt,
        cancelledAt: transition.cancelledAt,
      })
      .returning({ id: tasks.id });
    await replaceTags(tx, row!.id, input.tagIds ?? []);

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
    const { tagIds, ...fields } = input.patch;

    await assertAreaOwned(tx, userId, fields.areaId);
    if (tagIds) await assertTagsOwned(tx, userId, tagIds);
    assertSchedule({
      startDate: fields.startDate !== undefined ? fields.startDate : current.startDate,
      dueDate: fields.dueDate !== undefined ? fields.dueDate : current.dueDate,
      dueTime: fields.dueTime !== undefined ? fields.dueTime : current.dueTime,
    });

    if (Object.keys(fields).length > 0) {
      await tx
        .update(tasks)
        .set(fields)
        .where(and(eq(tasks.id, current.id), eq(tasks.userId, userId)));
    } else {
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, current.id));
    }
    if (tagIds) await replaceTags(tx, current.id, tagIds);
    return getTask(tx, userId, current.id);
  });
}

export function setTaskStatus(
  { db, bus }: TaskDeps,
  userId: string,
  input: { id: string; statusId: string },
): Promise<Task> {
  return db.transaction(async (tx) => {
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

/** Soft-deletes the task and all of its subtasks. */
export function deleteTask({ db }: TaskDeps, userId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    await getTask(tx, userId, id);
    await tx.execute(sql`
      with recursive tree as (
        select id from tasks where id = ${id} and user_id = ${userId}
        union all
        select t.id from tasks t join tree on t.parent_task_id = tree.id
      )
      update tasks set deleted_at = now(), updated_at = now()
      where id in (select id from tree) and user_id = ${userId} and deleted_at is null
    `);
  });
}
