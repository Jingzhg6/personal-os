import { expect, type Page } from "@playwright/test";

export function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export const PASSWORD = "correct-horse-battery";

export async function register(page: Page, { name, email }: { name: string; email: string }) {
  await page.goto("/register");
  await page.getByLabel("名字").fill(name);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
