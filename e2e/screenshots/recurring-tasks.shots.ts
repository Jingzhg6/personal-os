import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/recurring-tasks";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* Recurring series made through the app's API; instances created by completing and skipping. */

type Created = { id: string };

async function seed(page: Page) {
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);
  const set = (taskId: string, rule: Record<string, unknown>, mode = "fixed") =>
    mutate(page, "tasks.recurrence.set", { taskId, rule, mode });

  const project = await mutate<Created>(page, "projects.create", { name: "团队周会" });
  const weekly = await task({
    title: "整理周报",
    dueDate: day(0),
    dueTime: "17:00",
    projectId: project.id,
    isUrgent: true,
    isImportant: true,
    priority: 3,
  });
  await set(weekly.id, { frequency: "weekly", interval: 1, weekdays: [1, 3, 5] });
  await mutate(page, "tasks.complete", { id: weekly.id });

  const run = await task({ title: "晨跑 5 公里", dueDate: day(0), isImportant: true });
  await set(run.id, { frequency: "daily", interval: 1, end: { type: "count", count: 30 } });
  await mutate(page, "tasks.recurrence.skip", { taskId: run.id });

  const sheets = await task({ title: "换床单", dueDate: day(2) });
  await set(sheets.id, { frequency: "daily", interval: 7 }, "after_completion");

  const bills = await task({ title: "交房租", dueDate: day(3), priority: 4 });
  await set(bills.id, { frequency: "monthly", interval: 1, monthDay: -1 });
  await task({ title: "预约牙医", dueDate: day(4) });
  return { weekly, bills };
}

test("Recurring tasks visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const { bills, weekly } = await seed(page);

  // 1. The task list: every open occurrence is an ordinary task, marked as recurring.
  await page.goto("/tasks");
  await expect(page.getByTestId("recurring-mark").first()).toBeVisible();
  await shot(page, `${OUT}/01-task-list.png`);

  // 2. The task panel of the newest occurrence: rule, position, upcoming dates, skip / stop.
  await page.goto(`/tasks?task=${bills.id}`);
  await expect(page.getByTestId("recurrence-summary")).toBeVisible();
  await page
    .getByTestId("task-recurrence")
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/02-panel-summary.png`);

  // 3. Editing the rule.
  await page.getByTestId("recurrence-edit").click();
  await page.getByTestId("recurrence-frequency").selectOption("weekly");
  await expect(page.getByTestId("recurrence-form")).toBeVisible();
  await page.getByTestId("recurrence-form").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/03-panel-edit.png`);

  // 4. The matrix: the next 整理周报 occurrence, in its quadrant like any task.
  await page.goto("/tasks/matrix");
  await expect(page.getByText("整理周报").first()).toBeVisible();
  await shot(page, `${OUT}/04-matrix.png`);

  const storage = await page.context().storageState();
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto(`/tasks?task=${bills.id}`);
  await expect(mobile.getByTestId("task-recurrence")).toBeVisible();
  await mobile.getByTestId("task-recurrence").scrollIntoViewIfNeeded();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/05-mobile-panel.png`);
  await phone.close();

  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(`/tasks?task=${weekly.id}`);
  await expect(darkPage.getByTestId("recurrence-summary")).toBeVisible();
  await darkPage
    .getByTestId("task-recurrence")
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(darkPage, `${OUT}/06-dark-panel.png`);
  await dark.close();
});
