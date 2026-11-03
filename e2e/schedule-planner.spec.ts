import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";

/*
 * Schedule Planner (V2, ADR 0028), one story for one fresh user in UTC: a quadrant's task dragged
 * onto the day view, the block moved and resized with the pointer, moved across days in the week
 * view, planned over several days in the month view; every change read back from the server.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};
const D = "2026-11-18"; // a Wednesday
const HOUR = 48;

type Block = { id: string; taskId: string; startAt: string; endAt: string; allDay: boolean };

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "日程测试", email: uniqueEmail() });
  await mutate(page, "settings.update", { timeZone: "UTC", weekStartsOn: 1 });
  const a = await mutate<{ id: string }>(page, "tasks.create", {
    title: "写季度总结",
    isUrgent: true,
    isImportant: true,
    estimatedMinutes: 30,
  });
  const b = await mutate<{ id: string }>(page, "tasks.create", {
    title: "规划旅行",
    isUrgent: false,
    isImportant: true,
  });
  Object.assign(ids, { a: a.id, b: b.id });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const blocks = (page: Page) =>
  query<Block[]>(page, "schedule.list", {
    from: "2026-10-26T00:00:00.000Z",
    to: "2026-12-07T00:00:00.000Z",
  });

async function dragTo(page: Page, from: Locator, x: number, y: number) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 });
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

/** Scrolls the time grid so `hour` is near its top and returns the column's box. */
async function column(page: Page, date: string, hour: number) {
  await page
    .getByTestId("schedule-grid")
    .evaluate((el, top) => (el.scrollTop = top), (hour - 1) * HOUR);
  return (await page.getByTestId(`schedule-column-${date}`).boundingBox())!;
}

test("1 — a quadrant task dragged onto the day view becomes a block at the drop time", async ({
  page,
}) => {
  await page.goto(`/schedule?view=day&date=${D}&q=do`);
  const task = page.getByTestId("schedule-task").filter({ hasText: "写季度总结" });
  await expect(task).toBeVisible();
  await expect(page.getByTestId("schedule-task").filter({ hasText: "规划旅行" })).toHaveCount(0);
  const box = await column(page, D, 10);
  await dragTo(page, task.getByTestId("schedule-task-handle"), box.x + 40, box.y + 10 * HOUR + 4);
  await expect
    .poll(async () => (await blocks(page)).map((b) => [b.startAt, b.endAt]))
    .toEqual([
      [`${D}T10:00:00.000Z`, `${D}T10:30:00.000Z`], // the task's 30-minute estimate
    ]);
  ids.block = (await blocks(page))[0]!.id;
  // The task itself is unchanged.
  const tasks = await query<{ id: string; dueDate: string | null }[]>(page, "tasks.list", {
    today: D,
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  expect(tasks.find((t) => t.id === ids.a)?.dueDate).toBeNull();
});

test("2 — moving and resizing in the day view are saved", async ({ page }) => {
  await page.goto(`/schedule?view=day&date=${D}`);
  const block = page.getByTestId("schedule-block").first();
  await expect(block).toBeVisible();
  await column(page, D, 10);
  const box = (await block.boundingBox())!;
  // Two hours down.
  await dragTo(page, block, box.x + box.width / 2, box.y + box.height / 2 + 2 * HOUR);
  await expect.poll(async () => (await blocks(page))[0]!.startAt).toBe(`${D}T12:00:00.000Z`);
  // Bottom edge one hour down: 12:00–13:30.
  await column(page, D, 12);
  const end = page.getByTestId("schedule-block").first().getByTestId("schedule-resize-end");
  const edge = (await end.boundingBox())!;
  await dragTo(page, end, edge.x + edge.width / 2, edge.y + edge.height / 2 + HOUR);
  await expect.poll(async () => (await blocks(page))[0]!.endAt).toBe(`${D}T13:30:00.000Z`);
  // After a reload the block is where it was left.
  await page.reload();
  await expect(page.getByTestId("schedule-block").first()).toContainText("12:00–13:30");
});

test("3 — overlapping blocks are flagged", async ({ page }) => {
  await mutate(page, "schedule.create", {
    taskId: ids.b,
    startAt: `${D}T13:00:00.000Z`,
    endAt: `${D}T14:00:00.000Z`,
  });
  await page.goto(`/schedule?view=day&date=${D}`);
  await expect(page.getByTestId("schedule-conflicts")).toContainText("2 个日程时间重叠");
});

test("4 — the week view moves a block to another day, keeping its time", async ({ page }) => {
  await page.goto(`/schedule?date=${D}`);
  await expect(page.getByTestId("schedule-view-week")).toHaveAttribute("aria-pressed", "true");
  const block = page.locator(`[data-block-id="${ids.block}"]`).first();
  await column(page, D, 12);
  const from = (await block.boundingBox())!;
  const next = (await page.getByTestId("schedule-column-2026-11-19").boundingBox())!;
  await dragTo(page, block, next.x + next.width / 2, from.y + from.height / 2);
  await expect
    .poll(async () => (await blocks(page)).find((b) => b.id === ids.block)?.startAt)
    .toBe("2026-11-19T12:00:00.000Z");
  expect((await blocks(page)).find((b) => b.id === ids.block)?.endAt).toBe(
    "2026-11-19T13:30:00.000Z",
  );
});

test("5 — the month view plans a task over several days", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`/schedule?view=month&date=${D}&q=schedule`);
  const task = page.getByTestId("schedule-task").filter({ hasText: "规划旅行" });
  const cell = (await page.locator(`[data-drop="day"][data-date="2026-11-24"]`).boundingBox())!;
  await dragTo(
    page,
    task.getByTestId("schedule-task-handle"),
    cell.x + cell.width / 2,
    cell.y + cell.height - 10,
  );
  await expect
    .poll(async () => (await blocks(page)).filter((b) => b.allDay).map((b) => [b.startAt, b.endAt]))
    .toEqual([["2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z"]]);
  // Stretch it to Thursday: a three-day bar.
  const bar = page.getByRole("button", { name: "规划旅行，全天" });
  const handle = bar.getByTestId("schedule-resize-days");
  const target = (await page.locator(`[data-drop="day"][data-date="2026-11-26"]`).boundingBox())!;
  const h = (await handle.boundingBox())!;
  await dragTo(page, handle, target.x + target.width / 2, h.y + h.height / 2);
  await expect
    .poll(async () => (await blocks(page)).find((b) => b.allDay)?.endAt)
    .toBe("2026-11-27T00:00:00.000Z");
});

test("6 — blocks follow their task: renamed, deleted block keeps the task, trash hides", async ({
  page,
}) => {
  await mutate(page, "tasks.update", { id: ids.a, patch: { title: "写年度总结" } });
  await page.goto(`/schedule?date=${D}`);
  await page.locator(`[data-block-id="${ids.block}"]`).first().click();
  await expect(page.getByTestId("schedule-editor-title")).toHaveText("写年度总结");
  await page.getByTestId("schedule-editor-delete").click();
  await expect.poll(async () => (await blocks(page)).some((b) => b.id === ids.block)).toBe(false);
  const tasks = await query<{ id: string }[]>(page, "tasks.list", {
    today: D,
    sort: "manual",
    includeSubtasks: false,
    filter: {},
  });
  expect(tasks.some((t) => t.id === ids.a)).toBe(true);
  // A task in the Trash takes its blocks out of the calendar.
  await mutate(page, "tasks.delete", { id: ids.b });
  expect(await blocks(page)).toEqual([]);
});

test("7 — another user cannot read or change the blocks; the page fits a phone", async ({
  page,
  browser,
}, testInfo) => {
  const block = await mutate<{ id: string }>(page, "schedule.create", {
    taskId: ids.a,
    startAt: `${D}T08:00:00.000Z`,
    endAt: `${D}T09:00:00.000Z`,
  });
  const other = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
    storageState: "e2e/.auth/user.json",
  });
  const otherPage = await other.newPage();
  const update = await otherPage.request.post("/api/trpc/schedule.update", {
    data: { json: { id: block.id, startAt: `${D}T01:00:00.000Z`, endAt: `${D}T02:00:00.000Z` } },
  });
  expect(update.status()).toBe(404);
  const create = await otherPage.request.post("/api/trpc/schedule.create", {
    data: { json: { taskId: ids.a, startAt: `${D}T01:00:00.000Z`, endAt: `${D}T02:00:00.000Z` } },
  });
  expect(create.status()).toBe(404);
  await other.close();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["day", "week", "month"]) {
    await page.goto(`/schedule?view=${view}&date=${D}`);
    await expect(page.getByTestId("schedule-planner")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      view,
    ).toBe(true);
  }
});
