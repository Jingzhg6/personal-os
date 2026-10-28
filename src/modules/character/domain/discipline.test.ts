import { describe, expect, it } from "vitest";

import {
  adjustmentFor,
  attributeScore,
  deadlineOf,
  DISCIPLINE_POINTS,
  disciplineOutcome,
  isGrowthTarget,
  reasonFor,
  type DisciplineTask,
} from "./index";

const UTC = "UTC";
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);

/** A task planned two days before its deadline (2026-10-28, end of day UTC). */
const planned = (patch: Partial<DisciplineTask> = {}): DisciplineTask => ({
  category: "unstarted",
  dueDate: "2026-10-28",
  dueTime: null,
  plannedAt: at("2026-10-26T09:00:00Z"),
  completedAt: null,
  failedAt: null,
  ...patch,
});
const outcome = (task: DisciplineTask, now: string, missed = false, timeZone = UTC) =>
  disciplineOutcome(task, { now: ms(now), timeZone, missed });

describe("自制力 rules", () => {
  it("has the fixed scoring table", () => {
    expect(DISCIPLINE_POINTS).toEqual({
      none: 0,
      early: 15,
      on_time: 10,
      late: 3,
      overdue: -3,
      failed: -5,
      cancelled: 0,
    });
  });

  it("scores completion early, on time and late against the deadline", () => {
    const done = (iso: string) => planned({ category: "completed", completedAt: at(iso) });
    expect(outcome(done("2026-10-27T20:00:00Z"), "2026-10-27T20:00:00Z")).toBe("early");
    expect(outcome(done("2026-10-28T00:00:00Z"), "2026-10-28T00:00:00Z")).toBe("on_time");
    expect(outcome(done("2026-10-28T23:59:59Z"), "2026-10-28T23:59:59Z")).toBe("on_time");
    expect(outcome(done("2026-10-29T00:00:01Z"), "2026-10-29T00:00:01Z")).toBe("late");
    // With a due time the deadline is that minute.
    const timed = planned({
      category: "completed",
      dueTime: "18:00",
      completedAt: at("2026-10-28T18:30:00Z"),
    });
    expect(outcome(timed, "2026-10-28T18:30:00Z")).toBe("late");
  });

  it("does not score tasks without planning information or done on the spot", () => {
    const noDeadline = planned({
      dueDate: null,
      category: "completed",
      completedAt: at("2026-10-27T10:00:00Z"),
    });
    expect(outcome(noDeadline, "2026-10-27T10:00:00Z")).toBe("none");
    // Created with a deadline and completed 10 minutes later: ad hoc.
    const adHoc = planned({
      category: "completed",
      plannedAt: at("2026-10-27T10:00:00Z"),
      completedAt: at("2026-10-27T10:10:00Z"),
    });
    expect(outcome(adHoc, "2026-10-27T10:10:00Z")).toBe("none");
    // A deadline set (in the past) after it had already passed is not planned.
    const backdated = planned({ plannedAt: at("2026-10-30T10:00:00Z") });
    expect(outcome(backdated, "2026-10-30T12:00:00Z")).toBe("none");
  });

  it("marks an open task overdue once its planned deadline has passed", () => {
    expect(outcome(planned(), "2026-10-28T23:59:00Z")).toBe("none");
    expect(outcome(planned(), "2026-10-29T00:00:00Z")).toBe("overdue");
    expect(outcome(planned({ category: "backlog" }), "2026-10-30T00:00:00Z")).toBe("overdue");
  });

  it("keeps a missed deadline missed: moving the date or reopening does not undo it", () => {
    const moved = planned({ dueDate: "2026-11-30" });
    expect(outcome(moved, "2026-10-30T00:00:00Z", true)).toBe("overdue");
    const doneEarly = planned({
      category: "completed",
      dueDate: "2026-11-30",
      completedAt: at("2026-10-30T00:00:00Z"),
    });
    expect(outcome(doneEarly, "2026-10-30T00:00:00Z", true)).toBe("late");
  });

  it("scores failure −5, cancellation 0 (never a failure penalty)", () => {
    const failed = planned({ category: "failed", failedAt: at("2026-10-29T10:00:00Z") });
    expect(outcome(failed, "2026-10-29T10:00:00Z")).toBe("failed");
    expect(
      outcome(
        planned({
          category: "failed",
          plannedAt: at("2026-10-29T09:30:00Z"),
          failedAt: at("2026-10-29T10:00:00Z"),
        }),
        "2026-10-29T10:00:00Z",
      ),
    ).toBe("none");
    expect(outcome(planned({ category: "cancelled" }), "2026-10-30T00:00:00Z", true)).toBe(
      "cancelled",
    );
  });

  it("adjusts the net to the target instead of stacking", () => {
    // Overdue (−3) then completed late: +6 → net +3.
    expect(adjustmentFor({ net: -3, outcome: "overdue" }, "late")).toEqual({ points: 6 });
    // Overdue then failed: −2 → net −5 (not −8).
    expect(adjustmentFor({ net: -3, outcome: "overdue" }, "failed")).toEqual({ points: -2 });
    // Completed again after reopening: back to +10 from 0, never +20.
    expect(adjustmentFor({ net: 0, outcome: "none" }, "on_time")).toEqual({ points: 10 });
    expect(adjustmentFor({ net: 10, outcome: "on_time" }, "on_time")).toBeNull();
    // Overdue then cancelled: +3 → net 0.
    expect(adjustmentFor({ net: -3, outcome: "overdue" }, "cancelled")).toEqual({ points: 3 });
    expect(reasonFor("none", "started")).toBe("reopened");
    expect(reasonFor("none", "completed")).toBe("not_eligible");
  });
});

describe("time zones and date boundaries", () => {
  it("puts the end of the due date at local midnight", () => {
    expect(
      new Date(
        deadlineOf({ dueDate: "2026-10-28", dueTime: null }, "Asia/Shanghai")!,
      ).toISOString(),
    ).toBe("2026-10-28T16:00:00.000Z");
    expect(
      new Date(
        deadlineOf({ dueDate: "2026-10-28", dueTime: null }, "America/Los_Angeles")!,
      ).toISOString(),
    ).toBe("2026-10-29T07:00:00.000Z");
    // 2026-03-29 in Paris: a due time inside the DST gap resolves forward (02:30 → 03:30 CEST).
    expect(
      new Date(
        deadlineOf({ dueDate: "2026-03-29", dueTime: "02:30" }, "Europe/Paris")!,
      ).toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
  });

  it("judges early and late by the local calendar", () => {
    const shanghai = "Asia/Shanghai";
    const task = planned({ category: "completed" });
    // 23:30 local on the due date → on time; 00:10 local the next day → late.
    expect(
      outcome(
        { ...task, completedAt: at("2026-10-28T15:30:00Z") },
        "2026-10-28T15:30:00Z",
        false,
        shanghai,
      ),
    ).toBe("on_time");
    expect(
      outcome(
        { ...task, completedAt: at("2026-10-28T16:10:00Z") },
        "2026-10-28T16:10:00Z",
        false,
        shanghai,
      ),
    ).toBe("late");
    // 23:30 local the day before → early.
    expect(
      outcome(
        { ...task, completedAt: at("2026-10-27T15:30:00Z") },
        "2026-10-27T15:30:00Z",
        false,
        shanghai,
      ),
    ).toBe("early");
  });
});

describe("the 自制力 attribute", () => {
  it("is not a Growth XP target and draws its level from its score, floored at 0", () => {
    expect(isGrowthTarget({ systemKey: "discipline" })).toBe(false);
    expect(isGrowthTarget({ systemKey: "french" })).toBe(true);
    expect(attributeScore({ systemKey: "discipline", xp: 0, points: -8 })).toBe(0);
    expect(attributeScore({ systemKey: "discipline", xp: 0, points: 25 })).toBe(25);
    expect(attributeScore({ systemKey: null, xp: 40, points: null })).toBe(40);
  });
});
