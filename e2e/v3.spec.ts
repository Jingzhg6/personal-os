import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { confirmCompletion, register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

/*
 * V3 (ADR 0029), one story for one fresh user: navigation reordered by dragging and kept, the
 * area Kanban with project cards, the matrix project view, the Gantt project → task → subtask
 * hierarchy, and investment accounts / holdings / transactions through the UI.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
const ids: Record<string, string> = {};

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "三号", email: uniqueEmail() });
  await mutate(page, "settings.update", { timeZone: "UTC" });
  await mutate(page, "finance.setBaseCurrency", { baseCurrency: "EUR" });
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  const area = areas.find((a) => a.systemKey === "work") ?? areas[0]!;
  const project = await mutate<{ id: string }>(page, "projects.create", {
    name: "网站改版",
    areaId: area.id,
    status: "active",
  });
  const task = (input: Record<string, unknown>) =>
    mutate<{ id: string }>(page, "tasks.create", input);
  const design = await task({
    title: "设计稿",
    projectId: project.id,
    startDate: day(0),
    dueDate: day(4),
    isUrgent: true,
    isImportant: true,
  });
  await task({ title: "首页", parentTaskId: design.id, startDate: day(1), dueDate: day(2) });
  await task({ title: "详情页", parentTaskId: design.id, startDate: day(3), dueDate: day(6) });
  await task({
    title: "上线",
    projectId: project.id,
    dueDate: day(9),
    isUrgent: false,
    isImportant: true,
  });
  Object.assign(ids, { area: area.id, project: project.id, design: design.id });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

async function drag(page: Page, from: Locator, to: Locator, dy = 0) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 15 });
  await page.mouse.up();
}

test("1 — navigation groups and pages are reordered by dragging, kept, and reset", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "主导航" });
  const headings = () => nav.getByRole("heading", { level: 2 }).allTextContents();
  expect((await headings()).slice(0, 3)).toEqual(["概览", "任务", "工作与事务"]);
  await nav.getByTestId("nav-customize").click();
  // While reordering, pages are not links: dragging can never navigate.
  await expect(nav.getByRole("link")).toHaveCount(0);
  await drag(
    page,
    nav.getByRole("button", { name: "拖动分组「财务」" }),
    nav.getByRole("button", { name: "拖动分组「概览」" }),
    -6,
  );
  await expect.poll(async () => (await headings())[0]).toBe("财务");
  // A page within its group: 全部项目 below 全部任务.
  const allProjects = nav.getByRole("button", { name: "拖动「全部项目」" });
  await allProjects.scrollIntoViewIfNeeded();
  await drag(page, allProjects, nav.getByRole("button", { name: "拖动「全部任务」" }), 8);
  const tasksItems = () =>
    nav
      .locator('[data-section="tasks"] [data-item]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-item")));
  await expect
    .poll(async () => (await tasksItems()).slice(0, 2))
    .toEqual(["allTasks", "allProjects"]);
  await nav.getByTestId("nav-customize").click();
  await expect
    .poll(
      async () =>
        (await query<{ navLayout: { sections: string[] } | null }>(page, "settings.get")).navLayout
          ?.sections[0],
    )
    .toBe("finance");

  await page.reload();
  expect((await headings())[0]).toBe("财务");
  expect((await tasksItems()).slice(0, 2)).toEqual(["allTasks", "allProjects"]);

  await nav.getByTestId("nav-customize").click();
  await nav.getByTestId("nav-reset").click();
  await expect.poll(async () => (await headings())[0]).toBe("概览");
  await expect
    .poll(async () => (await query<{ navLayout: unknown }>(page, "settings.get")).navLayout)
    .toBeNull();
});

test("2 — the area Kanban shows project cards with progress and moves tasks", async ({ page }) => {
  await page.goto(`/projects/kanban?area=${ids.area}`);
  const card = page.getByTestId("area-board-project").filter({ hasText: "网站改版" });
  // Two tasks and two subtasks, none done.
  await expect(card).toContainText("0/4 个任务");
  await card.getByTestId("area-board-project-toggle").click();
  const cards = card.getByTestId("kanban-card");
  await expect(cards).toHaveCount(2);
  const started = card.getByTestId("kanban-column").filter({ hasText: "进行中" });
  await drag(page, cards.filter({ hasText: "上线" }), started);
  await expect(started.getByTestId("kanban-card")).toContainText("上线");
  await expect
    .poll(async () => {
      const tasks = await query<{ title: string; statusCategory: string }[]>(page, "tasks.list", {
        today: day(0),
        sort: "manual",
        includeSubtasks: false,
        filter: {},
      });
      return tasks.find((t) => t.title === "上线")?.statusCategory;
    })
    .toBe("started");

  // Completing a task on the board updates the project's progress at once.
  await card.getByRole("checkbox", { name: "完成「上线」" }).click();
  await confirmCompletion(page);
  await expect(card).toContainText("1/4 个任务");
  await expect(card).toContainText("25%");

  // A subtask completed elsewhere counts too (seen after the page reloads its data).
  const subtasks = await query<{ id: string; title: string }[]>(page, "tasks.list", {
    today: day(0),
    sort: "manual",
    includeSubtasks: true,
    filter: {},
  });
  await mutate(page, "tasks.complete", { id: subtasks.find((t) => t.title === "首页")!.id });
  await page.reload();
  await expect(
    page.getByTestId("area-board-project").filter({ hasText: "网站改版" }),
  ).toContainText("2/4 个任务");
});

test("3 — the matrix project view groups the same tasks without reclassifying them", async ({
  page,
}) => {
  await page.goto("/tasks/matrix");
  await page.getByTestId("matrix-view-projects").click();
  await expect(page).toHaveURL(/view=projects/);
  const card = page.getByTestId("matrix-project").filter({ hasText: "网站改版" });
  await expect(card).toContainText("2/4 个任务");
  await expect(card).toContainText("重要且紧急 1"); // 设计稿
  await expect(card).toContainText("未分类 1"); // its subtask 详情页 has no flags
  await expect(card).toContainText("重要不紧急 0"); // 上线 is done
  await card.getByTestId("matrix-project-toggle").click();
  await expect(card.getByTestId("matrix-project-task")).toHaveCount(2);
  await page.getByTestId("matrix-view-tasks").click();
  await expect(page.getByTestId("matrix-zone-do")).toContainText("设计稿");
  const design = await query<{ isUrgent: boolean; isImportant: boolean }>(page, "tasks.byId", {
    id: ids.design,
  });
  expect(design).toMatchObject({ isUrgent: true, isImportant: true });
});

test("4 — the Gantt chart nests project → task → subtask, each collapsible", async ({ page }) => {
  await page.goto("/projects/gantt");
  const group = page.getByTestId("gantt-group").filter({ hasText: "网站改版" });
  await expect(group).toBeVisible();
  await expect(page.getByTestId("gantt-project-span").first()).toBeVisible();
  // 首页 is completed: hidden by default. 详情页 shows under 设计稿.
  const sub = page.locator('[data-testid="gantt-row"][data-depth="1"]');
  await expect(sub).toHaveCount(1);
  await expect(sub).toContainText("详情页");
  const designRow = page.getByTestId("gantt-row").filter({ hasText: "设计稿" });
  await designRow.getByTestId("gantt-task-toggle").click();
  await expect(sub).toHaveCount(0);
  await designRow.getByTestId("gantt-task-toggle").click();
  await expect(sub).toHaveCount(1);
  await page.getByTestId("gantt-toggle-all").click();
  await expect(page.getByTestId("gantt-row")).toHaveCount(0);
  await page.getByTestId("gantt-toggle-all").click();
  await expect(page.getByTestId("gantt-row").filter({ hasText: "设计稿" })).toBeVisible();
  // 上线 is completed: hidden by default, still a task.
  await expect(page.getByTestId("gantt-row").filter({ hasText: "上线" })).toHaveCount(0);
});

test("5 — investment accounts, holdings and transactions through the UI", async ({ page }) => {
  await page.goto("/finance/investments");
  await page.getByTestId("investment-account-add").click();
  await page.getByTestId("investment-account-name").fill("券商 A");
  await page.getByTestId("investment-account-submit").click();
  await expect(page.getByTestId("investment-account")).toContainText("券商 A");

  await page.getByTestId("holding-add").click();
  await page.getByTestId("holding-name").fill("沪深300 ETF");
  await page.getByTestId("holding-submit").click();
  const holding = page.getByTestId("holding-row").filter({ hasText: "沪深300 ETF" });
  await expect(holding).toBeVisible();

  const record = async (kind: string, quantity: string, price: string, fee = "") => {
    await holding.getByTestId("holding-trade").click();
    await page.getByTestId("transaction-kind").selectOption(kind);
    await page.getByTestId("transaction-date").fill(day(-1));
    await page.getByTestId("transaction-quantity").fill(quantity);
    await page.getByTestId("transaction-price").fill(price);
    if (fee) await page.getByTestId("transaction-fee").fill(fee);
    await page.getByTestId("transaction-submit").click();
    await expect(page.getByTestId("transaction-form")).toBeHidden();
  };
  await record("buy", "10", "100", "5");
  await record("sell", "4", "120", "2");
  await expect(holding.getByTestId("holding-units")).toHaveText("6");
  await expect(holding.getByTestId("holding-valuation")).toHaveText("按成本估算");
  await expect(holding.getByTestId("holding-realized")).toContainText("76.00");

  // A manual price turns the estimate into a valuation with its date.
  await holding.getByTestId("holding-edit").click();
  await page.getByTestId("holding-price").fill("130");
  await page.getByTestId("holding-submit").click();
  await expect(holding.getByTestId("holding-valuation")).toContainText("手动价格");
  await expect(holding.getByTestId("holding-value")).toContainText("780.00");
  await expect(holding.getByTestId("holding-unrealized")).toContainText("177.00");

  // Selling more than held is refused; editing and deleting a transaction recompute.
  await holding.getByTestId("holding-trade").click();
  await page.getByTestId("transaction-kind").selectOption("sell");
  await page.getByTestId("transaction-quantity").fill("50");
  await page.getByTestId("transaction-price").fill("1");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByText("卖出数量超过了当时持有的数量。")).toBeVisible();
  await page.keyboard.press("Escape");

  const sell = page.getByTestId("transaction-row").filter({ hasText: "卖出" });
  await sell.getByTestId("transaction-edit").click();
  await page.getByTestId("transaction-quantity").fill("5");
  await page.getByTestId("transaction-amount").fill("");
  await page.getByTestId("transaction-submit").click();
  await expect(holding.getByTestId("holding-units")).toHaveText("5");
  await sell.getByTestId("transaction-delete").click();
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(holding.getByTestId("holding-units")).toHaveText("10");

  // Counted once in the asset overview (EUR account, base currency EUR).
  const overview = await query<{ assets: string; investments: { value: string } }>(
    page,
    "finance.overview",
  );
  expect(overview.investments.value).toBe("1300.00");
  expect(overview.assets).toBe("1300.00");
});
