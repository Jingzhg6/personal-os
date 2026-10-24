import { expect, test } from "@playwright/test";

import { PASSWORD, register, uniqueEmail } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("signs out, protects routes and signs back in to the requested page", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, { name: "Jin", email });
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/tasks/matrix");
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks%2Fmatrix$/);
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("邮箱或密码不正确。");

  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/tasks\/matrix$/);
});
