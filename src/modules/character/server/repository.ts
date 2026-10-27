import { and, desc, eq, exists, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/shared/db/types";

import { developmentAttributes, xpAttributeCredits, xpLedger } from "../db";
import {
  getLevelProgress,
  getStageProgress,
  isActiveAttribute,
  type XpActivity,
  type XpDay,
  type XpTotals,
  type CharacterOverview,
  type XpEntry,
  type XpEntryKind,
  type XpHistoryInput,
  type XpSourceType,
} from "../domain";
import { listAttributes } from "./attributes";

/*
 * Read side. Every number shown on the character page is aggregated from the ledger and its
 * credits here; nothing is stored as a counter.
 */

/** Never NULL: user-created attributes have no system key and are not legacy. */
const isLegacySql = sql`coalesce(${developmentAttributes.systemKey} like 'legacy.%', false)`;
/** Stored Level XP, or `historicLevelXp` for credits recorded before M6.2 (see economy.ts). */
const creditLevelXpSql = sql`coalesce(${xpAttributeCredits.levelXp}, case when ${isLegacySql} then 0 else ${xpAttributeCredits.amount} end)`;

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
          levelXp: sql<number>`${creditLevelXpSql}::int`,
        })
        .from(xpAttributeCredits)
        .innerJoin(
          developmentAttributes,
          eq(developmentAttributes.id, xpAttributeCredits.attributeId),
        )
        .where(inArray(xpAttributeCredits.ledgerEntryId, ids))
    : [];
  const creditsOf = new Map<string, XpEntry["credits"]>();
  for (const { entryId, attributeId, amount, levelXp } of creditRows) {
    creditsOf.set(entryId, [...(creditsOf.get(entryId) ?? []), { attributeId, amount, levelXp }]);
  }

  return rows.map(({ entry, reversedBy }) => {
    const credits = (creditsOf.get(entry.id) ?? []).sort(
      (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
    );
    return {
      id: entry.id,
      kind: entry.kind as XpEntryKind,
      amount: entry.amount,
      levelXp: credits.reduce((sum, credit) => sum + credit.levelXp, 0),
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
    };
  });
}

/**
 * Lifetime totals of the three XP kinds. Active XP sums the ledger; Growth and Level XP sum the
 * credits. Reversals are corrections and count negatively; spending (rewards module) is not part
 * of these figures at all.
 */
export async function getXpTotals(db: DbExecutor, userId: string): Promise<XpTotals> {
  const [[active], [credits]] = await Promise.all([
    db
      .select({ xp: sql<number>`coalesce(sum(${xpLedger.amount}), 0)::int` })
      .from(xpLedger)
      .where(eq(xpLedger.userId, userId)),
    db
      .select({
        growth: sql<number>`coalesce(sum(${xpAttributeCredits.amount}) filter (where not ${isLegacySql}), 0)::int`,
        legacy: sql<number>`coalesce(sum(${xpAttributeCredits.amount}) filter (where ${isLegacySql}), 0)::int`,
        level: sql<number>`coalesce(sum(${creditLevelXpSql}), 0)::int`,
      })
      .from(xpAttributeCredits)
      .innerJoin(
        developmentAttributes,
        eq(developmentAttributes.id, xpAttributeCredits.attributeId),
      )
      .where(eq(xpAttributeCredits.userId, userId)),
  ]);
  return {
    lifetimeActiveXp: active?.xp ?? 0,
    growthXp: credits?.growth ?? 0,
    legacyGrowthXp: credits?.legacy ?? 0,
    lifetimeLevelXp: credits?.level ?? 0,
  };
}

export async function getOverview(db: DbExecutor, userId: string): Promise<CharacterOverview> {
  const [attributes, totals, counts, recentGrants, recentReversals] = await Promise.all([
    listAttributes(db, userId),
    getXpTotals(db, userId),
    db
      .select({
        grants: sql<number>`(count(*) filter (where ${xpLedger.kind} = 'grant'))::int`,
        reversals: sql<number>`(count(*) filter (where ${xpLedger.kind} = 'reversal'))::int`,
      })
      .from(xpLedger)
      .where(eq(xpLedger.userId, userId)),
    loadEntries(db, userId, eq(xpLedger.kind, "grant"), 6),
    loadEntries(db, userId, eq(xpLedger.kind, "reversal"), 4),
  ]);
  return {
    totals,
    level: getLevelProgress(totals.lifetimeLevelXp),
    stage: getStageProgress(totals.lifetimeLevelXp),
    grantCount: counts[0]?.grants ?? 0,
    reversalCount: counts[0]?.reversals ?? 0,
    attributes: attributes
      .filter(isActiveAttribute)
      .map((attribute) => ({ ...attribute, progress: getLevelProgress(attribute.xp) })),
    recentGrants,
    recentReversals,
  };
}

/**
 * XP earned from the local date `from` (inclusive; null = all time) in `timeZone`, by local day and
 * by attribute. Two grouped queries over the existing ledger and credits — no counters, no copies.
 */
export async function getXpActivity(
  db: DbExecutor,
  userId: string,
  range: { from: string | null; timeZone: string },
): Promise<XpActivity> {
  const day = (column: typeof xpLedger.createdAt | typeof xpAttributeCredits.createdAt) =>
    sql<string>`to_char((${column} at time zone ${range.timeZone})::date, 'YYYY-MM-DD')`;
  const since = (column: typeof xpLedger.createdAt | typeof xpAttributeCredits.createdAt) =>
    range.from === null
      ? undefined
      : sql`${column} >= (${range.from}::date::timestamp at time zone ${range.timeZone})`;

  const ledgerDay = day(xpLedger.createdAt);
  const creditDay = day(xpAttributeCredits.createdAt);
  const [activeRows, creditRows] = await Promise.all([
    db
      .select({ date: ledgerDay, xp: sql<number>`sum(${xpLedger.amount})::int` })
      .from(xpLedger)
      .where(and(eq(xpLedger.userId, userId), since(xpLedger.createdAt)))
      // By position: the same expression with fresh bind parameters would not match.
      .groupBy(sql`1`),
    db
      .select({
        date: creditDay,
        attributeId: xpAttributeCredits.attributeId,
        growth: sql<number>`sum(${xpAttributeCredits.amount})::int`,
        level: sql<number>`sum(${creditLevelXpSql})::int`,
      })
      .from(xpAttributeCredits)
      .innerJoin(
        developmentAttributes,
        eq(developmentAttributes.id, xpAttributeCredits.attributeId),
      )
      .where(
        and(
          eq(xpAttributeCredits.userId, userId),
          sql`not ${isLegacySql}`,
          since(xpAttributeCredits.createdAt),
        ),
      )
      .groupBy(sql`1`, sql`2`),
  ]);

  const days = new Map<string, XpDay>();
  const dayOf = (date: string) => {
    let entry = days.get(date);
    if (!entry) days.set(date, (entry = { date, activeXp: 0, growthXp: 0, levelXp: 0 }));
    return entry;
  };
  const byAttribute = new Map<string, number>();
  for (const row of activeRows) dayOf(row.date).activeXp += row.xp;
  for (const row of creditRows) {
    const entry = dayOf(row.date);
    entry.growthXp += row.growth;
    entry.levelXp += row.level;
    byAttribute.set(row.attributeId, (byAttribute.get(row.attributeId) ?? 0) + row.growth);
  }
  const sorted = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    activeXp: sorted.reduce((sum, d) => sum + d.activeXp, 0),
    growthXp: sorted.reduce((sum, d) => sum + d.growthXp, 0),
    levelXp: sorted.reduce((sum, d) => sum + d.levelXp, 0),
    byAttribute: [...byAttribute].map(([attributeId, growthXp]) => ({ attributeId, growthXp })),
    days: sorted,
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
