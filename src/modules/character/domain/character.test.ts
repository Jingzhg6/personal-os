import { describe, expect, it } from "vitest";

import { splitByWeight } from "./attributes";
import { ATTRIBUTE_LEVEL_STEP, fractionalLevel, levelProgress, xpForLevel } from "./levels";
import { TASK_XP, xpEventTypes, xpRules } from "./rules";

describe("levels", () => {
  it("derives the level from total XP on one curve", () => {
    expect([1, 2, 3, 4].map((level) => xpForLevel(level))).toEqual([0, 100, 300, 600]);
    expect(levelProgress(0)).toMatchObject({ level: 1, xpIntoLevel: 0, xpForNext: 100, ratio: 0 });
    expect(levelProgress(99).level).toBe(1);
    expect(levelProgress(100)).toMatchObject({ level: 2, xpIntoLevel: 0, xpForNext: 200 });
    expect(levelProgress(450)).toMatchObject({ level: 3, xpIntoLevel: 150, xpForNext: 300 });
    expect(levelProgress(-20)).toMatchObject({ level: 1, xp: 0 });
  });

  it("uses a smaller step for attributes", () => {
    expect(levelProgress(50, ATTRIBUTE_LEVEL_STEP).level).toBe(2);
    expect(fractionalLevel(75)).toBeCloseTo(2.25);
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
