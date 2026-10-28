import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * Recurring tasks (ADR 0023), as one story for one fresh user: a series set up in the task panel,
 * its instances completed, skipped, edited and stopped in the UI, and checked across views.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};
const TITLE = "整理周报";

type Task = {
  id: string;
  title: string;
  dueDate: string | null;
  recurrenceId: string | null;
  statusCategory: string;
  projectId: string | null;
  isUrgent: boolean | null;
};

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "重复测试", email: uniqueEmail() });
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const project = await mutate<{ id: string }>(page, "projects.create", { name: "团队周会" });
  const task = await mutate<{ id: string }>(page, "tasks.create", {
    title: TITLE,
    dueDate: day(0),
    projectId: project.id,
    isUrgent: true,
    isImportant: true,
  });
  Object.assign(ids, { project: project.id, first: task.id });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const tasksOf = (page: Page) =>
  query<Task[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
const openInstances = async (page: Page) =>
  (await tasksOf(page)).filter(
    (t) => t.title === TITLE && !["completed", "cancelled", "failed"].includes(t.statusCategory),
  );

test("1 — a daily rule is set in the task panel", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.first}`);
  const field = page.getByTestId("task-recurrence");
  await expect(field).toContainText("不重复");
  await field.getByTestId("recurrence-edit").click();
  await field.getByTestId("recurrence-frequency").selectOption("daily");
  await field.getByTestId("recurrence-save").click();
  await expect(field.getByTestId("recurrence-summary")).toContainText("每天 · 按固定日程");
  await expect(field.getByTestId("recurrence-upcoming")).toBeVisible();
  await page.goto("/tasks");
  await expect(page.getByTestId("recurring-mark").first()).toBeVisible();
});

test("2 — completing it creates the next instance, visible in every view", async ({ page }) => {
  await page.goto("/tasks");
  await page
    .getByRole("checkbox", { name: `完成「${TITLE}」` })
    .first()
    .click();
  await expect
    .poll(async () => (await openInstances(page)).map((t) => t.dueDate))
    .toEqual([day(1)]);
  const [next] = await openInstances(page);
  ids.second = next!.id;
  expect(next).toMatchObject({ projectId: ids.project, isUrgent: true });
  // Matrix, project and Gantt read the same task.
  await page.goto("/tasks/matrix");
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto(`/projects/${ids.project}`);
  await expect(page.getByText(TITLE).first()).toBeVisible();
  const timeline = await query<unknown>(page, "tasks.timeline", {
    today: day(0),
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  expect(JSON.stringify(timeline)).toContain(ids.second);
  // Completing the first one again (after reopening) creates nothing new.
  await mutate(page, "tasks.reopen", { id: ids.first });
  await mutate(page, "tasks.complete", { id: ids.first });
  expect(await openInstances(page)).toHaveLength(1);
});

test("3 — skipping an occurrence cancels it and schedules the next", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.second}`);
  const field = page.getByTestId("task-recurrence");
  await expect(field).toContainText("第 2 次");
  await field.getByTestId("recurrence-skip").click();
  await expect
    .poll(async () => (await openInstances(page)).map((t) => t.dueDate))
    .toEqual([day(2)]);
  const skipped = (await tasksOf(page)).find((t) => t.id === ids.second);
  expect(skipped?.statusCategory).toBe("cancelled");
  ids.third = (await openInstances(page))[0]!.id;
});

test("4 — the rule is changed on the newest instance; older ones are history", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.first}`);
  await expect(page.getByTestId("task-recurrence")).toContainText("较早的一次");
  await expect(page.getByTestId("recurrence-edit")).toHaveCount(0);

  await page.goto(`/tasks?task=${ids.third}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-edit").click();
  await field.getByTestId("recurrence-frequency").selectOption("weekly");
  await field.getByTestId("recurrence-mode").selectOption("after_completion");
  await field.getByTestId("recurrence-save").click();
  await expect(field.getByTestId("recurrence-summary")).toContainText("每周 · 完成后再计");
  await mutate(page, "tasks.complete", { id: ids.third });
  // After completion (today), weekly: a week from today.
  await expect
    .poll(async () => (await openInstances(page)).map((t) => t.dueDate))
    .toEqual([day(7)]);
  ids.fourth = (await openInstances(page))[0]!.id;
});

test("5 — stopping the series: no further instances", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.fourth}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-stop").click();
  await page.getByRole("dialog").getByRole("button", { name: "停止重复" }).click();
  await expect(field).toContainText("已停止重复");
  await mutate(page, "tasks.complete", { id: ids.fourth });
  expect(await openInstances(page)).toHaveLength(0);
});

test("6 — another user can neither read nor change the series", async ({ browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const page = await other.newPage();
  const get = await page.request.get(
    `/api/trpc/tasks.recurrence.get?input=${encodeURIComponent(JSON.stringify({ json: { taskId: ids.fourth } }))}`,
  );
  expect(get.status()).toBe(404);
  for (const path of ["tasks.recurrence.skip", "tasks.recurrence.stop"]) {
    const response = await page.request.post(`/api/trpc/${path}`, {
      data: { json: { taskId: ids.fourth } },
    });
    expect(response.status(), path).toBe(404);
  }
  const set = await page.request.post("/api/trpc/tasks.recurrence.set", {
    data: { json: { taskId: ids.first, rule: { frequency: "daily", interval: 1 }, mode: "fixed" } },
  });
  expect(set.status()).toBe(404);
  await other.close();
});

test("7 — the repeat section fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tasks?task=${ids.fourth}`);
  await expect(page.getByTestId("task-recurrence")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
