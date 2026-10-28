import { readFile } from "node:fs/promises";

import { devices, expect, test, type BrowserContext, type Download } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate } from "./screenshots/support";

/*
 * Personal data export (ADR 0025): one fresh user with some data downloads the file from 设置 ›
 * 通用 on desktop and on a phone; failures are reported; nobody else can get it.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const email = uniqueEmail();
const TITLE = "导出测试任务";

type ExportFile = {
  format: string;
  version: number;
  generatedAt: string;
  user: { email: string };
  counts: Record<string, number>;
  data: {
    tasks: { tasks: { title: string; dueDate: string | null }[] };
    finance: { snapshots: { amount: string; fxRate: string | null }[] };
  };
};

async function readExport(download: Download): Promise<{ text: string; file: ExportFile }> {
  const text = await readFile((await download.path())!, "utf8");
  return { text, file: JSON.parse(text) as ExportFile };
}

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "导出测试", email });
  await mutate(page, "settings.update", { timeZone: "UTC" });
  await mutate(page, "tasks.create", { title: TITLE, dueDate: day(2) });
  const bank = await mutate<{ id: string }>(page, "finance.providers.create", {
    name: "测试银行",
    providerType: "bank",
  });
  const cny = await mutate<{ id: string }>(page, "finance.accounts.create", {
    providerId: bank.id,
    name: "人民币活期",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "CNY",
  });
  // No CNY rate given: the snapshot has no base value.
  await mutate(page, "finance.snapshots.saveBatch", {
    valuationDate: day(-1),
    entries: [{ accountId: cny.id, amount: "88.50" }],
  });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

test("1 — 导出 JSON downloads a readable file of the user's data", async ({ page }) => {
  await page.goto("/settings");
  const card = page.getByTestId("export-data");
  await expect(card).toContainText("不包含密码、登录会话等安全信息");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByTestId("export-button").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^personal-os-export-\d{4}-\d\d-\d\d\.json$/);
  const { text, file } = await readExport(download);
  expect(file).toMatchObject({ format: "personal-os-export", version: 1, user: { email } });
  expect(file.data.tasks.tasks.map((t) => t.title)).toContain(TITLE);
  expect(file.data.finance.snapshots).toEqual([
    expect.objectContaining({ amount: "88.500000", fxRate: null }),
  ]);
  expect(text).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);
  await expect(page.getByText(/^已导出 \d+ 条记录/)).toBeVisible();
  await expect(card.getByTestId("export-last")).toContainText(download.suggestedFilename());
});

test("2 — a failure is reported and nothing is saved", async ({ page }) => {
  await page.route("**/api/export", (route) =>
    route.fulfill({ status: 500, body: '{"error":"export_failed"}' }),
  );
  await page.goto("/settings");
  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await page.getByTestId("export-button").click();
  await expect(page.getByText("导出失败，请稍后再试。")).toBeVisible();
  await expect(page.getByTestId("export-button")).toBeEnabled();
  expect(downloaded).toBe(false);
});

test("3 — only the signed-in user gets a file, and only their own", async ({
  browser,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  // An explicit empty state: inside the runner, new contexts otherwise inherit test.use().
  const anonymous = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  expect((await anonymous.post("/api/export")).status()).toBe(401);
  expect((await anonymous.get("/api/export")).status()).toBe(405);
  await anonymous.dispose();

  const other = await browser.newContext({
    baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const response = await other.request.post("/api/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain(email);
  expect(text).not.toContain(TITLE);
  expect(text).not.toContain("人民币活期");
  await other.close();
});

test("4 — on a phone the export button is reachable and downloads the file", async ({
  browser,
}, testInfo) => {
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: account,
  });
  const page = await phone.newPage();
  await page.goto("/settings");
  const button = page.getByTestId("export-button");
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const [download] = await Promise.all([page.waitForEvent("download"), button.tap()]);
  const { file } = await readExport(download);
  expect(file.user.email).toBe(email);
  await expect(page.getByText(/^已导出 \d+ 条记录/)).toBeVisible();
  await phone.close();
});
