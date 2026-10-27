import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m10";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Created {
  id: string;
}

/**
 * Real app operations only (API): rules created and enabled explicitly, then real task
 * completions, a finance batch and a deleted project produce the executions shown.
 */
async function seed(page: Page) {
  const rule = async (config: object, enable = true) => {
    const created = await mutate<Created>(page, "automation.rules.create", config);
    if (enable)
      await mutate(page, "automation.rules.setEnabled", { id: created.id, enabled: true });
    return created;
  };
  const complete = async (title: string, priority = 0, projectId?: string) => {
    const task = await mutate<Created>(page, "tasks.create", { title, priority, projectId });
    await mutate(page, "tasks.complete", { id: task.id });
    return task.id;
  };

  const project = await mutate<Created>(page, "projects.create", { name: "季度规划" });
  const followUp = await rule({
    name: "完成后跟进",
    description: "完成重要任务后，自动安排一次跟进。",
    trigger: { type: "task.completed" },
    conditions: [{ type: "task_priority", priority: 3 }],
    actions: [
      { type: "create_follow_up_task", title: "跟进：{task}", priority: 2, dueInDays: 3 },
      { type: "notify", title: "已为「{task}」安排跟进" },
    ],
  });
  await rule({
    name: "记账后提醒",
    trigger: { type: "finance.snapshot_saved" },
    conditions: [{ type: "finance_all_valued" }],
    actions: [{ type: "notify", title: "{date} 的余额已记录", body: "看看净资产的变化吧。" }],
  });
  await rule({
    name: "每月记录余额",
    trigger: { type: "schedule", schedule: { kind: "monthly", day: 1, time: "09:00" } },
    actions: [{ type: "create_task", title: "记录 {date} 的账户余额", priority: 2, dueInDays: 2 }],
  });
  await rule(
    {
      name: "目标完成后复盘",
      trigger: { type: "goal.status_changed" },
      conditions: [{ type: "goal_status", status: "completed" }],
      actions: [{ type: "create_task", title: "复盘目标：{goal}" }],
    },
    false,
  );
  const temp = await mutate<Created>(page, "projects.create", { name: "临时项目" });
  const failing = await rule({
    name: "归档到临时项目",
    trigger: { type: "task.completed" },
    conditions: [{ type: "task_priority", priority: 4 }],
    actions: [
      { type: "notify", title: "紧急任务完成：{task}" },
      { type: "create_task", title: "归档 {task}", projectId: temp.id },
    ],
  });
  await mutate(page, "projects.delete", { id: temp.id });

  await complete("整理会议纪要", 1, project.id);
  const report = await complete("写季度报告", 3, project.id);
  await mutate(page, "tasks.reopen", { id: report });
  await mutate(page, "tasks.complete", { id: report });
  await complete("准备客户演示", 3, project.id);
  await complete("修复线上问题", 4);

  const provider = await mutate<Created>(page, "finance.providers.create", {
    name: "BNP Paribas",
    providerType: "bank",
  });
  const account = await mutate<Created>(page, "finance.accounts.create", {
    providerId: provider.id,
    name: "活期账户",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "EUR",
  });
  await mutate(page, "finance.snapshots.saveBatch", {
    valuationDate: day(-1),
    entries: [{ accountId: account.id, amount: "2265.90" }],
  });
  return { followUp: followUp.id, failing: failing.id };
}

test("M10 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);

  // 7. Empty state.
  await page.goto("/automation");
  await expect(page.getByTestId("automation-empty")).toBeVisible();
  await shot(page, `${OUT}/07-empty-state.png`);

  const ids = await seed(page);
  expect(await query<unknown[]>(page, "automation.rules.list")).toHaveLength(5);

  // 1. Rule list with the runtime status.
  await page.goto("/automation");
  await expect(page.getByTestId("rule-row").first()).toBeVisible();
  await shot(page, `${OUT}/01-rules.png`, { fullPage: true });

  // 2. Guided builder: trigger, a condition, two actions, the summary.
  await page.goto("/automation/new");
  const builder = page.getByTestId("rule-builder");
  await builder.getByTestId("condition-add").click();
  await builder.getByTestId("condition-value").selectOption({ label: "高" });
  await builder.getByTestId("action-row").getByLabel("任务标题").fill("跟进：{task}");
  await builder.getByTestId("action-add").click();
  const second = builder.getByTestId("action-row").nth(1);
  await second.getByLabel("动作类型").selectOption({ label: "发送站内通知" });
  await second.getByLabel("通知标题").fill("已完成：{task}");
  await builder.getByLabel("规则名称").fill("重要任务跟进");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await shot(page, `${OUT}/02-rule-builder.png`, { fullPage: true });

  // 5. Schedule trigger: the runtime requirement is stated.
  await builder.getByTestId("trigger-schedule").click();
  await page.getByTestId("schedule-fields").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/05-schedule-runtime.png`);

  // 3. Rule detail and history: success, condition skip, duplicate ignored.
  await page.goto(`/automation/${ids.followUp}`);
  await expect(page.getByTestId("execution-row").first()).toBeVisible();
  await shot(page, `${OUT}/03-rule-history.png`, { fullPage: true });

  // 4. A failed execution: what ran, what failed, why.
  await page.goto(`/automation/${ids.failing}`);
  await expect(page.getByTestId("execution-failure").first()).toBeVisible();
  await shot(page, `${OUT}/04-failed-execution.png`, { fullPage: true });

  // 6. Notifications.
  await page.goto("/automation/notifications");
  await expect(page.getByTestId("notification").first()).toBeVisible();
  await shot(page, `${OUT}/06-notifications.png`, { fullPage: true });

  const storage = await page.context().storageState();

  // 8–9. Phone.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  for (const [path, file] of [
    ["/automation", "08-mobile-rules.png"],
    [`/automation/${ids.followUp}`, "09-mobile-rule-detail.png"],
  ] as const) {
    await mobile.goto(path);
    await expect(mobile.locator("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await shot(mobile, `${OUT}/${file}`, { fullPage: true });
  }
  await phone.close();

  // 10. Dark mode.
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(`/automation/${ids.followUp}`);
  await expect(darkPage.getByTestId("execution-row").first()).toBeVisible();
  await shot(darkPage, `${OUT}/10-dark-rule-detail.png`, { fullPage: true });
  await dark.close();
});
