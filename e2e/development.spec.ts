import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";

/*
 * M8 development system, as one story for one fresh user (sign-up is rate-limited, and the
 * shared e2e user is used by parallel tests). Goals, links and focus are driven through the UI.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "成长测试", email: uniqueEmail() });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

interface Keyed {
  id: string;
  systemKey: string | null;
}

async function openDevelopment(page: Page) {
  await page.goto("/development");
  await expect(page.getByRole("heading", { level: 1, name: "成长" })).toBeVisible();
}

const goalCard = (page: Page, title: string) =>
  page.getByTestId("goal-card").filter({ hasText: title });

test("empty states guide a new user", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "成长", exact: true })
    .click();
  await expect(page).toHaveURL(/\/development$/);
  await expect(page.getByTestId("vision-empty")).toContainText("你还没有写下自己的成长方向。");
  await expect(page.getByTestId("goals-empty")).toContainText("先定义一个你真正想变得更好的方向。");
  await expect(page.getByTestId("focus-empty")).toContainText("选择最多 3 个当前成长重点。");
  await expect(page.getByTestId("recent-growth-empty")).toBeVisible();
  // The user's own attributes, not a fixed list.
  // Five seeded attributes plus the fixed 自制力 (M10.5).
  await expect(page.getByTestId("attribute-card")).toHaveCount(6);
});

test("writes and edits the vision", async ({ page }) => {
  await openDevelopment(page);
  await page.getByRole("button", { name: "写下成长方向" }).click();
  await page.getByLabel("你希望成为一个怎样的人？").fill("成为能流利使用法语、身体健康的人。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("vision-text")).toHaveText("成为能流利使用法语、身体健康的人。");

  await page.getByTestId("vision").getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("你希望成为一个怎样的人？").fill("成为能流利使用法语和英语的人。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("vision-text")).toHaveText("成为能流利使用法语和英语的人。");
});

test("creates a goal with weighted attributes, then edits it", async ({ page }) => {
  await openDevelopment(page);
  await page.getByRole("button", { name: "新建成长目标" }).first().click();
  const form = page.getByTestId("goal-form");
  await form.getByLabel("目标", { exact: true }).fill("法语达到 B1");
  await form.getByLabel("说明").fill("能看懂法语新闻。");
  await form.getByLabel("优先级").selectOption({ label: "高优先级" });
  await form.getByLabel("目标日期").fill("2027-06-30");
  // At least one attribute is required.
  await expect(form.getByRole("button", { name: "创建目标" })).toBeDisabled();
  await form.getByRole("button", { name: "法语" }).click();
  await form.getByRole("button", { name: "阅读" }).click();
  await form.getByLabel("「法语」的权重").selectOption({ label: "主要" });
  await form.getByLabel("「阅读」的权重").selectOption({ label: "少量" });
  await form.getByRole("button", { name: "创建目标" }).click();

  // Lands on the new goal.
  await expect(page).toHaveURL(/\/development\/goals\/[0-9a-f-]+$/);
  await expect(page.getByTestId("goal-title")).toHaveText("法语达到 B1");
  await expect(page.getByTestId("goal-status")).toHaveText("进行中");
  await expect(page.getByTestId("goal-attribute")).toHaveCount(2);
  await expect(page.getByTestId("goal-attribute").first()).toContainText("权重：主要");
  await expect(page.getByTestId("goal-tasks-empty")).toContainText("这个目标还没有关联行动。");

  await page.getByRole("button", { name: "编辑" }).click();
  await page.getByTestId("goal-form").getByLabel("目标", { exact: true }).fill("法语达到 B2");
  await page.getByTestId("goal-form").getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("goal-title")).toHaveText("法语达到 B2");

  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByTestId("goal-status")).toHaveText("已暂停");
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByTestId("goal-status")).toHaveText("进行中");
});

test("links an existing task and creates a new one from the goal", async ({ page }) => {
  await mutate(page, "tasks.create", { title: "整理法语语法笔记" });
  await openDevelopment(page);
  await goalCard(page, "法语达到 B2").getByRole("link", { name: "打开「法语达到 B2」" }).click();

  // Link an existing task.
  await page.getByRole("button", { name: "关联已有任务" }).click();
  await page.getByRole("option", { name: /整理法语语法笔记/ }).click();
  await expect(page.getByTestId("goal-task")).toHaveCount(1);

  // Create a new, ordinary task linked to this goal.
  await page.getByLabel("新任务名称").fill("法语口语练习 30 分钟");
  await page.getByLabel("新任务名称").press("Enter");
  await expect(page.getByTestId("goal-task")).toHaveCount(2);
  await expect(page.getByTestId("goal-actions").first()).toHaveText("已完成 0 / 2 项行动");

  // Complete it here: progress counts it.
  await page
    .getByTestId("goal-task")
    .filter({ hasText: "法语口语练习 30 分钟" })
    .getByRole("checkbox")
    .click();
  await expect(page.getByTestId("goal-actions").first()).toHaveText("已完成 1 / 2 项行动");
  await expect(page.getByTestId("recent-completed")).toHaveText("1"); // M9 evidence card

  // Open the task: it is a normal task with the goal's attributes as contributions, and the goal.
  await page.getByRole("button", { name: "打开「整理法语语法笔记」" }).click();
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await expect(panel.getByTestId("task-goal")).toHaveText("法语达到 B2");
  await page.keyboard.press("Escape");

  // The created task appears everywhere tasks do.
  await page.goto("/tasks");
  await page.getByRole("button", { name: /显示已完成/ }).click();
  await expect(
    page.getByTestId("task-row").filter({ hasText: "法语口语练习 30 分钟" }),
  ).toBeVisible();
  // It earned XP by the normal rule (10) split over the goal's attributes (法语 3 : 阅读 1).
  const balances = await query<{ lifetimeActiveXp: number; lifetimeLevelXp: number }>(
    page,
    "rewards.balances",
  );
  expect(balances).toMatchObject({ lifetimeActiveXp: 10, lifetimeLevelXp: 10 });

  // Unlink from the goal: the task itself stays.
  await page.goto("/development");
  await goalCard(page, "法语达到 B2").getByRole("link").first().click();
  await page.getByRole("button", { name: "取消关联「整理法语语法笔记」" }).click();
  await expect(page.getByTestId("goal-task")).toHaveCount(1);
  expect(
    (await query<{ title: string }[]>(page, "tasks.list", { today: "2026-10-27" })).map(
      (t) => t.title,
    ),
  ).toContain("整理法语语法笔记");
});

test("links a goal from the task panel", async ({ page }) => {
  await page.goto("/tasks");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "整理法语语法笔记" })
    .locator("[data-row-main]")
    .click();
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await panel.getByRole("button", { name: "关联目标" }).click();
  await page.getByRole("option", { name: "法语达到 B2" }).click();
  await expect(panel.getByTestId("task-goal")).toHaveText("法语达到 B2");
  await page.goto("/development");
  await expect(goalCard(page, "法语达到 B2").getByTestId("goal-actions")).toHaveText(
    "已完成 1 / 2 项行动",
  );
});

test("chooses at most three focus attributes, separate from recent growth", async ({ page }) => {
  await openDevelopment(page);
  await page.getByRole("button", { name: "选择成长重点" }).click();
  const dialog = page.getByTestId("focus-dialog");
  for (const name of ["英语", "力量", "有氧"]) await dialog.getByLabel(name).check();
  await expect(dialog.getByTestId("focus-count")).toContainText("已选 3 / 3");
  // The rest are disabled at the limit.
  await expect(dialog.getByLabel("法语")).toBeDisabled();
  await dialog.getByLabel("力量").uncheck();
  await dialog.getByLabel("法语").check();
  await dialog.getByRole("button", { name: "保存成长重点" }).click();

  const focus = page.getByTestId("focus-list");
  await expect(focus.getByRole("listitem")).toHaveText([/英语/, /有氧/, /法语/]);
  // Recent growth is measured: 法语 grew (it was not chosen first), 英语 did not.
  const recent = page.getByTestId("recent-row");
  await expect(recent.first()).toContainText("法语");
  await expect(recent.filter({ hasText: "英语" })).toHaveCount(0);
  await expect(
    page.getByTestId("attribute-card").filter({ hasText: "英语" }).getByTestId("attribute-focused"),
  ).toBeVisible();

  // The dashboard's focus card shows the chosen focus and links here.
  await page.goto("/");
  await expect(page.getByTestId("chosen-focus")).toContainText("英语");
  await page.getByTestId("growth-focus").getByRole("link", { name: "成长规划" }).click();
  await expect(page).toHaveURL(/\/development$/);
});

test("attribute detail shows growth, goals, tasks and sources", async ({ page }) => {
  await openDevelopment(page);
  await page.getByRole("link", { name: "查看「法语」" }).click();
  await expect(page).toHaveURL(/\/development\/attributes\/[0-9a-f-]+$/);
  await expect(page.getByTestId("attribute-name")).toHaveText("法语");
  // 10 XP split 3:1 → 法语 8 (largest remainder), 阅读 2.
  await expect(page.getByTestId("attribute-detail-lifetime")).toHaveText("8");
  await expect(page.getByTestId("attribute-detail-recent")).toHaveText("+8");
  await expect(page.getByTestId("attribute-goals")).toContainText("法语达到 B2");
  await expect(page.getByTestId("attribute-sources")).toContainText("法语口语练习 30 分钟");
  await expect(page.getByTestId("attribute-entries").getByTestId("xp-entry")).toHaveCount(1);
  await expect(page.getByTestId("trend-bar")).toHaveCount(1);
});

test("archives and restores a goal", async ({ page }) => {
  await openDevelopment(page);
  await goalCard(page, "法语达到 B2").getByRole("link").first().click();
  await page.getByRole("button", { name: "归档" }).click();
  await expect(page.getByTestId("goal-status")).toHaveText("已归档");
  await expect(page.getByRole("button", { name: "关联已有任务" })).toHaveCount(0);
  await page.goto("/development");
  await expect(page.getByTestId("goals-empty")).toBeVisible();
  await page.getByTestId("archived-goals").locator("summary").click();
  await page.getByTestId("archived-goals").getByRole("button", { name: "恢复" }).click();
  await expect(goalCard(page, "法语达到 B2")).toBeVisible();
});

test("phone layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDevelopment(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const id of ["vision", "focus", "recent-growth", "goals", "attributes"]) {
    const section = page.getByTestId(id);
    await section.scrollIntoViewIfNeeded();
    const box = (await section.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await goalCard(page, "法语达到 B2").getByRole("link").first().click();
  await expect(page.getByTestId("goal-detail")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("dark mode keeps the page readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openDevelopment(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("goal-card").first()).toBeVisible();
  const contrast = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    };
    const card = document.querySelector('[data-testid="goal-card"]')!;
    const title = card.querySelector("a")!;
    return {
      surface: luminance(getComputedStyle(card).backgroundColor),
      text: luminance(getComputedStyle(title).color),
    };
  });
  expect(contrast.surface).toBeLessThan(0.2);
  expect(contrast.text).toBeGreaterThan(0.8);
});

test("rejects another user's goal", async ({ page }) => {
  // A well-formed id that is not this user's goal shows the not-found state, not data.
  await page.goto(`/development/goals/${crypto.randomUUID()}`);
  await expect(page.getByText("这个成长目标不存在或已被删除。")).toBeVisible();
  const attributes = await query<Keyed[]>(page, "character.attributes.list");
  expect(attributes.length).toBeGreaterThan(0);
});
