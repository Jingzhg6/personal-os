import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { taskDependencies, tasks } from "../db";
import type { DependencyInput } from "../domain";
import type { TaskDeps } from "./service";

/*
 * Task dependencies (finish-to-start). Both tasks must belong to the user and not be in the
 * Trash; an edge that would close a cycle is rejected. Adding an existing edge is a no-op.
 */

/** True when `from` reaches `to` by following blocking → blocked edges. */
async function reaches(db: DbExecutor, userId: string, from: string, to: string) {
  const result = await db.execute<{ found: boolean }>(sql`
    with recursive downstream(id) as (
      select ${from}::uuid
      union
      select d.blocked_task_id from task_dependencies d
        join downstream on d.blocking_task_id = downstream.id
      where d.user_id = ${userId}
    )
    select exists(select 1 from downstream where id = ${to}::uuid) as found
  `);
  return Boolean(result.rows[0]?.found);
}

export function addDependency(
  { db }: TaskDeps,
  userId: string,
  { blockingTaskId, blockedTaskId }: DependencyInput,
): Promise<void> {
  if (blockingTaskId === blockedTaskId) {
    return Promise.reject(new DomainError("invalid", "dependency.self"));
  }
  return db.transaction(async (tx) => {
    // Serialise dependency edits per user so two concurrent edges cannot form a cycle.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deps:${userId}`}))`);
    const owned = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          inArray(tasks.id, [blockingTaskId, blockedTaskId]),
        ),
      );
    if (owned.length !== 2) throw new DomainError("not_found", "task.not_found");
    if (await reaches(tx, userId, blockedTaskId, blockingTaskId)) {
      throw new DomainError("invalid", "dependency.cycle");
    }
    await tx
      .insert(taskDependencies)
      .values({ userId, blockingTaskId, blockedTaskId })
      .onConflictDoNothing();
  });
}

export async function removeDependency(
  { db }: TaskDeps,
  userId: string,
  { blockingTaskId, blockedTaskId }: DependencyInput,
): Promise<void> {
  await db
    .delete(taskDependencies)
    .where(
      and(
        eq(taskDependencies.userId, userId),
        eq(taskDependencies.blockingTaskId, blockingTaskId),
        eq(taskDependencies.blockedTaskId, blockedTaskId),
      ),
    );
}
