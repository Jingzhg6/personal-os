import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { confirmCompletion, register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * Navigation and task-handling round (2026-11), as one story for one fresh user: project areas
 * as defaults, moving unassigned tasks into projects, in-place editing in 全部任务, subtasks that
 * expand, and completion with a confirmed date.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};

type Task = {
  id: string;
  title: string;
  areaId: string | null;
  projectId: string | null;
  priority: number;
  startDate: string | null;
  dueDate: string | null;
  statusCategory: string;
  completedAt: string | null;
};

const byId = (page: Page, id: string) => query<Task>(page, "tasks.byId", { id });
const row = (page: Page, title: string) =>
  page.getByTestId("task-row").filter({ hasText: title }).first();

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "体验测试", email: uniqueEmail() });
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  ids.work = areas.find((a) => a.systemKey === "work")!.id;
  ids.learning = areas.find((a) => a.systemKey === "learning")!.id;
  const project = await mutate<{ id: string }>(page, "projects.create", {
    name: "官网改版",
    status: "active",
    areaId: ids.work,
  });
  ids.project = project.id;
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

test("1 — a task added inside a project takes the project's area", async ({ page }) => {
  await page.goto(`/projects/${ids.project}`);
  const input = page.getByLabel("快速添加任务");
  await input.fill("设计首页");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(row(page, "设计首页")).toBeVisible();
  const tasks = await query<Task[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: false,
    filter: { projectIds: [ids.project] },
  });
  const created = tasks.find((t) => t.title === "设计首页")!;
  expect(created).toMatchObject({ areaId: ids.work, startDate: day(0) });
});

test("2 — unassigned tasks are dragged (or moved) into a project in place", async ({ page }) => {
  const loose = await mutate<Task>(page, "tasks.create", { title: "整理需求文档" });
  const chosen = await mutate<Task>(page, "tasks.create", {
    title: "预约体检",
    areaId: ids.learning,
  });
  await page.goto("/projects");
  const panel = page.getByTestId("unassigned");
  await expect(panel).toContainText("未分配项目的任务");
  const item = panel.getByTestId("unassigned-task").filter({ hasText: "整理需求文档" });
  await expect(item).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydrated: drag handlers attached

  // Pointer drag onto the project card.
  const handle = item.getByRole("button", { name: "拖动「整理需求文档」到项目" });
  const target = page.getByTestId("project-drop").first();
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await page.mouse.up();
  // The toast (the screen-reader announcement says the same).
  await expect(page.getByText("已将「整理需求文档」移到「官网改版」").first()).toBeVisible();
  await expect(
    panel.getByTestId("unassigned-task").filter({ hasText: "整理需求文档" }),
  ).toHaveCount(0);
  // Same task: its project set, the empty area filled from the project.
  expect(await byId(page, loose.id)).toMatchObject({
    id: loose.id,
    projectId: ids.project,
    areaId: ids.work,
  });

  // The menu (keyboard and touch): a task with its own area keeps it.
  await panel
    .getByRole("combobox", { name: "把「预约体检」移到项目" })
    .selectOption({ label: "官网改版" });
  await expect(page.getByText("已将「预约体检」移到「官网改版」").first()).toBeVisible();
  expect(await byId(page, chosen.id)).toMatchObject({
    projectId: ids.project,
    areaId: ids.learning,
  });
});

test("3 — 全部任务 edits fields in place; new tasks start today, old ones are left alone", async ({
  page,
}) => {
  const old = await mutate<Task>(page, "tasks.create", { title: "旧任务无开始日期" });
  await page.goto("/tasks");
  const input = page.getByLabel("快速添加任务");
  await input.fill("写周报");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const fields = row(page, "写周报").getByTestId("task-quick-fields");
  await expect(fields.getByLabel("「写周报」的开始日期")).toHaveValue(day(0));

  await fields.getByRole("button", { name: /「写周报」的优先级/ }).click();
  await page.getByRole("menuitemradio", { name: "高", exact: true }).click();
  await fields.getByRole("button", { name: /「写周报」的领域/ }).click();
  await page.getByRole("menuitemradio", { name: "学习", exact: true }).click();
  await fields.getByRole("button", { name: /「写周报」的项目/ }).click();
  await page.getByRole("menuitemradio", { name: "官网改版", exact: true }).click();
  await fields.getByLabel("「写周报」的截止日期").fill(day(3));
  await expect(fields.getByRole("button", { name: "「写周报」的优先级：高" })).toBeVisible();

  await page.reload();
  const reloaded = row(page, "写周报").getByTestId("task-quick-fields");
  await expect(reloaded.getByRole("button", { name: "「写周报」的优先级：高" })).toBeVisible();
  await expect(reloaded.getByRole("button", { name: "「写周报」的领域：学习" })).toBeVisible();
  await expect(reloaded.getByRole("button", { name: "「写周报」的项目：官网改版" })).toBeVisible();
  await expect(reloaded.getByLabel("「写周报」的截止日期")).toHaveValue(day(3));

  // Editing an existing task never gives it a start date.
  await row(page, "旧任务无开始日期")
    .getByRole("button", { name: /「旧任务无开始日期」的优先级/ })
    .click();
  await page.getByRole("menuitemradio", { name: "低", exact: true }).click();
  await expect.poll(async () => (await byId(page, old.id)).priority).toBe(1);
  expect((await byId(page, old.id)).startDate).toBeNull();
});

test("4 — subtasks expand under their task and stay consistent with it", async ({ page }) => {
  const parent = await mutate<Task>(page, "tasks.create", { title: "准备搬家" });
  const a = await mutate<Task>(page, "tasks.create", { title: "订纸箱", parentTaskId: parent.id });
  const b = await mutate<Task>(page, "tasks.create", {
    title: "约搬家公司",
    parentTaskId: parent.id,
  });
  ids.parent = parent.id;
  await page.goto("/tasks");
  const parentRow = row(page, "准备搬家");
  await expect(parentRow).toContainText("0/2");
  await parentRow.getByRole("button", { name: "展开「准备搬家」的子任务" }).click();
  const subtasks = parentRow.getByTestId("subtask-rows");
  await expect(subtasks.getByTestId("task-row")).toHaveCount(2);

  // Complete one subtask from the expanded list.
  await subtasks.getByRole("checkbox", { name: "完成「订纸箱」" }).click();
  await confirmCompletion(page);
  await expect(parentRow).toContainText("1/2");
  expect((await byId(page, a.id)).statusCategory).toBe("completed");

  await parentRow.getByRole("button", { name: "收起「准备搬家」的子任务" }).click();
  await expect(parentRow.getByTestId("subtask-rows")).toHaveCount(0);

  // Completing the parent offers to complete the open subtask on the same date.
  await parentRow.getByRole("checkbox", { name: "完成「准备搬家」" }).click();
  await expect(page.getByTestId("complete-dialog")).toContainText("同时完成 1 个未完成的子任务");
  await expect(page.getByTestId("complete-subtasks")).toBeChecked();
  await confirmCompletion(page);
  await expect.poll(async () => (await byId(page, b.id)).statusCategory).toBe("completed");
  const [p, s] = [await byId(page, parent.id), await byId(page, b.id)];
  expect(s.completedAt).toBe(p.completedAt);
});

test("5 — completion asks for the date: cancel changes nothing, earlier dates are recorded", async ({
  page,
}) => {
  await mutate(page, "tasks.create", { title: "交水电费" });
  await page.goto("/tasks");
  const checkbox = row(page, "交水电费").getByRole("checkbox", { name: "完成「交水电费」" });

  await checkbox.click();
  await expect(page.getByTestId("complete-date")).toHaveValue(day(0));
  await page
    .getByRole("dialog", { name: "确认完成" })
    .getByRole("button", { name: "取消" })
    .click();
  await expect(page.getByTestId("complete-dialog")).toBeHidden();
  await expect(checkbox).not.toBeChecked();
  const listed = await query<Task[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  const task = listed.find((t) => t.title === "交水电费")!;
  expect(task.statusCategory).not.toBe("completed");

  await checkbox.click();
  await confirmCompletion(page, day(-3));
  await expect.poll(async () => (await byId(page, task.id)).completedAt).not.toBeNull();
  // Recorded on that day (noon local time), not now.
  expect((await byId(page, task.id)).completedAt!.slice(0, 10)).toBe(day(-3));
});

test("6 — the task list stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks");
  await expect(row(page, "写周报").getByTestId("task-quick-fields")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto("/projects");
  await expect(page.getByTestId("unassigned")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
