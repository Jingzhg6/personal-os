import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m9-5";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Created {
  id: string;
}

/**
 * Real app operations only (API): institutions, accounts and dated balance snapshots with the
 * rates the user typed. Six recorded dates over five months; nothing is filled in between.
 */
async function seed(page: Page) {
  const provider = (name: string, providerType: string, country: string | null = null) =>
    mutate<Created>(page, "finance.providers.create", { name, providerType, country });
  const account = (providerId: string, input: Record<string, unknown>) =>
    mutate<Created>(page, "finance.accounts.create", {
      providerId,
      kind: "asset",
      accountType: "current",
      assetCategory: "bank_deposit",
      currency: "EUR",
      ...input,
    });

  const bnp = await provider("BNP Paribas", "bank", "法国");
  const boc = await provider("中国银行", "bank", "中国");
  const alipay = await provider("支付宝", "ewallet", "中国");
  const broker = await provider("Trade Republic", "broker", "德国");
  const cash = await provider("现金", "cash");

  const a = {
    current: await account(bnp.id, { name: "活期账户" }),
    livret: await account(bnp.id, {
      name: "Livret A",
      accountType: "savings",
      assetCategory: "savings",
    }),
    card: await account(bnp.id, {
      name: "信用卡",
      kind: "liability",
      accountType: "credit_card",
      assetCategory: null,
    }),
    boc: await account(boc.id, { name: "储蓄卡", currency: "CNY" }),
    alipay: await account(alipay.id, {
      name: "余额宝",
      accountType: "ewallet",
      assetCategory: "ewallet",
      currency: "CNY",
    }),
    etf: await account(broker.id, {
      name: "ETF 投资账户",
      accountType: "investment",
      assetCategory: "investment",
    }),
    wallet: await account(cash.id, {
      name: "钱包现金",
      accountType: "cash",
      assetCategory: "cash",
    }),
  };

  const batches: [number, string, Partial<Record<keyof typeof a, string>>][] = [
    [
      -150,
      "0.1265",
      {
        current: "1820.40",
        livret: "7500",
        card: "310.20",
        boc: "9200",
        alipay: "3100",
        etf: "4200",
        wallet: "120",
      },
    ],
    [
      -120,
      "0.1271",
      {
        current: "2140.75",
        livret: "7700",
        card: "455.80",
        boc: "9600",
        alipay: "2850",
        etf: "4380.50",
      },
    ],
    [
      -90,
      "0.1288",
      {
        current: "1690.10",
        livret: "7900",
        card: "380.00",
        boc: "10400",
        alipay: "3300",
        etf: "4510.20",
        wallet: "90",
      },
    ],
    [
      -60,
      "0.1279",
      {
        current: "2310.65",
        livret: "8000",
        card: "512.35",
        boc: "10400",
        alipay: "3600",
        etf: "4705.80",
      },
    ],
    [
      -30,
      "0.1282",
      {
        current: "1980.30",
        livret: "8100",
        card: "420.50",
        boc: "11000",
        alipay: "3450",
        etf: "4890.00",
        wallet: "150",
      },
    ],
    [
      -2,
      "0.1301",
      {
        current: "2265.90",
        livret: "8200",
        card: "395.10",
        boc: "12000",
        alipay: "3700",
        etf: "5012.40",
      },
    ],
  ];
  for (const [offset, cny, values] of batches) {
    await mutate(page, "finance.snapshots.saveBatch", {
      valuationDate: day(offset),
      entries: Object.entries(values).map(([key, amount]) => ({
        accountId: a[key as keyof typeof a].id,
        amount,
      })),
      rates: { CNY: cny },
    });
  }

  // A new USD account, not valued yet (shown as missing, then entered without a rate).
  const usd = await account(broker.id, { name: "美元现金账户", currency: "USD" });
  return { ...a, usd };
}

test("M9.5 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);

  // 5. Empty state.
  await page.goto("/finance");
  await expect(page.getByTestId("finance-empty")).toBeVisible();
  await shot(page, `${OUT}/05-empty-state.png`);

  const ids = await seed(page);
  expect((await query<{ accounts: unknown[] }>(page, "finance.structure")).accounts).toHaveLength(
    8,
  );

  // 1. Overview.
  await page.goto("/finance");
  await expect(page.getByTestId("net-worth-point").first()).toBeVisible();
  await shot(page, `${OUT}/01-overview.png`, { fullPage: true });

  // 2. Institutions and accounts.
  await page.goto("/finance/accounts");
  await expect(page.getByTestId("account-row").first()).toBeVisible();
  await shot(page, `${OUT}/02-accounts.png`, { fullPage: true });

  // 3. Batch entry: previous values as hints, one used, a USD balance without a rate.
  await page.goto(`/finance/snapshot?date=${day(0)}`);
  await page.getByRole("button", { name: "沿用「活期账户」上次的余额" }).click();
  await page.getByLabel("「储蓄卡」的余额（CNY）").fill("12150");
  await page.getByLabel("「美元现金账户」的余额（USD）").fill("650");
  await page.getByLabel("「信用卡」的余额（EUR）").fill("212.40");
  await expect(page.getByTestId("snapshot-missing-rate")).toContainText("USD");
  // Viewport shot: the provisional total stays pinned at the bottom, as on screen.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByTestId("snapshot-rates").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/03-snapshot-missing-fx.png`);

  // 4. Account history: original currency, the rate of each day, the value then.
  await page.goto(`/finance/accounts/${ids.boc.id}`);
  await expect(page.getByTestId("account-history-row")).toHaveCount(6);
  await shot(page, `${OUT}/04-account-history.png`, { fullPage: true });

  const storage = await page.context().storageState();

  // 6–7. Phone: overview and snapshot entry.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/finance");
  await expect(mobile.getByTestId("net-worth-point").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/06-mobile-overview.png`, { fullPage: true });
  await mobile.goto(`/finance/snapshot?date=${day(0)}`);
  await expect(mobile.getByTestId("snapshot-entry").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/07-mobile-snapshot.png`);
  await phone.close();

  // 8. Dark mode.
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/finance");
  await expect(darkPage.getByTestId("net-worth-point").first()).toBeVisible();
  await shot(darkPage, `${OUT}/08-dark-overview.png`, { fullPage: true });
  await dark.close();
});
