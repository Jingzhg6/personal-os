import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/shared/db/types";
import type { DomainEvent } from "@/shared/events/types";

import { developmentAttributes, xpAttributeCredits, xpLedger } from "../db";
import {
  calculateLevelXpFromGrowth,
  historicLevelXp,
  splitByWeight,
  xpRules,
  type XpGrant,
  type XpRule,
} from "../domain";

/*
 * The XP engine: turns domain events into ledger entries, in the publisher's transaction.
 *
 * Idempotency does not rely on callers: every insert is `ON CONFLICT DO NOTHING` against the
 * ledger's unique indexes, so delivering the same event twice — or a second event for a
 * completion that is already granted — adds nothing.
 *
 * Two layers: the ledger row carries the overall XP of a completion (counted once); its
 * attribute credits split that same amount across the development attributes the source
 * contributes to. Credits are written only together with a newly inserted ledger row.
 */

const reversal = alias(xpLedger, "reversal");

export async function applyXpEvent(db: DbExecutor, event: DomainEvent): Promise<void> {
  for (const rule of xpRules) {
    if (rule.grantOn === event.type) await grant(db, event, rule, rule.grant(event.payload));
    if (rule.reverseOn === event.type) {
      await reverse(db, event, rule, rule.reversedSource(event.payload));
    }
  }
}

async function grant(db: DbExecutor, event: DomainEvent, rule: XpRule, xp: XpGrant) {
  if (xp.amount <= 0) return;
  const sameSource = and(
    eq(xpLedger.userId, event.userId),
    eq(xpLedger.ruleKey, rule.key),
    eq(xpLedger.sourceType, xp.sourceType),
    eq(xpLedger.sourceId, xp.sourceId),
  );
  // Each reversal closes a completion cycle; the next grant belongs to the next cycle.
  const [{ cycle }] = (await db
    .select({ cycle: sql<number>`count(*)::int` })
    .from(xpLedger)
    .where(and(sameSource, eq(xpLedger.kind, "reversal")))) as [{ cycle: number }];

  const [entry] = await db
    .insert(xpLedger)
    .values({
      userId: event.userId,
      kind: "grant",
      amount: xp.amount,
      ruleKey: rule.key,
      sourceEventId: event.id,
      sourceEventType: event.type,
      sourceType: xp.sourceType,
      sourceId: xp.sourceId,
      sourceTitle: xp.title,
      cycle,
      createdAt: event.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: xpLedger.id });
  if (!entry) return; // already granted: no credits either

  // Only the user's own attributes can be credited (archived ones still count: the task named
  // them when it was completed).
  const ids = xp.contributions.map((c) => c.attributeId);
  const owned = new Map(
    ids.length
      ? (
          await db
            .select({ id: developmentAttributes.id, systemKey: developmentAttributes.systemKey })
            .from(developmentAttributes)
            .where(
              and(
                eq(developmentAttributes.userId, event.userId),
                inArray(developmentAttributes.id, ids),
              ),
            )
        ).map((row) => [row.id, row] as const)
      : [],
  );
  const credits = splitByWeight(
    xp.amount,
    xp.contributions.filter((c) => owned.has(c.attributeId)),
  );
  if (credits.length > 0) {
    await db
      .insert(xpAttributeCredits)
      .values(
        credits.map((credit) => ({
          userId: event.userId,
          ledgerEntryId: entry.id,
          attributeId: credit.attributeId,
          amount: credit.amount,
          // Level XP is fixed now, at the current rate; later rate changes never rewrite it.
          levelXp: calculateLevelXpFromGrowth(credit.amount, owned.get(credit.attributeId)!),
          createdAt: event.occurredAt,
        })),
      )
      .onConflictDoNothing();
  }
}

async function reverse(db: DbExecutor, event: DomainEvent, rule: XpRule, sourceId: string) {
  // The latest grant of this source that has not been reversed yet (none: nothing to undo,
  // e.g. completed before XP existed).
  const [open] = await db
    .select({ grant: xpLedger })
    .from(xpLedger)
    .leftJoin(reversal, eq(reversal.reversalOf, xpLedger.id))
    .where(
      and(
        eq(xpLedger.userId, event.userId),
        eq(xpLedger.kind, "grant"),
        eq(xpLedger.ruleKey, rule.key),
        eq(xpLedger.sourceType, rule.sourceType),
        eq(xpLedger.sourceId, sourceId),
        isNull(reversal.id),
      ),
    )
    .orderBy(desc(xpLedger.cycle))
    .limit(1);
  if (!open) return;

  const [entry] = await db
    .insert(xpLedger)
    .values({
      userId: event.userId,
      kind: "reversal",
      amount: -open.grant.amount,
      ruleKey: rule.key,
      sourceEventId: event.id,
      sourceEventType: event.type,
      sourceType: open.grant.sourceType,
      sourceId: open.grant.sourceId,
      sourceTitle: open.grant.sourceTitle,
      // Legacy M6 grants recorded one attribute here; the reversal mirrors it as recorded.
      attributeId: open.grant.attributeId,
      cycle: open.grant.cycle,
      reversalOf: open.grant.id,
      createdAt: event.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: xpLedger.id });
  if (!entry) return;

  // Undo exactly what the grant credited, whatever the task's contributions are now.
  const credits = await db
    .select({
      attributeId: xpAttributeCredits.attributeId,
      amount: xpAttributeCredits.amount,
      levelXp: xpAttributeCredits.levelXp,
      systemKey: developmentAttributes.systemKey,
    })
    .from(xpAttributeCredits)
    .innerJoin(developmentAttributes, eq(developmentAttributes.id, xpAttributeCredits.attributeId))
    .where(eq(xpAttributeCredits.ledgerEntryId, open.grant.id));
  if (credits.length > 0) {
    await db
      .insert(xpAttributeCredits)
      .values(
        credits.map((credit) => ({
          userId: event.userId,
          ledgerEntryId: entry.id,
          attributeId: credit.attributeId,
          amount: -credit.amount,
          levelXp: -(credit.levelXp ?? historicLevelXp(credit.amount, credit)),
          createdAt: event.occurredAt,
        })),
      )
      .onConflictDoNothing();
  }
}
