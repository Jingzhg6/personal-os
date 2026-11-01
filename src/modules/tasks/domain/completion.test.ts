import { describe, expect, it } from "vitest";

import { completeTaskInput, completionInstant } from "./completion";

describe("completion date", () => {
  const now = new Date("2026-11-01T09:30:00Z"); // 17:30 in Shanghai

  it("is now for today or no date", () => {
    expect(completionInstant(undefined, "2026-11-01", now, "Asia/Shanghai")).toBe(now);
    expect(completionInstant("2026-11-01", "2026-11-01", now, "Asia/Shanghai")).toBe(now);
  });

  it("is noon local time on an earlier day, so it falls on that day in the user's zone", () => {
    expect(completionInstant("2026-10-28", "2026-11-01", now, "Asia/Shanghai")?.toISOString()).toBe(
      "2026-10-28T04:00:00.000Z",
    );
    expect(
      completionInstant("2026-10-28", "2026-11-01", now, "America/Los_Angeles")?.toISOString(),
    ).toBe("2026-10-28T19:00:00.000Z");
  });

  it("refuses the future", () => {
    expect(completionInstant("2026-11-02", "2026-11-01", now, "UTC")).toBeNull();
  });

  it("validates the input", () => {
    expect(completeTaskInput.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(
      completeTaskInput.safeParse({ id: crypto.randomUUID(), completedOn: "2026-13-01" }).success,
    ).toBe(false);
  });
});
