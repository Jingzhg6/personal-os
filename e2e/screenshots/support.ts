import { expect, type Page } from "@playwright/test";

/*
 * Helpers for milestone visual checks (`pnpm screenshots`). They drive the real running app:
 * a fresh account is registered through the UI and demo data is created through the app's own
 * tRPC API, exactly as the UI would. Nothing here is a product feature.
 */

export const PASSWORD = "correct-horse-battery";

export async function registerDemoUser(page: Page, name = "晋") {
  await page.goto("/register");
  await page.getByLabel("名字").fill(name);
  await page.getByLabel("邮箱").fill(`demo-${Date.now()}@example.test`);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Calls a tRPC mutation with the page's session cookie. */
export async function mutate<T = unknown>(page: Page, path: string, input?: unknown): Promise<T> {
  const response = await page.request.post(`/api/trpc/${path}`, { data: { json: input ?? null } });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).result.data.json as T;
}

/** Calls a tRPC query with the page's session cookie. */
export async function query<T = unknown>(page: Page, path: string, input?: unknown): Promise<T> {
  const search =
    input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const response = await page.request.get(`/api/trpc/${path}${search}`);
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).result.data.json as T;
}

/** "YYYY-MM-DD" relative to today in UTC (the demo user's timezone, detected from the browser). */
export function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export const doc = (...paragraphs: string[]) => ({
  type: "doc" as const,
  content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
});

/** Saves a screenshot after network activity and animations settle. */
export async function shot(page: Page, file: string, options: { fullPage?: boolean } = {}) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({
    path: file,
    fullPage: options.fullPage ?? false,
    animations: "disabled",
  });
}
