import { describe, expect, it } from "vitest";

import {
  createProjectInput,
  progressRatio,
  updateMilestoneInput,
  validateProjectDates,
} from "./index";

describe("project domain", () => {
  it("computes the completion ratio, or null when there is nothing to count", () => {
    expect(progressRatio({ total: 4, completed: 1, overdue: 0 })).toBe(0.25);
    expect(progressRatio({ total: 0, completed: 0, overdue: 0 })).toBeNull();
  });

  it("validates date order", () => {
    expect(validateProjectDates({ startDate: "2026-11-02", targetDate: "2026-11-01" })).toBe(
      "project.start_after_target",
    );
    expect(validateProjectDates({ startDate: "2026-11-01", targetDate: "2026-11-01" })).toBeNull();
    expect(validateProjectDates({ startDate: null, targetDate: "2026-11-01" })).toBeNull();
  });

  it("validates inputs", () => {
    expect(createProjectInput.safeParse({ name: "  " }).success).toBe(false);
    expect(createProjectInput.safeParse({ name: "x", status: "archived" }).success).toBe(false);
    expect(createProjectInput.safeParse({ name: "x", color: "violet", priority: 4 }).success).toBe(
      true,
    );
    expect(
      updateMilestoneInput.safeParse({
        id: "0190f2a4-4b3c-7d2e-8f00-000000000001",
        patch: { dueDate: null },
      }).success,
    ).toBe(true);
  });
});
