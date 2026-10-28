import { describe, expect, it } from "vitest";

import { hasScheduleConflict, scheduleSpan, wouldCreateCycle } from "./dependencies";
import { daysBetween, editSchedule, startOfWeek, timelineWindow } from "./timeline";

describe("dependencies", () => {
  const edges = [
    { blockingTaskId: "a", blockedTaskId: "b" },
    { blockingTaskId: "b", blockedTaskId: "c" },
  ];

  it("detects cycles through the graph", () => {
    expect(wouldCreateCycle(edges, { blockingTaskId: "c", blockedTaskId: "a" })).toBe(true);
    expect(wouldCreateCycle(edges, { blockingTaskId: "b", blockedTaskId: "a" })).toBe(true);
    expect(wouldCreateCycle(edges, { blockingTaskId: "a", blockedTaskId: "a" })).toBe(true);
    expect(wouldCreateCycle(edges, { blockingTaskId: "a", blockedTaskId: "c" })).toBe(false);
    expect(wouldCreateCycle(edges, { blockingTaskId: "d", blockedTaskId: "a" })).toBe(false);
  });

  it("derives a span from one or two dates", () => {
    expect(scheduleSpan({ startDate: null, dueDate: null })).toBeNull();
    expect(scheduleSpan({ startDate: null, dueDate: "2026-11-03" })).toEqual({
      start: "2026-11-03",
      end: "2026-11-03",
    });
    expect(scheduleSpan({ startDate: "2026-11-01", dueDate: "2026-11-03" })).toEqual({
      start: "2026-11-01",
      end: "2026-11-03",
    });
  });

  it("flags a blocked task starting before its blocker is due", () => {
    const blocker = { startDate: "2026-11-01", dueDate: "2026-11-05" };
    expect(hasScheduleConflict(blocker, { startDate: "2026-11-04", dueDate: null })).toBe(true);
    expect(hasScheduleConflict(blocker, { startDate: "2026-11-05", dueDate: null })).toBe(false);
    expect(hasScheduleConflict(blocker, { startDate: null, dueDate: null })).toBe(false);
  });
});

describe("timeline", () => {
  it("counts days and finds Mondays", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19"); // Sunday → previous Monday
    expect(startOfWeek("2026-10-26")).toBe("2026-10-26");
  });

  it("starts weeks on the user's first weekday", () => {
    // 2026-10-28 is a Wednesday.
    expect(startOfWeek("2026-10-28", 0)).toBe("2026-10-25"); // Sunday
    expect(startOfWeek("2026-10-25", 0)).toBe("2026-10-25");
    expect(startOfWeek("2026-10-28", 6)).toBe("2026-10-24"); // Saturday
    expect(startOfWeek("2026-01-01", 1)).toBe("2025-12-29"); // across the year
    const window = timelineWindow([], "2026-10-28", 42, 0);
    expect(new Date(`${window.start}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  it("pads the window around the spans and today", () => {
    const window = timelineWindow([{ start: "2026-11-10", end: "2026-12-20" }], "2026-10-25");
    expect(window.start).toBe("2026-10-12");
    expect(window.end >= "2026-12-27").toBe(true);
    expect(window.days).toBe(daysBetween(window.start, window.end) + 1);
    expect(timelineWindow([], "2026-10-25").days).toBe(42);
  });

  it("moves and resizes bars", () => {
    const both = { startDate: "2026-11-01", dueDate: "2026-11-04" };
    expect(editSchedule(both, "move", 2)).toEqual({
      startDate: "2026-11-03",
      dueDate: "2026-11-06",
    });
    expect(editSchedule(both, "end", -1)).toEqual({
      startDate: "2026-11-01",
      dueDate: "2026-11-03",
    });
    expect(editSchedule(both, "start", 4)).toBeNull();
    expect(editSchedule(both, "move", 0)).toBeNull();

    const dueOnly = { startDate: null, dueDate: "2026-11-04" };
    expect(editSchedule(dueOnly, "move", 1)).toEqual({ startDate: null, dueDate: "2026-11-05" });
    expect(editSchedule(dueOnly, "start", -2)).toEqual({
      startDate: "2026-11-02",
      dueDate: "2026-11-04",
    });
    expect(editSchedule({ startDate: null, dueDate: null }, "move", 1)).toBeNull();
  });
});
