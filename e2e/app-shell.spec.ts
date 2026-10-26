import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard");
});

test("shows the Chinese navigation and placeholder modules", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav.getByRole("link", { name: "仪表盘" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "仪表盘" })).toBeVisible();
  await expect(page.getByTestId("current-user-name")).toHaveText("晋");

  await nav.getByRole("link", { name: "看板" }).click(); // still a placeholder (M4)
  await expect(page).toHaveURL(/\/projects\/kanban$/);
  await expect(page.getByRole("heading", { level: 1, name: "看板" })).toBeVisible();
  await expect(page.getByText("第 1 阶段 · 里程碑 M4", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("看板 · Personal OS");
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
