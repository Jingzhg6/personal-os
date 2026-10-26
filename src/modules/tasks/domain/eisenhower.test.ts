import { describe, expect, it } from "vitest";

import { flagsForPlacement, matrixPlacement, matrixPlacements } from "./eisenhower";

describe("Eisenhower placement", () => {
  it("maps the urgent / important flags to quadrants", () => {
    expect(matrixPlacement({ isUrgent: true, isImportant: true })).toBe("do");
    expect(matrixPlacement({ isUrgent: false, isImportant: true })).toBe("schedule");
    expect(matrixPlacement({ isUrgent: true, isImportant: false })).toBe("delegate");
    expect(matrixPlacement({ isUrgent: false, isImportant: false })).toBe("eliminate");
  });

  it("keeps tasks unsorted until both flags are decided", () => {
    expect(matrixPlacement({ isUrgent: null, isImportant: null })).toBe("unsorted");
    expect(matrixPlacement({ isUrgent: true, isImportant: null })).toBe("unsorted");
    expect(matrixPlacement({ isUrgent: null, isImportant: false })).toBe("unsorted");
  });

  it("round-trips every placement through its flags", () => {
    for (const placement of matrixPlacements) {
      expect(matrixPlacement(flagsForPlacement(placement))).toBe(placement);
    }
  });
});
