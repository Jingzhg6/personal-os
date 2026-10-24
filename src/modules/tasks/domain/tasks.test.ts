import { describe, expect, it } from "vitest";

import { addDays, dueState, splitMinutes, todayIn } from "./dates";
import { priorityId } from "./priority";
import { isRichTextEmpty, MAX_RICH_TEXT_BYTES, richTextDoc } from "./rich-text";
import { createTagInput } from "./tags";
import { createTaskInput, updateTaskInput, validateSchedule } from "./tasks";

const id = "0190f2a4-4b3c-7d2e-8f00-000000000001";

describe("task input validation", () => {
  it("requires a non-blank title", () => {
    expect(createTaskInput.safeParse({ title: "  " }).success).toBe(false);
    expect(createTaskInput.parse({ title: "  学法语 " }).title).toBe("学法语");
  });

  it("validates priority, estimate, dates and times", () => {
    expect(createTaskInput.safeParse({ title: "x", priority: 5 }).success).toBe(false);
    expect(createTaskInput.safeParse({ title: "x", estimatedMinutes: 0 }).success).toBe(false);
    expect(createTaskInput.safeParse({ title: "x", dueDate: "2026-02-30" }).success).toBe(false);
    expect(createTaskInput.safeParse({ title: "x", dueTime: "24:00" }).success).toBe(false);
    expect(
      createTaskInput.safeParse({
        title: "x",
        dueDate: "2026-10-25",
        dueTime: "19:30",
        priority: 3,
      }).success,
    ).toBe(true);
  });

  it("accepts partial updates, including clearing fields with null", () => {
    expect(updateTaskInput.parse({ id, patch: { dueDate: null, areaId: null } }).patch).toEqual({
      dueDate: null,
      areaId: null,
    });
    expect(updateTaskInput.safeParse({ id, patch: { title: "" } }).success).toBe(false);
  });

  it("checks schedule consistency", () => {
    expect(validateSchedule({ startDate: null, dueDate: null, dueTime: "10:00" })).toBe(
      "task.due_time_without_date",
    );
    expect(
      validateSchedule({ startDate: "2026-10-26", dueDate: "2026-10-25", dueTime: null }),
    ).toBe("task.start_after_due");
    expect(
      validateSchedule({ startDate: "2026-10-25", dueDate: "2026-10-25", dueTime: "09:00" }),
    ).toBeNull();
  });
});

describe("rich text", () => {
  const doc = (text: string) => ({
    type: "doc" as const,
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });

  it("accepts a ProseMirror document and rejects other shapes or oversized documents", () => {
    expect(richTextDoc.safeParse(doc("你好")).success).toBe(true);
    expect(richTextDoc.safeParse({ type: "paragraph" }).success).toBe(false);
    expect(richTextDoc.safeParse(doc("x".repeat(MAX_RICH_TEXT_BYTES))).success).toBe(false);
  });

  it("detects empty documents", () => {
    expect(isRichTextEmpty(null)).toBe(true);
    expect(isRichTextEmpty(doc(""))).toBe(true);
    expect(isRichTextEmpty(doc("  "))).toBe(true);
    expect(isRichTextEmpty(doc("内容"))).toBe(false);
    expect(isRichTextEmpty({ type: "doc", content: [{ type: "bulletList", content: [] }] })).toBe(
      false,
    );
  });
});

describe("dates", () => {
  it("computes today in the user's timezone", () => {
    const instant = new Date("2026-10-24T20:00:00Z");
    expect(todayIn("Asia/Shanghai", instant)).toBe("2026-10-25");
    expect(todayIn("Europe/Paris", instant)).toBe("2026-10-24");
  });

  it("classifies due dates", () => {
    expect(dueState("2026-10-24", "2026-10-25")).toBe("overdue");
    expect(dueState("2026-10-25", "2026-10-25")).toBe("today");
    expect(dueState("2026-10-26", "2026-10-25")).toBe("tomorrow");
    expect(dueState("2026-11-02", "2026-10-25")).toBe("upcoming");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("splits durations", () => {
    expect(splitMinutes(95)).toEqual({ hours: 1, minutes: 35 });
    expect(splitMinutes(45)).toEqual({ hours: 0, minutes: 45 });
  });
});

describe("priority and tags", () => {
  it("maps priority numbers to stable identifiers", () => {
    expect(priorityId(0)).toBe("none");
    expect(priorityId(4)).toBe("highest");
    expect(priorityId(9)).toBe("none");
  });

  it("keeps tag names usable in Quick Add", () => {
    expect(createTagInput.safeParse({ name: "法语" }).success).toBe(true);
    expect(createTagInput.safeParse({ name: "two words" }).success).toBe(false);
    expect(createTagInput.safeParse({ name: "a#b" }).success).toBe(false);
  });
});
