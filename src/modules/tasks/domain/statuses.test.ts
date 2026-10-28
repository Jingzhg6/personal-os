import { describe, expect, it } from "vitest";

import { defaultStatusFor, isClosedCategory, sortStatuses, statusTransition } from "./statuses";

const now = new Date("2026-10-25T10:00:00Z");
const earlier = new Date("2026-10-20T10:00:00Z");
const open = { category: "unstarted" as const, completedAt: null, cancelledAt: null };

describe("statusTransition", () => {
  it("completing an open task sets completedAt and emits task.completed", () => {
    expect(statusTransition(open, "completed", now)).toEqual({
      completedAt: now,
      cancelledAt: null,
      failedAt: null,
      event: "task.completed",
    });
  });

  it("moving between completed statuses keeps the original completion time and emits nothing", () => {
    const done = { category: "completed" as const, completedAt: earlier, cancelledAt: null };
    expect(statusTransition(done, "completed", now)).toEqual({
      completedAt: earlier,
      cancelledAt: null,
      failedAt: null,
      event: null,
    });
  });

  it("reopening a completed task clears completedAt and emits task.reopened", () => {
    const done = { category: "completed" as const, completedAt: earlier, cancelledAt: null };
    expect(statusTransition(done, "started", now)).toEqual({
      completedAt: null,
      cancelledAt: null,
      failedAt: null,
      event: "task.reopened",
    });
  });

  it("cancelling sets cancelledAt; cancelling a completed task also emits task.reopened", () => {
    expect(statusTransition(open, "cancelled", now)).toEqual({
      completedAt: null,
      cancelledAt: now,
      failedAt: null,
      event: null,
    });
    const done = { category: "completed" as const, completedAt: earlier, cancelledAt: null };
    expect(statusTransition(done, "cancelled", now).event).toBe("task.reopened");
  });

  it("failing sets failedAt (not cancelledAt); failing a completed task emits task.reopened", () => {
    expect(statusTransition(open, "failed", now)).toEqual({
      completedAt: null,
      cancelledAt: null,
      failedAt: now,
      event: null,
    });
    const failed = { ...open, category: "failed" as const, failedAt: earlier };
    expect(statusTransition(failed, "failed", now).failedAt).toBe(earlier);
    expect(statusTransition(failed, "unstarted", now).failedAt).toBeNull();
    const done = { category: "completed" as const, completedAt: earlier, cancelledAt: null };
    expect(statusTransition(done, "failed", now).event).toBe("task.reopened");
    expect(isClosedCategory("failed")).toBe(true);
  });

  it("moving between open categories changes nothing", () => {
    expect(statusTransition(open, "started", now)).toEqual({
      completedAt: null,
      cancelledAt: null,
      failedAt: null,
      event: null,
    });
  });
});

describe("status ordering", () => {
  const statuses = [
    { id: "d", category: "completed" as const, sortKey: "a0" },
    { id: "t2", category: "unstarted" as const, sortKey: "a2" },
    { id: "b", category: "backlog" as const, sortKey: "a9" },
    { id: "t1", category: "unstarted" as const, sortKey: "a1" },
  ];

  it("sorts by workflow category, then by position", () => {
    expect(sortStatuses(statuses).map((s) => s.id)).toEqual(["b", "t1", "t2", "d"]);
  });

  it("picks the first status of a category as its default", () => {
    expect(defaultStatusFor(statuses, "unstarted")?.id).toBe("t1");
    expect(defaultStatusFor(statuses, "started")).toBeUndefined();
  });

  it("knows which categories are closed", () => {
    expect(isClosedCategory("completed")).toBe(true);
    expect(isClosedCategory("cancelled")).toBe(true);
    expect(isClosedCategory("started")).toBe(false);
  });
});
