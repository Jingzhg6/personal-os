import { expect, test } from "@playwright/test";

test("the interface is Simplified Chinese only, with no language switch", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("radio", { name: /English|Français/ })).toHaveCount(0);
  await expect(page.getByText("界面语言")).toHaveCount(0);
  // The theme setting is still there.
  await expect(page.getByRole("heading", { name: "外观" })).toBeVisible();
});
