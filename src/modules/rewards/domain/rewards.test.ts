import { describe, expect, it } from "vitest";

import { xpForLevel } from "@/modules/character/domain";

import {
  calculateRewardPurchase,
  earlyClaimCost,
  levelRewardState,
  firstEarlyClaimLevel,
  maxEarlyClaimLevel,
  remainingRedemptions,
  rewardCosts,
} from "./index";

const tea = { value: 500, payWithActive: true, payWithLevel: true };
const rich = { spendableActiveXp: 650, spendableLevelXp: 320 };

describe("reward costs", () => {
  it("derives Active and Level XP prices from the value", () => {
    expect(rewardCosts(tea)).toEqual({ activeXpCost: 500, levelXpCost: 100 });
    expect(rewardCosts({ ...tea, value: 501 })).toEqual({ activeXpCost: 501, levelXpCost: 101 });
    expect(rewardCosts({ ...tea, payWithLevel: false })).toEqual({
      activeXpCost: 500,
      levelXpCost: 0,
    });
  });

  it("counts remaining redemptions", () => {
    expect(remainingRedemptions({ repeatable: true, maxRedemptions: null }, 9)).toBeNull();
    expect(remainingRedemptions({ repeatable: true, maxRedemptions: 3 }, 1)).toBe(2);
    expect(remainingRedemptions({ repeatable: false, maxRedemptions: null }, 1)).toBe(0);
  });
});

describe("calculateRewardPurchase", () => {
  it("pays with Active XP first, Level XP for the rest", () => {
    expect(calculateRewardPurchase(tea, rich, { strategy: "active_first" })).toMatchObject({
      canRedeem: true,
      activeXpToSpend: 500,
      levelXpToSpend: 0,
      purchaseValue: 500,
    });
    expect(
      calculateRewardPurchase(
        tea,
        { spendableActiveXp: 300, spendableLevelXp: 320 },
        {
          strategy: "active_first",
        },
      ),
    ).toMatchObject({ canRedeem: true, activeXpToSpend: 300, levelXpToSpend: 40 });
  });

  it("pays with Level XP first, Active XP for the rest", () => {
    expect(calculateRewardPurchase(tea, rich, { strategy: "level_first" })).toMatchObject({
      activeXpToSpend: 0,
      levelXpToSpend: 100,
    });
    expect(
      calculateRewardPurchase(
        tea,
        { spendableActiveXp: 650, spendableLevelXp: 40 },
        {
          strategy: "level_first",
        },
      ),
    ).toMatchObject({ canRedeem: true, activeXpToSpend: 300, levelXpToSpend: 40 });
  });

  it("accepts an exact custom mix: 300 Active + 40 Level = 500", () => {
    expect(
      calculateRewardPurchase(tea, rich, { strategy: "custom", activeXp: 300, levelXp: 40 }),
    ).toMatchObject({ canRedeem: true, purchaseValue: 500, remainingPurchaseValue: 0 });
  });

  it("rejects not enough value, overpaying and missing balances", () => {
    expect(
      calculateRewardPurchase(tea, rich, { strategy: "custom", activeXp: 300, levelXp: 39 }),
    ).toMatchObject({ canRedeem: false, problem: "not_enough_value", remainingPurchaseValue: 5 });
    expect(
      calculateRewardPurchase(tea, rich, { strategy: "custom", activeXp: 300, levelXp: 41 }),
    ).toMatchObject({ canRedeem: false, problem: "overpay" });
    expect(
      calculateRewardPurchase(tea, rich, { strategy: "custom", activeXp: 700, levelXp: 0 }),
    ).toMatchObject({ canRedeem: false, problem: "overpay" });
    expect(
      calculateRewardPurchase(tea, rich, { strategy: "custom", activeXp: 0, levelXp: 100 }),
    ).toMatchObject({ canRedeem: true });
    expect(
      calculateRewardPurchase(
        tea,
        { spendableActiveXp: 100, spendableLevelXp: 50 },
        { strategy: "active_first" },
      ),
    ).toMatchObject({ canRedeem: false, problem: "insufficient_level" });
    expect(
      calculateRewardPurchase(
        tea,
        { spendableActiveXp: 100, spendableLevelXp: 10 },
        { strategy: "custom", activeXp: 450, levelXp: 10 },
      ),
    ).toMatchObject({ canRedeem: false, problem: "insufficient_active" });
  });

  it("respects the currencies a reward accepts", () => {
    const activeOnly = { ...tea, payWithLevel: false };
    expect(calculateRewardPurchase(activeOnly, rich, { strategy: "level_first" })).toMatchObject({
      canRedeem: true,
      activeXpToSpend: 500,
      levelXpToSpend: 0,
    });
    expect(
      calculateRewardPurchase(activeOnly, rich, { strategy: "custom", activeXp: 0, levelXp: 100 }),
    ).toMatchObject({ canRedeem: false, problem: "currency_not_accepted" });
  });
});

describe("level rewards", () => {
  it("allows early claims up to the end of the next level's stage", () => {
    expect(maxEarlyClaimLevel(17)).toBe(20);
    expect(maxEarlyClaimLevel(20)).toBe(30);
    expect(maxEarlyClaimLevel(4)).toBe(5);
    expect(maxEarlyClaimLevel(5)).toBe(10);
    expect(maxEarlyClaimLevel(61)).toBe(71);
  });

  it("finds the first level from which a reward can be claimed early", () => {
    expect(firstEarlyClaimLevel(30)).toBe(20);
    expect(firstEarlyClaimLevel(20)).toBe(10);
    expect(firstEarlyClaimLevel(5)).toBe(2);
    for (const level of [5, 10, 20, 30, 45]) {
      const first = firstEarlyClaimLevel(level);
      expect(maxEarlyClaimLevel(first)).toBeGreaterThanOrEqual(level);
      if (first > 2) expect(maxEarlyClaimLevel(first - 1)).toBeLessThan(level);
    }
  });

  it("derives the state of a level reward", () => {
    expect(levelRewardState(10, 12, false)).toBe("claimable");
    expect(levelRewardState(10, 10, false)).toBe("claimable");
    expect(levelRewardState(10, 12, true)).toBe("claimed");
    expect(levelRewardState(20, 17, false)).toBe("early");
    expect(levelRewardState(30, 17, false)).toBe("locked");
  });

  it("prices an early claim at the Level XP still missing", () => {
    const at17 = xpForLevel(17) + 40;
    expect(earlyClaimCost(at17, 20)).toBe(xpForLevel(20) - at17);
    expect(earlyClaimCost(xpForLevel(20) + 5, 20)).toBe(0);
  });
});
