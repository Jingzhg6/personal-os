import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";

/*
 * M9 growth planning and goal attribution, as one story for one fresh user (sign-up is
 * rate-limited). Plans, task creation and allocations are driven through the UI; XP comes from
 * real completions. Every figure is asserted exactly.
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
  await register(page, { name: "计划测试", email: uniqueEmail() });
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  ids.french = attributes.find((a) => a.systemKey === "french")!.id;
  ids.reading = attributes.find((a) => a.systemKey === "reading")!.id;
  const goal = await mutate<{ id: string }>(page, "development.goals.create", {
    title: "法语达到 B1",
    attributes: [{ attributeId: ids.french, weight: 3 }],
  });
  ids.goal = goal.id;
  const travel = await mutate<{ id: string }>(page, "development.goals.create", {
    title: "去法国旅行",
    attributes: [{ attributeId: ids.french, weight: 2 }],
  });
  ids.travel = travel.id;
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

const goalPage = (page: Page, id = ids.goal) => page.goto(`/development/goals/${id}`);
const plan = (page: Page, title: string) => page.getByTestId("plan").filter({ hasText: title });

test("empty states: no plans and no actions yet", async ({ page }) => {
  await page.goto("/development");
  await expect(page.getByTestId("plans-overview-empty")).toBeVisible();
  await goalPage(page);
  await expect(page.getByTestId("plans-empty")).toContainText("这个目标还没有成长计划。");
  await expect(page.getByTestId("goal-tasks-empty")).toContainText("这个目标还没有关联行动。");
  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("0");
  await expect(page.getByTestId("unattributed-xp")).toHaveText("0 XP");
});

test("creates a growth plan and an ordinary task inside it", async ({ page }) => {
  await goalPage(page);
  await page.getByLabel("新建成长计划").fill("建立每日法语输入习惯");
  await page.getByLabel("计划说明").fill("每天至少进行 30 分钟法语学习。");
  await page.getByTestId("new-plan").getByRole("button", { name: "创建计划" }).click();
  const daily = plan(page, "建立每日法语输入习惯");
  await expect(daily).toBeVisible();
  await expect(daily).toContainText("每天至少进行 30 分钟法语学习。");
  await expect(daily.getByTestId("plan-actions")).toHaveText("还没有行动");

  await daily.getByLabel("计划中的新任务").fill("学习法语 30 分钟");
  await daily.getByLabel("计划中的新任务").press("Enter");
  await expect(daily.getByTestId("goal-task")).toHaveCount(1);
  await expect(daily.getByTestId("plan-actions")).toHaveText("已完成 0 / 1 项行动");

  // A normal task: in the task list.
  await page.goto("/tasks");
  await expect(page.getByTestId("task-row").filter({ hasText: "学习法语 30 分钟" })).toBeVisible();
});

test("links an existing task to the plan (and to the goal)", async ({ page }) => {
  await mutate(page, "tasks.create", {
    title: "精听一期法语播客",
    priority: 2,
    contributions: [{ attributeId: ids.french, weight: 2 }],
  });
  await goalPage(page);
  const daily = plan(page, "建立每日法语输入习惯");
  await daily.getByRole("button", { name: "加入已有任务" }).click();
  await page.getByRole("option", { name: /精听一期法语播客/ }).click();
  await expect(daily.getByTestId("goal-task")).toHaveCount(2);
  await expect(page.getByTestId("evidence-actions")).toContainText("已完成 0 / 2 项行动");
});

test("completing plan tasks updates the goal's statistics", async ({ page }) => {
  await goalPage(page);
  const daily = plan(page, "建立每日法语输入习惯");
  for (const title of ["学习法语 30 分钟", "精听一期法语播客"]) {
    await daily.getByTestId("goal-task").filter({ hasText: title }).getByRole("checkbox").click();
  }
  // 10 XP (priority 0, 法语 from the goal) + 20 XP (priority 2), each 100 % to the only goal.
  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("30");
  await expect(page.getByTestId("recent-completed")).toHaveText("2");
  await expect(page.getByTestId("recent-attributed")).toHaveText("+30");
  await expect(daily.getByTestId("plan-actions")).toHaveText("已完成 2 / 2 项行动");
  await expect(daily.getByTestId("task-attributed").first()).toBeVisible();
});

test("goal XP is not the attribute's XP: an unlinked task does not count", async ({ page }) => {
  const trip = await mutate<{ id: string }>(page, "tasks.create", {
    title: "法国旅游准备",
    contributions: [{ attributeId: ids.french, weight: 2 }],
  });
  await mutate(page, "tasks.complete", { id: trip.id });
  await goalPage(page);
  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("30");
  // The attribute itself grew by 40 — shown as the attribute's overall growth.
  await expect(page.getByTestId("goal-attribute").first()).toContainText("累计 40 XP");
});

test("allocates one task shared by two goals, 60 / 40", async ({ page }) => {
  const shared = await mutate<{ id: string }>(page, "tasks.create", {
    title: "在巴黎点餐练习",
    priority: 2,
    contributions: [{ attributeId: ids.french, weight: 2 }],
  });
  ids.shared = shared.id;
  await mutate(page, "development.goals.setForTask", {
    taskId: shared.id,
    goalIds: [ids.goal, ids.travel],
  });
  await mutate(page, "tasks.complete", { id: shared.id });

  await goalPage(page);
  const row = page.getByTestId("goal-task").filter({ hasText: "在巴黎点餐练习" });
  await expect(row.getByTestId("task-needs-allocation")).toHaveText("待分配");
  await expect(page.getByTestId("unattributed-xp")).toHaveText("20 XP");

  await row.getByRole("button", { name: "编辑「在巴黎点餐练习」的成长归属" }).click();
  const dialog = page.getByTestId("attribution-dialog");
  await dialog.getByLabel("「法语达到 B1」在「法语」中的比例").fill("60");
  await dialog.getByLabel("「去法国旅行」在「法语」中的比例").fill("50");
  await expect(dialog.getByRole("alert")).toContainText("合计超过 100%");
  await expect(dialog.getByRole("button", { name: "保存归属" })).toBeDisabled();
  await dialog.getByLabel("「去法国旅行」在「法语」中的比例").fill("40");
  await expect(dialog.getByTestId("attribution-unattributed")).toContainText("0 XP");
  await dialog.getByRole("button", { name: "保存归属" }).click();

  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("42"); // 30 + 12
  await expect(row.getByTestId("task-attributed")).toHaveText("+12 XP 归属");
  await expect(page.getByTestId("unattributed-xp")).toHaveText("0 XP");
  await goalPage(page, ids.travel);
  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("8");
});

test("partial attribution leaves unattributed XP on display", async ({ page }) => {
  await goalPage(page, ids.travel);
  const row = page.getByTestId("goal-task").filter({ hasText: "在巴黎点餐练习" });
  await row.getByRole("button", { name: "编辑「在巴黎点餐练习」的成长归属" }).click();
  const dialog = page.getByTestId("attribution-dialog");
  await dialog.getByLabel("「去法国旅行」在「法语」中的比例").fill("15");
  await expect(dialog.getByTestId("attribution-unattributed")).toContainText("25");
  await dialog.getByRole("button", { name: "保存归属" }).click();
  // trunc(20 × 15 %) = 3; 20 − 12 − 3 = 5 unattributed.
  await expect(page.getByTestId("goal-attributed-xp")).toHaveText("3");
  await expect(page.getByTestId("unattributed-xp")).toHaveText("5 XP");
  await expect(row.getByTestId("task-unattributed")).toHaveText("5 XP 未归属");
});

test("the task panel opens the same attribution editor", async ({ page }) => {
  await page.goto(`/tasks?task=${ids.shared}`);
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await panel.getByTestId("open-attribution").click();
  const dialog = page.getByTestId("attribution-dialog");
  await expect(dialog.getByLabel("「法语达到 B1」在「法语」中的比例")).toHaveValue("60");
  await expect(dialog.getByLabel("「去法国旅行」在「法语」中的比例")).toHaveValue("15");
});

test("the overview shows goal-specific XP and plan activity", async ({ page }) => {
  await page.goto("/development");
  const card = page.getByTestId("goal-card").filter({ hasText: "法语达到 B1" });
  await expect(card.getByTestId("goal-recent-growth")).toHaveText("本目标近 30 天 +42 XP");
  await expect(card.getByTestId("goal-plan-count")).toHaveText("1 个计划");
  await expect(page.getByTestId("plans-withActivity")).toContainText("建立每日法语输入习惯");
  await expect(page.getByTestId("active-plan-count")).toHaveText("1 个进行中的计划");
});

test("attribution never changes XP: dashboard and balances stay the same", async ({ page }) => {
  const before = await query(page, "rewards.balances");
  await page.goto("/");
  const active = await page.getByTestId("dash-active-lifetime").textContent();
  const growth = await page.getByTestId("dash-growth-lifetime").textContent();
  await mutate(page, "development.attribution.set", {
    taskId: ids.shared,
    allocations: [{ goalId: ids.goal, attributeId: ids.french, share: 100 }],
  });
  expect(await query(page, "rewards.balances")).toEqual(before);
  await page.reload();
  await expect(page.getByTestId("dash-active-lifetime")).toHaveText(active!);
  await expect(page.getByTestId("dash-growth-lifetime")).toHaveText(growth!);
});

test("phone layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await goalPage(page);
  await expect(page.getByTestId("plan").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const id of ["goal-evidence", "goal-plans", "goal-tasks"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test("dark mode keeps the goal page readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await goalPage(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId("plan").first()).toBeVisible();
  const contrast = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    };
    const plan = document.querySelector('[data-testid="plan"]')!;
    const title = plan.querySelector('[data-testid="plan-title"]')!;
    return {
      surface: luminance(getComputedStyle(plan).backgroundColor),
      text: luminance(getComputedStyle(title).color),
    };
  });
  expect(contrast.surface).toBeLessThan(0.2);
  expect(contrast.text).toBeGreaterThan(0.8);
});
