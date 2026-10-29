import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";
import { schedulerText, workerMode } from "./worker-mode";

/*
 * M10 automation, as one story for one fresh user (sign-up is rate-limited). Rules are built in
 * the UI; the changes that trigger them go through the app's normal API (as the UI would send
 * them), so the after-mutation processing path is exercised for real.
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
  await register(page, { name: "自动化测试", email: uniqueEmail() });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const ruleRow = (page: Page, name: string) =>
  page.locator(`[data-testid="rule-row"][data-rule="${name}"]`);

async function completeNewTask(page: Page, title: string, priority = 0) {
  const task = await mutate<{ id: string }>(page, "tasks.create", { title, priority });
  await mutate(page, "tasks.complete", { id: task.id });
  return task.id;
}

async function taskTitles(page: Page) {
  const tasks = await query<{ title: string }[]>(page, "tasks.list", {
    today: new Date().toISOString().slice(0, 10),
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  return tasks.map((t) => t.title);
}

test("1 — a fresh user sees the automation empty state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "规则" }).first().click();
  await expect(page).toHaveURL(/\/automation$/);
  await expect(page.getByTestId("automation-empty")).toContainText("还没有自动化规则");
  await expect(page.getByTestId("automation-empty")).toContainText("新建的规则默认是停用的");
  // The scheduler state depends on the deployment (e2e/worker-mode.ts).
  await expect(page.getByTestId("health-scheduler")).toContainText(schedulerText[workerMode]);
});

test("2 — the guided builder saves a disabled rule", async ({ page }) => {
  await page.goto("/automation");
  await page.getByTestId("rule-new").click();
  await expect(page).toHaveURL(/\/automation\/new$/);
  const builder = page.getByTestId("rule-builder");
  await expect(builder.getByTestId("trigger-task.completed")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await builder.getByTestId("action-row").getByLabel("任务标题").fill("跟进：{task}");
  await builder.getByLabel("规则名称").fill("完成后跟进");
  await expect(builder.getByTestId("rule-summary")).toContainText("任务完成时");
  await expect(builder.getByTestId("rule-summary")).toContainText("创建跟进任务「跟进：{task}」");
  await expect(builder).toContainText("保存后规则处于停用状态");
  await builder.getByTestId("rule-save").click();

  await expect(page).toHaveURL(/\/automation\/[0-9a-f-]{36}$/);
  ids.followUp = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("rule-enabled-note")).toHaveText("规则已停用，不会执行。");
  await page.goto("/automation");
  await expect(ruleRow(page, "完成后跟进").getByTestId("rule-state")).toHaveText("已停用");
});

test("3 + 8 — rules run only after being enabled explicitly, never while disabled", async ({
  page,
}) => {
  // Disabled: nothing happens.
  await completeNewTask(page, "停用时完成的任务");
  expect(await taskTitles(page)).not.toContain("跟进：停用时完成的任务");

  await page.goto(`/automation/${ids.followUp}`);
  await page.getByTestId("rule-enable").click();
  await expect(page.getByTestId("rule-enabled-note")).toHaveText(/规则已启用/);
  // And off again from the list's switch, then back on.
  await page.goto("/automation");
  const toggle = ruleRow(page, "完成后跟进").getByRole("switch", { name: "启用「完成后跟进」" });
  await expect(toggle).toBeChecked();
  await toggle.click({ force: true });
  await expect(ruleRow(page, "完成后跟进").getByTestId("rule-state")).toHaveText("已停用");
  await completeNewTask(page, "再次停用时完成的任务");
  expect(await taskTitles(page)).not.toContain("跟进：再次停用时完成的任务");
  await toggle.click({ force: true });
  await expect(ruleRow(page, "完成后跟进").getByTestId("rule-state")).toHaveText("已启用");
});

test("4 + 6 — an event runs the action once, even when repeated", async ({ page }) => {
  const id = await completeNewTask(page, "写周报");
  expect(await taskTitles(page)).toContain("跟进：写周报");

  // Reopened and completed again: no second follow-up.
  await mutate(page, "tasks.reopen", { id });
  await mutate(page, "tasks.complete", { id });
  expect((await taskTitles(page)).filter((t) => t === "跟进：写周报")).toHaveLength(1);

  await page.goto(`/automation/${ids.followUp}`);
  const row = page.getByTestId("execution-row").filter({ hasText: "写周报" });
  await expect(row.getByTestId("execution-status")).toHaveText("成功");
  await expect(row).toContainText("1 / 1 个动作完成");
  await expect(row.getByTestId("execution-duplicates")).toHaveText("重复触发 1 次，已忽略");
  await page.goto("/tasks");
  await expect(page.getByTestId("task-row").filter({ hasText: "跟进：写周报" })).toBeVisible();
});

test("5 — conditions that do not match prevent the action", async ({ page }) => {
  await page.goto("/automation/new");
  const builder = page.getByTestId("rule-builder");
  await builder.getByTestId("condition-add").click();
  await builder
    .getByTestId("condition-row")
    .getByLabel("条件类型")
    .selectOption({ label: "任务优先级为" });
  await builder.getByTestId("condition-value").selectOption({ label: "最高" });
  const action = builder.getByTestId("action-row");
  await action.getByLabel("动作类型").selectOption({ label: "发送站内通知" });
  await action.getByLabel("通知标题").fill("重要任务完成：{task}");
  await builder.getByLabel("规则名称").fill("重要任务通知");
  await expect(builder.getByTestId("rule-summary")).toContainText("任务优先级为「最高」");
  await builder.getByTestId("rule-save").click();
  await page.getByTestId("rule-enable").click();
  await expect(page.getByTestId("rule-enabled-note")).toHaveText(/规则已启用/);
  ids.important = page.url().split("/").at(-1)!;

  await completeNewTask(page, "普通任务", 1);
  await completeNewTask(page, "关键任务", 4);
  await page.reload();
  const rows = page.getByTestId("execution-row");
  await expect(rows.filter({ hasText: "普通任务" }).getByTestId("execution-skip")).toHaveText(
    "条件不满足",
  );
  await expect(rows.filter({ hasText: "关键任务" }).getByTestId("execution-status")).toHaveText(
    "成功",
  );
  await page.goto("/automation/notifications");
  await expect(page.getByTestId("notification")).toHaveCount(1);
  await expect(page.getByTestId("notification")).toContainText("重要任务完成：关键任务");
  await page.getByTestId("notifications-read-all").click();
  await expect(page.getByTestId("notifications-unread")).toHaveText("0 条未读");
});

test("7 — a failed execution is visible with its reason", async ({ page }) => {
  const project = await mutate<{ id: string }>(page, "projects.create", { name: "临时项目" });
  const rule = await mutate<{ id: string }>(page, "automation.rules.create", {
    name: "归档到项目",
    trigger: { type: "task.completed" },
    conditions: [{ type: "task_priority", priority: 3 }],
    actions: [{ type: "create_task", title: "归档 {task}", projectId: project.id }],
  });
  await mutate(page, "automation.rules.setEnabled", { id: rule.id, enabled: true });
  await mutate(page, "projects.delete", { id: project.id });
  await completeNewTask(page, "高优先级任务", 3);

  await page.goto(`/automation/${rule.id}`);
  const row = page.getByTestId("execution-row").first();
  await expect(row.getByTestId("execution-status")).toHaveText("失败");
  await expect(row.getByTestId("execution-failure")).toContainText("项目不存在或已删除");
  await expect(row.getByTestId("execution-failure")).toContainText("重试不会成功");
  await page.goto("/automation");
  await expect(page.getByTestId("health-failures")).toContainText("归档到项目");
  await expect(ruleRow(page, "归档到项目").getByTestId("execution-status")).toHaveText("失败");
});

test("9 — a saved finance batch triggers a rule, without exposing balances", async ({ page }) => {
  const rule = await mutate<{ id: string }>(page, "automation.rules.create", {
    name: "记账后提醒",
    trigger: { type: "finance.snapshot_saved" },
    actions: [{ type: "notify", title: "{date} 的余额已记录", body: "记得看看净资产变化。" }],
  });
  await mutate(page, "automation.rules.setEnabled", { id: rule.id, enabled: true });
  const provider = await mutate<{ id: string }>(page, "finance.providers.create", {
    name: "BNP Paribas",
    providerType: "bank",
  });
  const acct = await mutate<{ id: string }>(page, "finance.accounts.create", {
    providerId: provider.id,
    name: "活期账户",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "EUR",
  });
  await mutate(page, "finance.snapshots.saveBatch", {
    valuationDate: "2026-10-01",
    entries: [{ accountId: acct.id, amount: "4321.09" }],
  });
  await page.goto("/automation/notifications");
  await expect(page.getByTestId("notification").first()).toContainText("2026-10-01 的余额已记录");
  await page.goto(`/automation/${rule.id}`);
  const row = page.getByTestId("execution-row").first();
  await expect(row).toContainText("保存余额记录时：2026-10-01");
  await expect(page.getByTestId("automation-detail")).not.toContainText("4321");
});

/** A one-time UTC schedule a minute from now, enabled. */
async function oneTimeRuleSoon(page: Page) {
  const at = new Date(Date.now() + 60_000);
  const rule = await mutate<{ id: string }>(page, "automation.rules.create", {
    name: "一次性提醒",
    trigger: {
      type: "schedule",
      schedule: {
        kind: "once",
        date: at.toISOString().slice(0, 10),
        time: at.toISOString().slice(11, 16),
      },
    },
    timeZone: "UTC",
    actions: [{ type: "notify", title: "计划提醒：记录本月余额" }],
  });
  await mutate(page, "automation.rules.setEnabled", { id: rule.id, enabled: true });
  return { rule, at };
}

// Test 10 has one version per deployment (e2e/worker-mode.ts); each runs where it applies.
test("10 (no worker) — schedules state their runtime requirement; the manual path runs due ones", async ({
  page,
}) => {
  test.skip(workerMode !== "off", "covered by 10 (worker running) in this deployment");
  test.setTimeout(150_000);
  await page.goto("/automation/new");
  await page.getByTestId("trigger-schedule").click();
  await expect(page.getByTestId("schedule-runtime")).toContainText(
    "当前没有检测到后台 worker，计划规则不会自动运行",
  );
  await expect(page.getByTestId("schedule-fields")).toContainText("夏令时");
  // Without AUTOMATION_WORKER_SECRET the worker endpoint is off, and says so.
  const tick = await page.request.post("/api/automation/tick");
  expect(tick.status()).toBe(503);

  // A one-time schedule a minute from now, in UTC.
  const { rule, at } = await oneTimeRuleSoon(page);
  await page.goto("/automation");
  await expect(page.getByTestId("health-scheduler")).toContainText("1 条计划规则等待下次运行");
  // Enabled, but honestly marked as not running on its own.
  await expect(ruleRow(page, "一次性提醒").getByTestId("rule-awaiting-worker")).toHaveText(
    "等待后台 worker：不会自动运行",
  );
  await page.goto(`/automation/${rule.id}`);
  await expect(page.getByTestId("rule-awaiting-worker")).toContainText("不会自动执行");
  await page.goto("/automation");
  // Nothing runs on its own (no worker); once due, the manual check runs it exactly once.
  await page.waitForTimeout(Math.max(0, at.getTime() - Date.now()) + 2_000);
  await page.reload();
  await expect(page.getByTestId("health-scheduler")).toContainText("1 条已到期");
  await page.getByTestId("health-run-due").click();
  await expect(page.getByText("已执行 1 个计划")).toBeVisible();
  await page.getByTestId("health-run-due").click();
  await expect(page.getByText("已执行 0 个计划")).toBeVisible();
  await expect(ruleRow(page, "一次性提醒")).toContainText("一次性计划已执行完毕");
  await expect(ruleRow(page, "一次性提醒").getByTestId("rule-awaiting-worker")).toHaveCount(0);
  await expect(page.getByTestId("health-scheduler")).toContainText("0 条计划规则等待下次运行");
  await page.goto("/automation/notifications");
  await expect(
    page.getByTestId("notification").filter({ hasText: "计划提醒：记录本月余额" }),
  ).toHaveCount(1);
});

test("10 (worker running) — the worker runs a due schedule by itself, exactly once", async ({
  page,
}) => {
  test.skip(workerMode !== "running", "covered by 10 (no worker) in this deployment");
  test.setTimeout(240_000);
  await page.goto("/automation/new");
  await page.getByTestId("trigger-schedule").click();
  await expect(page.getByTestId("schedule-runtime")).toContainText("后台 worker 正在运行");
  // The worker endpoint is on, and refuses a caller without the worker secret.
  const tick = await page.request.post("/api/automation/tick");
  expect(tick.status()).toBe(401);

  const { rule } = await oneTimeRuleSoon(page);
  await page.goto("/automation");
  await expect(page.getByTestId("health-scheduler")).toContainText("计划调度运行中");
  // Enabled, and not marked as waiting for a worker: one is running.
  await expect(ruleRow(page, "一次性提醒")).toBeVisible();
  await expect(ruleRow(page, "一次性提醒").getByTestId("rule-awaiting-worker")).toHaveCount(0);
  // The worker ticks every minute: within ~2 minutes it has run the rule, without any click.
  await expect
    .poll(
      async () => {
        await page.reload();
        return ruleRow(page, "一次性提醒").textContent();
      },
      { timeout: 180_000, intervals: [10_000] },
    )
    .toContain("一次性计划已执行完毕");
  // A manual check afterwards finds nothing left: the worker ran it exactly once.
  await page.getByTestId("health-run-due").click();
  await expect(page.getByText("已执行 0 个计划")).toBeVisible();
  await page.goto(`/automation/${rule.id}`);
  await expect(page.getByTestId("execution-row")).toHaveCount(1);
  await expect(page.getByTestId("execution-row").first()).toContainText("成功");
  await page.goto("/automation/notifications");
  await expect(
    page.getByTestId("notification").filter({ hasText: "计划提醒：记录本月余额" }),
  ).toHaveCount(1);
});

test("another user can neither see nor run these rules", async ({ browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const page = await other.newPage();
  await page.goto(`/automation/${ids.followUp}`);
  await expect(page.getByTestId("rule-not-found")).toBeVisible();
  const toggle = await page.request.post("/api/trpc/automation.rules.setEnabled", {
    data: { json: { id: ids.followUp, enabled: false } },
  });
  expect(toggle.status()).toBe(404);
  const rules = await query<{ id: string }[]>(page, "automation.rules.list");
  expect(rules.map((r) => r.id)).not.toContain(ids.followUp);
  await other.close();
});

test("11 — the automation pages fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/automation",
    "/automation/new",
    `/automation/${ids.followUp}`,
    "/automation/notifications",
  ]) {
    await page.goto(path);
    await expect(page.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
  }
});

test("12 — dark mode keeps automation readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/automation");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(ruleRow(page, "完成后跟进")).toBeVisible();
  await expect(page.getByTestId("automation-health")).toBeVisible();
});
