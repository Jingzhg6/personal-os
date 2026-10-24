import { describe, expect, it } from "vitest";

import { parseQuickAdd } from "./quick-add";

const context = {
  areas: [
    { id: "area-learning", label: "学习" },
    { id: "area-work", label: "Work" },
  ],
  tags: [
    { id: "tag-french", name: "法语" },
    { id: "tag-urgent", name: "Deep" },
  ],
};

describe("parseQuickAdd", () => {
  it("returns plain text as the title", () => {
    expect(parseQuickAdd("  完成 法语 听力练习 ", context)).toEqual({
      title: "完成 法语 听力练习",
      priority: null,
      areaId: null,
      tagIds: [],
      newTagNames: [],
    });
  });

  it("extracts tags, area and priority", () => {
    expect(parseQuickAdd("完成听力练习 #法语 @学习 !3", context)).toEqual({
      title: "完成听力练习",
      priority: 3,
      areaId: "area-learning",
      tagIds: ["tag-french"],
      newTagNames: [],
    });
  });

  it("accepts full-width markers typed with a Chinese IME", () => {
    const result = parseQuickAdd("背单词 ＃法语 ＠学习 ！2", context);
    expect(result).toMatchObject({
      title: "背单词",
      priority: 2,
      areaId: "area-learning",
      tagIds: ["tag-french"],
    });
  });

  it("matches case-insensitively and collects unknown tags once", () => {
    const result = parseQuickAdd("Plan #deep #新标签 #新标签 @work", context);
    expect(result).toMatchObject({
      title: "Plan",
      areaId: "area-work",
      tagIds: ["tag-urgent"],
      newTagNames: ["新标签"],
    });
  });

  it("keeps unknown areas, invalid priorities and bare markers in the title", () => {
    expect(parseQuickAdd("Email @boss !9 # @", context).title).toBe("Email @boss !9 # @");
  });
});
