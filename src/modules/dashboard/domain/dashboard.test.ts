import { describe, expect, it } from "vitest";

import { xpForLevel } from "@/modules/character/domain";
import type { LevelReward, LevelRewardState } from "@/modules/rewards/domain";

import {
  buildTrend,
  daysBetween,
  growthFocus,
  nextLevelReward,
  periodStart,
  rankGrowth,
  trendBucket,
  weekStart,
} from "./index";

describe("periods", () => {
  it("starts a period so that it ends today, inclusive", () => {
    expect(periodStart("7d", "2026-10-27")).toBe("2026-10-21");
    expect(periodStart("30d", "2026-10-27")).toBe("2026-09-28");
    expect(periodStart("90d", "2026-03-01")).toBe("2025-12-02");
    expect(periodStart("all", "2026-10-27")).toBeNull();
  });

  it("finds the first day of the week for any week start", () => {
    // 2026-10-27 is a Tuesday.
    expect(weekStart("2026-10-27", 1)).toBe("2026-10-26");
    expect(weekStart("2026-10-27", 0)).toBe("2026-10-25");
    expect(weekStart("2026-10-27", 2)).toBe("2026-10-27");
    expect(weekStart("2026-10-27", 3)).toBe("2026-10-21");
    // Across a month and year boundary.
    expect(weekStart("2026-01-01", 1)).toBe("2025-12-29");
  });

  it("counts days between local dates across DST-free UTC arithmetic", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-27", "2026-10-27")).toBe(0);
  });
});

describe("growth trend", () => {
  it("fills every day of the period, including days without XP", () => {
    const { bucket, points } = buildTrend(
      [
        { date: "2026-10-22", activeXp: 30, growthXp: 20, levelXp: 20 },
        { date: "2026-10-25", activeXp: 10, growthXp: 0, levelXp: 0 },
        { date: "2026-10-10", activeXp: 99, growthXp: 99, levelXp: 99 }, // outside: ignored
      ],
      "2026-10-21",
      "2026-10-27",
    );
    expect(bucket).toBe("day");
    expect(points.map((p) => p.start)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(points.map((p) => p.growthXp)).toEqual([0, 20, 0, 0, 0, 0, 0]);
    expect(points.reduce((sum, p) => sum + p.activeXp, 0)).toBe(40);
  });

  it("switches to weeks and months for long spans without losing XP", () => {
    expect(trendBucket(92)).toBe("day");
    expect(trendBucket(93)).toBe("week");
    expect(trendBucket(800)).toBe("month");

    const days = [
      { date: "2026-01-01", activeXp: 10, growthXp: 10, levelXp: 10 },
      { date: "2026-01-07", activeXp: 10, growthXp: 5, levelXp: 5 },
      { date: "2026-01-08", activeXp: 10, growthXp: 1, levelXp: 1 },
      { date: "2026-06-30", activeXp: 10, growthXp: 2, levelXp: 2 },
    ];
    const weekly = buildTrend(days, "2026-01-01", "2026-06-30");
    expect(weekly.bucket).toBe("week");
    expect(weekly.points[0]).toMatchObject({ start: "2026-01-01", growthXp: 15 });
    expect(weekly.points[1]).toMatchObject({ start: "2026-01-08", growthXp: 1 });
    expect(weekly.points.reduce((sum, p) => sum + p.growthXp, 0)).toBe(18);

    const monthly = buildTrend(days, "2023-01-01", "2026-06-30");
    expect(monthly.bucket).toBe("month");
    expect(monthly.points[0]!.start).toBe("2023-01-01");
    expect(monthly.points.find((p) => p.start === "2026-01-01")!.growthXp).toBe(16);
    expect(monthly.points.reduce((sum, p) => sum + p.activeXp, 0)).toBe(40);
  });

  it("nets reversals: a day can be negative", () => {
    const { points } = buildTrend(
      [{ date: "2026-10-27", activeXp: -10, growthXp: -10, levelXp: -10 }],
      "2026-10-27",
      "2026-10-27",
    );
    expect(points).toEqual([{ start: "2026-10-27", activeXp: -10, growthXp: -10, levelXp: -10 }]);
  });
});

const attrs = [{ id: "fr" }, { id: "en" }, { id: "read" }, { id: "run" }];

describe("growth ranking", () => {
  it("ranks active attributes that grew, most first, ties in the user's order", () => {
    const ranking = rankGrowth(
      [
        { attributeId: "read", growthXp: 41 },
        { attributeId: "run", growthXp: 65 },
        { attributeId: "fr", growthXp: 41 },
        { attributeId: "archived", growthXp: 500 },
        { attributeId: "en", growthXp: 0 },
      ],
      attrs,
    );
    expect(ranking).toEqual([
      { attributeId: "run", growthXp: 65 },
      { attributeId: "fr", growthXp: 41 },
      { attributeId: "read", growthXp: 41 },
    ]);
  });

  it("limits the list and drops net-negative growth", () => {
    const ranking = rankGrowth(
      [
        { attributeId: "fr", growthXp: 3 },
        { attributeId: "en", growthXp: 2 },
        { attributeId: "read", growthXp: -5 },
      ],
      attrs,
      1,
    );
    expect(ranking).toEqual([{ attributeId: "fr", growthXp: 3 }]);
  });
});

describe("growth focus", () => {
  it("names the fastest and the least-grown attribute (zero included)", () => {
    expect(
      growthFocus(
        [
          { attributeId: "fr", growthXp: 82 },
          { attributeId: "en", growthXp: 12 },
          { attributeId: "read", growthXp: 41 },
        ],
        attrs,
      ),
    ).toEqual({
      fastest: { attributeId: "fr", growthXp: 82 },
      slowest: { attributeId: "run", growthXp: 0 },
    });
  });

  it("shows nothing when nothing grew, and no 'least' with a single attribute", () => {
    expect(growthFocus([], attrs)).toEqual({ fastest: null, slowest: null });
    expect(growthFocus([{ attributeId: "fr", growthXp: 5 }], [{ id: "fr" }])).toEqual({
      fastest: { attributeId: "fr", growthXp: 5 },
      slowest: null,
    });
    expect(growthFocus([], [])).toEqual({ fastest: null, slowest: null });
  });

  it("breaks ties by the user's order", () => {
    const focus = growthFocus(
      [
        { attributeId: "en", growthXp: 10 },
        { attributeId: "read", growthXp: 10 },
      ],
      attrs,
    );
    expect(focus.fastest?.attributeId).toBe("en");
    expect(focus.slowest?.attributeId).toBe("fr");
  });
});

function levelReward(level: number, state: LevelRewardState): LevelReward {
  return {
    id: `r${level}`,
    level,
    systemKey: null,
    name: `Lv ${level}`,
    emoji: null,
    description: null,
    realWorldCostCents: null,
    claim: state === "claimed" ? { early: false, levelXpSpent: 0, createdAt: new Date() } : null,
    state,
    earlyClaimCost: null,
  };
}

describe("next level reward", () => {
  it("prefers a reward that can be claimed now", () => {
    const next = nextLevelReward(
      [levelReward(20, "early"), levelReward(10, "claimable"), levelReward(5, "claimed")],
      xpForLevel(12),
    );
    expect(next?.reward.level).toBe(10);
    expect(next?.missingLevelXp).toBe(0);
    expect(next?.ratio).toBe(1);
  });

  it("otherwise shows the nearest unclaimed one with the Level XP still missing", () => {
    const lifetime = xpForLevel(17) + 267;
    const next = nextLevelReward(
      [levelReward(30, "locked"), levelReward(20, "early"), levelReward(10, "claimed")],
      lifetime,
    );
    expect(next?.reward.level).toBe(20);
    expect(next?.requiredLevelXp).toBe(xpForLevel(20));
    expect(next?.missingLevelXp).toBe(xpForLevel(20) - lifetime);
    expect(next?.ratio).toBeCloseTo(lifetime / xpForLevel(20));
  });

  it("is null when everything is claimed or nothing is set up", () => {
    expect(nextLevelReward([levelReward(5, "claimed")], 9999)).toBeNull();
    expect(nextLevelReward([], 0)).toBeNull();
  });
});
