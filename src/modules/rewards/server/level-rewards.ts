import { and, asc, eq, inArray } from "drizzle-orm";

import type { Database, DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { levelRewards, rewardLedger } from "../db";
import {
  defaultLevelRewards,
  earlyClaimCost,
  levelRewardState,
  type CreateLevelRewardInput,
  type LevelReward,
  type LevelRewardKey,
  type RewardLedgerEntry,
  type UpdateLevelRewardInput,
} from "../domain";
import { getBalances } from "./balances";
import { findByIdempotencyKey, lockSpending, toEntry } from "./store";

type Row = typeof levelRewards.$inferSelect;

export async function seedLevelRewards(db: DbExecutor, userId: string): Promise<void> {
  await db
    .insert(levelRewards)
    .values(defaultLevelRewards.map((reward) => ({ userId, ...reward })))
    .onConflictDoNothing();
}

export async function listLevelRewards(db: DbExecutor, userId: string): Promise<LevelReward[]> {
  const [rows, balances] = await Promise.all([
    db
      .select()
      .from(levelRewards)
      .where(eq(levelRewards.userId, userId))
      .orderBy(asc(levelRewards.level)),
    getBalances(db, userId),
  ]);
  const claims = rows.length
    ? await db
        .select()
        .from(rewardLedger)
        .where(
          and(
            eq(rewardLedger.kind, "milestone_reward_claimed"),
            inArray(
              rewardLedger.levelRewardId,
              rows.map((row) => row.id),
            ),
          ),
        )
    : [];
  const claimOf = new Map(claims.map((claim) => [claim.levelRewardId, claim]));
  return rows.map((row) => {
    const claim = claimOf.get(row.id);
    const state = levelRewardState(row.level, balances.level, Boolean(claim));
    return {
      id: row.id,
      level: row.level,
      systemKey: row.systemKey as LevelRewardKey | null,
      name: row.name,
      emoji: row.emoji,
      description: row.description,
      realWorldCostCents: row.realWorldCostCents,
      claim: claim
        ? { early: claim.early, levelXpSpent: claim.levelXpSpent, createdAt: claim.createdAt }
        : null,
      state,
      earlyClaimCost:
        state === "early" ? earlyClaimCost(balances.lifetimeLevelXp, row.level) : null,
    };
  });
}

async function getOwned(db: DbExecutor, userId: string, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(levelRewards)
    .where(and(eq(levelRewards.id, id), eq(levelRewards.userId, userId)));
  if (!row) throw new DomainError("not_found", "level_reward.not_found");
  return row;
}

async function assertLevelFree(db: DbExecutor, userId: string, level: number, except?: string) {
  const [taken] = await db
    .select({ id: levelRewards.id })
    .from(levelRewards)
    .where(and(eq(levelRewards.userId, userId), eq(levelRewards.level, level)));
  if (taken && taken.id !== except) throw new DomainError("conflict", "level_reward.level_taken");
}

export async function createLevelReward(
  db: DbExecutor,
  userId: string,
  input: CreateLevelRewardInput,
): Promise<void> {
  await assertLevelFree(db, userId, input.level);
  await db.insert(levelRewards).values({ ...input, userId });
}

export async function updateLevelReward(
  db: DbExecutor,
  userId: string,
  input: UpdateLevelRewardInput,
): Promise<void> {
  const current = await getOwned(db, userId, input.id);
  if (input.patch.level !== undefined && input.patch.level !== current.level) {
    const [claimed] = await db
      .select({ id: rewardLedger.id })
      .from(rewardLedger)
      .where(eq(rewardLedger.levelRewardId, current.id));
    if (claimed) throw new DomainError("conflict", "level_reward.already_claimed");
    await assertLevelFree(db, userId, input.patch.level, current.id);
  }
  if (input.patch.name === null && !current.systemKey) {
    throw new DomainError("invalid", "level_reward.name_required");
  }
  await db
    .update(levelRewards)
    .set(input.patch)
    .where(and(eq(levelRewards.id, current.id), eq(levelRewards.userId, userId)));
}

export async function deleteLevelReward(db: DbExecutor, userId: string, id: string) {
  const current = await getOwned(db, userId, id);
  const [claimed] = await db
    .select({ id: rewardLedger.id })
    .from(rewardLedger)
    .where(eq(rewardLedger.levelRewardId, current.id));
  if (claimed) throw new DomainError("conflict", "level_reward.already_claimed");
  await db.delete(levelRewards).where(eq(levelRewards.id, current.id));
}

/**
 * Claims a level reward once: free at or above its level; early (paid with spendable Level XP
 * equal to the Level XP still missing) when allowed by `maxEarlyClaimLevel`. Never touches
 * lifetime XP, so the level stays. The unique claim index makes a second claim impossible.
 */
export function claimLevelReward(
  db: Database,
  userId: string,
  input: { levelRewardId: string; idempotencyKey: string },
): Promise<RewardLedgerEntry> {
  return db.transaction(async (tx) => {
    await lockSpending(tx, userId);
    const previous = await findByIdempotencyKey(tx, userId, input.idempotencyKey);
    if (previous) {
      if (previous.levelRewardId !== input.levelRewardId) {
        throw new DomainError("conflict", "reward.idempotency_mismatch");
      }
      return toEntry(previous);
    }

    const reward = await getOwned(tx, userId, input.levelRewardId);
    const [claimed] = await tx
      .select({ id: rewardLedger.id })
      .from(rewardLedger)
      .where(
        and(
          eq(rewardLedger.levelRewardId, reward.id),
          eq(rewardLedger.kind, "milestone_reward_claimed"),
        ),
      );
    const balances = await getBalances(tx, userId);
    const state = levelRewardState(reward.level, balances.level, Boolean(claimed));
    if (state === "claimed") throw new DomainError("conflict", "level_reward.already_claimed");
    if (state === "locked") throw new DomainError("invalid", "level_reward.too_far");

    const cost = state === "early" ? earlyClaimCost(balances.lifetimeLevelXp, reward.level) : 0;
    if (cost > balances.spendableLevelXp) {
      throw new DomainError("invalid", "level_reward.insufficient_level");
    }

    const [row] = await tx
      .insert(rewardLedger)
      .values({
        userId,
        kind: "milestone_reward_claimed",
        levelRewardId: reward.id,
        title: reward.name,
        titleKey: reward.name ? null : reward.systemKey,
        emoji: reward.emoji,
        levelXpSpent: cost,
        early: state === "early",
        levelAtClaim: balances.level,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new DomainError("conflict", "level_reward.already_claimed");
    return toEntry(row);
  });
}
