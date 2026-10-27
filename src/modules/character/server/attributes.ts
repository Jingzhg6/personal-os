import { and, asc, eq, inArray } from "drizzle-orm";

import { listAreas } from "@/modules/areas/server";
import type { DbExecutor } from "@/shared/db/types";
import type { ColorId } from "@/shared/lib/colors";
import { DomainError } from "@/shared/lib/errors";
import { keysForNewItems } from "@/shared/lib/order";

import { attributeAreas, attributes } from "../db";
import {
  defaultAttributeForArea,
  defaultAttributes,
  type Attribute,
  type AttributeKey,
  type SetAttributeAreaInput,
} from "../domain";

/** Seeds the attributes and links the seeded areas to them (new accounts). */
export async function seedAttributes(db: DbExecutor, userId: string): Promise<void> {
  const keys = keysForNewItems(defaultAttributes.length);
  await db
    .insert(attributes)
    .values(defaultAttributes.map((a, i) => ({ userId, ...a, sortKey: keys[i]! })))
    .onConflictDoNothing();

  const [areas, rows] = await Promise.all([
    listAreas(db, userId),
    db.select().from(attributes).where(eq(attributes.userId, userId)),
  ]);
  const byKey = new Map(rows.map((row) => [row.systemKey, row.id]));
  const links = areas.flatMap((area) => {
    const key = area.systemKey ? defaultAttributeForArea[area.systemKey] : undefined;
    const attributeId = key ? byKey.get(key) : undefined;
    return attributeId ? [{ areaId: area.id, userId, attributeId }] : [];
  });
  if (links.length > 0) await db.insert(attributeAreas).values(links).onConflictDoNothing();
}

export async function listAttributes(db: DbExecutor, userId: string): Promise<Attribute[]> {
  const [rows, links] = await Promise.all([
    db
      .select()
      .from(attributes)
      .where(eq(attributes.userId, userId))
      .orderBy(asc(attributes.sortKey), asc(attributes.id)),
    db.select().from(attributeAreas).where(eq(attributeAreas.userId, userId)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    systemKey: row.systemKey as AttributeKey,
    name: row.name,
    color: row.color as ColorId,
    areaIds: links.filter((l) => l.attributeId === row.id).map((l) => l.areaId),
  }));
}

/** The attribute an area credits, if any. */
export async function attributeForArea(
  db: DbExecutor,
  userId: string,
  areaId: string | null,
): Promise<string | null> {
  if (!areaId) return null;
  const [row] = await db
    .select({ attributeId: attributeAreas.attributeId })
    .from(attributeAreas)
    .where(and(eq(attributeAreas.areaId, areaId), eq(attributeAreas.userId, userId)));
  return row?.attributeId ?? null;
}

/**
 * Changes which attribute an area credits from now on. Existing ledger entries keep the attribute
 * they were credited to: history is never rewritten.
 */
export async function setAttributeArea(
  db: DbExecutor,
  userId: string,
  input: SetAttributeAreaInput,
): Promise<void> {
  const areas = await listAreas(db, userId);
  if (!areas.some((area) => area.id === input.areaId)) {
    throw new DomainError("not_found", "area.not_found");
  }
  if (input.attributeId) {
    const [owned] = await db
      .select({ id: attributes.id })
      .from(attributes)
      .where(and(eq(attributes.id, input.attributeId), eq(attributes.userId, userId)));
    if (!owned) throw new DomainError("not_found", "attribute.not_found");
    await db
      .insert(attributeAreas)
      .values({ areaId: input.areaId, userId, attributeId: input.attributeId })
      .onConflictDoUpdate({
        target: attributeAreas.areaId,
        set: { attributeId: input.attributeId },
      });
  } else {
    await db
      .delete(attributeAreas)
      .where(
        and(eq(attributeAreas.userId, userId), inArray(attributeAreas.areaId, [input.areaId])),
      );
  }
}
