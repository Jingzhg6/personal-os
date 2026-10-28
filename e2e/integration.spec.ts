import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * Phase 1 integration: one captured task flows through every module that uses it (projects,
 * goals, XP, dashboard, automation), and back again when it is reopened; another user can reach
 * none of it; every navigation page renders in Chinese without errors or horizontal overflow.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};
const TITLE = "整理首页文案";

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "集成测试", email: uniqueEmail() });
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  ids.french = attributes.find((a) => a.systemKey === "french")!.id;
  const project = await mutate<{ id: string }>(page, "projects.create", { name: "网站改版" });
  const milestone = await mutate<{ id: string }>(page, "projects.milestones.create", {
    projectId: project.id,
    name: "上线首页",
    dueDate: day(10),
  });
  const task = await mutate<{ id: string }>(page, "tasks.create", {
    title: TITLE,
    projectId: project.id,
    milestoneId: milestone.id,
    dueDate: day(3),
    priority: 3,
    contributions: [{ attributeId: ids.french, weight: 2 }],
  });
  const goal = await mutate<{ id: string }>(page, "development.goals.create", {
    title: "提升法语写作",
    attributes: [{ attributeId: ids.french, weight: 3 }],
  });
  await mutate(page, "development.goals.linkTask", { goalId: goal.id, taskId: task.id });
  const rule = await mutate<{ id: string }>(page, "automation.rules.create", {
    name: "完成后检查",
    trigger: { type: "task.completed" },
    actions: [{ type: "create_follow_up_task", title: "检查：{task}", priority: 2 }],
  });
  await mutate(page, "automation.rules.setEnabled", { id: rule.id, enabled: true });
  Object.assign(ids, {
    project: project.id,
    milestone: milestone.id,
    task: task.id,
    goal: goal.id,
    rule: rule.id,
  });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

type Overview = {
  grantCount: number;
  reversalCount: number;
  totals: { lifetimeActiveXp?: number };
};
type Task = { id: string; title: string; statusCategory: string; projectId: string | null };
type ProjectDetail = { progress: { total: number; completed: number } };
type GoalDetail = { actions: { linked: number; completed: number; open: number } };

const allTasks = (page: Page) =>
  query<Task[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: true,
    filter: {},
  });

test("1 — one task, captured once, is the same record in every view", async ({ page }) => {
  // Task list, project, matrix and Gantt all show the single record.
  await page.goto("/tasks");
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto(`/projects/${ids.project}`);
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto("/tasks/matrix");
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await page.goto(`/development/goals/${ids.goal}`);
  await expect(page.getByText(TITLE).first()).toBeVisible();
  expect((await allTasks(page)).filter((t) => t.title === TITLE)).toHaveLength(1);
});

test("2 — completing it updates projects, goals, XP, the dashboard and automation", async ({
  page,
}) => {
  const before = await query<Overview>(page, "character.overview");
  await page.goto("/tasks");
  await page
    .getByRole("checkbox", { name: `完成「${TITLE}」` })
    .first()
    .click();
  await expect(page.getByRole("checkbox", { name: `完成「${TITLE}」` })).toHaveCount(0);

  // The checkbox updates optimistically; wait for the server-side effects.
  await expect
    .poll(async () => (await query<Overview>(page, "character.overview")).grantCount)
    .toBeGreaterThan(before.grantCount);
  // The automation rule created exactly one follow-up task, in the same project (M10 rule:
  // follow-ups go where the trigger lives).
  await expect
    .poll(async () => (await allTasks(page)).filter((t) => t.title === `检查：${TITLE}`).length)
    .toBe(1);
  const followUp = (await allTasks(page)).find((t) => t.title === `检查：${TITLE}`)!;
  expect(followUp.projectId).toBe(ids.project);
  const project = await query<ProjectDetail>(page, "projects.byId", {
    id: ids.project,
    today: day(0),
  });
  expect(project.progress).toMatchObject({ total: 2, completed: 1 });
  const goal = await query<GoalDetail>(page, "development.goals.detail", { id: ids.goal });
  expect(goal.actions).toMatchObject({ linked: 1, completed: 1, open: 0 });
  await page.goto("/");
  await expect(page.getByTestId("activity-entry").filter({ hasText: TITLE }).first()).toBeVisible();
});

test("3 — reopening reverses the XP; completing again creates no second follow-up", async ({
  page,
}) => {
  const before = await query<Overview>(page, "character.overview");
  await mutate(page, "tasks.reopen", { id: ids.task });
  const reopened = await query<Overview>(page, "character.overview");
  expect(reopened.reversalCount).toBe(before.reversalCount + 1);
  const goal = await query<GoalDetail>(page, "development.goals.detail", { id: ids.goal });
  expect(goal.actions).toMatchObject({ completed: 0, open: 1 });

  await mutate(page, "tasks.complete", { id: ids.task });
  const followUps = (await allTasks(page)).filter((t) => t.title === `检查：${TITLE}`);
  expect(followUps).toHaveLength(1);
});

test("4 — deleting it moves it to the Trash and out of every view; restoring brings it back", async ({
  page,
}) => {
  await mutate(page, "tasks.delete", { id: ids.task });
  expect((await allTasks(page)).some((t) => t.id === ids.task)).toBe(false);
  const project = await query<ProjectDetail>(page, "projects.byId", {
    id: ids.project,
    today: day(0),
  });
  // Only the follow-up task is left in the project.
  expect(project.progress).toMatchObject({ total: 1, completed: 0 });
  const trash = await query<{ id: string }[]>(page, "tasks.trash.list");
  expect(trash.map((t) => t.id)).toContain(ids.task);
  await mutate(page, "tasks.trash.restore", { id: ids.task });
  expect((await allTasks(page)).some((t) => t.id === ids.task)).toBe(true);
});

test("5 — another user can reach none of these records", async ({ browser }, testInfo) => {
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const page = await other.newPage();
  const get = (path: string, input: unknown) =>
    page.request.get(
      `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
    );
  const post = (path: string, input: unknown) =>
    page.request.post(`/api/trpc/${path}`, { data: { json: input } });

  expect((await get("tasks.byId", { id: ids.task })).status()).toBe(404);
  expect((await get("projects.byId", { id: ids.project, today: day(0) })).status()).toBe(404);
  expect((await get("development.goals.detail", { id: ids.goal })).status()).toBe(404);
  expect((await get("automation.rules.byId", { id: ids.rule })).status()).toBe(404);
  expect((await post("tasks.complete", { id: ids.task })).status()).toBe(404);
  expect((await post("tasks.delete", { id: ids.task })).status()).toBe(404);
  expect(
    (await post("development.goals.linkTask", { goalId: ids.goal, taskId: ids.task })).status(),
  ).toBe(404);
  // Referencing the other user's project from one's own task is refused, too.
  expect((await post("tasks.create", { title: "越权", projectId: ids.project })).status()).toBe(
    404,
  );
  const own = await query<{ id: string }[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: true,
    filter: {},
  });
  expect(own.map((t) => t.id)).not.toContain(ids.task);
  await page.goto(`/projects/${ids.project}`);
  await expect(page.getByText("网站改版")).toHaveCount(0);
  await other.close();
});

test("6 — every navigation page renders in Chinese, without errors or overflow", async ({
  page,
}) => {
  await page.goto("/");
  const hrefs = await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link")
    .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")!))]);
  expect(hrefs.length).toBeGreaterThan(15);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBeLessThan(400);
      await expect(page.locator("main").getByRole("heading", { level: 1 }), href).toBeVisible();
      await expect(page.getByText("出了点问题"), href).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${href} @ ${viewport.width}px`,
      ).toBe(true);
    }
  }
});
