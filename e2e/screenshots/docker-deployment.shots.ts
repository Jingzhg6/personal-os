import { devices, expect, test } from "@playwright/test";

import { day, mutate, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/docker-deployment";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/*
 * Docker deployment check (ADR 0026). Run while deploy/compose.yaml is up on port 3100 with the
 * worker configured: Playwright then reuses that server, so every page below is served by the
 * containers (app, database, worker), not by a local build.
 */

test("Docker deployment visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });

  // A recurring task completed once: its next occurrence is created by the containerised app.
  const daily = await mutate<{ id: string }>(page, "tasks.create", {
    title: "晨间复盘",
    dueDate: day(0),
    isImportant: true,
  });
  await mutate(page, "tasks.recurrence.set", {
    taskId: daily.id,
    rule: { frequency: "daily", interval: 1 },
    mode: "fixed",
  });
  await mutate(page, "tasks.complete", { id: daily.id });
  await mutate(page, "tasks.create", { title: "整理发票", dueDate: day(2) });

  // A one-time schedule a minute or two ahead: the worker container runs it.
  const at = new Date(Date.now() + 90_000);
  const rule = await mutate<{ id: string }>(page, "automation.rules.create", {
    name: "提醒记录余额",
    trigger: {
      type: "schedule",
      schedule: {
        kind: "once",
        date: at.toISOString().slice(0, 10),
        time: at.toISOString().slice(11, 16),
      },
    },
    actions: [{ type: "notify", title: "该记录本月余额了" }],
  });
  await mutate(page, "automation.rules.setEnabled", { id: rule.id, enabled: true });

  // 1. The dashboard served from the container.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot(page, `${OUT}/01-dashboard.png`);

  // 2. Tasks: the next occurrence of the recurring task, made in the container.
  await page.goto("/tasks");
  await expect(page.getByTestId("recurring-mark").first()).toBeVisible();
  await shot(page, `${OUT}/02-tasks-recurring.png`);

  // 3–4. Automation: the rule executed by the worker, and the scheduler running (heartbeat).
  await expect
    .poll(
      async () => {
        await page.goto(`/automation/${rule.id}`);
        await page.waitForLoadState("networkidle"); // executions are fetched by the client
        return page.getByTestId("execution-row").count();
      },
      { timeout: 200_000, intervals: [15_000] },
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("execution-row").first()).toContainText("成功");
  await shot(page, `${OUT}/04-rule-run-by-worker.png`);
  await page.goto("/automation");
  await expect(page.getByTestId("health-scheduler")).toContainText("计划调度运行中");
  await shot(page, `${OUT}/03-automation-worker.png`);

  // 5. JSON export from the container.
  await page.goto("/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-button").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^personal-os-export-.*\.json$/);
  await expect(page.getByTestId("export-last")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByTestId("export-data").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/05-settings-export.png`);

  // 6. Phone.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: await page.context().storageState(),
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/");
  await expect(mobile.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/06-mobile-dashboard.png`);
  await phone.close();
});
