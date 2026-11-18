import { describe, expect, it } from "vitest";

import { sourceMessages } from "@/shared/i18n/messages";

import {
  allNavItems,
  applyNavLayout,
  layoutOf,
  findActiveNavItem,
  findNavItem,
  findNavSection,
  navigation,
} from "./navigation";

describe("navigation", () => {
  it("has unique item ids and hrefs", () => {
    const ids = allNavItems.map((item) => item.id);
    const hrefs = allNavItems.map((item) => item.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("has a zh-CN label for every section and item", () => {
    for (const section of navigation) {
      expect(sourceMessages.nav.sections[section.id]).toBeTruthy();
    }
    for (const item of allNavItems) {
      expect(sourceMessages.nav.items[item.id]).toBeTruthy();
    }
  });

  it("orders the sections as agreed (V3): tasks right after the overview", () => {
    expect(navigation.map((s) => s.id)).toEqual([
      "overview",
      "tasks",
      "work",
      "life",
      "finance",
      "records",
      "system",
    ]);
    const items = (id: string) => navigation.find((s) => s.id === id)!.items.map((i) => i.id);
    expect(items("tasks")).toEqual([
      "allProjects",
      "allTasks",
      "matrix",
      "gantt",
      "schedule",
      "kanban",
      "deadlines",
      "trash",
    ]);
    expect(items("work")).toEqual(["work", "business", "adminTasks", "goals"]);
    expect(items("life")).toEqual(
      expect.arrayContaining(["learning", "fitness", "skills", "personal", "calendar"]),
    );
    expect(items("records")).toEqual(["documents"]);
    expect(items("finance")).toEqual(["financeOverview", "financeAccounts", "financeInvestments"]);
    expect(items("system")).toEqual(["automationRules", "automationNotifications", "settings"]);
  });

  it("applies a saved layout without losing or moving pages between groups", () => {
    const sections = applyNavLayout({
      sections: ["finance", "unknown", "overview", "finance"],
      items: { overview: ["productivity", "dashboard", "allTasks"], tasks: ["trash"] },
    });
    expect(sections.map((s) => s.id).slice(0, 3)).toEqual(["finance", "overview", "tasks"]);
    expect(sections).toHaveLength(navigation.length);
    expect(sections[1]!.items.map((i) => i.id)).toEqual([
      "productivity",
      "dashboard",
      "personalStats",
    ]);
    expect(sections[2]!.items[0]!.id).toBe("trash");
    expect(sections.flatMap((s) => s.items)).toHaveLength(allNavItems.length);
    expect(applyNavLayout(layoutOf(sections))).toEqual(sections);
    expect(applyNavLayout(null)).toBe(navigation);
  });

  it("assigns a milestone to every Phase 1 view except settings", () => {
    for (const item of allNavItems.filter((i) => i.phase === 1 && i.id !== "settings")) {
      expect(item.milestone, item.id).toMatch(/^M\d+$/);
    }
  });

  it("finds items by exact path", () => {
    expect(findNavItem("/tasks/matrix")?.id).toBe("matrix");
    expect(findNavItem("/does-not-exist")).toBeNull();
  });

  it("highlights the most specific item for nested paths", () => {
    expect(findActiveNavItem("/tasks")?.id).toBe("allTasks");
    expect(findActiveNavItem("/tasks/matrix")?.id).toBe("matrix");
    expect(findActiveNavItem("/projects/123")?.id).toBe("allProjects");
    expect(findActiveNavItem("/settings")?.id).toBe("settings");
  });

  it("keeps navigation separate from modules: several items can share one module", () => {
    const taskViews = allNavItems.filter((item) => item.module === "tasks").map((item) => item.id);
    expect(taskViews).toEqual(
      expect.arrayContaining(["allTasks", "matrix", "work", "business", "adminTasks"]),
    );
    expect(findNavSection(findNavItem("/work")!)?.id).toBe("work");
    expect(findNavSection(findNavItem("/admin")!)?.id).toBe("work");
  });
});
