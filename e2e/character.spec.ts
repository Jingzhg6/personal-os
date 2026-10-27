import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;
const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });

/*
 * The e2e user is shared by parallel tests: entries are followed by unique titles, and the
 * seeded attributes (法语, 阅读, …) are never renamed or archived here.
 */

test("a task in an area contributes to two development attributes without doubling XP", async ({
  page,
}) => {
  const title = unique("用法语读书");
  const nav = page.getByRole("navigation", { name: "主导航" });
  // Visit the character page first: coming back must not show cached, stale XP.
  await page.goto("/character");
  await expect(page.getByTestId("level-card")).toBeVisible();
  await nav.getByRole("link", { name: "全部任务" }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  const input = page.getByLabel("快速添加任务");
  await input.fill(`${title} @学习`);
  await input.press("Enter");
  await page.getByTestId("task-row").filter({ hasText: title }).locator("[data-row-main]").click();
  await expect(panel(page).getByText("无成长贡献：完成后只计入总经验。")).toBeVisible();

  // Area 学习 and development contributions are independent choices.
  for (const name of ["法语", "阅读"]) {
    await panel(page).getByRole("button", { name: "添加成长能力" }).click();
    await page.getByRole("option", { name }).click();
    await expect(panel(page).getByTestId("contribution").filter({ hasText: name })).toBeVisible();
  }
  await panel(page).getByLabel("「法语」的权重").selectOption({ label: "主要" });
  await expect(panel(page).getByTestId("contribution-preview")).toHaveText(
    "完成后约获得 10 XP：法语 +6 · 阅读 +4",
  );
  await expect(panel(page).getByRole("combobox", { name: "领域" })).toHaveValue(/.+/);

  await panel(page).getByRole("button", { name: "完成" }).click();
  await expect(panel(page).getByRole("button", { name: "重新打开" })).toBeVisible();

  await nav.getByRole("link", { name: "角色", exact: true }).click();
  const grant = page
    .getByTestId("recent-grants")
    .getByTestId("xp-entry")
    .filter({ hasText: title });
  await expect(grant).toContainText("+10"); // overall, counted once
  await expect(grant.getByTestId("xp-credit")).toHaveText([/法语\+6$/, /阅读\+4$/]);

  // Reopen: the reversal undoes exactly the same split.
  await grant.getByRole("link", { name: `打开「${title}」` }).click();
  await panel(page).getByRole("button", { name: "重新打开" }).click();
  await expect(panel(page).getByRole("button", { name: "完成" })).toBeVisible();
  await page.goto("/character/xp?kind=reversal");
  const reversal = page.getByTestId("xp-entry").filter({ hasText: title });
  await expect(reversal).toContainText("-10");
  await expect(reversal.getByTestId("xp-credit")).toHaveText([/法语-6$/, /阅读-4$/]);
});

test("manages development attributes and the radar follows them", async ({ page }) => {
  const name = unique("SQL");
  const renamed = unique("数据库");
  await page.goto("/character/attributes");
  await expect(page.getByRole("heading", { level: 1, name: "成长能力设置" })).toBeVisible();
  await page.getByLabel("新成长能力，例如 Python").fill(name);
  await page.getByLabel("图标（emoji）", { exact: true }).fill("🗄️");
  await page.getByRole("button", { name: "添加" }).click();
  const row = page.getByTestId("attribute-setting").filter({
    has: page.getByRole("textbox", { name: `名称: ${name}` }),
  });
  await expect(row).toBeVisible();

  await page.goto("/character");
  await expect(page.getByTestId("attribute-radar")).toContainText(name);

  // Rename, then take it off the radar.
  await page.goto("/character/attributes");
  const nameInput = page.getByRole("textbox", { name: `名称: ${name}` });
  await nameInput.fill(renamed);
  await nameInput.press("Enter");
  await expect(page.getByText("已保存").first()).toBeVisible();
  const renamedRow = page.getByTestId("attribute-setting").filter({
    has: page.getByRole("textbox", { name: `名称: ${renamed}` }),
  });
  await renamedRow.getByRole("checkbox", { name: "在雷达图显示" }).uncheck();
  await page.goto("/character");
  await expect(page.getByTestId("attribute-row").filter({ hasText: renamed })).toBeVisible();
  await expect(page.getByTestId("attribute-radar")).not.toContainText(renamed);

  // Archive, reactivate, delete (it has no XP).
  await page.goto("/character/attributes");
  await renamedRow.getByRole("button", { name: "停用" }).click();
  const archived = page.getByTestId("attribute-archived").filter({ hasText: renamed });
  await expect(archived).toBeVisible();
  await archived.getByRole("button", { name: "重新启用" }).click();
  await expect(renamedRow).toBeVisible();
  await renamedRow.getByRole("button", { name: `删除「${renamed}」` }).click();
  await page
    .getByRole("dialog", { name: `删除成长能力「${renamed}」？` })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByText("已删除")).toBeVisible();
  await expect(renamedRow).toHaveCount(0);
});
