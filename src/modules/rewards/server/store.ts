import { and, desc, eq, sql } from "drizzle-orm";

import type { Database, DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { rewardLedger, rewards } from "../db";
import {
  calculateRewardPurchase,
  remainingRedemptions,
  rewardCosts,
  type CreateRewardInput,
  type RedeemRewardInput,
  type Reward,
  type RewardCategory,
  type RewardLedgerEntry,
  type UpdateRewardInput,
} from "../domain";
import { getBalances } from "./balances";

type Row = typeof rewards.$inferSelect;

function toReward(row: Row, redemptionCount: number): Reward {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    category: row.category as RewardCategory,
    value: row.value,
    payWithActive: row.payWithActive,
    payWithLevel: row.payWithLevel,
    ...rewardCosts(row),
    enabled: row.enabled,
    repeatable: row.repeatable,
    maxRedemptions: row.maxRedemptions,
    realWorldCostCents: row.realWorldCostCents,
    redemptionCount,
    remaining: remainingRedemptions(row, redemptionCount),
    createdAt: row.createdAt,
  };
}

/** Net redemptions per reward (a refund gives one back). */
const redemptionCountSql = sql<number>`(count(*) filter (where ${rewardLedger.kind} = 'reward_redeemed') - count(*) filter (where ${rewardLedger.kind} = 'reward_refunded'))::int`;

export async function listRewards(db: DbExecutor, userId: string): Promise<Reward[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(rewards).where(eq(rewards.userId, userId)).orderBy(rewards.createdAt),
    db
      .select({ rewardId: rewardLedger.rewardId, count: redemptionCountSql })
      .from(rewardLedger)
      .where(eq(rewardLedger.userId, userId))
      .groupBy(rewardLedger.rewardId),
  ]);
  const countOf = new Map(counts.map((c) => [c.rewardId, c.count]));
  return rows.map((row) => toReward(row, countOf.get(row.id) ?? 0));
}

async function getOwned(db: DbExecutor, userId: string, id: string, lock = false): Promise<Row> {
  const select = db
    .select()
    .from(rewards)
    .where(and(eq(rewards.id, id), eq(rewards.userId, userId)));
  const [row] = lock ? await select.for("update") : await select;
  if (!row) throw new DomainError("not_found", "reward.not_found");
  return row;
}

export async function createReward(
  db: DbExecutor,
  userId: string,
  input: CreateRewardInput,
): Promise<Reward> {
  const [row] = await db
    .insert(rewards)
    .values({ ...input, userId })
    .returning();
  return toReward(row!, 0);
}

export async function updateReward(
  db: DbExecutor,
  userId: string,
  input: UpdateRewardInput,
): Promise<void> {
  const current = await getOwned(db, userId, input.id);
  const next = { ...current, ...input.patch };
  if (!next.payWithActive && !next.payWithLevel) {
    throw new DomainError("invalid", "reward.not_payable");
  }
  await db
    .update(rewards)
    .set(input.patch)
    .where(and(eq(rewards.id, input.id), eq(rewards.userId, userId)));
}

/** Deletes a reward never redeemed; one with history can only be disabled. */
export async function deleteReward(db: DbExecutor, userId: string, id: string): Promise<void> {
  await getOwned(db, userId, id);
  const [used] = await db
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .where(eq(rewardLedger.rewardId, id))
    .limit(1);
  if (used) throw new DomainError("conflict", "reward.has_history");
  await db.delete(rewards).where(and(eq(rewards.id, id), eq(rewards.userId, userId)));
}

/** Serialises a user's spending so two requests can never spend the same balance twice. */
export async function lockSpending(db: DbExecutor, userId: string) {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`rewards:${userId}`}))`);
}

/** The ledger entry already written for this idempotency key, if any. */
export async function findByIdempotencyKey(db: DbExecutor, userId: string, key: string) {
  const [row] = await db
    .select()
    .from(rewardLedger)
    .where(and(eq(rewardLedger.userId, userId), eq(rewardLedger.idempotencyKey, key)));
  return row;
}

export function toEntry(row: typeof rewardLedger.$inferSelect): RewardLedgerEntry {
  return {
    id: row.id,
    kind: row.kind as RewardLedgerEntry["kind"],
    rewardId: row.rewardId,
    levelRewardId: row.levelRewardId,
    title: row.title,
    titleKey: row.titleKey as RewardLedgerEntry["titleKey"],
    emoji: row.emoji,
    activeXpSpent: row.activeXpSpent,
    levelXpSpent: row.levelXpSpent,
    purchaseValue: row.purchaseValue,
    early: row.early,
    levelAtClaim: row.levelAtClaim,
    createdAt: row.createdAt,
  };
}

/**
 * Redeems a store reward in one transaction: lock, fresh balances, server-side payment
 * calculation, one append-only ledger row. Retrying with the same idempotency key returns the
 * first result and spends nothing more.
 */
export function redeemReward(
  db: Database,
  userId: string,
  input: RedeemRewardInput,
): Promise<RewardLedgerEntry> {
  return db.transaction(async (tx) => {
    await lockSpending(tx, userId);
    const previous = await findByIdempotencyKey(tx, userId, input.idempotencyKey);
    if (previous) {
      if (previous.rewardId !== input.rewardId) {
        throw new DomainError("conflict", "reward.idempotency_mismatch");
      }
      return toEntry(previous);
    }

    const reward = await getOwned(tx, userId, input.rewardId, true);
    if (!reward.enabled) throw new DomainError("invalid", "reward.disabled");
    const [count] = await tx
      .select({ count: redemptionCountSql })
      .from(rewardLedger)
      .where(eq(rewardLedger.rewardId, reward.id));
    if (remainingRedemptions(reward, count?.count ?? 0) === 0) {
      throw new DomainError("conflict", "reward.sold_out");
    }

    const purchase = calculateRewardPurchase(reward, await getBalances(tx, userId), input.payment);
    if (!purchase.canRedeem) throw new DomainError("invalid", `reward.${purchase.problem}`);

    const [row] = await tx
      .insert(rewardLedger)
      .values({
        userId,
        kind: "reward_redeemed",
        rewardId: reward.id,
        title: reward.name,
        emoji: reward.emoji,
        activeXpSpent: purchase.activeXpToSpend,
        levelXpSpent: purchase.levelXpToSpend,
        purchaseValue: purchase.purchaseValue,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    return toEntry(row!);
  });
}

export async function listRewardHistory(
  db: DbExecutor,
  userId: string,
  limit = 50,
): Promise<RewardLedgerEntry[]> {
  const rows = await db
    .select()
    .from(rewardLedger)
    .where(eq(rewardLedger.userId, userId))
    .orderBy(desc(rewardLedger.createdAt), desc(rewardLedger.id))
    .limit(limit);
  return rows.map(toEntry);
}
