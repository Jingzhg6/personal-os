import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { developmentAttributes } from "@/modules/character/db";
import { isLegacyAttribute } from "@/modules/character/domain";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { developmentFocus, developmentProfiles } from "../db";
import { MAX_FOCUS_ATTRIBUTES } from "../domain";

/* The user's vision (one free-text statement) and chosen focus attributes. */

export async function getVision(db: DbExecutor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ vision: developmentProfiles.vision })
    .from(developmentProfiles)
    .where(eq(developmentProfiles.userId, userId));
  return row?.vision ?? null;
}

export async function updateVision(
  db: DbExecutor,
  userId: string,
  vision: string | null,
): Promise<string | null> {
  const value = vision?.trim() || null;
  await db
    .insert(developmentProfiles)
    .values({ userId, vision: value })
    .onConflictDoUpdate({
      target: developmentProfiles.userId,
      set: { vision: value, updatedAt: new Date() },
    });
  return value;
}

/** Chosen focus attributes in the user's order (archived ones drop out of the focus). */
export async function getFocus(db: DbExecutor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ attributeId: developmentFocus.attributeId })
    .from(developmentFocus)
    .innerJoin(developmentAttributes, eq(developmentAttributes.id, developmentFocus.attributeId))
    .where(
      and(eq(developmentFocus.userId, userId), sql`${developmentAttributes.archivedAt} is null`),
    )
    .orderBy(asc(developmentFocus.position));
  return rows.map((row) => row.attributeId);
}

/**
 * Replaces the chosen focus. At most MAX_FOCUS_ATTRIBUTES active attributes of the user's own;
 * serialized per user so two concurrent saves cannot interleave.
 */
export function setFocus(
  db: DbExecutor,
  userId: string,
  attributeIds: string[],
  max = MAX_FOCUS_ATTRIBUTES,
): Promise<string[]> {
  if (attributeIds.length > max) throw new DomainError("invalid", "focus.too_many");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`development:${userId}`}))`);
    if (attributeIds.length > 0) {
      const rows = await tx
        .select({
          id: developmentAttributes.id,
          systemKey: developmentAttributes.systemKey,
          archivedAt: developmentAttributes.archivedAt,
        })
        .from(developmentAttributes)
        .where(
          and(
            eq(developmentAttributes.userId, userId),
            inArray(developmentAttributes.id, attributeIds),
          ),
        );
      if (rows.length !== attributeIds.length) {
        throw new DomainError("not_found", "attribute.not_found");
      }
      if (rows.some((row) => row.archivedAt || isLegacyAttribute(row))) {
        throw new DomainError("invalid", "attribute.archived");
      }
    }
    await tx.delete(developmentFocus).where(eq(developmentFocus.userId, userId));
    if (attributeIds.length > 0) {
      await tx
        .insert(developmentFocus)
        .values(attributeIds.map((attributeId, position) => ({ userId, attributeId, position })));
    }
    return getFocus(tx, userId);
  });
}
