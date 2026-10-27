import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m6";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Keyed {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

/** Real completions, reversals and deletions through the app's API; XP follows from events. */
async function seed(page: Page) {
  const areas = await query<Keyed[]>(page, "areas.list");
  const statuses = await query<Keyed[]>(page, "tasks.statuses.list");
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const status = (key: string) => statuses.find((s) => s.systemKey === key)!.id;
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);
  const complete = (t: Created) => mutate(page, "tasks.complete", { id: t.id });

  const done = async (title: string, areaKey: string, extra: Record<string, unknown> = {}) => {
    const created = await task({ title, areaId: area(areaKey), ...extra });
    await complete(created);
    return created;
  };

  // Learning
  for (const [title, priority] of [
    ["听力精听 20 篇", 3],
    ["写作范文 10 篇", 2],
    ["背完 B2 词汇第 3 单元", 1],
    ["法语口语练习 30 分钟", 2],
  ] as const) {
    await done(title, "learning", { priority, isImportant: priority >= 2 });
  }
  const delf = await mutate<Created>(page, "projects.create", {
    name: "通过 DELF B2 考试",
    areaId: area("learning"),
    color: "violet",
  });
  const signUp = await mutate<Created>(page, "projects.milestones.create", {
    projectId: delf.id,
    name: "完成报名",
    dueDate: day(-5),
  });
  await mutate(page, "projects.milestones.setCompleted", { id: signUp.id, completed: true });

  // Work
  await done("提交季度 OKR 复盘", "work", { priority: 4, isImportant: true });
  await done("评审设计稿", "work", { priority: 2 });
  await done("整理会议纪要", "work");
  const site = await mutate<Created>(page, "projects.create", {
    name: "官网改版 v2",
    areaId: area("work"),
    color: "blue",
    priority: 2,
  });
  await mutate(page, "projects.update", { id: site.id, patch: { status: "completed" } });

  // Fitness, business, admin, life
  await done("跑步 5 公里", "health", { priority: 1 });
  await done("力量训练：下肢", "health");
  await done("联系三位潜在客户", "business", { priority: 3, isImportant: true });
  await done("提交报销单", "admin");
  await done("续签租房合同", "admin", { priority: 2 });
  await done("给家里打电话", "personal");

  // Reversals: reopened task, completed → cancelled, milestone un-completed.
  const reopened = await done("准备周会材料", "work", { priority: 1 });
  await mutate(page, "tasks.reopen", { id: reopened.id });
  const cancelled = await done("预订周末餐厅", "personal");
  await mutate(page, "tasks.setStatus", { id: cancelled.id, statusId: status("cancelled") });
  const mock = await mutate<Created>(page, "projects.milestones.create", {
    projectId: delf.id,
    name: "第一次模拟考试",
  });
  await mutate(page, "projects.milestones.setCompleted", { id: mock.id, completed: true });
  await mutate(page, "projects.milestones.setCompleted", { id: mock.id, completed: false });

  // Deleting a completed task keeps its XP.
  const deleted = await done("清理旧文件", "admin");
  await mutate(page, "tasks.delete", { id: deleted.id });
}

test("M6 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await registerDemoUser(page);
  await seed(page);

  // 1. Character overview: level, XP progress, radar, attributes, recent grants and reversals.
  await page.goto("/character");
  await expect(page.getByTestId("attribute-row")).toHaveCount(6);
  await expect(page.getByTestId("recent-reversals").getByTestId("xp-entry")).toHaveCount(3);
  await shot(page, `${OUT}/01-character-overview.png`);

  // 2. Recent XP earned / reversed (scrolled), radar tooltip on hover.
  await page.getByTestId("recent-grants").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/02-recent-xp.png`);
  await page.getByTestId("attribute-radar").scrollIntoViewIfNeeded();
  await page.getByTestId("radar-point").nth(1).hover({ force: true });
  await shot(page, `${OUT}/03-attributes-radar.png`);

  // 3. Full XP history with the rules.
  await page.goto("/character/xp");
  await expect(page.getByTestId("xp-entry").first()).toBeVisible();
  await shot(page, `${OUT}/04-xp-history.png`);

  // 4. Reversals only.
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByTestId("xp-entry")).toHaveCount(3);
  await shot(page, `${OUT}/05-xp-reversals.png`);

  // 5. Area → attribute mapping.
  await page.goto("/character");
  await page.getByRole("button", { name: "设置来源领域" }).click();
  await expect(page.getByRole("dialog", { name: "领域与属性" })).toBeVisible();
  await shot(page, `${OUT}/06-area-mapping.png`);
  await page.keyboard.press("Escape");

  // 6. Dark theme, desktop.
  const dark = await browser.newContext({
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    storageState: await page.context().storageState(),
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/character");
  await expect(darkPage.getByTestId("attribute-row")).toHaveCount(6);
  await shot(darkPage, `${OUT}/07-character-dark.png`);
  await dark.close();

  // 7. Phone, light and dark.
  for (const scheme of ["light", "dark"] as const) {
    const phone = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL,
      locale: "zh-CN",
      colorScheme: scheme,
      storageState: await page.context().storageState(),
    });
    const mobile = await phone.newPage();
    if (scheme === "light") {
      await mobile.goto("/character");
      await expect(mobile.getByTestId("level-card")).toBeVisible();
      await shot(mobile, `${OUT}/08-mobile-character.png`);
    } else {
      await mobile.goto("/character/xp");
      await expect(mobile.getByTestId("xp-entry").first()).toBeVisible();
      await shot(mobile, `${OUT}/09-mobile-history-dark.png`);
    }
    await phone.close();
  }
});
