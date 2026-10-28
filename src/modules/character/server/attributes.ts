import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import type { ColorId } from "@/shared/lib/colors";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyForMove, keysForNewItems } from "@/shared/lib/order";

import { developmentAttributes, disciplineLedger, xpAttributeCredits } from "../db";
import {
  defaultDevelopmentAttributes,
  disciplineAttributeSeed,
  isDisciplineAttribute,
  type AttributeLabelKey,
  type CreateAttributeInput,
  type DevelopmentAttribute,
  type UpdateAttributeInput,
} from "../domain";

/*
 * Development attributes are user data. Renaming or archiving one never touches the XP ledger or
 * its credits: history keeps pointing at the same attribute id.
 */

type Row = typeof developmentAttributes.$inferSelect;

function toAttribute(row: Row, xp: number, points: number | null = null): DevelopmentAttribute {
  return {
    id: row.id,
    systemKey: row.systemKey as AttributeLabelKey | null,
    name: row.name,
    icon: row.icon,
    color: row.color as ColorId,
    onRadar: row.onRadar,
    archivedAt: row.archivedAt,
    sortKey: row.sortKey,
    xp,
    points: isDisciplineAttribute(row) ? (points ?? 0) : null,
  };
}

/** Seeds the example attributes and the fixed 自制力 attribute for a new account. */
export async function seedDevelopmentAttributes(db: DbExecutor, userId: string): Promise<void> {
  const seeds = [...defaultDevelopmentAttributes, disciplineAttributeSeed];
  const keys = keysForNewItems(seeds.length);
  await db
    .insert(developmentAttributes)
    .values(seeds.map((a, i) => ({ userId, ...a, sortKey: keys[i]! })))
    .onConflictDoNothing();
}

/**
 * The user's 自制力 attribute id, creating it if missing (idempotent: the unique (user, system
 * key) index makes concurrent or repeated calls converge on one row).
 */
export async function ensureDisciplineAttribute(db: DbExecutor, userId: string): Promise<string> {
  const find = () =>
    db
      .select({ id: developmentAttributes.id })
      .from(developmentAttributes)
      .where(
        and(
          eq(developmentAttributes.userId, userId),
          eq(developmentAttributes.systemKey, disciplineAttributeSeed.systemKey),
        ),
      );
  const [existing] = await find();
  if (existing) return existing.id;
  const [last] = await db
    .select({ sortKey: developmentAttributes.sortKey })
    .from(developmentAttributes)
    .where(eq(developmentAttributes.userId, userId))
    .orderBy(desc(developmentAttributes.sortKey))
    .limit(1);
  await db
    .insert(developmentAttributes)
    .values({ userId, ...disciplineAttributeSeed, sortKey: keyAfter(last?.sortKey ?? null) })
    .onConflictDoNothing();
  const [row] = await find();
  return row!.id;
}

/** All of the user's attributes (archived included), in display order, with their XP. */
export async function listAttributes(
  db: DbExecutor,
  userId: string,
): Promise<DevelopmentAttribute[]> {
  const [rows, totals, discipline] = await Promise.all([
    db
      .select()
      .from(developmentAttributes)
      .where(eq(developmentAttributes.userId, userId))
      .orderBy(asc(developmentAttributes.sortKey), asc(developmentAttributes.id)),
    db
      .select({
        attributeId: xpAttributeCredits.attributeId,
        xp: sql<number>`coalesce(sum(${xpAttributeCredits.amount}), 0)::int`,
      })
      .from(xpAttributeCredits)
      .where(eq(xpAttributeCredits.userId, userId))
      .groupBy(xpAttributeCredits.attributeId),
    db
      .select({ points: sql<number>`coalesce(sum(${disciplineLedger.points}), 0)::int` })
      .from(disciplineLedger)
      .where(eq(disciplineLedger.userId, userId)),
  ]);
  const xpOf = new Map(totals.map((t) => [t.attributeId, t.xp]));
  const points = discipline[0]?.points ?? 0;
  return rows.map((row) => toAttribute(row, xpOf.get(row.id) ?? 0, points));
}

async function getOwned(db: DbExecutor, userId: string, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(developmentAttributes)
    .where(and(eq(developmentAttributes.id, id), eq(developmentAttributes.userId, userId)));
  if (!row) throw new DomainError("not_found", "attribute.not_found");
  return row;
}

export async function createAttribute(
  db: DbExecutor,
  userId: string,
  input: CreateAttributeInput,
): Promise<DevelopmentAttribute> {
  const [last] = await db
    .select({ sortKey: developmentAttributes.sortKey })
    .from(developmentAttributes)
    .where(eq(developmentAttributes.userId, userId))
    .orderBy(desc(developmentAttributes.sortKey))
    .limit(1);
  const [row] = await db
    .insert(developmentAttributes)
    .values({
      userId,
      name: input.name,
      icon: input.icon ?? null,
      color: input.color ?? "indigo",
      sortKey: keyAfter(last?.sortKey ?? null),
    })
    .returning();
  return toAttribute(row!, 0);
}

/** 自制力 is fixed: only its radar visibility (and position) may change (M10.5). */
function assertNotLocked(row: Row, patch: Record<string, unknown> = {}) {
  if (!isDisciplineAttribute(row)) return;
  const changes = Object.keys(patch).filter((key) => key !== "onRadar");
  if (changes.length > 0) throw new DomainError("invalid", "attribute.system_locked");
}

export async function updateAttribute(
  db: DbExecutor,
  userId: string,
  input: UpdateAttributeInput,
): Promise<void> {
  const row = await getOwned(db, userId, input.id);
  assertNotLocked(row, input.patch);
  const { archived, ...patch } = input.patch;
  if (patch.name === null && !row.systemKey) {
    throw new DomainError("invalid", "attribute.name_required");
  }
  await db
    .update(developmentAttributes)
    .set({
      ...patch,
      ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }),
    })
    .where(and(eq(developmentAttributes.id, input.id), eq(developmentAttributes.userId, userId)));
}

/** Moves an active attribute one place up or down among the active ones. */
export async function moveAttribute(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const row = await getOwned(db, userId, id);
  if (row.archivedAt) return;
  const active = (await listAttributes(db, userId)).filter((a) => !a.archivedAt);
  const key = keyForMove(
    active.map((a) => a.sortKey),
    active.findIndex((a) => a.id === id),
    direction,
  );
  if (key) {
    await db
      .update(developmentAttributes)
      .set({ sortKey: key })
      .where(and(eq(developmentAttributes.id, id), eq(developmentAttributes.userId, userId)));
  }
}

/** Deletes an attribute that never earned XP; one with history can only be archived. */
export async function deleteAttribute(db: DbExecutor, userId: string, id: string): Promise<void> {
  const row = await getOwned(db, userId, id);
  if (isDisciplineAttribute(row)) throw new DomainError("invalid", "attribute.system_locked");
  const [used] = await db
    .select({ id: xpAttributeCredits.id })
    .from(xpAttributeCredits)
    .where(eq(xpAttributeCredits.attributeId, id))
    .limit(1);
  if (used) throw new DomainError("conflict", "attribute.has_xp");
  await db
    .delete(developmentAttributes)
    .where(and(eq(developmentAttributes.id, id), eq(developmentAttributes.userId, userId)));
}
