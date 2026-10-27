import {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import {
  taskDependencies,
  taskDevelopmentContributions,
  tasks,
  taskStatuses,
  taskTags,
} from "../db";
import {
  addDays,
  type DependencyRef,
  type FlagFilter,
  type StatusCategory,
  type Task,
  type TaskDetail,
  type TaskDependency,
  type TaskListQuery,
} from "../domain";

/*
 * Read side of the task module. Every query is scoped by user and excludes soft-deleted rows.
 */

type TaskRow = typeof tasks.$inferSelect;

const parent = alias(tasks, "parent");

function toTask(
  row: TaskRow,
  category: string,
  parentTitle: string | null,
  tagIds: string[],
  contributions: Task["contributions"],
  counts: { total: number; done: number } | undefined,
  openBlockerCount: number,
): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    areaId: row.areaId,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    parentTaskId: row.parentTaskId,
    parentTitle,
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
    contributions,
    subtaskCount: counts?.total ?? 0,
    completedSubtaskCount: counts?.done ?? 0,
    openBlockerCount,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const active = (userId: string) => and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

const blocker = alias(tasks, "blocker");
const blockerStatus = alias(taskStatuses, "blocker_status");

/** Loads tasks with their status category, parent title, tag ids and subtask progress. */
export async function loadTasks(
  db: DbExecutor,
  userId: string,
  where?: SQL,
  orderBy: SQL[] = [asc(tasks.sortKey), asc(tasks.id)],
): Promise<Task[]> {
  const rows = await db
    .select({ task: tasks, category: taskStatuses.category, parentTitle: parent.title })
    .from(tasks)
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
    .leftJoin(parent, eq(parent.id, tasks.parentTaskId))
    .where(and(active(userId), where))
    .orderBy(...orderBy);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.task.id);
  const [tagRows, contributionRows, countRows, blockerRows] = await Promise.all([
    db
      .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
      .from(taskTags)
      .where(inArray(taskTags.taskId, ids)),
    db
      .select()
      .from(taskDevelopmentContributions)
      .where(inArray(taskDevelopmentContributions.taskId, ids))
      .orderBy(
        desc(taskDevelopmentContributions.weight),
        asc(taskDevelopmentContributions.attributeId),
      ),
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
    db
      .select({ taskId: taskDependencies.blockedTaskId, open: sql<number>`count(*)::int` })
      .from(taskDependencies)
      .innerJoin(blocker, eq(blocker.id, taskDependencies.blockingTaskId))
      .innerJoin(blockerStatus, eq(blockerStatus.id, blocker.statusId))
      .where(
        and(
          inArray(taskDependencies.blockedTaskId, ids),
          isNull(blocker.deletedAt),
          inArray(blockerStatus.category, ["backlog", "unstarted", "started"]),
        ),
      )
      .groupBy(taskDependencies.blockedTaskId),
  ]);

  const tagsByTask = new Map<string, string[]>();
  for (const { taskId, tagId } of tagRows) {
    tagsByTask.set(taskId, [...(tagsByTask.get(taskId) ?? []), tagId]);
  }
  const countsByTask = new Map(
    countRows.map((c) => [c.parentId!, { total: c.total, done: c.done }]),
  );

  const blockersByTask = new Map(blockerRows.map((b) => [b.taskId, b.open]));
  const contributionsByTask = new Map<string, Task["contributions"]>();
  for (const { taskId, attributeId, weight } of contributionRows) {
    contributionsByTask.set(taskId, [
      ...(contributionsByTask.get(taskId) ?? []),
      { attributeId, weight },
    ]);
  }

  return rows.map(({ task, category, parentTitle }) =>
    toTask(
      task,
      category,
      parentTitle,
      tagsByTask.get(task.id) ?? [],
      contributionsByTask.get(task.id) ?? [],
      countsByTask.get(task.id),
      blockersByTask.get(task.id) ?? 0,
    ),
  );
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

function flagCondition(
  column: typeof tasks.isUrgent | typeof tasks.isImportant,
  filter: FlagFilter | undefined,
) {
  if (filter === "yes") return eq(column, true);
  if (filter === "no") return eq(column, false);
  if (filter === "unset") return isNull(column);
  return undefined;
}

function dueCondition(query: TaskListQuery): SQL | undefined {
  const { today } = query;
  switch (query.filter.due) {
    case "overdue":
      return lt(tasks.dueDate, today);
    case "today":
      return eq(tasks.dueDate, today);
    case "week":
      return between(tasks.dueDate, today, addDays(today, 6));
    case "none":
      return isNull(tasks.dueDate);
    case "any":
      return isNotNull(tasks.dueDate);
    default:
      return undefined;
  }
}

const sortOrders: Record<TaskListQuery["sort"], SQL[]> = {
  manual: [asc(tasks.sortKey), asc(tasks.id)],
  due: [
    sql`${tasks.dueDate} asc nulls last`,
    sql`${tasks.dueTime} asc nulls last`,
    asc(tasks.sortKey),
  ],
  priority: [desc(tasks.priority), sql`${tasks.dueDate} asc nulls last`, asc(tasks.sortKey)],
  created: [desc(tasks.createdAt), desc(tasks.id)],
  updated: [desc(tasks.updatedAt), desc(tasks.id)],
};

/**
 * Filtered / searched / sorted task list. Without a search, only top-level tasks are returned
 * unless `includeSubtasks` is set; a search always looks at every level.
 */
export function listTasks(db: DbExecutor, userId: string, query: TaskListQuery): Promise<Task[]> {
  const { filter } = query;
  const search = query.search?.trim();
  const conditions: (SQL | undefined)[] = [];

  if (!search && !query.includeSubtasks) conditions.push(isNull(tasks.parentTaskId));
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    conditions.push(or(ilike(tasks.title, pattern), ilike(tasks.descriptionText, pattern)));
  }
  if (filter.categories?.length) conditions.push(inArray(taskStatuses.category, filter.categories));
  if (filter.priorities?.length) conditions.push(inArray(tasks.priority, filter.priorities));
  if (filter.areaIds?.length || filter.noArea) {
    conditions.push(
      or(
        filter.areaIds?.length ? inArray(tasks.areaId, filter.areaIds) : undefined,
        filter.noArea ? isNull(tasks.areaId) : undefined,
      ),
    );
  }
  if (filter.projectIds?.length || filter.noProject) {
    // A subtask belongs to its parent's project (first level of nesting).
    conditions.push(
      or(
        filter.projectIds?.length ? inArray(tasks.projectId, filter.projectIds) : undefined,
        filter.projectIds?.length ? inArray(parent.projectId, filter.projectIds) : undefined,
        filter.noProject ? and(isNull(tasks.projectId), isNull(parent.projectId)) : undefined,
      ),
    );
  }
  if (filter.milestoneIds?.length) conditions.push(inArray(tasks.milestoneId, filter.milestoneIds));
  if (filter.tagIds?.length) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskTags)
          .where(and(eq(taskTags.taskId, tasks.id), inArray(taskTags.tagId, filter.tagIds))),
      ),
    );
  }
  conditions.push(flagCondition(tasks.isUrgent, filter.urgent));
  conditions.push(flagCondition(tasks.isImportant, filter.important));
  conditions.push(dueCondition(query));

  return loadTasks(db, userId, and(...conditions), sortOrders[query.sort]);
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
  const [subtasks, parentRows, blockedBy, blocking] = await Promise.all([
    loadTasks(db, userId, eq(tasks.parentTaskId, id)),
    task.parentTaskId
      ? db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(and(active(userId), eq(tasks.id, task.parentTaskId)))
      : Promise.resolve([]),
    dependencyRefs(db, userId, id, "blockedBy"),
    dependencyRefs(db, userId, id, "blocking"),
  ]);
  return { ...task, parent: parentRows[0] ?? null, subtasks, blockedBy, blocking };
}

/** The tasks on the other side of a task's dependencies (deleted ones are hidden). */
async function dependencyRefs(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: "blockedBy" | "blocking",
): Promise<DependencyRef[]> {
  const [self, other] =
    direction === "blockedBy"
      ? [taskDependencies.blockedTaskId, taskDependencies.blockingTaskId]
      : [taskDependencies.blockingTaskId, taskDependencies.blockedTaskId];
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      statusCategory: taskStatuses.category,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
    })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, other))
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .where(and(eq(self, id), eq(taskDependencies.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.title));
  return rows.map((row) => ({ ...row, statusCategory: row.statusCategory as StatusCategory }));
}

/** Dependencies whose two ends are both in `taskIds`. */
export async function dependenciesAmong(
  db: DbExecutor,
  userId: string,
  taskIds: string[],
): Promise<TaskDependency[]> {
  if (taskIds.length === 0) return [];
  return db
    .select({
      blockingTaskId: taskDependencies.blockingTaskId,
      blockedTaskId: taskDependencies.blockedTaskId,
    })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.userId, userId),
        inArray(taskDependencies.blockingTaskId, taskIds),
        inArray(taskDependencies.blockedTaskId, taskIds),
      ),
    );
}

/** Tasks of a list query plus the dependencies between them (the Gantt chart). */
export async function listTimeline(db: DbExecutor, userId: string, query: TaskListQuery) {
  const list = await listTasks(db, userId, query);
  const dependencies = await dependenciesAmong(
    db,
    userId,
    list.map((task) => task.id),
  );
  return { tasks: list, dependencies };
}

/**
 * Tasks (subtasks included) completed on or after the local date `from` in `timeZone` and still
 * completed; the Trash is excluded.
 */
export async function countCompletedTasks(
  db: DbExecutor,
  userId: string,
  range: { from: string; timeZone: string },
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        sql`${tasks.completedAt} >= (${range.from}::date::timestamp at time zone ${range.timeZone})`,
      ),
    );
  return row?.count ?? 0;
}
