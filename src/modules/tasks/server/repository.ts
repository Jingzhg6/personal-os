import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { tasks, taskStatuses, taskTags } from "../db";
import type { StatusCategory, Task, TaskDetail } from "../domain";

/*
 * Read side of the task module. Every query is scoped by user and excludes soft-deleted rows.
 */

type TaskRow = typeof tasks.$inferSelect;

function toTask(
  row: TaskRow,
  category: string,
  tagIds: string[],
  counts: { total: number; done: number } | undefined,
): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    areaId: row.areaId,
    parentTaskId: row.parentTaskId,
    statusId: row.statusId,
    statusCategory: category as StatusCategory,
    priority: row.priority,
    isUrgent: row.isUrgent,
    isImportant: row.isImportant,
    startDate: row.startDate,
    dueDate: row.dueDate,
    dueTime: row.dueTime ? row.dueTime.slice(0, 5) : null,
    estimatedMinutes: row.estimatedMinutes,
    sortKey: row.sortKey,
    tagIds,
    subtaskCount: counts?.total ?? 0,
    completedSubtaskCount: counts?.done ?? 0,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const active = (userId: string) => and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

/** Loads tasks with their status category, tag ids and subtask progress. */
export async function loadTasks(db: DbExecutor, userId: string, where?: SQL): Promise<Task[]> {
  const rows = await db
    .select({ task: tasks, category: taskStatuses.category })
    .from(tasks)
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
    .where(and(active(userId), where))
    .orderBy(asc(tasks.sortKey), asc(tasks.id));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.task.id);
  const [tagRows, countRows] = await Promise.all([
    db
      .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
      .from(taskTags)
      .where(inArray(taskTags.taskId, ids)),
    db
      .select({
        parentId: tasks.parentTaskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) filter (where ${taskStatuses.category} = 'completed'))::int`,
      })
      .from(tasks)
      .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
      .where(and(active(userId), inArray(tasks.parentTaskId, ids)))
      .groupBy(tasks.parentTaskId),
  ]);

  const tagsByTask = new Map<string, string[]>();
  for (const { taskId, tagId } of tagRows) {
    tagsByTask.set(taskId, [...(tagsByTask.get(taskId) ?? []), tagId]);
  }
  const countsByTask = new Map(
    countRows.map((c) => [c.parentId!, { total: c.total, done: c.done }]),
  );

  return rows.map(({ task, category }) =>
    toTask(task, category, tagsByTask.get(task.id) ?? [], countsByTask.get(task.id)),
  );
}

/** Top-level tasks (subtasks are shown inside their parent). */
export function listTopLevelTasks(db: DbExecutor, userId: string): Promise<Task[]> {
  return loadTasks(db, userId, isNull(tasks.parentTaskId));
}

export async function getTask(db: DbExecutor, userId: string, id: string): Promise<Task> {
  const [task] = await loadTasks(db, userId, eq(tasks.id, id));
  if (!task) throw new DomainError("not_found", "task.not_found");
  return task;
}

export async function getTaskDetail(
  db: DbExecutor,
  userId: string,
  id: string,
): Promise<TaskDetail> {
  const task = await getTask(db, userId, id);
  const [subtasks, parentRows] = await Promise.all([
    loadTasks(db, userId, eq(tasks.parentTaskId, id)),
    task.parentTaskId
      ? db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(and(active(userId), eq(tasks.id, task.parentTaskId)))
      : Promise.resolve([]),
  ]);
  return { ...task, parent: parentRows[0] ?? null, subtasks };
}
