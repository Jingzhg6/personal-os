import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/phase1-integration";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* One account, data made through the app's API, shown across the integrated modules. */

type Created = { id: string };

async function seed(page: Page) {
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);

  const site = await mutate<Created>(page, "projects.create", {
    name: "个人网站改版",
    areaId: area("work"),
    priority: 3,
    startDate: day(-10),
    targetDate: day(20),
  });
  const launch = await mutate<Created>(page, "projects.milestones.create", {
    projectId: site.id,
    name: "上线新首页",
    dueDate: day(12),
  });
  const copy = await task({
    title: "整理首页文案",
    projectId: site.id,
    milestoneId: launch.id,
    startDate: day(-2),
    dueDate: day(3),
    priority: 3,
    isUrgent: true,
    isImportant: true,
  });
  const test1 = await task({
    title: "完成首页的浏览器测试",
    projectId: site.id,
    startDate: day(2),
    dueDate: day(6),
  });
  await mutate(page, "tasks.dependencies.add", {
    blockingTaskId: copy.id,
    blockedTaskId: test1.id,
  });
  const french = await task({
    title: "法语听力练习 30 分钟",
    areaId: area("learning"),
    dueDate: day(0),
    contributions: [{ attributeId: attr("french"), weight: 3 }],
  });
  await task({ title: "预约牙医", areaId: area("personal"), dueDate: day(4), isImportant: true });
  const reading = await task({
    title: "读完《活着》第三章",
    contributions: [{ attributeId: attr("reading"), weight: 2 }],
  });
  const goal = await mutate<Created>(page, "development.goals.create", {
    title: "通过法语 B2",
    targetDate: day(120),
    attributes: [{ attributeId: attr("french"), weight: 3 }],
  });
  await mutate(page, "development.goals.linkTask", { goalId: goal.id, taskId: french.id });
  await mutate(page, "tasks.complete", { id: reading.id });
  await mutate(page, "tasks.complete", { id: french.id });

  await mutate(page, "finance.setBaseCurrency", { baseCurrency: "CNY" });
  const bank = await mutate<Created>(page, "finance.providers.create", {
    name: "招商银行",
    providerType: "bank",
  });
  const salary = await mutate<Created>(page, "finance.accounts.create", {
    providerId: bank.id,
    name: "工资卡",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "CNY",
  });
  await mutate(page, "finance.snapshots.saveBatch", {
    valuationDate: day(-1),
    entries: [{ accountId: salary.id, amount: "18000.00" }],
  });
  await mutate(page, "automation.rules.create", {
    name: "完成后跟进",
    trigger: { type: "task.completed" },
    actions: [{ type: "create_follow_up_task", title: "跟进：{task}", priority: 2 }],
  });
  return { site };
}

test("Phase 1 integration visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const { site } = await seed(page);

  await page.goto("/");
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await shot(page, `${OUT}/01-dashboard.png`, { fullPage: true });

  await page.goto("/tasks");
  await expect(page.getByText("整理首页文案").first()).toBeVisible();
  await shot(page, `${OUT}/02-tasks.png`);

  await page.goto(`/projects/${site.id}`);
  await expect(page.getByText("整理首页文案").first()).toBeVisible();
  await shot(page, `${OUT}/03-project.png`);

  await page.goto("/projects/gantt");
  await expect(page.getByText("个人网站改版").first()).toBeVisible();
  await shot(page, `${OUT}/04-gantt.png`);

  await page.goto("/development");
  await expect(page.getByText("通过法语 B2").first()).toBeVisible();
  await shot(page, `${OUT}/05-development.png`);

  await page.goto("/finance");
  await expect(page.getByText("¥18,000.00").first()).toBeVisible();
  await shot(page, `${OUT}/06-finance.png`);

  const storage = await page.context().storageState();
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/tasks/matrix");
  await expect(mobile.getByText("整理首页文案").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/07-mobile-matrix.png`);
  await phone.close();

  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/character");
  await expect(darkPage.getByTestId("attribute-radar")).toBeVisible();
  await shot(darkPage, `${OUT}/08-dark-character.png`);
  await dark.close();
});
