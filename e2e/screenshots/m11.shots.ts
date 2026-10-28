import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m11";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/*
 * Real app, real data through the app's API, and the deterministic mock provider the e2e server
 * runs with (AI_PROVIDER=mock): every AI result in these shots is labelled 模拟 in the UI and was
 * produced by the mock's fixed rules, not by a model.
 */

type Created = { id: string };

async function seed(page: Page) {
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const attribute = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);

  const delf = await mutate<Created>(page, "projects.create", {
    name: "通过 DELF B2 考试",
    areaId: area("learning"),
    priority: 4,
    targetDate: day(40),
  });
  await mutate(page, "projects.milestones.create", {
    projectId: delf.id,
    name: "完成两次模拟考试",
    dueDate: day(-3),
  });
  const report = await task({
    title: "提交季度报告",
    dueDate: day(-2),
    priority: 2,
    areaId: area("work"),
  });
  await task({
    title: "听力精听 20 篇",
    dueDate: day(-1),
    projectId: delf.id,
    isUrgent: true,
    isImportant: true,
  });
  const release = await task({ title: "发布个人网站新首页", dueDate: day(3), priority: 3 });
  const tests = await task({ title: "完成首页的浏览器测试", dueDate: day(2) });
  await mutate(page, "tasks.dependencies.add", {
    blockingTaskId: tests.id,
    blockedTaskId: release.id,
  });
  await task({ title: "法语口语练习 30 分钟", dueDate: day(1) });
  const reading = await task({ title: "读完《活着》第三章" });
  await task({ title: "预约牙医", dueDate: day(5) });

  const french = await mutate<Created>(page, "development.goals.create", {
    title: "通过法语 B2",
    description: "12 月参加 DELF B2，四项都达到 15 分以上。",
    targetDate: day(45),
    attributes: [{ attributeId: attribute("french"), weight: 3 }],
  });
  await mutate(page, "development.goals.create", {
    title: "每月读两本书",
    attributes: [{ attributeId: attribute("reading"), weight: 3 }],
  });

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
  await mutate(page, "finance.accounts.create", {
    providerId: bank.id,
    name: "定期存款",
    kind: "asset",
    accountType: "savings",
    assetCategory: "savings",
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
  return { report, reading, french };
}

const card = (page: Page, capability: string) =>
  page.locator(`[data-testid="ai-proposal"][data-capability="${capability}"]`).first();

async function approve(page: Page, capability: string) {
  await card(page, capability).getByTestId("ai-approve").click();
  await page.getByRole("dialog").getByRole("button", { name: "确认应用" }).click();
  await expect(card(page, capability)).toHaveAttribute("data-status", "applied");
}

test("M11 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const ids = await seed(page);

  // 2. Review: app-computed facts, AI analysis, priority recommendations.
  await page.goto("/ai/review");
  await expect(page.getByTestId("facts-missing")).toBeVisible();
  await page.getByTestId("ai-generate-review").click();
  await expect(card(page, "review")).toHaveAttribute("data-status", "analysis");
  await page.getByTestId("ai-generate-priorities").click();
  await expect(card(page, "priorities")).toHaveAttribute("data-status", "proposed");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${OUT}/02-review.png`, { fullPage: true });

  // 3. Explicit confirmation before anything changes.
  await card(page, "priorities").getByTestId("ai-approve").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, `${OUT}/03-approve-dialog.png`);
  await page.getByRole("dialog").getByRole("button", { name: "确认应用" }).click();
  await expect(card(page, "priorities")).toHaveAttribute("data-status", "applied");

  // 4. Goal plan: editable candidate tasks, nothing created yet.
  await page.goto("/ai/planning");
  await page.getByTestId("ai-plan-goal").selectOption(ids.french.id);
  await page.getByTestId("ai-generate-plan").click();
  await expect(card(page, "goal_plan")).toHaveAttribute("data-status", "proposed");
  await card(page, "goal_plan").getByLabel("任务标题").first().fill("整理 DELF B2 真题和听力材料");
  await card(page, "goal_plan").getByTestId("ai-change-select").nth(2).uncheck();
  await page.getByTestId("ai-plan").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/04-goal-plan.png`);
  await approve(page, "goal_plan");

  // 5. Automation drafts: an unsupported request explained, a supported one saved disabled.
  await page.getByTestId("ai-automation-request").fill("任务完成后给我发一封邮件");
  await page.getByTestId("ai-generate-automation").click();
  await expect(card(page, "automation_rule").getByTestId("ai-unsupported")).toBeVisible();
  await page.getByTestId("ai-automation-request").fill("每天 8:30 提醒我看今天的计划");
  await page.getByTestId("ai-generate-automation").click();
  await expect(card(page, "automation_rule")).toHaveAttribute("data-status", "proposed");
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId("ai-automation").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/05-automation-draft.png`);
  await approve(page, "automation_rule");

  // A contribution suggestion discarded, another made stale by a later edit.
  await page.getByTestId("ai-contributions-task").selectOption(ids.reading.id);
  await page.getByTestId("ai-generate-contributions").click();
  await card(page, "contributions").getByTestId("ai-discard").click();
  await expect(card(page, "contributions")).toHaveAttribute("data-status", "discarded");
  await page.getByTestId("ai-contributions-task").selectOption(ids.report.id);
  await page.getByTestId("ai-generate-contributions").click();
  await expect(card(page, "contributions")).toHaveAttribute("data-status", "proposed");
  await mutate(page, "tasks.update", { id: ids.report.id, patch: { dueDate: day(1) } });

  // 1. Home: a question answered from the user's data.
  await page.goto("/ai");
  await page.getByTestId("ai-question").fill("这周我应该优先做什么？");
  await page.getByTestId("ai-ask-submit").click();
  await expect(page.getByTestId("ai-answer")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `${OUT}/01-home.png`, { fullPage: true });

  // 6. History: analysis, applied, discarded and expired/stale records.
  await page.goto("/ai/history");
  await expect(page.getByTestId("ai-proposal").first()).toBeVisible();
  await page.goto("/ai/history");
  await expect(page.getByTestId("ai-proposal").first()).toBeVisible();
  await shot(page, `${OUT}/06-history.png`);

  const storage = await page.context().storageState();
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/ai/review");
  await expect(mobile.getByTestId("ai-facts")).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/07-mobile-review.png`, { fullPage: true });
  await phone.close();

  // 8. Dark mode, with a provider failure shown as a failure (mock timeout).
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/ai");
  await darkPage.getByTestId("ai-question").fill("帮我看看下周的安排 [mock:timeout]");
  await darkPage.getByTestId("ai-ask-submit").click();
  await expect(darkPage.getByTestId("ai-error")).toBeVisible();
  await shot(darkPage, `${OUT}/08-dark-error.png`);
  await dark.close();
});
