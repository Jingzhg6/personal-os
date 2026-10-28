import { devices, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * M11 AI advisor, as one story for one fresh user, against the deterministic mock provider
 * (AI_PROVIDER=mock in the e2e server; no paid calls). Data is created through the app's API;
 * every AI step goes through the UI: generate → review → approve or discard.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "顾问测试", email: uniqueEmail() });
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const report = await mutate<{ id: string }>(page, "tasks.create", {
    title: "提交季度报告",
    dueDate: day(-2),
    priority: 2,
  });
  ids.report = report.id;
  const french = await mutate<{ id: string }>(page, "tasks.create", { title: "法语听力练习" });
  ids.french = french.id;
  const bank = await mutate<{ id: string }>(page, "finance.providers.create", {
    name: "招商银行",
    providerType: "bank",
  });
  await mutate(page, "finance.accounts.create", {
    providerId: bank.id,
    name: "定期存款",
    kind: "asset",
    accountType: "savings",
    assetCategory: "savings",
    currency: "CNY",
  });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const card = (page: Page, capability: string) =>
  page.locator(`[data-testid="ai-proposal"][data-capability="${capability}"]`).first();

async function approve(page: Page, scope: ReturnType<typeof card>) {
  await scope.getByTestId("ai-approve").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("确认应用这些更改");
  await dialog.getByRole("button", { name: "确认应用" }).click();
}

test("1 — the AI section is in the navigation and labels the mock as simulated", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "顾问" }).click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.getByRole("heading", { name: "AI 顾问", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ai-simulated")).toContainText("模拟模式");
  await expect(page.getByTestId("ai-recent-empty")).toBeVisible();
});

test("2 — the review shows app facts, missing finance values not as zero, and an AI analysis", async ({
  page,
}) => {
  await page.goto("/ai/review");
  const facts = page.getByTestId("ai-facts");
  await expect(facts).toContainText("不是 AI 生成");
  await expect(page.getByTestId("facts-tasks")).toContainText("提交季度报告");
  await expect(page.getByTestId("facts-missing")).toContainText("定期存款");
  await expect(page.getByTestId("facts-missing")).toContainText("未记录（不计为 0）");
  await page.getByTestId("ai-generate-review").click();
  const analysis = card(page, "review");
  await expect(analysis).toHaveAttribute("data-status", "analysis");
  await expect(analysis.getByTestId("ai-summary")).toContainText("2 个未完成任务");
  await expect(analysis.getByTestId("ai-recommendation").first()).toContainText("提交季度报告");
  await expect(analysis).not.toContainText("批准");
});

test("3 — priority recommendations change nothing until approved", async ({ page }) => {
  await page.goto("/ai/review");
  await page.getByTestId("ai-generate-priorities").click();
  const proposal = card(page, "priorities");
  await expect(proposal).toHaveAttribute("data-status", "proposed");
  await expect(proposal.getByTestId("ai-recommendation").first()).toContainText("现在就做");
  type Task = { priority: number };
  expect((await query<Task>(page, "tasks.byId", { id: ids.report })).priority).toBe(2);
  await approve(page, proposal);
  await expect(card(page, "priorities")).toHaveAttribute("data-status", "applied");
  expect((await query<Task>(page, "tasks.byId", { id: ids.report })).priority).toBe(3);
});

test("4 — a goal plan creates only the approved, edited tasks", async ({ page }) => {
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  const french = attributes.find((a) => a.systemKey === "french")!.id;
  const goal = await mutate<{ id: string }>(page, "development.goals.create", {
    title: "通过法语 B1",
    attributes: [{ attributeId: french, weight: 3 }],
  });
  ids.goal = goal.id;
  await page.goto("/ai/planning");
  await page.getByTestId("ai-plan-goal").selectOption(goal.id);
  await page.getByTestId("ai-generate-plan").click();
  const plan = card(page, "goal_plan");
  await expect(plan).toHaveAttribute("data-status", "proposed");
  await expect(plan.getByTestId("ai-change")).toHaveCount(3);
  await plan.getByLabel("任务标题").first().fill("整理法语学习资源");
  await plan.getByTestId("ai-change-select").nth(2).uncheck();
  await approve(page, plan);
  await expect(card(page, "goal_plan")).toHaveAttribute("data-status", "applied");
  const detail = await query<{ tasks: { title: string }[] }>(page, "development.goals.detail", {
    id: goal.id,
  });
  expect(detail.tasks.map((t) => t.title).sort()).toEqual(
    ["整理法语学习资源", "通过法语 B1：完成第一次练习"].sort(),
  );
});

test("5 — contribution suggestions never include 自制力 and can be discarded", async ({ page }) => {
  await page.goto("/ai/planning");
  await page.getByTestId("ai-contributions-task").selectOption(ids.french!);
  await page.getByTestId("ai-generate-contributions").click();
  const proposal = card(page, "contributions");
  await expect(proposal).toHaveAttribute("data-status", "proposed");
  await expect(proposal.getByTestId("ai-change")).toContainText("法语 ×3");
  await expect(proposal.getByTestId("ai-change")).not.toContainText("自制力");
  await proposal.getByTestId("ai-discard").click();
  await expect(card(page, "contributions")).toHaveAttribute("data-status", "discarded");
  const task = await query<{ contributions: unknown[] }>(page, "tasks.byId", { id: ids.french });
  expect(task.contributions).toEqual([]);
});

test("6 — automation drafts use supported features only and are saved disabled", async ({
  page,
}) => {
  await page.goto("/ai/planning");
  const request = page.getByTestId("ai-automation-request");
  await request.fill("任务完成后给我发一封邮件");
  await page.getByTestId("ai-generate-automation").click();
  const unsupported = card(page, "automation_rule");
  await expect(unsupported.getByTestId("ai-unsupported")).toBeVisible();
  await expect(unsupported.getByTestId("ai-approve")).toHaveCount(0);

  await request.fill("每天 8:30 提醒我看今天的计划");
  await page.getByTestId("ai-generate-automation").click();
  const draft = card(page, "automation_rule");
  await expect(draft).toHaveAttribute("data-status", "proposed");
  await expect(draft.getByTestId("ai-change")).toContainText("每日提醒");
  await expect(draft.getByTestId("ai-change")).toContainText("保存后为停用状态");
  await approve(page, draft);
  await expect(card(page, "automation_rule")).toHaveAttribute("data-status", "applied");
  const rules = await query<{ name: string; enabled: boolean }[]>(page, "automation.rules.list");
  expect(rules).toEqual([expect.objectContaining({ name: "每日提醒", enabled: false })]);
});

test("7 — a proposal made stale by a later edit is rejected and can be regenerated", async ({
  page,
}) => {
  await page.goto("/ai/planning");
  await page.getByTestId("ai-contributions-task").selectOption(ids.french!);
  await page.getByTestId("ai-generate-contributions").click();
  const proposal = card(page, "contributions");
  await expect(proposal).toHaveAttribute("data-status", "proposed");
  await mutate(page, "tasks.update", { id: ids.french, patch: { title: "法语听力练习（每天）" } });
  await approve(page, proposal);
  await expect(card(page, "contributions")).toHaveAttribute("data-status", "stale");
  await expect(card(page, "contributions").getByTestId("ai-proposal-hint")).toContainText("已失效");
  await expect(card(page, "contributions").getByTestId("ai-regenerate")).toBeVisible();
  const task = await query<{ contributions: unknown[] }>(page, "tasks.byId", { id: ids.french });
  expect(task.contributions).toEqual([]);
});

test("8 — provider failures are shown as failures, never as answers", async ({ page }) => {
  await page.goto("/ai");
  await page.getByTestId("ai-question").fill("这周最重要的是什么？[mock:timeout]");
  await page.getByTestId("ai-ask-submit").click();
  await expect(page.getByTestId("ai-error")).toHaveAttribute("data-code", "ai.timeout");
  await expect(page.getByTestId("ai-error")).toContainText("超时");
  await expect(page.getByTestId("ai-ask-result").getByTestId("ai-proposal")).toHaveCount(0);

  await page.getByTestId("ai-question").fill("这周最重要的是什么？[mock:malformed]");
  await page.getByTestId("ai-ask-submit").click();
  await expect(page.getByTestId("ai-error")).toHaveAttribute("data-code", "ai.malformed_output");

  await page.getByTestId("ai-question").fill("这周最重要的是什么？");
  await page.getByTestId("ai-ask-submit").click();
  await expect(page.getByTestId("ai-answer")).toContainText("未完成任务");
  // Other workflows keep working after failures.
  await mutate(page, "tasks.create", { title: "AI 失败后照常添加" });
});

test("9 — the history lists every record and supports filtering and deletion", async ({ page }) => {
  await page.goto("/ai/history");
  const cards = page.getByTestId("ai-proposal");
  // Review, priorities, plan, two contribution suggestions, two automation drafts, one answer
  // (failed requests create no record).
  await expect(cards).toHaveCount(8);
  const total = 8;
  await page.getByRole("button", { name: "已应用" }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "全部" }).click();
  await cards.first().getByTestId("ai-delete").click();
  await expect(cards).toHaveCount(total - 1);
});

test("10 — phone layout and dark mode", async ({ browser }, testInfo) => {
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: testInfo.project.use.baseURL,
    storageState: account,
    locale: "zh-CN",
    colorScheme: "dark",
  });
  const page = await phone.newPage();
  for (const path of ["/ai", "/ai/review", "/ai/planning", "/ai/history"]) {
    await page.goto(path);
    await expect(page.getByTestId("ai-status")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await phone.close();
});
