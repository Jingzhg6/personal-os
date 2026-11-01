import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("shows the Chinese navigation and placeholder modules", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "仪表盘" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "仪表盘" })).toBeVisible();
  await expect(page.getByTestId("current-user-name")).toHaveText("晋");

  // 目标 opens the development goals (M8) in 成长.
  await nav.getByRole("link", { name: "目标" }).click();
  await expect(page).toHaveURL(/\/development#goals$/);
  await expect(page.getByTestId("goals")).toBeVisible();

  // 学习 is still a placeholder (Phase 2).
  await nav.getByRole("link", { name: /^学习\s*P2$/ }).click();
  await expect(page).toHaveURL(/\/life\/learning$/);
  await expect(page.getByRole("heading", { level: 1, name: "学习" })).toBeVisible();
  await expect(page.getByText("第 2 阶段", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("学习 · Personal OS");
});

test("orders and collapses the sidebar sections, remembering the choice", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText([
    "概览",
    "工作与事务",
    "任务",
    "个人成长与生活",
    "资料与记录",
    "财务",
    "系统与自动化",
  ]);
  const finance = nav.getByRole("button", { name: "财务" });
  await finance.click();
  await expect(finance).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "资产总览" })).toBeHidden();
  await page.reload();
  await expect(nav.getByRole("button", { name: "财务" })).toHaveAttribute("aria-expanded", "false");
  // Opening a page of a collapsed section expands it again.
  await page.goto("/finance");
  await expect(nav.getByRole("button", { name: "财务" })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "资产总览" })).toHaveAttribute("aria-current", "page");
});

test("renders a translated 404 for unknown routes", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
});

test("switches theme", async ({ page }) => {
  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAttribute("aria-label", "主题: 跟随系统");
  await toggle.click(); // system → light
  await expect(html).toHaveClass(/\blight\b/);
  await toggle.click(); // light → dark
  await expect(html).toHaveClass(/\bdark\b/);
});

test("opens the navigation drawer on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "全部任务" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { level: 1, name: "全部任务" })).toBeVisible();
  await expect(dialog).toBeHidden();
});
