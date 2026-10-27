import { describe, expect, it } from "vitest";

import { splitByWeight } from "./attributes";
import {
  calculateLevelXpFromGrowth,
  historicLevelXp,
  LEVEL_XP_PER_GROWTH_XP,
  REWARD_XP_RATES,
} from "./economy";
import {
  fractionalLevel,
  getLevelFromLevelXp,
  getLevelProgress,
  getXpRequiredForNextLevel,
  getXpToNextLevel,
  xpForLevel,
} from "./levels";
import { getNextStage, getStage, getStageProgress } from "./stages";
import { TASK_XP, xpEventTypes, xpRules } from "./rules";

describe("level curve", () => {
  it("raises the cost of each level by 8%", () => {
    expect([1, 2, 3, 4, 5].map(getXpRequiredForNextLevel)).toEqual([100, 108, 117, 126, 136]);
    expect([1, 2, 3, 4, 5, 6].map((level) => xpForLevel(level))).toEqual([
      0, 100, 208, 325, 451, 587,
    ]);
  });

  it("derives the level at exact boundaries", () => {
    for (const level of [2, 5, 10, 20, 30, 60, 61]) {
      expect(getLevelFromLevelXp(xpForLevel(level))).toBe(level);
      expect(getLevelFromLevelXp(xpForLevel(level) - 1)).toBe(level - 1);
    }
    expect(getLevelFromLevelXp(0)).toBe(1);
    expect(getLevelFromLevelXp(-50)).toBe(1);
  });

  it("reports progress and XP to the next level", () => {
    expect(getLevelProgress(150)).toMatchObject({
      level: 2,
      xp: 150,
      xpIntoLevel: 50,
      xpForNext: 108,
    });
    expect(getXpToNextLevel(150)).toBe(58);
    expect(getLevelProgress(0)).toMatchObject({ level: 1, ratio: 0 });
    expect(fractionalLevel(150)).toBeCloseTo(2 + 50 / 108);
  });
});

describe("growth stages", () => {
  it.each([
    [1, "starter"],
    [5, "starter"],
    [6, "explorer"],
    [10, "explorer"],
    [11, "practitioner"],
    [20, "practitioner"],
    [21, "refiner"],
    [30, "refiner"],
    [31, "shaper"],
    [41, "outstanding"],
    [51, "master"],
    [60, "master"],
    [61, "legend"],
    [200, "legend"],
  ])("level %i is %s", (level, key) => {
    expect(getStage(level).key).toBe(key);
  });

  it("knows the next stage and the XP to reach it", () => {
    const at17 = getStageProgress(xpForLevel(17));
    expect(at17.stage.key).toBe("practitioner");
    expect(at17.nextStage?.key).toBe("refiner");
    expect(at17.xpToNextStage).toBe(xpForLevel(21) - xpForLevel(17));
    expect(getNextStage(61)).toBeNull();
    expect(getStageProgress(xpForLevel(61)).xpToNextStage).toBeNull();
  });
});

describe("xp economy", () => {
  it("turns growth into Level XP for current attributes only", () => {
    expect(calculateLevelXpFromGrowth(20, { systemKey: "french" })).toBe(
      20 * LEVEL_XP_PER_GROWTH_XP,
    );
    expect(calculateLevelXpFromGrowth(20, { systemKey: null })).toBe(20);
    expect(calculateLevelXpFromGrowth(20, { systemKey: "legacy.work" })).toBe(0);
    expect(historicLevelXp(15, { systemKey: "reading" })).toBe(15);
    expect(historicLevelXp(15, { systemKey: "legacy.learning" })).toBe(0);
  });

  it("prices Level XP at five times Active XP", () => {
    expect(REWARD_XP_RATES).toEqual({ active: 1, level: 5 });
  });
});

describe("xp rules", () => {
  const rule = (key: string) => xpRules.find((r) => r.key === key)!;
  const task = {
    taskId: "t",
    title: "写报告",
    parentTaskId: null,
    contributions: [{ attributeId: "fr", weight: 3 }],
    areaId: "a",
    priority: 2,
    isUrgent: null,
    isImportant: true,
    estimatedMinutes: null,
    completedAt: new Date(),
  };

  it("scores tasks by priority and importance, subtasks flat", () => {
    expect(rule("task.completion").grant(task)).toMatchObject({
      sourceType: "task",
      sourceId: "t",
      amount: TASK_XP.base + 2 * TASK_XP.perPriority + TASK_XP.important,
      contributions: [{ attributeId: "fr", weight: 3 }],
      title: "写报告",
    });
    expect(rule("task.completion").grant({ ...task, parentTaskId: "p" }).amount).toBe(
      TASK_XP.subtask,
    );
  });

  it("pairs every grant event with its reversal event", () => {
    expect(xpRules.map((r) => [r.grantOn, r.reverseOn])).toEqual([
      ["task.completed", "task.reopened"],
      ["project.completed", "project.reopened"],
      ["milestone.completed", "milestone.reopened"],
    ]);
    expect(xpEventTypes).toHaveLength(6);
  });
});

describe("splitByWeight", () => {
  const c = (attributeId: string, weight: number) => ({ attributeId, weight });

  it("splits in proportion and always adds up to the total", () => {
    expect(splitByWeight(20, [c("fr", 3), c("read", 2)])).toEqual([
      { attributeId: "fr", amount: 12 },
      { attributeId: "read", amount: 8 },
    ]);
    expect(splitByWeight(10, [c("a", 1), c("b", 1), c("c", 1)]).map((p) => p.amount)).toEqual([
      4, 3, 3,
    ]);
    for (const total of [5, 7, 13, 30, 145]) {
      const parts = splitByWeight(total, [c("a", 3), c("b", 2), c("c", 1)]);
      expect(parts.reduce((sum, p) => sum + p.amount, 0)).toBe(total);
    }
  });

  it("gives the whole amount to a single contribution and nothing without any", () => {
    expect(splitByWeight(15, [c("a", 1)])).toEqual([{ attributeId: "a", amount: 15 }]);
    expect(splitByWeight(15, [])).toEqual([]);
    expect(splitByWeight(0, [c("a", 2)])).toEqual([]);
  });

  it("drops parts that round to zero", () => {
    expect(splitByWeight(1, [c("a", 1), c("b", 1)])).toEqual([{ attributeId: "a", amount: 1 }]);
  });
});
