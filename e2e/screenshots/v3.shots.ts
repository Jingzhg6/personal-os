import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/v3";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* V3 (ADR 0029): demo data made through the app's own API, then the real pages captured. */

type Created = { id: string };

async function seed(page: Page) {
  await mutate(page, "settings.update", { timeZone: "UTC" });
  await mutate(page, "finance.setBaseCurrency", { baseCurrency: "CNY" });
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  const work = areas.find((a) => a.systemKey === "work")!.id;
  const project = (name: string, areaId: string, status = "active", targetDate?: string) =>
    mutate<Created>(page, "projects.create", { name, areaId, status, targetDate });
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);

  const site = await project("官网改版", work, "active", day(20));
  const design = await task({
    title: "交互设计",
    projectId: site.id,
    startDate: day(-2),
    dueDate: day(5),
    isUrgent: true,
    isImportant: true,
  });
  const home = await task({
    title: "首页",
    parentTaskId: design.id,
    startDate: day(-2),
    dueDate: day(1),
  });
  await task({ title: "产品详情页", parentTaskId: design.id, startDate: day(2), dueDate: day(5) });
  await task({
    title: "前端开发",
    projectId: site.id,
    startDate: day(6),
    dueDate: day(15),
    isUrgent: false,
    isImportant: true,
  });
  const copy = await task({
    title: "文案定稿",
    projectId: site.id,
    dueDate: day(3),
    isUrgent: true,
    isImportant: false,
  });
  await mutate(page, "tasks.complete", { id: home.id });
  await mutate(page, "tasks.complete", { id: copy.id });

  const job = await project("求职准备", work, "active", day(30));
  await task({
    title: "更新简历",
    projectId: job.id,
    startDate: day(0),
    dueDate: day(3),
    isUrgent: true,
    isImportant: true,
  });
  await task({
    title: "准备作品集",
    projectId: job.id,
    startDate: day(2),
    dueDate: day(10),
    isUrgent: false,
    isImportant: true,
  });
  await project("年度复盘", work, "planned");

  const inv = (path: string, input: Record<string, unknown>) =>
    mutate<Created>(page, `finance.investments.${path}`, input);
  const broker = await inv("accounts.create", {
    name: "证券账户 A",
    institution: "某证券",
    accountType: "brokerage",
    currency: "CNY",
  });
  await inv("transactions.create", {
    accountId: broker.id,
    kind: "deposit",
    tradeDate: day(-200),
    amount: "60000",
  });
  const etf = await inv("holdings.create", {
    accountId: broker.id,
    name: "沪深300 ETF",
    kind: "etf",
    ticker: "510300",
    currentPrice: "4.152",
    priceDate: day(0),
  });
  await inv("transactions.create", {
    accountId: broker.id,
    holdingId: etf.id,
    kind: "buy",
    tradeDate: day(-180),
    quantity: "8000",
    unitPrice: "3.85",
    fee: "5",
  });
  await inv("transactions.create", {
    accountId: broker.id,
    holdingId: etf.id,
    kind: "sell",
    tradeDate: day(-30),
    quantity: "2000",
    unitPrice: "4.10",
    fee: "5",
  });
  await inv("transactions.create", {
    accountId: broker.id,
    holdingId: etf.id,
    kind: "dividend",
    tradeDate: day(-20),
    amount: "180",
  });
  const stock = await inv("holdings.create", {
    accountId: broker.id,
    name: "贵州茅台",
    kind: "stock",
    ticker: "600519",
  });
  await inv("transactions.create", {
    accountId: broker.id,
    holdingId: stock.id,
    kind: "buy",
    tradeDate: day(-90),
    quantity: "10",
    unitPrice: "1520",
    fee: "8",
  });
  const fundAccount = await inv("accounts.create", {
    name: "基金平台",
    accountType: "platform",
    currency: "CNY",
  });
  const fund = await inv("holdings.create", {
    accountId: fundAccount.id,
    name: "招商中证白酒指数",
    kind: "fund",
    currentValue: "7420",
  });
  await inv("transactions.create", {
    accountId: fundAccount.id,
    holdingId: fund.id,
    kind: "buy",
    tradeDate: day(-60),
    amount: "8000",
  });
  const usd = await inv("accounts.create", {
    name: "美股账户",
    accountType: "brokerage",
    currency: "USD",
  });
  const vti = await inv("holdings.create", {
    accountId: usd.id,
    name: "VTI",
    kind: "etf",
    ticker: "VTI",
    currentPrice: "286.4",
    priceDate: day(0),
  });
  await inv("transactions.create", {
    accountId: usd.id,
    holdingId: vti.id,
    kind: "buy",
    tradeDate: day(-100),
    quantity: "12",
    unitPrice: "262.1",
    fee: "1",
  });
  return { site: site.id, broker: broker.id };
}

test("V3", async ({ page, browser }, testInfo) => {
  await registerDemoUser(page);
  const ids = await seed(page);

  await page.goto("/projects/kanban");
  const card = page.getByTestId("area-board-project").filter({ hasText: "官网改版" });
  await card.getByTestId("area-board-project-toggle").click();
  await expect(card.getByTestId("kanban-card").first()).toBeVisible();
  await shot(page, `${OUT}/01-kanban-area-projects.png`);

  await page.goto("/tasks/matrix?view=projects");
  await page.getByTestId("matrix-project").first().getByTestId("matrix-project-toggle").click();
  await shot(page, `${OUT}/02-matrix-project-view.png`);

  await page.goto("/projects/gantt");
  await expect(page.getByTestId("gantt-group").first()).toBeVisible();
  await shot(page, `${OUT}/03-gantt-hierarchy.png`);

  await page.goto("/finance/investments");
  await page.getByTestId("investment-account-select").selectOption(ids.broker);
  await expect(page.getByTestId("holding-row").first()).toBeVisible();
  await shot(page, `${OUT}/04-investments-account.png`, { fullPage: true });

  await page.goto("/finance/investments");
  await shot(page, `${OUT}/05-investments-overview.png`);

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByTestId("nav-customize").click();
  await shot(page, `${OUT}/06-navigation-customize.png`);
  await nav.getByTestId("nav-customize").click();

  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/projects/kanban");
  await expect(mobile.getByTestId("area-board-project").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/07-mobile-kanban.png`, { fullPage: true });
  await mobile.goto("/finance/investments");
  await expect(mobile.getByTestId("investment-totals").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/08-mobile-investments.png`, { fullPage: true });
  await phone.close();
});
