import { describe, expect, it } from "vitest";

import { countActiveFilters, readListParams, taskListQuery, writeListParams } from "./list-query";
import { richTextToPlainText } from "./rich-text";
import { deadlineGroup } from "./views";

const AREA = "0190f2a4-4b3c-7d2e-8f00-000000000001";
const TAG = "0190f2a4-4b3c-7d2e-8f00-000000000002";

describe("list URL state", () => {
  it("round-trips search, filters and sort through URL params", () => {
    const state = {
      search: "法语",
      sort: "due" as const,
      filter: {
        categories: ["unstarted" as const, "started" as const],
        priorities: [3, 4],
        areaIds: [AREA],
        noArea: true,
        tagIds: [TAG],
        urgent: "yes" as const,
        important: "unset" as const,
        due: "week" as const,
      },
    };
    const params = writeListParams(state);
    expect(params.get("area")).toBe(`${AREA},none`);
    expect(readListParams(params)).toEqual(state);
  });

  it("omits defaults and keeps unrelated params such as the open task", () => {
    const params = writeListParams(
      { search: "  ", sort: "manual", filter: {} },
      new URLSearchParams("task=abc&q=old"),
    );
    expect(params.toString()).toBe("task=abc");
  });

  it("drops invalid values instead of failing", () => {
    const state = readListParams(
      new URLSearchParams(
        "status=done,started&priority=9,2,x&area=nope&tag=1&urgent=maybe&due=soon&sort=random",
      ),
    );
    expect(state).toEqual({
      search: "",
      sort: "manual",
      filter: {
        categories: ["started"],
        priorities: [2],
        areaIds: undefined,
        noArea: undefined,
        tagIds: undefined,
        urgent: undefined,
        important: undefined,
        due: undefined,
      },
    });
  });

  it("counts active filter dimensions", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(
      countActiveFilters({ noArea: true, areaIds: [AREA], priorities: [1], due: "today" }),
    ).toBe(3);
  });

  it("validates API queries", () => {
    expect(taskListQuery.parse({ today: "2026-10-25" })).toMatchObject({
      sort: "manual",
      filter: {},
      includeSubtasks: false,
    });
    expect(taskListQuery.safeParse({ today: "25/10/2026" }).success).toBe(false);
    expect(taskListQuery.safeParse({ today: "2026-10-25", search: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});

describe("deadline groups", () => {
  it("buckets due dates relative to today", () => {
    const today = "2026-10-25";
    expect(deadlineGroup("2026-10-01", today)).toBe("overdue");
    expect(deadlineGroup("2026-10-25", today)).toBe("today");
    expect(deadlineGroup("2026-10-26", today)).toBe("tomorrow");
    expect(deadlineGroup("2026-10-31", today)).toBe("week");
    expect(deadlineGroup("2026-11-01", today)).toBe("later");
  });
});

describe("richTextToPlainText", () => {
  it("extracts text from nested nodes, separating blocks", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "每天" },
            { type: "text", text: "练习" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "听力" }] }],
            },
          ],
        },
      ],
    };
    expect(richTextToPlainText(doc)).toBe("每天练习 听力");
    expect(richTextToPlainText({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
    expect(richTextToPlainText(null)).toBeNull();
  });
});
