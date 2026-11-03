import { describe, expect, it } from "vitest";

import {
  conflictingBlockIds,
  layoutColumns,
  layoutSegments,
  startOfWeek,
  stepAnchor,
  viewDates,
} from ".";

const at = (s: string) => new Date(s);

describe("schedule layout", () => {
  it("finds overlapping timed blocks, ignoring all-day plans and touching ends", () => {
    const blocks = [
      { id: "a", startAt: at("2026-11-03T09:00Z"), endAt: at("2026-11-03T10:00Z"), allDay: false },
      { id: "b", startAt: at("2026-11-03T09:30Z"), endAt: at("2026-11-03T11:00Z"), allDay: false },
      { id: "c", startAt: at("2026-11-03T11:00Z"), endAt: at("2026-11-03T12:00Z"), allDay: false },
      { id: "d", startAt: at("2026-11-03T00:00Z"), endAt: at("2026-11-04T00:00Z"), allDay: true },
    ];
    expect([...conflictingBlockIds(blocks)].sort()).toEqual(["a", "b"]);
  });

  it("builds day, week and month ranges from the week start", () => {
    expect(startOfWeek("2026-11-03", 1)).toBe("2026-11-02");
    expect(startOfWeek("2026-11-03", 0)).toBe("2026-11-01");
    expect(viewDates("week", "2026-11-03", 1)).toHaveLength(7);
    const month = viewDates("month", "2026-11-03", 1);
    expect(month[0]).toBe("2026-10-26");
    expect(month.length % 7).toBe(0);
    expect(month).toContain("2026-11-30");
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
  });

  it("puts overlapping multi-day bars in separate lanes and clips them to the row", () => {
    const days = viewDates("week", "2026-11-03", 1); // Mon 2 … Sun 8
    const segments = layoutSegments(
      [
        { item: "long", first: "2026-10-30", last: "2026-11-04" },
        { item: "mid", first: "2026-11-04", last: "2026-11-05" },
        { item: "late", first: "2026-11-06", last: "2026-11-06" },
      ],
      days,
    );
    expect(segments.map((s) => [s.item, s.start, s.end, s.lane, s.clippedStart])).toEqual([
      ["long", 0, 2, 0, true],
      ["mid", 2, 3, 1, false],
      ["late", 4, 4, 0, false],
    ]);
  });

  it("puts overlapping timed blocks side by side", () => {
    const placed = layoutColumns([
      { item: "a", start: 540, end: 600 },
      { item: "b", start: 570, end: 660 },
      { item: "c", start: 700, end: 760 },
    ]);
    expect(placed.map((p) => [p.item, p.column, p.columns])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });
});
