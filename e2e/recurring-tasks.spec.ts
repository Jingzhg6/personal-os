import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * Recurring tasks (ADR 0023, V2 in ADR 0028), as one story for one fresh user: a calendar series
 * generated ahead as independent instances, paused and resumed; a completion-based series with one
 * open instance; stopping; isolation between users.
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

const instancesOf = async (page: Page, title: string) =>
  (await tasksOf(page)).filter((t) => t.title === title);
const isOpen = (t: Task) => !["completed", "cancelled", "failed"].includes(t.statusCategory);

test("1 — a calendar rule generates independent daily instances ahead", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.first}`);
  const field = page.getByTestId("task-recurrence");
  await expect(field).toContainText("不重复");
  await field.getByTestId("recurrence-edit").click();
  await expect(field.getByTestId("recurrence-mode")).toHaveValue("fixed");
  await field.getByTestId("recurrence-frequency").selectOption("daily");
  await expect(field.getByTestId("recurrence-start")).toHaveValue(day(0));
  await field.getByTestId("recurrence-save").click();
  await expect(field.getByTestId("recurrence-summary")).toContainText("每天 · 按日历周期生成");
  await expect.poll(async () => (await openInstances(page)).length).toBeGreaterThanOrEqual(28);
  const open = await openInstances(page);
  expect(open.slice(0, 3).map((t) => t.dueDate)).toEqual([day(0), day(1), day(2)]);
  // Every instance is its own task with the template's fields.
  expect(new Set(open.map((t) => t.id)).size).toBe(open.length);
  expect(open[1]).toMatchObject({ projectId: ids.project, isUrgent: true });
  ids.second = open[1]!.id;
  await page.goto("/tasks");
  await expect(page.getByTestId("recurring-mark").first()).toBeVisible();
});

test("2 — completing one instance leaves the others; nothing is generated twice", async ({
  page,
}) => {
  const before = (await openInstances(page)).length;
  await mutate(page, "tasks.complete", { id: ids.first });
  await mutate(page, "tasks.recurrence.refresh", {});
  expect((await openInstances(page)).length).toBe(before - 1);
  const all = await instancesOf(page, TITLE);
  expect(new Set(all.map((t) => t.dueDate)).size).toBe(all.length);
  // Matrix and Gantt read the same task rows; the Gantt keeps the series on one row.
  await page.goto("/tasks/matrix");
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto("/projects/gantt");
  await expect(page.getByTestId("gantt-row").filter({ hasText: TITLE })).toHaveCount(1);
});

test("3 — pausing removes untouched future instances; resuming fills the window again", async ({
  page,
}) => {
  await page.goto(`/tasks?task=${ids.second}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-pause").click();
  await expect(field.getByTestId("recurrence-summary")).toContainText("已暂停");
  // Untouched future instances are removed, except the one the series was paused from.
  await expect
    .poll(async () => (await openInstances(page)).map((t) => t.dueDate))
    .toEqual([day(1)]);
  // The completed one stays as history.
  expect((await instancesOf(page, TITLE)).filter((t) => !isOpen(t))).toHaveLength(1);
  await field.getByTestId("recurrence-resume").click();
  await expect.poll(async () => (await openInstances(page)).length).toBeGreaterThanOrEqual(28);
  const all = await instancesOf(page, TITLE);
  expect(new Set(all.map((t) => t.dueDate)).size).toBe(all.length);
});

test("4 — completion-based: one open instance, the next counted from completion", async ({
  page,
}) => {
  const task = await mutate<{ id: string }>(page, "tasks.create", {
    title: "复盘",
    dueDate: day(-3),
  });
  await page.goto(`/tasks?task=${task.id}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-edit").click();
  await field.getByTestId("recurrence-mode").selectOption("after_completion");
  await field.getByTestId("recurrence-frequency").selectOption("weekly");
  await field.getByTestId("recurrence-start").fill(day(-3));
  await field.getByTestId("recurrence-save").click();
  await expect(field.getByTestId("recurrence-summary")).toContainText("每周 · 完成上一次后再生成");
  expect((await instancesOf(page, "复盘")).filter(isOpen)).toHaveLength(1);
  await mutate(page, "tasks.complete", { id: task.id });
  await expect
    .poll(async () => (await instancesOf(page, "复盘")).filter(isOpen).map((t) => t.dueDate))
    .toEqual([day(7)]);
  ids.fourth = (await instancesOf(page, "复盘")).filter(isOpen)[0]!.id;
});

test("5 — stopping the series: no further instances", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.fourth}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-stop").click();
  await page.getByRole("dialog").getByRole("button", { name: "终止重复" }).click();
  await expect(field).toContainText("已终止");
  await mutate(page, "tasks.complete", { id: ids.fourth });
  expect((await instancesOf(page, "复盘")).filter(isOpen)).toHaveLength(0);
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
    data: {
      json: {
        taskId: ids.first,
        rule: { frequency: "daily", interval: 1 },
        mode: "fixed",
        startDate: day(0),
      },
    },
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
