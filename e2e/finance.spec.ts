import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * M9.5 personal finance, as one story for one fresh user (sign-up is rate-limited). Institutions,
 * accounts and balance snapshots are entered through the UI; every figure is asserted exactly.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};
const FIRST = day(-30);
const SECOND = day(-1);

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "财务测试", email: uniqueEmail() });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const provider = (page: Page, name: string) =>
  page.getByTestId("provider-card").filter({ has: page.getByRole("heading", { name }) });
const accountRow = (page: Page, name: string) =>
  page.locator(`[data-testid="account-row"][data-account="${name}"]`);
const amount = (page: Page, name: string, currency: string) =>
  page.getByLabel(`「${name}」的余额（${currency}）`);

async function addAccount(
  page: Page,
  providerName: string,
  values: { name: string; kind?: string; type?: string; category?: string; currency?: string },
) {
  await provider(page, providerName).getByTestId("account-new").click();
  const form = page.getByTestId("account-form");
  await form.getByLabel("账户名称").fill(values.name);
  if (values.kind) await form.getByLabel("资产或负债").selectOption({ label: values.kind });
  if (values.type) await form.getByLabel("账户类型").selectOption({ label: values.type });
  if (values.category) await form.getByLabel("资产类别").selectOption({ label: values.category });
  if (values.currency) await form.getByLabel("币种").fill(values.currency);
  await form.getByRole("button", { name: "添加" }).click();
  await expect(accountRow(page, values.name)).toBeVisible();
}

test("1 — empty state guides the first steps", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "资产总览" }).first().click();
  await expect(page).toHaveURL(/\/finance$/);
  const empty = page.getByTestId("finance-empty");
  await expect(empty).toContainText("开始记录你的资产");
  await expect(empty).toContainText("添加一个机构");
  await empty.getByRole("link", { name: "添加第一个机构" }).click();
  await expect(page).toHaveURL(/\/finance\/accounts$/);
  await expect(page.getByText("还没有机构。")).toBeVisible();
  await expect(page.getByTestId("base-currency")).toContainText("报告货币");
});

test("2 — an institution holds several accounts", async ({ page }) => {
  await page.goto("/finance/accounts");
  await page.getByTestId("provider-new").click();
  const form = page.getByTestId("provider-form");
  await form.getByLabel("机构名称").fill("BNP Paribas");
  await form.getByLabel("国家/地区（可选）").fill("法国");
  await form.getByRole("button", { name: "添加" }).click();
  await expect(provider(page, "BNP Paribas")).toContainText("银行 · 法国");

  await addAccount(page, "BNP Paribas", { name: "活期账户" });
  await addAccount(page, "BNP Paribas", {
    name: "Livret A",
    type: "储蓄",
    category: "储蓄",
  });
  await addAccount(page, "BNP Paribas", {
    name: "信用卡",
    kind: "负债",
    type: "信用卡",
  });
  await expect(provider(page, "BNP Paribas").getByTestId("account-row")).toHaveCount(3);
  await expect(accountRow(page, "信用卡")).toContainText("负债");

  await page.getByTestId("provider-new").click();
  await form.getByLabel("机构名称").fill("中国银行");
  await form.getByRole("button", { name: "添加" }).click();
  await addAccount(page, "中国银行", { name: "储蓄卡", currency: "CNY" });
  await expect(accountRow(page, "储蓄卡")).toContainText("CNY");

  // The overview now asks for a first balance.
  await page.goto("/finance");
  await expect(page.getByTestId("finance-empty-action")).toHaveText(/记录第一次余额/);

  const structure = await query<{ accounts: { id: string; name: string }[] }>(
    page,
    "finance.structure",
  );
  for (const a of structure.accounts) ids[a.name] = a.id;
});

test("3 + 4 — EUR and CNY balances, a liability, and net worth", async ({ page }) => {
  await page.goto(`/finance/snapshot?date=${FIRST}`);
  await expect(page.getByTestId("snapshot-entry")).toHaveCount(4);
  await amount(page, "活期账户", "EUR").fill("1500.00");
  await amount(page, "Livret A", "EUR").fill("8000");
  await amount(page, "储蓄卡", "CNY").fill("10000");
  await amount(page, "信用卡", "EUR").fill("420.50");

  // A foreign balance without a rate is flagged, never counted at 1.
  await expect(page.getByTestId("snapshot-missing-rate")).toContainText("CNY");
  await expect(page.getByTestId("snapshot-unconverted")).toHaveText("未换算");
  await expect(page.getByTestId("snapshot-provisional-net")).toHaveText("€9,079.50");

  await page.getByTestId("snapshot-rate-CNY").fill("0.1282");
  await expect(page.getByTestId("snapshot-preview")).toHaveText("≈ €1,282.00");
  await expect(page.getByTestId("snapshot-provisional-net")).toHaveText("€10,361.50");

  // Validation: a negative or over-precise amount blocks the save.
  await amount(page, "活期账户", "EUR").fill("1500.001");
  await expect(page.getByText("小数位过多")).toBeVisible();
  await amount(page, "活期账户", "EUR").fill("1500.00");

  await page.getByTestId("snapshot-save").click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.getByTestId("finance-net-worth-value")).toHaveText("€10,361.50");
  await expect(page.getByTestId("finance-assets")).toContainText("€10,782.00");
  await expect(page.getByTestId("finance-liabilities")).toContainText("€420.50");
  await expect(page.getByTestId("finance-change")).toContainText("至少需要两次记录");

  const categories = page.getByTestId("finance-by-category");
  await expect(categories.getByRole("listitem").first()).toContainText("储蓄");
  await expect(categories.getByRole("listitem").first()).toContainText("€8,000.00");
  await expect(categories).toContainText("€2,782.00");
  await expect(page.getByTestId("finance-by-provider")).toContainText("€9,079.50");
  const currencies = page.getByTestId("finance-by-currency");
  await expect(currencies.getByRole("row", { name: /CNY/ })).toContainText("¥10,000.00");
  await expect(currencies.getByRole("row", { name: /EUR/ })).toContainText("€9,500.00");
  await expect(currencies.getByRole("row", { name: /EUR/ })).toContainText("€420.50");
});

test("5 — a later snapshot: history, change split and account history", async ({ page }) => {
  await page.goto(`/finance/snapshot?date=${SECOND}`);
  // The previous balance is only a hint; "use previous" must be chosen per account.
  await expect(amount(page, "活期账户", "EUR")).toHaveValue("");
  await page.getByRole("button", { name: "沿用「活期账户」上次的余额" }).click();
  await expect(amount(page, "活期账户", "EUR")).toHaveValue("1500.00");
  await page.getByRole("button", { name: "沿用「信用卡」上次的余额" }).click();
  await amount(page, "Livret A", "EUR").fill("8100");
  await amount(page, "储蓄卡", "CNY").fill("12000");
  // The last rate is pre-filled from the previous batch, and can be changed.
  await expect(page.getByTestId("snapshot-rate-CNY")).toHaveValue("0.1282");
  await page.getByTestId("snapshot-rate-CNY").fill("0.13");
  await page.getByTestId("snapshot-save").click();
  await expect(page).toHaveURL(/\/finance$/);

  await expect(page.getByTestId("finance-net-worth-value")).toHaveText("€10,739.50");
  await expect(page.getByTestId("finance-change-total")).toHaveText("+€378.00");
  await expect(page.getByTestId("finance-change-balance")).toContainText("+€356.40");
  await expect(page.getByTestId("finance-change-fx")).toContainText("+€21.60");
  await expect(page.getByTestId("finance-change")).toContainText("这不是收益率或投资表现");
  await expect(page.getByTestId("net-worth-point")).toHaveCount(2);

  // Account history keeps each rate and value as recorded.
  await page.goto(`/finance/accounts/${ids["储蓄卡"]}`);
  const rows = page.getByTestId("account-history-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("¥12,000.00");
  await expect(rows.nth(0)).toContainText("0.13");
  await expect(rows.nth(0)).toContainText("€1,560.00");
  await expect(rows.nth(1)).toContainText("0.1282");
  await expect(rows.nth(1)).toContainText("€1,282.00");

  // Correcting a date: values pre-filled, saved as revision 2.
  await page.goto(`/finance/snapshot?date=${SECOND}`);
  await expect(page.getByTestId("snapshot-correcting")).toContainText("已有 4 条记录");
  await expect(amount(page, "Livret A", "EUR")).toHaveValue("8100.00");
  await page.getByTestId("snapshot-save").click();
  await expect(page).toHaveURL(/\/finance$/);
  await page.goto(`/finance/accounts/${ids["Livret A"]}`);
  await expect(page.getByTestId("account-history-row").first()).toContainText(/€8,100\.00.*2$/);
});

test("6 — closing an account keeps its history", async ({ page }) => {
  await page.goto("/finance/accounts");
  // An account with history cannot be deleted or change its currency.
  await accountRow(page, "Livret A").getByRole("button", { name: "编辑「Livret A」" }).click();
  await expect(page.getByTestId("account-form").getByLabel("币种")).toBeDisabled();
  await page.getByTestId("account-form").press("Escape");

  await accountRow(page, "Livret A").getByTestId("account-archive").click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await expect(accountRow(page, "Livret A").getByTestId("account-archived")).toBeVisible();

  // From today on it no longer counts; its past stays in the history.
  await page.goto("/finance");
  await expect(page.getByTestId("finance-net-worth-value")).toHaveText("€2,639.50");
  await expect(page.getByTestId("net-worth-point")).toHaveCount(2);
  await page.goto(`/finance/accounts/${ids["Livret A"]}`);
  await expect(page.getByTestId("account-history-row")).toHaveCount(2);

  // No new balances for a closed account.
  await page.goto(`/finance/snapshot?date=${day(0)}`);
  await expect(page.getByTestId("snapshot-entry")).toHaveCount(3);
  await expect(page.locator('[data-testid="snapshot-entry"][data-account="Livret A"]')).toHaveCount(
    0,
  );

  // Reactivated, it can be valued again.
  await page.goto("/finance/accounts");
  await accountRow(page, "Livret A").getByTestId("account-reactivate").click();
  await expect(accountRow(page, "Livret A").getByTestId("account-archived")).toHaveCount(0);
});

test("7 — a missing FX rate is surfaced, not guessed", async ({ page }) => {
  const created = await mutate<{ id: string }>(page, "finance.accounts.create", {
    providerId: (
      await query<{ providers: { id: string; name: string }[] }>(page, "finance.structure")
    ).providers.find((p) => p.name === "BNP Paribas")!.id,
    name: "美元账户",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "USD",
  });
  ids["美元账户"] = created.id;

  await page.goto(`/finance/snapshot?date=${day(0)}`);
  await amount(page, "美元账户", "USD").fill("500");
  await expect(page.getByTestId("snapshot-rate-USD")).toHaveValue("");
  await expect(page.getByTestId("snapshot-missing-rate")).toContainText("USD");
  await page.getByTestId("snapshot-save").click();
  await expect(page).toHaveURL(/\/finance$/);

  const warnings = page.getByTestId("finance-warnings");
  await expect(warnings.getByTestId("finance-warning-unconverted")).toContainText(
    "美元账户：US$500.00 缺少汇率，未计入合计",
  );
  // Net worth leaves the USD balance out instead of counting it at 1.
  await expect(page.getByTestId("finance-net-worth-value")).toHaveText("€10,739.50");
});

test("8 — another user can neither see nor change these accounts", async ({
  browser,
}, testInfo) => {
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const page = await other.newPage();
  const history = await page.request.get(
    `/api/trpc/finance.accounts.history?input=${encodeURIComponent(
      JSON.stringify({ json: { id: ids["储蓄卡"] } }),
    )}`,
  );
  expect(history.status()).toBe(404);
  const save = await page.request.post("/api/trpc/finance.snapshots.saveBatch", {
    data: {
      json: { valuationDate: day(0), entries: [{ accountId: ids["储蓄卡"], amount: "1" }] },
    },
  });
  expect(save.status()).toBe(404);
  const archive = await page.request.post("/api/trpc/finance.accounts.setArchived", {
    data: { json: { id: ids["储蓄卡"], archived: true } },
  });
  expect(archive.status()).toBe(404);

  await page.goto(`/finance/accounts/${ids["储蓄卡"]}`);
  await expect(page.getByTestId("account-not-found")).toBeVisible();
  const structure = await query<{ accounts: { id: string }[] }>(page, "finance.structure");
  expect(structure.accounts.map((a) => a.id)).not.toContain(ids["储蓄卡"]);
  await other.close();
});

test("9 — the overview and snapshot form fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/finance", "/finance/accounts", `/finance/snapshot?date=${day(0)}`]) {
    await page.goto(path);
    await expect(page.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
  }
  await page.goto("/finance");
  await expect(page.getByTestId("finance-net-worth-value")).toBeVisible();
});

test("10 — dark mode keeps finance readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/finance");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("finance-net-worth-value")).toHaveText("€10,739.50");
  await expect(page.getByTestId("net-worth-chart")).toBeVisible();
});
