import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;
const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });
const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });
/** The e2e user's timezone is the browser's (UTC in CI), detected at registration. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function quickAdd(page: Page, text: string) {
  const input = page.getByLabel("快速添加任务");
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

/**
 * Keyboard drag: lift with Space, move one step up, drop. Waits on dnd-kit's live region,
 * which always holds the latest announcement (in Chinese).
 */
async function dragUpByKeyboard(page: Page, handleName: string, title: string) {
  // Each sortable list has its own live region; use the one announcing this item.
  const live = page.locator('[id^="DndLiveRegion"]').filter({ hasText: `「${title}」` });
  await page.getByRole("button", { name: handleName }).focus();
  await page.keyboard.press("Space");
  await expect(live).toHaveText(new RegExp(`「${title}」移动到第 \\d+ 位。`));
  const lifted = (await live.textContent()) ?? "";
  await page.keyboard.press("ArrowUp");
  await expect(live).not.toHaveText(lifted);
  await page.keyboard.press("Space");
  await expect(live).toHaveText(new RegExp(`「${title}」已放到第 \\d+ 位。`));
}

async function openTask(page: Page, title: string) {
  await row(page, title).locator("[data-row-main]").click();
  await expect(panel(page)).toBeVisible();
}

test.describe("search, filters and sorting", () => {
  test("searches titles, descriptions and subtasks, and keeps the query in the URL", async ({
    page,
  }) => {
    const key = unique("检索");
    await page.goto("/tasks");
    await quickAdd(page, `${key} 父任务`);
    await openTask(page, `${key} 父任务`);
    await panel(page).getByLabel("添加子任务，按回车保存").fill(`${key} 子任务`);
    await panel(page).getByLabel("添加子任务，按回车保存").press("Enter");
    await expect(
      panel(page).getByRole("button", { name: `${key} 子任务`, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByLabel("搜索任务").fill(key);
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(key)}`));
    await expect(page.getByTestId("task-row")).toHaveCount(2);
    await expect(row(page, `${key} 子任务`)).toContainText(`属于「${key} 父任务」`);
    await expect(page.getByText("找到 2 个任务")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("搜索任务")).toHaveValue(key);
    await expect(page.getByTestId("task-row")).toHaveCount(2);

    await page.getByLabel("搜索任务").fill(`${key}不存在`);
    await expect(page.getByText("没有符合条件的任务")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("filters by priority and flags through menus, and sorts", async ({ page }) => {
    const key = unique("筛选");
    await page.goto("/tasks");
    await quickAdd(page, `${key}低 !1`);
    await quickAdd(page, `${key}最高 !4`);
    await quickAdd(page, `${key}高 !3`);
    await page.getByLabel("搜索任务").fill(key);
    await expect(page.getByTestId("task-row")).toHaveCount(3);

    await page.getByRole("button", { name: "优先级" }).click();
    await page.getByRole("menuitemcheckbox", { name: "高", exact: true }).click();
    await page.getByRole("menuitemcheckbox", { name: "最高" }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/priority=3%2C4|priority=3,4/);
    await expect(page.getByTestId("task-row")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "优先级：2 项" })).toBeVisible();

    await page.getByLabel("排序").selectOption({ label: "按优先级" });
    await expect(page.getByTestId("task-row").first()).toContainText(`${key}最高`);

    await page.getByRole("button", { name: "紧急" }).click();
    await page.getByRole("menuitemradio", { name: "是" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("没有符合条件的任务")).toBeVisible();
  });
});

test("reorders tasks by keyboard drag-and-drop and keeps the order", async ({ page }) => {
  const first = unique("排序甲");
  const second = unique("排序乙");
  await page.goto("/tasks");
  await quickAdd(page, first);
  await quickAdd(page, second);
  const titles = () =>
    page
      .getByTestId("task-row")
      .locator("[data-row-main] > span > span:first-child")
      .allTextContents();
  const before = await titles();
  expect(before.indexOf(second)).toBe(before.indexOf(first) + 1);

  await dragUpByKeyboard(page, `拖动「${second}」调整顺序`, second);
  await expect
    .poll(async () => {
      const order = await titles();
      return order.indexOf(second) < order.indexOf(first);
    })
    .toBe(true);

  await page.reload();
  await expect(row(page, second)).toBeVisible();
  const after = await titles();
  expect(after.indexOf(second)).toBe(after.indexOf(first) - 1);
});

test("navigates the list with the keyboard", async ({ page }) => {
  const title = unique("键盘");
  await page.goto("/tasks");
  await quickAdd(page, title);
  await page.goto(`/tasks?q=${encodeURIComponent(title)}`);
  await expect(row(page, title)).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });

  await page.keyboard.press("j");
  await expect(row(page, title).locator("[data-row-main]")).toBeFocused();
  await page.keyboard.press("o");
  await expect(panel(page).getByRole("textbox", { name: "标题" })).toHaveValue(title);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByRole("button", { name: /显示已完成/ })).toBeVisible();

  await page.keyboard.press("/");
  await expect(page.getByLabel("搜索任务")).toBeFocused();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("n");
  await expect(page.getByLabel("快速添加任务")).toBeFocused();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "键盘快捷键" })).toBeVisible();
});

test("restores and permanently deletes tasks in the Trash", async ({ page }) => {
  const keep = unique("恢复我");
  const purge = unique("彻底删除");
  await page.goto("/tasks");
  for (const title of [keep, purge]) {
    await quickAdd(page, title);
    await openTask(page, title);
    await panel(page).getByRole("button", { name: "删除任务" }).click();
    await page
      .getByRole("dialog", { name: "删除这个任务？" })
      .getByRole("button", { name: "删除" })
      .click();
    await expect(row(page, title)).toHaveCount(0);
  }

  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "回收站" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "回收站" })).toBeVisible();
  const trashRow = (title: string) => page.getByTestId("trash-row").filter({ hasText: title });

  await trashRow(keep).getByRole("button", { name: "恢复" }).click();
  await expect(trashRow(keep)).toHaveCount(0);

  await trashRow(purge).getByRole("button", { name: "永久删除" }).click();
  await page
    .getByRole("dialog", { name: `永久删除「${purge}」？` })
    .getByRole("button", { name: "永久删除" })
    .click();
  await expect(trashRow(purge)).toHaveCount(0);

  await page.goto("/tasks");
  await expect(row(page, keep)).toBeVisible();
  await expect(row(page, purge)).toHaveCount(0);
});

test("scoped views show their areas, file new tasks there and can be re-scoped", async ({
  page,
}) => {
  const workTask = unique("工作视图");
  const businessTask = unique("业务视图");
  await page.goto("/tasks");
  await quickAdd(page, `${businessTask} @业务`);

  await page.goto("/work");
  await expect(page.getByRole("heading", { level: 1, name: "工作" })).toBeVisible();
  await quickAdd(page, workTask);
  await expect(row(page, workTask)).toContainText("工作");
  await expect(row(page, businessTask)).toHaveCount(0);

  await page.getByRole("button", { name: "编辑领域" }).click();
  await page.getByRole("menuitemcheckbox", { name: "业务" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(row(page, businessTask)).toBeVisible();

  // The same task is visible in 全部任务 and in the 业务 view: one record, several views.
  await page.goto("/work/business");
  await expect(row(page, businessTask)).toBeVisible();

  // Restore the default scope of the 工作 view.
  await page.goto("/work");
  await page.getByRole("button", { name: "编辑领域" }).click();
  await page.getByRole("menuitemcheckbox", { name: "业务" }).click();
  await page.getByRole("button", { name: "保存" }).click();
  await expect(row(page, businessTask)).toHaveCount(0);
});

test("groups open tasks with due dates in the deadlines view", async ({ page }) => {
  const dueToday = unique("今天截止");
  const overdue = unique("逾期");
  await page.goto("/tasks");
  await quickAdd(page, dueToday);
  await openTask(page, dueToday);
  await panel(page).getByLabel("截止日期").fill(todayUtc());
  await expect(panel(page).getByLabel("截止日期")).toHaveValue(todayUtc());
  await quickAdd(page, overdue);
  await openTask(page, overdue);
  await panel(page).getByLabel("截止日期").fill("2026-01-05");
  await expect(panel(page).getByLabel("截止日期")).toHaveValue("2026-01-05");

  await page.goto("/admin/deadlines");
  await expect(page.getByRole("region", { name: /^今天/ }).getByText(dueToday)).toBeVisible();
  await expect(page.getByRole("region", { name: /^已逾期/ }).getByText(overdue)).toBeVisible();
  await expect(page.getByLabel("快速添加任务")).toHaveCount(0);
});

test("moves a task under another task and back, and reorders subtasks", async ({ page }) => {
  const parent = unique("上级");
  const child = unique("下级");
  await page.goto("/tasks");
  await quickAdd(page, parent);
  await quickAdd(page, child);

  await openTask(page, child);
  await panel(page).getByRole("button", { name: "更改" }).click();
  await page.getByRole("textbox", { name: "搜索要移入的任务" }).fill(parent);
  await page.getByRole("option", { name: parent }).click();
  await expect(
    panel(page).getByRole("button", { name: parent, exact: true }).first(),
  ).toBeVisible();
  await expect(row(page, child)).toHaveCount(0);
  await expect(row(page, parent)).toContainText("0/1");

  await panel(page).getByRole("button", { name: "更改" }).click();
  await page.getByRole("option", { name: "设为顶层任务" }).click();
  await expect(panel(page).getByText("无（顶层任务）")).toBeVisible();
  await expect(row(page, child)).toBeVisible();

  // Subtask order inside the panel.
  await openTask(page, parent);
  const add = panel(page).getByLabel("添加子任务，按回车保存");
  for (const title of ["第一步", "第二步"]) {
    await add.fill(title);
    await add.press("Enter");
    await expect(panel(page).getByRole("button", { name: title, exact: true })).toBeVisible();
  }
  await dragUpByKeyboard(page, "拖动「第二步」调整子任务顺序", "第二步");
  await expect(panel(page).getByTestId("subtask-row").first()).toContainText("第二步");
  await page.reload();
  await expect(panel(page).getByTestId("subtask-row").first()).toContainText("第二步");
});
