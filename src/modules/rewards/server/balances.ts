import { eq, sql } from "drizzle-orm";

import { getLevelFromLevelXp } from "@/modules/character/domain";
import { getXpTotals } from "@/modules/character/server";
import type { DbExecutor } from "@/shared/db/types";

import { rewardLedger } from "../db";
import type { XpBalances } from "../domain";

/**
 * Spendable = lifetime − spent. Lifetime figures come from the character module (XP ledger);
 * spending lives only in the reward ledger, so lifetime XP and the level never move here.
 */
export async function getBalances(db: DbExecutor, userId: string): Promise<XpBalances> {
  const [totals, [spent]] = await Promise.all([
    getXpTotals(db, userId),
    db
      .select({
        active: sql<number>`coalesce(sum(${rewardLedger.activeXpSpent}), 0)::int`,
        level: sql<number>`coalesce(sum(${rewardLedger.levelXpSpent}), 0)::int`,
      })
      .from(rewardLedger)
      .where(eq(rewardLedger.userId, userId)),
  ]);
  return {
    lifetimeActiveXp: totals.lifetimeActiveXp,
    spendableActiveXp: totals.lifetimeActiveXp - (spent?.active ?? 0),
    lifetimeLevelXp: totals.lifetimeLevelXp,
    spendableLevelXp: totals.lifetimeLevelXp - (spent?.level ?? 0),
    level: getLevelFromLevelXp(totals.lifetimeLevelXp),
  };
}
