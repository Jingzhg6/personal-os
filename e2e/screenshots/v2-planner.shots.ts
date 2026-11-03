import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/v2-planner";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* V2 (ADR 0028): data made through the app's own API, then the real pages captured. */

type Created = { id: string };

/** Today's local date plus hours, as an ISO instant (the demo user is in UTC). */
const at = (offset: number, hour: number) =>
  `${day(offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`;

async function seed(page: Page) {
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);
  const report = await task({
    title: "写季度总结",
    isUrgent: true,
    isImportant: true,
    estimatedMinutes: 90,
    dueDate: day(2),
  });
  const call = await task({
    title: "回复客户邮件",
    isUrgent: true,
    isImportant: true,
    estimatedMinutes: 30,
  });
  await task({ title: "准备周会材料", isUrgent: true, isImportant: true });
  const trip = await task({ title: "规划旅行", isImportant: true, isUrgent: false });
  const read = await task({ title: "读完《深度工作》", isImportant: true, isUrgent: false });
  const run = await task({
    title: "晨跑 5 公里",
    isImportant: true,
    isUrgent: false,
    dueDate: day(0),
  });
  await mutate(page, "tasks.recurrence.set", {
    taskId: run.id,
    rule: { frequency: "daily", interval: 1 },
    mode: "fixed",
    startDate: day(0),
  });
  const block = (taskId: string, startAt: string, endAt: string, allDay = false) =>
    mutate(page, "schedule.create", { taskId, startAt, endAt, allDay });
  await block(report.id, at(0, 9), at(0, 11));
  await block(call.id, at(0, 10), at(0, 11));
  await block(run.id, at(0, 7), at(0, 8));
  await block(read.id, at(1, 14), at(1, 16));
  await block(report.id, at(2, 9), at(2, 10));
  await block(trip.id, at(3, 0), at(6, 0), true);

  await mutate(page, "finance.setBaseCurrency", { baseCurrency: "CNY" });
  const bank = await mutate<Created>(page, "finance.providers.create", {
    name: "招商银行",
    providerType: "bank",
  });
  const account = await mutate<Created>(page, "finance.accounts.create", {
    providerId: bank.id,
    name: "活期",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "CNY",
  });
  await mutate(page, "finance.snapshots.saveBatch", {
    valuationDate: day(0),
    entries: [{ accountId: account.id, amount: "52000.00" }],
  });
  const invest = (input: Record<string, unknown>) =>
    mutate(page, "finance.investments.create", input);
  await invest({
    name: "沪深300 ETF",
    kind: "etf",
    costAmount: "20000",
    purchaseDate: day(-200),
    quantity: "5000",
    currentValue: "21850.40",
  });
  await invest({
    name: "招商中证白酒指数基金",
    kind: "fund",
    costAmount: "8000",
    purchaseDate: day(-90),
    currentValue: "7420.00",
  });
  await invest({
    name: "贵州茅台",
    kind: "stock",
    costAmount: "15000",
    purchaseDate: day(-30),
    quantity: "10",
  });

  await mutate(page, "settings.update", {
    dashboardPanels: [
      "character",
      "week",
      "activity",
      "xp",
      "growth",
      "focus",
      "levelReward",
      "rewardStore",
    ],
  });
}

test("V2 planner", async ({ page, browser }, testInfo) => {
  await registerDemoUser(page);
  await seed(page);

  await page.goto(`/schedule?view=day&date=${day(0)}&q=do`);
  await page.getByTestId("schedule-grid").evaluate((el) => (el.scrollTop = 6 * 48));
  await page.locator("[data-block-id]").first().click();
  await expect(page.getByTestId("schedule-editor")).toBeVisible();
  await shot(page, `${OUT}/01-schedule-day.png`);

  await page.goto(`/schedule?date=${day(0)}&q=schedule`);
  await page.getByTestId("schedule-grid").evaluate((el) => (el.scrollTop = 6 * 48));
  await shot(page, `${OUT}/02-schedule-week.png`);

  await page.goto(`/schedule?view=month&date=${day(0)}&q=schedule`);
  await shot(page, `${OUT}/03-schedule-month.png`);

  await page.goto("/finance/investments");
  await expect(page.getByTestId("investment-row")).toHaveCount(3);
  await shot(page, `${OUT}/04-investments.png`);

  await page.goto("/finance");
  await expect(page.getByTestId("finance-investments-card")).toBeVisible();
  await shot(page, `${OUT}/05-finance-overview.png`);

  await page.goto("/");
  await expect(page.getByTestId("dashboard-panels")).toBeVisible();
  await page.getByTestId("panel-week").hover();
  await shot(page, `${OUT}/06-dashboard-custom-order.png`);

  await page.goto("/projects/gantt");
  await shot(page, `${OUT}/07-gantt-series.png`);

  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto(`/schedule?view=day&date=${day(0)}&q=do`);
  await expect(mobile.getByTestId("schedule-planner")).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/08-mobile-schedule.png`, { fullPage: true });
  await phone.close();
});
