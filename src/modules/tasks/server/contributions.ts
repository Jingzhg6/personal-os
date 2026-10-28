import { and, eq, inArray } from "drizzle-orm";

import { developmentAttributes } from "@/modules/character/db";
import { isGrowthTarget } from "@/modules/character/domain";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { taskDevelopmentContributions } from "../db";
import type { TaskContribution } from "../domain";

/*
 * A task's development contributions: which of the user's development attributes it helps grow.
 * They are task data (like tags); the character module only sees them in `task.completed`.
 */

/**
 * Every attribute must belong to the user; attributes newly added to the task must also be active
 * (an archived one already on the task may stay).
 */
export async function assertContributionsUsable(
  db: DbExecutor,
  userId: string,
  contributions: readonly TaskContribution[],
  existing: readonly TaskContribution[] = [],
): Promise<void> {
  if (contributions.length === 0) return;
  const ids = contributions.map((c) => c.attributeId);
  const rows = await db
    .select({
      id: developmentAttributes.id,
      systemKey: developmentAttributes.systemKey,
      archivedAt: developmentAttributes.archivedAt,
    })
    .from(developmentAttributes)
    .where(and(eq(developmentAttributes.userId, userId), inArray(developmentAttributes.id, ids)));
  if (rows.length !== new Set(ids).size) throw new DomainError("not_found", "attribute.not_found");
  // 自制力 is scored by fixed rules only, never by task contributions (M10.5).
  if (rows.some((row) => !isGrowthTarget(row))) {
    throw new DomainError("invalid", "attribute.system_scored");
  }
  const kept = new Set(existing.map((c) => c.attributeId));
  if (rows.some((row) => row.archivedAt && !kept.has(row.id))) {
    throw new DomainError("invalid", "attribute.archived");
  }
}

export async function replaceContributions(
  db: DbExecutor,
  taskId: string,
  contributions: readonly TaskContribution[],
): Promise<void> {
  await db
    .delete(taskDevelopmentContributions)
    .where(eq(taskDevelopmentContributions.taskId, taskId));
  if (contributions.length > 0) {
    await db
      .insert(taskDevelopmentContributions)
      .values(contributions.map((c) => ({ taskId, attributeId: c.attributeId, weight: c.weight })));
  }
}
