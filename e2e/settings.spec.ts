import { expect, test } from "@playwright/test";

test("switches the interface language without touching user data", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: /English/ }).click();

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // User-created content is never translated.
  await expect(page.getByTestId("current-user-name")).toHaveText("晋");

  await page.getByRole("radio", { name: /Français/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();

  // The choice is stored per user, so it survives a reload.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();

  await page.getByRole("radio", { name: /简体中文/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
});
