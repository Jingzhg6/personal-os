import { and, desc, eq, exists, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/shared/db/types";

import { xpAttributeCredits, xpLedger } from "../db";
import {
  ATTRIBUTE_LEVEL_STEP,
  levelProgress,
  type CharacterOverview,
  type XpEntry,
  type XpEntryKind,
  type XpHistoryInput,
  type XpSourceType,
} from "../domain";
import { listAttributes } from "./attributes";

/*
 * Read side. Every number shown on the character page is aggregated from the ledger here.
 */

const reversal = alias(xpLedger, "reversal");

async function loadEntries(
  db: DbExecutor,
  userId: string,
  where: SQL | undefined,
  limit: number,
): Promise<XpEntry[]> {
  const rows = await db
    .select({ entry: xpLedger, reversedBy: reversal.id })
    .from(xpLedger)
    .leftJoin(reversal, eq(reversal.reversalOf, xpLedger.id))
    .where(and(eq(xpLedger.userId, userId), where))
    .orderBy(desc(xpLedger.createdAt), desc(xpLedger.id))
    .limit(limit);
  const ids = rows.map((row) => row.entry.id);
  const creditRows = ids.length
    ? await db
        .select({
          entryId: xpAttributeCredits.ledgerEntryId,
          attributeId: xpAttributeCredits.attributeId,
          amount: xpAttributeCredits.amount,
        })
        .from(xpAttributeCredits)
        .where(inArray(xpAttributeCredits.ledgerEntryId, ids))
    : [];
  const creditsOf = new Map<string, XpEntry["credits"]>();
  for (const { entryId, attributeId, amount } of creditRows) {
    creditsOf.set(entryId, [...(creditsOf.get(entryId) ?? []), { attributeId, amount }]);
  }

  return rows.map(({ entry, reversedBy }) => ({
    id: entry.id,
    kind: entry.kind as XpEntryKind,
    amount: entry.amount,
    ruleKey: entry.ruleKey,
    sourceEventId: entry.sourceEventId,
    sourceEventType: entry.sourceEventType,
    sourceType: entry.sourceType as XpSourceType,
    sourceId: entry.sourceId,
    sourceTitle: entry.sourceTitle,
    credits: (creditsOf.get(entry.id) ?? []).sort(
      (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
    ),
    reversalOf: entry.reversalOf,
    reversed: reversedBy !== null,
    createdAt: entry.createdAt,
  }));
}

/** Total XP: the sum of the ledger, never a stored counter. */
export async function totalXp(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int` })
    .from(xpLedger)
    .where(eq(xpLedger.userId, userId));
  return row?.total ?? 0;
}

export async function getOverview(db: DbExecutor, userId: string): Promise<CharacterOverview> {
  const [attributes, totals, recentGrants, recentReversals] = await Promise.all([
    listAttributes(db, userId),
    db
      .select({
        total: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int`,
        grants: sql<number>`(count(*) filter (where ${xpLedger.kind} = 'grant'))::int`,
        reversals: sql<number>`(count(*) filter (where ${xpLedger.kind} = 'reversal'))::int`,
      })
      .from(xpLedger)
      .where(eq(xpLedger.userId, userId)),
    loadEntries(db, userId, eq(xpLedger.kind, "grant"), 6),
    loadEntries(db, userId, eq(xpLedger.kind, "reversal"), 4),
  ]);
  const total = totals[0]!;
  return {
    progress: levelProgress(total.total),
    developmentXp: attributes.reduce((sum, a) => sum + a.xp, 0),
    grantCount: total.grants,
    reversalCount: total.reversals,
    attributes: attributes
      .filter((attribute) => !attribute.archivedAt)
      .map((attribute) => ({
        ...attribute,
        progress: levelProgress(attribute.xp, ATTRIBUTE_LEVEL_STEP),
      })),
    recentGrants,
    recentReversals,
  };
}

/** Newest first, paged with the id of the last entry seen. */
export async function listHistory(
  db: DbExecutor,
  userId: string,
  input: XpHistoryInput,
): Promise<{ entries: XpEntry[]; nextCursor: string | null }> {
  let after: SQL | undefined;
  if (input.cursor) {
    const [last] = await db
      .select({ createdAt: xpLedger.createdAt, id: xpLedger.id })
      .from(xpLedger)
      .where(and(eq(xpLedger.id, input.cursor), eq(xpLedger.userId, userId)));
    if (last) {
      after = or(
        lt(xpLedger.createdAt, last.createdAt),
        and(eq(xpLedger.createdAt, last.createdAt), lt(xpLedger.id, last.id)),
      );
    }
  }
  const entries = await loadEntries(
    db,
    userId,
    and(
      input.kind ? eq(xpLedger.kind, input.kind) : undefined,
      input.attributeId
        ? exists(
            db
              .select({ one: sql`1` })
              .from(xpAttributeCredits)
              .where(
                and(
                  eq(xpAttributeCredits.ledgerEntryId, xpLedger.id),
                  eq(xpAttributeCredits.attributeId, input.attributeId),
                ),
              ),
          )
        : undefined,
      after,
    ),
    input.limit + 1,
  );
  const page = entries.slice(0, input.limit);
  return {
    entries: page,
    nextCursor: entries.length > input.limit ? page[page.length - 1]!.id : null,
  };
}
