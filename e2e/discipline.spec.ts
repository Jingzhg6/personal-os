import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";
import { disciplineWorkerText, workerMode } from "./worker-mode";

/*
 * M10.5 自制力, as one story for one fresh user. Tasks are created and changed through the app's
 * API and UI; the only direct database write backdates `tasks.planned_at` (a deadline "planned
 * three days ago"), because a planned task cannot be produced in the same minute otherwise.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const DAY = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

test.afterAll(() => pool.end());

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "自制力测试", email: uniqueEmail() });
  // A fixed zone so "today" and the deadlines are deterministic.
  await mutate(page, "settings.update", { timeZone: "UTC" });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

async function plannedTask(page: Page, title: string, dueOffset: number) {
  const task = await mutate<{ id: string }>(page, "tasks.create", {
    title,
    dueDate: isoDay(dueOffset),
  });
  await pool.query("update tasks set planned_at = now() - interval '3 days' where id = $1", [
    task.id,
  ]);
  return task.id;
}

interface Attribute {
  id: string;
  systemKey: string | null;
  points: number | null;
  onRadar: boolean;
}
const disciplineAttribute = async (page: Page) =>
  (await query<Attribute[]>(page, "character.attributes.list")).find(
    (a) => a.systemKey === "discipline",
  )!;

test("1 — every user has a fixed 自制力 attribute in the growth system", async ({ page }) => {
  const attribute = await disciplineAttribute(page);
  ids.attribute = attribute.id;
  expect(attribute).toMatchObject({ points: 0, onRadar: true });
  await page.goto("/development");
  const card = page.getByTestId("attribute-card").filter({ hasText: "自制力" });
  await expect(card.getByTestId("discipline-card")).toContainText("0 分");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/development/attributes/${attribute.id}$`));
  const panel = page.getByTestId("discipline-panel");
  await expect(panel.getByTestId("discipline-score")).toHaveText("0 分");
  await expect(panel.getByTestId("discipline-rules")).toContainText("+15");
  await expect(panel.getByTestId("discipline-rules")).toContainText("-5");
  // The overdue check's state depends on the deployment (e2e/worker-mode.ts).
  await expect(panel.getByTestId("discipline-worker")).toContainText(
    disciplineWorkerText[workerMode],
  );
  await expect(panel.getByTestId("discipline-history")).toContainText("还没有计分记录");
});

test("2 — it cannot be renamed or removed; radar visibility is the user's choice", async ({
  page,
}) => {
  await page.goto("/character/attributes");
  const row = page.locator('[data-testid="attribute-setting"][data-system="discipline"]');
  await expect(row).toContainText("系统属性");
  await expect(row.getByRole("textbox")).toHaveCount(0);
  await expect(row.getByRole("button", { name: /归档|删除/ })).toHaveCount(0);
  const rename = await page.request.post("/api/trpc/character.attributes.update", {
    data: { json: { id: ids.attribute, patch: { name: "改名" } } },
  });
  expect(rename.status()).toBe(400);

  await row.getByTestId("discipline-on-radar").uncheck();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await page.reload();
  await expect(
    page.locator('[data-system="discipline"]').getByTestId("discipline-on-radar"),
  ).not.toBeChecked();
  expect((await disciplineAttribute(page)).onRadar).toBe(false);
});

test("3 — completing planned tasks scores early, on time and late; hidden still scores", async ({
  page,
}) => {
  for (const [title, offset] of [
    ["提前完成的报告", 2],
    ["按时完成的报告", 0],
    ["逾期完成的报告", -1],
  ] as const) {
    const id = await plannedTask(page, title, offset);
    await mutate(page, "tasks.complete", { id });
  }
  // Ad hoc: created and completed at once — no points.
  const adHoc = await mutate<{ id: string }>(page, "tasks.create", {
    title: "随手完成",
    dueDate: isoDay(0),
  });
  await mutate(page, "tasks.complete", { id: adHoc.id });
  expect((await disciplineAttribute(page)).points).toBe(28);

  await page.goto(`/development/attributes/${ids.attribute}`);
  await expect(page.getByTestId("discipline-score")).toHaveText("28 分");
  const history = page.getByTestId("discipline-history");
  await expect(history.getByTestId("discipline-entry")).toHaveCount(3);
  await expect(
    history.getByTestId("discipline-entry").filter({ hasText: "提前完成的报告" }),
  ).toContainText("+15");
  await expect(
    history.getByTestId("discipline-entry").filter({ hasText: "逾期完成的报告" }),
  ).toContainText("逾期完成");

  // Turn the radar back on.
  await page.goto("/character/attributes");
  await page.locator('[data-system="discipline"]').getByTestId("discipline-on-radar").check();
  await expect(page.getByText("已保存").first()).toBeVisible();
});

test("4 — marking a task failed in the task panel: status, −5 and its reason", async ({ page }) => {
  const id = await plannedTask(page, "放弃的计划", 3);
  ids.failed = id;
  await page.goto(`/tasks?task=${id}`);
  await expect(page.getByTestId("task-discipline")).toContainText("不计分");
  await page.getByTestId("task-fail").click();
  await expect(page.getByTestId("task-discipline-net")).toHaveText("-5 分");
  await expect(page.getByTestId("task-discipline")).toContainText("任务失败");
  await expect(page.getByTestId("task-failed-at")).toBeVisible();
  await expect(page.getByTestId("task-fail")).toHaveCount(0);
  // Deleting and restoring keeps the result, without scoring again.
  await mutate(page, "tasks.delete", { id });
  await mutate(page, "tasks.trash.restore", { id });
  const forTask = await query<{ net: number; entries: unknown[] }>(
    page,
    "character.discipline.forTask",
    { taskId: id },
  );
  expect(forTask).toMatchObject({ net: -5 });
  expect(forTask.entries).toHaveLength(1);
});

test("5 — an overdue task is penalised once by the overdue check (manual path without a worker)", async ({
  page,
}) => {
  const id = await plannedTask(page, "拖延的任务", -2);
  ids.overdue = id;
  await page.goto("/automation");
  await page.getByTestId("health-run-due").click();
  await expect(page.getByText(/已执行 0 个计划/)).toBeVisible();
  await page.getByTestId("health-run-due").click();
  const forTask = await query<{ net: number; entries: { reason: string }[] }>(
    page,
    "character.discipline.forTask",
    { taskId: id },
  );
  expect(forTask.net).toBe(-3);
  expect(forTask.entries.map((e) => e.reason)).toEqual(["overdue"]);
  // Then failed: net −5, not −8.
  await mutate(page, "tasks.fail", { id });
  const after = await query<{ net: number }>(page, "character.discipline.forTask", { taskId: id });
  expect(after.net).toBe(-5);
  expect((await disciplineAttribute(page)).points).toBe(28 - 5 - 5);
});

test("6 — another user can neither see nor change these results", async ({ browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const page = await other.newPage();
  const forTask = await query<{ net: number; entries: unknown[] }>(
    page,
    "character.discipline.forTask",
    {
      taskId: ids.failed,
    },
  );
  expect(forTask).toEqual({ net: 0, outcome: null, entries: [] });
  const fail = await page.request.post("/api/trpc/tasks.fail", {
    data: { json: { id: ids.overdue } },
  });
  expect(fail.status()).toBe(404);
  await other.close();
});

test("7 — the 自制力 page fits a phone and dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    `/development/attributes/${ids.attribute}`,
    "/character/attributes",
    "/character",
  ]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      path,
    ).toBe(true);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/development/attributes/${ids.attribute}`);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("discipline-score")).toHaveText("18 分");
  // The radar shows 自制力 again (it was switched back on).
  await page.goto("/character");
  await expect(page.getByTestId("attribute-radar")).toContainText("自制力");
});
