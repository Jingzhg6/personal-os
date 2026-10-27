import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DbExecutor } from "@/shared/db/types";
import type { DomainEvent } from "@/shared/events/types";

import { xpLedger } from "../db";
import { xpRules, type XpGrant, type XpRule } from "../domain";
import { attributeForArea } from "./attributes";

/*
 * The XP engine: turns domain events into ledger entries, in the publisher's transaction.
 *
 * Idempotency does not rely on callers: every insert is `ON CONFLICT DO NOTHING` against the
 * ledger's unique indexes, so delivering the same event twice — or a second event for a
 * completion that is already granted — adds nothing.
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

  await db
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
      attributeId: await attributeForArea(db, event.userId, xp.areaId),
      cycle,
      createdAt: event.occurredAt,
    })
    .onConflictDoNothing();
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

  await db
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
      attributeId: open.grant.attributeId,
      cycle: open.grant.cycle,
      reversalOf: open.grant.id,
      createdAt: event.occurredAt,
    })
    .onConflictDoNothing();
}
