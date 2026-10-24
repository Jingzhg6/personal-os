import { and, count, eq, ne } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyForMove, keysForNewItems, type MoveDirection } from "@/shared/lib/order";

import { tasks, taskStatuses } from "../db";
import {
  defaultStatuses,
  sortStatuses,
  type CreateStatusInput,
  type DeleteStatusInput,
  type TaskStatus,
  type UpdateStatusInput,
} from "../domain";

function toStatus(row: typeof taskStatuses.$inferSelect): TaskStatus {
  return {
    id: row.id,
    systemKey: row.systemKey as TaskStatus["systemKey"],
    name: row.name,
    category: row.category as TaskStatus["category"],
    color: row.color as TaskStatus["color"],
    sortKey: row.sortKey,
  };
}

export async function seedDefaultStatuses(db: DbExecutor, userId: string): Promise<void> {
  const keys = keysForNewItems(defaultStatuses.length);
  await db
    .insert(taskStatuses)
    .values(defaultStatuses.map((status, i) => ({ userId, ...status, sortKey: keys[i]! })))
    .onConflictDoNothing();
}

export async function listStatuses(db: DbExecutor, userId: string): Promise<TaskStatus[]> {
  const rows = await db.select().from(taskStatuses).where(eq(taskStatuses.userId, userId));
  return sortStatuses(rows.map(toStatus));
}

export async function getOwnedStatus(
  db: DbExecutor,
  userId: string,
  id: string,
): Promise<TaskStatus> {
  const [row] = await db
    .select()
    .from(taskStatuses)
    .where(and(eq(taskStatuses.id, id), eq(taskStatuses.userId, userId)));
  if (!row) throw new DomainError("not_found", "status.not_found");
  return toStatus(row);
}

export async function createStatus(
  db: DbExecutor,
  userId: string,
  input: CreateStatusInput,
): Promise<TaskStatus> {
  const inCategory = (await listStatuses(db, userId)).filter((s) => s.category === input.category);
  const [row] = await db
    .insert(taskStatuses)
    .values({ userId, ...input, sortKey: keyAfter(inCategory.at(-1)?.sortKey ?? null) })
    .returning();
  return toStatus(row!);
}

export async function updateStatus(
  db: DbExecutor,
  userId: string,
  input: UpdateStatusInput,
): Promise<TaskStatus> {
  const current = await getOwnedStatus(db, userId, input.id);
  const { id, ...patch } = input;
  if (patch.name === null && !current.systemKey)
    throw new DomainError("invalid", "status.name_required");
  if (Object.keys(patch).length === 0) return current;
  const [row] = await db
    .update(taskStatuses)
    .set(patch)
    .where(and(eq(taskStatuses.id, id), eq(taskStatuses.userId, userId)))
    .returning();
  return toStatus(row!);
}

/** Moves a status within its category. */
export async function moveStatus(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: MoveDirection,
): Promise<TaskStatus[]> {
  const status = await getOwnedStatus(db, userId, id);
  const siblings = (await listStatuses(db, userId)).filter((s) => s.category === status.category);
  const key = keyForMove(
    siblings.map((s) => s.sortKey),
    siblings.findIndex((s) => s.id === id),
    direction,
  );
  if (key) {
    await db
      .update(taskStatuses)
      .set({ sortKey: key })
      .where(and(eq(taskStatuses.id, id), eq(taskStatuses.userId, userId)));
  }
  return listStatuses(db, userId);
}

/**
 * Deletes a status. Each category must keep at least one status. Tasks using it (including
 * soft-deleted ones) are moved to `replacementStatusId`, which must be in the same category so
 * completion state and history stay correct.
 */
export async function deleteStatus(
  db: DbExecutor,
  userId: string,
  input: DeleteStatusInput,
): Promise<void> {
  const status = await getOwnedStatus(db, userId, input.id);
  const [siblings] = await db
    .select({ n: count() })
    .from(taskStatuses)
    .where(
      and(
        eq(taskStatuses.userId, userId),
        eq(taskStatuses.category, status.category),
        ne(taskStatuses.id, status.id),
      ),
    );
  if (!siblings?.n) throw new DomainError("conflict", "status.last_in_category");

  const [usage] = await db.select({ n: count() }).from(tasks).where(eq(tasks.statusId, status.id));
  if (usage?.n) {
    if (!input.replacementStatusId || input.replacementStatusId === status.id) {
      throw new DomainError("conflict", "status.in_use");
    }
    const replacement = await getOwnedStatus(db, userId, input.replacementStatusId);
    if (replacement.category !== status.category) {
      throw new DomainError("invalid", "status.replacement_category_mismatch");
    }
    await db
      .update(tasks)
      .set({ statusId: replacement.id })
      .where(and(eq(tasks.statusId, status.id), eq(tasks.userId, userId)));
  }

  await db
    .delete(taskStatuses)
    .where(and(eq(taskStatuses.id, status.id), eq(taskStatuses.userId, userId)));
}
