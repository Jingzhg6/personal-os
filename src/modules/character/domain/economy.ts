import { isLegacyAttribute } from "./attributes";

/*
 * The XP model (M6.2):
 *
 *   Active XP  — "how much I did". Every completion earns it (the ledger amount, M6 rules).
 *                Lifetime total + spendable balance; low purchasing power.
 *   Growth XP  — "which abilities grew". The completion's Active XP split across the task's
 *                development contributions (xp_attribute_credits). Never spent.
 *   Level XP   — "how far the character has come". Derived from Growth XP when it is earned and
 *                stored with the credit. Lifetime total decides the level; spendable balance has
 *                high purchasing power. Spending never lowers the level.
 *   Reward     — a real-world treat bought with Active XP and/or Level XP (rewards module).
 *
 * A completion without development contributions earns Active XP only: doing things is not the
 * same as growing.
 */

/** Level XP per Growth XP for new grants. Change here; history keeps what it recorded. */
export const LEVEL_XP_PER_GROWTH_XP = 1;

/**
 * Level XP earned by `growthXp` of growth in an attribute. Legacy (M6 area-derived) attributes
 * never produce Level XP: they recorded *what kind of work* was done, not personal growth.
 */
export function calculateLevelXpFromGrowth(
  growthXp: number,
  attribute: { systemKey: string | null },
): number {
  if (isLegacyAttribute(attribute)) return 0;
  return Math.round(growthXp * LEVEL_XP_PER_GROWTH_XP);
}

/**
 * Level XP of a credit recorded before M6.2 (no stored value): M6.1 growth counted 1:1, legacy
 * area-derived history counts nothing. Fixed forever — it describes the past, not the current
 * rate. Mirrored in SQL by the character repository.
 */
export function historicLevelXp(growthXp: number, attribute: { systemKey: string | null }): number {
  return isLegacyAttribute(attribute) ? 0 : growthXp;
}

/**
 * Purchasing power of each spendable currency in the reward store. A reward's price is a value in
 * purchasing units; 500 units = 500 Active XP = 100 Level XP.
 */
export const REWARD_XP_RATES = { active: 1, level: 5 } as const;

/** Lifetime figures, all summed from the XP ledger and its credits. */
export interface XpTotals {
  lifetimeActiveXp: number;
  /** Growth XP of current development attributes (archived included, legacy excluded). */
  growthXp: number;
  /** M6 area-derived history: kept and auditable, never counted towards the level. */
  legacyGrowthXp: number;
  lifetimeLevelXp: number;
}
