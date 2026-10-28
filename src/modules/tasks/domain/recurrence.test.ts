import { describe, expect, it } from "vitest";

import {
  parseStoredRule,
  planNext,
  recurrenceRule,
  serializeRule,
  upcomingDates,
  type RecurrenceRuleInput,
} from "./recurrence";

const rule = (input: RecurrenceRuleInput) => recurrenceRule.parse(input);
const daily = rule({ frequency: "daily", interval: 1 });
const base = {
  mode: "fixed" as const,
  dtstart: "2026-10-28",
  sourceDue: "2026-10-28",
  sourceIndex: 1,
  closedOn: "2026-10-28",
  today: "2026-10-28",
};

describe("recurrence rules", () => {
  it("validate their parts", () => {
    expect(recurrenceRule.safeParse({ frequency: "daily", interval: 0 }).success).toBe(false);
    expect(
      recurrenceRule.safeParse({ frequency: "daily", interval: 1, weekdays: [1] }).success,
    ).toBe(false);
    expect(
      recurrenceRule.safeParse({ frequency: "weekly", interval: 1, monthDay: 3 }).success,
    ).toBe(false);
    expect(
      recurrenceRule.safeParse({ frequency: "weekly", interval: 1, weekdays: [1, 1] }).success,
    ).toBe(false);
    expect(
      recurrenceRule.safeParse({
        frequency: "monthly",
        interval: 1,
        monthDay: -1,
        end: { type: "count", count: 1001 },
      }).success,
    ).toBe(false);
  });

  it("round-trip through the stored RRULE text", () => {
    const cases: RecurrenceRuleInput[] = [
      { frequency: "daily", interval: 2 },
      { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] },
      { frequency: "monthly", interval: 1, monthDay: -1, end: { type: "count", count: 6 } },
      { frequency: "yearly", interval: 1, end: { type: "until", date: "2030-12-31" } },
    ];
    for (const input of cases) {
      const text = serializeRule(rule(input), "2026-10-28");
      expect(text).toContain("DTSTART;VALUE=DATE:20261028");
      expect(parseStoredRule(text)).toEqual({ rule: rule(input), dtstart: "2026-10-28" });
    }
    expect(parseStoredRule("RRULE:FREQ=SECONDLY")).toBeNull();
    expect(parseStoredRule("garbage")).toBeNull();
  });
});

describe("the next instance", () => {
  it("follows a fixed schedule", () => {
    expect(planNext({ ...base, rule: daily })).toEqual({ dueDate: "2026-10-29" });
    const mwf = rule({ frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });
    // Wed 2026-10-28 → Fri 10-30 → Mon 11-02.
    expect(planNext({ ...base, rule: mwf })).toEqual({ dueDate: "2026-10-30" });
    expect(planNext({ ...base, rule: mwf, sourceDue: "2026-10-30", today: "2026-10-30" })).toEqual({
      dueDate: "2026-11-02",
    });
    // Weekly without weekdays keeps the first due date's weekday, every second week.
    const biweekly = rule({ frequency: "weekly", interval: 2 });
    expect(planNext({ ...base, rule: biweekly })).toEqual({ dueDate: "2026-11-11" });
  });

  it("does not depend on when the instance was completed (fixed)", () => {
    expect(planNext({ ...base, rule: daily, closedOn: "2026-10-26", today: "2026-10-26" })).toEqual(
      { dueDate: "2026-10-29" },
    );
  });

  it("skips occurrences already in the past instead of creating a backlog", () => {
    // Due 10-28, completed a week late: the next instance is today, not 10-29.
    expect(planNext({ ...base, rule: daily, closedOn: "2026-11-04", today: "2026-11-04" })).toEqual(
      { dueDate: "2026-11-04" },
    );
    const mondays = rule({ frequency: "weekly", interval: 1, weekdays: [1] });
    expect(
      planNext({
        ...base,
        rule: mondays,
        dtstart: "2026-10-26",
        sourceDue: "2026-10-26",
        today: "2026-11-11",
      }),
    ).toEqual({ dueDate: "2026-11-16" });
  });

  it("counts from the day it was closed (after completion)", () => {
    const every3 = rule({ frequency: "daily", interval: 3 });
    expect(
      planNext({ ...base, rule: every3, mode: "after_completion", closedOn: "2026-10-30" }),
    ).toEqual({ dueDate: "2026-11-02" });
    // Completed early: still counted from the completion day.
    expect(
      planNext({ ...base, rule: every3, mode: "after_completion", closedOn: "2026-10-20" }),
    ).toEqual({ dueDate: "2026-10-23" });
  });

  it("anchors a weekly rule without weekdays on the closing day (after completion)", () => {
    const weekly = rule({ frequency: "weekly", interval: 1 });
    // Due Fri 10-30, completed Wed 10-28 → a week after completion, not the next Friday.
    expect(
      planNext({
        ...base,
        rule: weekly,
        mode: "after_completion",
        sourceDue: "2026-10-30",
        closedOn: "2026-10-28",
      }),
    ).toEqual({ dueDate: "2026-11-04" });
  });

  it("handles month ends and leap years", () => {
    const last = rule({ frequency: "monthly", interval: 1, monthDay: -1 });
    expect(
      planNext({
        ...base,
        rule: last,
        dtstart: "2027-01-31",
        sourceDue: "2027-01-31",
        today: "2027-01-31",
      }),
    ).toEqual({
      dueDate: "2027-02-28",
    });
    expect(
      planNext({
        ...base,
        rule: last,
        dtstart: "2028-01-31",
        sourceDue: "2028-01-31",
        today: "2028-01-31",
      }),
    ).toEqual({
      dueDate: "2028-02-29",
    });
    // Day 31 skips months without one (RFC 5545).
    const d31 = rule({ frequency: "monthly", interval: 1, monthDay: 31 });
    expect(
      planNext({
        ...base,
        rule: d31,
        dtstart: "2027-01-31",
        sourceDue: "2027-01-31",
        today: "2027-01-31",
      }),
    ).toEqual({
      dueDate: "2027-03-31",
    });
    // Year boundary.
    expect(
      planNext({
        ...base,
        rule: daily,
        dtstart: "2026-12-31",
        sourceDue: "2026-12-31",
        today: "2026-12-31",
      }),
    ).toEqual({
      dueDate: "2027-01-01",
    });
  });

  it("ends after the UNTIL date or COUNT instances", () => {
    const until = rule({
      frequency: "daily",
      interval: 1,
      end: { type: "until", date: "2026-10-29" },
    });
    expect(planNext({ ...base, rule: until })).toEqual({ dueDate: "2026-10-29" });
    expect(
      planNext({ ...base, rule: until, sourceDue: "2026-10-29", today: "2026-10-29" }),
    ).toEqual({
      end: "until",
    });
    const three = rule({ frequency: "daily", interval: 1, end: { type: "count", count: 3 } });
    expect(planNext({ ...base, rule: three, sourceIndex: 2 })).toEqual({ dueDate: "2026-10-29" });
    expect(planNext({ ...base, rule: three, sourceIndex: 3 })).toEqual({ end: "count" });
  });

  it("previews the next dates of a fixed schedule", () => {
    const mwf = rule({ frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });
    expect(upcomingDates(mwf, "2026-10-28", "2026-10-28", 3)).toEqual([
      "2026-10-30",
      "2026-11-02",
      "2026-11-04",
    ]);
  });
});
