import { and, asc, desc, eq } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyForMove, keysForNewItems, type MoveDirection } from "@/shared/lib/order";

import { areas } from "../db";
import { defaultAreas, type Area, type CreateAreaInput, type UpdateAreaInput } from "../domain";

function toArea(row: typeof areas.$inferSelect): Area {
  return {
    id: row.id,
    systemKey: row.systemKey as Area["systemKey"],
    name: row.name,
    color: row.color as Area["color"],
    icon: row.icon as Area["icon"],
    sortKey: row.sortKey,
  };
}

/** Creates the default areas for a new user. Idempotent. */
export async function seedDefaultAreas(db: DbExecutor, userId: string): Promise<void> {
  const keys = keysForNewItems(defaultAreas.length);
  await db
    .insert(areas)
    .values(defaultAreas.map((area, i) => ({ userId, ...area, sortKey: keys[i]! })))
    .onConflictDoNothing();
}

export async function listAreas(db: DbExecutor, userId: string): Promise<Area[]> {
  const rows = await db
    .select()
    .from(areas)
    .where(eq(areas.userId, userId))
    .orderBy(asc(areas.sortKey), asc(areas.id));
  return rows.map(toArea);
}

/** True when the area exists and belongs to the user. Used by other modules to validate references. */
export async function areaBelongsToUser(db: DbExecutor, userId: string, areaId: string) {
  const [row] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.id, areaId), eq(areas.userId, userId)));
  return Boolean(row);
}

async function getOwned(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(areas)
    .where(and(eq(areas.id, id), eq(areas.userId, userId)));
  if (!row) throw new DomainError("not_found", "area.not_found");
  return row;
}

export async function createArea(
  db: DbExecutor,
  userId: string,
  input: CreateAreaInput,
): Promise<Area> {
  const [last] = await db
    .select({ sortKey: areas.sortKey })
    .from(areas)
    .where(eq(areas.userId, userId))
    .orderBy(desc(areas.sortKey))
    .limit(1);
  const [row] = await db
    .insert(areas)
    .values({ userId, ...input, sortKey: keyAfter(last?.sortKey ?? null) })
    .returning();
  return toArea(row!);
}

export async function updateArea(
  db: DbExecutor,
  userId: string,
  input: UpdateAreaInput,
): Promise<Area> {
  const current = await getOwned(db, userId, input.id);
  const { id, ...patch } = input;
  if (patch.name === null && !current.systemKey) {
    throw new DomainError("invalid", "area.name_required");
  }
  if (Object.keys(patch).length === 0) return toArea(current);
  const [row] = await db
    .update(areas)
    .set(patch)
    .where(and(eq(areas.id, id), eq(areas.userId, userId)))
    .returning();
  return toArea(row!);
}

export async function moveArea(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: MoveDirection,
): Promise<Area[]> {
  const all = await listAreas(db, userId);
  const index = all.findIndex((area) => area.id === id);
  if (index === -1) throw new DomainError("not_found", "area.not_found");
  const key = keyForMove(
    all.map((area) => area.sortKey),
    index,
    direction,
  );
  if (key) {
    await db
      .update(areas)
      .set({ sortKey: key })
      .where(and(eq(areas.id, id), eq(areas.userId, userId)));
  }
  return listAreas(db, userId);
}

/** Deletes the area. Tasks keep existing; their area is cleared (FK ON DELETE SET NULL). */
export async function deleteArea(db: DbExecutor, userId: string, id: string): Promise<void> {
  await getOwned(db, userId, id);
  await db.delete(areas).where(and(eq(areas.id, id), eq(areas.userId, userId)));
}
