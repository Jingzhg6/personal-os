import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Progress } from "@/modules/projects/domain";
import type { DbExecutor } from "@/shared/db/types";

import { tasks, taskStatuses } from "../db";

/*
 * Progress = completed items / items, where an item is every task of the project and every
 * subtask of those tasks (V3: subtasks count, each as one item). Subtasks carry no project or
 * milestone of their own, so they are counted through their parent. Cancelled and failed items
 * are closed without being done and are left out; deleted ones (and subtasks of deleted tasks)
 * too.
 */

const parent = alias(tasks, "parent");

async function progressBy(
  db: DbExecutor,
  userId: string,
  today: string,
  column: "projectId" | "milestoneId",
  where?: (key: SQL) => SQL,
): Promise<Map<string, Progress>> {
  const key = sql<string>`coalesce(${tasks[column]}, ${parent[column]})`;
  const rows = await db
    .select({
      key,
      total: sql<number>`(count(*) filter (where ${taskStatuses.category} not in ('cancelled', 'failed')))::int`,
      completed: sql<number>`(count(*) filter (where ${taskStatuses.category} = 'completed'))::int`,
      overdue: sql<number>`(count(*) filter (where ${taskStatuses.category} not in ('completed', 'cancelled', 'failed') and ${tasks.dueDate} < ${today}))::int`,
    })
    .from(tasks)
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
    .leftJoin(parent, eq(parent.id, tasks.parentTaskId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        or(isNull(tasks.parentTaskId), isNull(parent.deletedAt)),
        sql`${key} is not null`,
        where?.(key),
      ),
    )
    .groupBy(key);
  return new Map(rows.map(({ key: k, ...progress }) => [k, progress]));
}

export function projectProgress(
  db: DbExecutor,
  userId: string,
  today: string,
  projectIds?: string[],
) {
  return progressBy(
    db,
    userId,
    today,
    "projectId",
    projectIds
      ? (key) =>
          projectIds.length === 0
            ? sql`false`
            : sql`${key} in (${sql.join(
                projectIds.map((id) => sql`${id}`),
                sql`, `,
              )})`
      : undefined,
  );
}

export function milestoneProgress(
  db: DbExecutor,
  userId: string,
  today: string,
  projectId: string,
) {
  return progressBy(
    db,
    userId,
    today,
    "milestoneId",
    () => sql`coalesce(${tasks.projectId}, ${parent.projectId}) = ${projectId}`,
  );
}
