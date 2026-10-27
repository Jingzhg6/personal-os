import { describe, expect, it } from "vitest";

import {
  countedActions,
  createGoalInput,
  goalActionStats,
  goalStatusChange,
  MAX_FOCUS_ATTRIBUTES,
  setFocusInput,
  setTaskGoalsInput,
  updateVisionInput,
} from "./index";

const id = () => crypto.randomUUID();
const now = new Date("2026-10-27T10:00:00Z");
const earlier = new Date("2026-09-01T10:00:00Z");

describe("goal status changes", () => {
  it("stamps completion and archiving, and clears them otherwise", () => {
    const active = { status: "active" as const, completedAt: null };
    expect(goalStatusChange(active, "completed", now)).toEqual({
      status: "completed",
      completedAt: now,
      archivedAt: null,
    });
    expect(goalStatusChange(active, "paused", now)).toEqual({
      status: "paused",
      completedAt: null,
      archivedAt: null,
    });
    expect(goalStatusChange(active, "archived", now)).toEqual({
      status: "archived",
      completedAt: null,
      archivedAt: now,
    });
  });

  it("keeps the original completion date when re-completing or archiving a completed goal", () => {
    const completed = { status: "completed" as const, completedAt: earlier };
    expect(goalStatusChange(completed, "completed", now).completedAt).toBe(earlier);
    expect(goalStatusChange(completed, "archived", now)).toEqual({
      status: "archived",
      completedAt: earlier,
      archivedAt: now,
    });
  });

  it("restores an archived goal as active", () => {
    expect(goalStatusChange({ status: "archived", completedAt: earlier }, "active", now)).toEqual({
      status: "active",
      completedAt: null,
      archivedAt: null,
    });
  });
});

describe("activity-based progress", () => {
  it("counts linked actions by status category", () => {
    const stats = goalActionStats([
      { statusCategory: "completed" },
      { statusCategory: "completed" },
      { statusCategory: "started" },
      { statusCategory: "backlog" },
      { statusCategory: "cancelled" },
    ]);
    expect(stats).toEqual({ linked: 5, completed: 2, cancelled: 1, open: 2 });
    // "已完成 2 / 4 项行动": cancelled actions no longer count.
    expect(countedActions(stats)).toBe(4);
  });

  it("is all zeros without linked actions", () => {
    const stats = goalActionStats([]);
    expect(stats).toEqual({ linked: 0, completed: 0, cancelled: 0, open: 0 });
    expect(countedActions(stats)).toBe(0);
  });
});

describe("inputs", () => {
  it("requires a title and at least one distinct attribute", () => {
    const attributeId = id();
    expect(
      createGoalInput.safeParse({ title: "掌握 SQL", attributes: [{ attributeId, weight: 3 }] })
        .success,
    ).toBe(true);
    expect(createGoalInput.safeParse({ title: "掌握 SQL", attributes: [] }).success).toBe(false);
    expect(
      createGoalInput.safeParse({ title: "   ", attributes: [{ attributeId, weight: 3 }] }).success,
    ).toBe(false);
    expect(
      createGoalInput.safeParse({
        title: "x",
        attributes: [
          { attributeId, weight: 3 },
          { attributeId, weight: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      createGoalInput.safeParse({ title: "x", attributes: [{ attributeId, weight: 4 }] }).success,
    ).toBe(false);
  });

  it("rejects duplicate focus attributes and goal ids", () => {
    const a = id();
    expect(setFocusInput.safeParse({ attributeIds: [a, a] }).success).toBe(false);
    expect(setTaskGoalsInput.safeParse({ taskId: id(), goalIds: [a, a] }).success).toBe(false);
    // The count limit is a business rule checked by the server, not the schema.
    expect(
      setFocusInput.safeParse({
        attributeIds: Array.from({ length: MAX_FOCUS_ATTRIBUTES + 1 }, id),
      }).success,
    ).toBe(true);
  });

  it("limits the vision length", () => {
    expect(updateVisionInput.safeParse({ vision: "成为更好的自己" }).success).toBe(true);
    expect(updateVisionInput.safeParse({ vision: "长".repeat(2001) }).success).toBe(false);
    expect(updateVisionInput.safeParse({ vision: null }).success).toBe(true);
  });
});
