import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import type { Progress } from "@/modules/projects/domain";
import type { DbExecutor } from "@/shared/db/types";

import { tasks, taskStatuses } from "../db";

/*
 * Progress = completed top-level tasks / top-level tasks, excluding cancelled and deleted ones.
 * Subtasks are progress *within* their parent and are not counted separately.
 */

async function progressBy(
  db: DbExecutor,
  userId: string,
  today: string,
  column: typeof tasks.projectId | typeof tasks.milestoneId,
  where?: SQL,
): Promise<Map<string, Progress>> {
  const rows = await db
    .select({
      key: column,
      total: sql<number>`(count(*) filter (where ${taskStatuses.category} <> 'cancelled'))::int`,
      completed: sql<number>`(count(*) filter (where ${taskStatuses.category} = 'completed'))::int`,
      overdue: sql<number>`(count(*) filter (where ${taskStatuses.category} not in ('completed', 'cancelled') and ${tasks.dueDate} < ${today}))::int`,
    })
    .from(tasks)
    .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.id))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.parentTaskId),
        isNotNull(column),
        where,
      ),
    )
    .groupBy(column);
  return new Map(rows.map(({ key, ...progress }) => [key!, progress]));
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
    tasks.projectId,
    projectIds ? inArray(tasks.projectId, projectIds) : undefined,
  );
}

export function milestoneProgress(
  db: DbExecutor,
  userId: string,
  today: string,
  projectId: string,
) {
  return progressBy(db, userId, today, tasks.milestoneId, eq(tasks.projectId, projectId));
}
