import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";

/*
 * M7 dashboard, as one story for one fresh user (sign-up is rate-limited and the shared e2e user
 * is used by parallel tests). XP is earned through real task completions; the dashboard only
 * reads. Every number is asserted exactly.
 */

test.describe.configure({ mode: "serial" });

let account: Awaited<ReturnType<BrowserContext["storageState"]>>;

test.beforeAll(async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  await register(page, { name: "仪表盘测试", email: uniqueEmail() });
  account = await context.storageState();
  await context.close();
});

test.use({ storageState: async ({}, provide) => provide(account) });

interface Keyed {
  id: string;
  systemKey: string | null;
}
interface Balances {
  lifetimeLevelXp: number;
  level: number;
}

/** Same curve as character/domain/levels.ts (kept here: e2e does not import app code). */
const required = (level: number) => Math.round(100 * 1.08 ** (level - 1));
const xpForLevel = (level: number) =>
  Array.from({ length: level - 1 }, (_, i) => required(i + 1)).reduce((a, b) => a + b, 0);

async function attributeId(page: Page, key: string) {
  const list = await query<Keyed[]>(page, "character.attributes.list");
  return list.find((a) => a.systemKey === key)!.id;
}

async function completeTask(page: Page, input: Record<string, unknown>) {
  const task = await mutate<{ id: string }>(page, "tasks.create", input);
  await mutate(page, "tasks.complete", { id: task.id });
}

const figure = (page: Page, card: string, key: string) => page.getByTestId(`dash-${card}-${key}`);

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("character-header")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("A — a fresh user sees the dashboard with empty states and no errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  // The old address still leads home.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "仪表盘" })).toBeVisible();
  await expect(page.getByTestId("dashboard-level")).toHaveText("Lv.1");
  await expect(page.getByTestId("dashboard-stage")).toHaveText("启程者");
  await expect(page.getByTestId("dashboard-to-next")).toHaveText("距离 Lv.2 还需要 100 XP");
  await expect(figure(page, "active", "lifetime")).toHaveText("0");
  await expect(page.getByTestId("dash-growth-badge")).toHaveText("不可消费");
  await expect(page.getByTestId("dash-level-badge")).toHaveText("可消费");
  await expect(page.getByTestId("radar-empty")).toBeVisible();
  await expect(page.getByTestId("ranking-empty")).toContainText("最近还没有成长记录");
  await expect(page.getByTestId("trend-empty")).toBeVisible();
  await expect(page.getByTestId("activity-empty")).toBeVisible();
  await expect(page.getByTestId("store-empty")).toHaveText("还没有设置奖励");
  await expect(page.getByTestId("growth-focus")).toContainText("还没有成长记录");
  await expect(page.getByTestId("level-reward-name")).toHaveText("奶茶");

  // Paths into the rest of the app.
  const links = page.getByRole("navigation", { name: "快速入口" });
  for (const [name, href] of [
    ["任务", "/tasks"],
    ["项目", "/projects"],
    ["角色", "/character"],
    ["奖励", "/rewards"],
    ["设置", "/settings"],
  ]) {
    await expect(links.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(errors).toEqual([]);
});

test("B — an ordinary task shows Active XP and activity, but no Growth or Level XP", async ({
  page,
}) => {
  await page.goto("/tasks");
  const input = page.getByLabel("快速添加任务");
  await input.fill("回复银行邮件");
  await input.press("Enter");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "回复银行邮件" })
    .getByRole("checkbox", { name: "完成「回复银行邮件」" })
    .click();
  // Completed tasks move into the collapsed "显示已完成" group.
  await expect(page.getByTestId("task-row").filter({ hasText: "回复银行邮件" })).toBeHidden();

  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "仪表盘" })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(figure(page, "active", "lifetime")).toHaveText("10");
  await expect(figure(page, "active", "spendable")).toHaveText("10");
  await expect(figure(page, "growth", "lifetime")).toHaveText("0");
  await expect(figure(page, "level", "lifetime")).toHaveText("0");
  await expect(page.getByTestId("dashboard-level")).toHaveText("Lv.1");
  await expect(page.getByTestId("week-completedTasks")).toHaveText("1");
  await expect(page.getByTestId("week-growth")).toHaveText("0");

  const entry = page.getByTestId("activity-entry").filter({ hasText: "回复银行邮件" });
  await expect(entry.getByTestId("activity-active")).toHaveText("+10 行动");
  await expect(entry.getByTestId("activity-growth")).toHaveCount(0);
  await expect(entry.getByTestId("activity-level")).toHaveCount(0);
  await expect(page.getByTestId("ranking-empty")).toBeVisible();
});

test("C — a growth task shows Active, Growth and Level XP and the attribute's growth", async ({
  page,
}) => {
  await page.goto("/");
  const cardio = await attributeId(page, "cardio");
  await completeTask(page, {
    title: "跑步 5 公里",
    priority: 2, // 20 XP
    contributions: [{ attributeId: cardio, weight: 2 }],
  });

  await openDashboard(page);
  await expect(figure(page, "active", "lifetime")).toHaveText("30");
  await expect(figure(page, "growth", "lifetime")).toHaveText("20");
  await expect(figure(page, "level", "lifetime")).toHaveText("20");
  await expect(figure(page, "level", "spendable")).toHaveText("20");
  await expect(figure(page, "growth", "week")).toHaveText("+20");
  await expect(page.getByTestId("dashboard-level-xp")).toHaveText("20 / 100 升级经验");

  const entry = page.getByTestId("activity-entry").filter({ hasText: "跑步 5 公里" });
  await expect(entry.getByTestId("activity-active")).toHaveText("+20 行动");
  await expect(entry.getByTestId("activity-growth")).toHaveText("+20 成长");
  await expect(entry.getByTestId("activity-level")).toHaveText("+20 升级");

  const rows = page.getByTestId("ranking-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("有氧");
  await expect(rows.first()).toContainText("+20 XP");
  await expect(page.getByTestId("focus-fastest")).toContainText("有氧");
  await expect(page.getByTestId("radar-empty")).toHaveCount(0);
  await expect(page.getByTestId("attribute-radar")).toBeVisible();
  await expect(page.getByTestId("trend-bar")).toHaveCount(1);
});

test("D — a task growing two attributes splits correctly in the ranking and radar", async ({
  page,
}) => {
  await page.goto("/");
  const [french, reading] = await Promise.all([
    attributeId(page, "french"),
    attributeId(page, "reading"),
  ]);
  await completeTask(page, {
    title: "用法语读 30 页书",
    priority: 2, // 20 XP → 法语 15, 阅读 5
    contributions: [
      { attributeId: french, weight: 3 },
      { attributeId: reading, weight: 1 },
    ],
  });

  await openDashboard(page);
  await expect(figure(page, "growth", "lifetime")).toHaveText("40");
  const rows = page.getByTestId("ranking-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("有氧");
  await expect(rows.nth(0)).toContainText("+20 XP");
  await expect(rows.nth(1)).toContainText("法语");
  await expect(rows.nth(1)).toContainText("+15 XP");
  await expect(rows.nth(2)).toContainText("阅读");
  await expect(rows.nth(2)).toContainText("+5 XP");
  await expect(page.getByTestId("activity-entry").first()).toContainText("法语 +15 · 阅读 +5");
  // The radar shows every active attribute on the radar (5 seeded).
  await expect(page.getByTestId("radar-point")).toHaveCount(5);
  await expect(page.getByTestId("week-top").getByRole("listitem")).toHaveCount(3);

  // Changing the period refetches the ranking; today's growth is in every period.
  for (const period of ["7天", "90天", "全部"]) {
    await page.getByRole("radio", { name: period }).click();
    await expect(page.getByRole("radio", { name: period })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("growth-summary")).toContainText("成长经验 +40");
    await expect(rows).toHaveCount(3);
  }
});

test("E — spending Level XP lowers spendable only; lifetime and level stay", async ({ page }) => {
  await page.goto("/");
  const reward = await mutate<{ id: string }>(page, "rewards.create", {
    name: "奶茶",
    emoji: "🧋",
    value: 50, // 10 Level XP
    payWithActive: false,
  });
  await openDashboard(page);
  await expect(page.getByTestId("store-preview-item")).toHaveCount(1);
  await expect(page.getByTestId("store-preview-item")).toContainText("10 升级经验");
  await expect(page.getByTestId("store-preview-item")).toContainText("可兑换");
  const level = await page.getByTestId("dashboard-level").textContent();

  await mutate(page, "rewards.redeem", {
    rewardId: reward.id,
    payment: { strategy: "level_first" },
    idempotencyKey: crypto.randomUUID(),
  });
  await openDashboard(page);
  await expect(figure(page, "level", "spendable")).toHaveText("30");
  await expect(figure(page, "level", "lifetime")).toHaveText("40");
  await expect(page.getByTestId("dashboard-level")).toHaveText(level!);
  await expect(page.getByTestId("dashboard-level-xp")).toHaveText("40 / 100 升级经验");
});

test("F — reaching a level reward makes it claimable; claiming happens in Rewards", async ({
  page,
}) => {
  await page.goto("/");
  const strength = await attributeId(page, "strength");
  const have = (await query<Balances>(page, "rewards.balances")).lifetimeLevelXp;
  const tasks = Math.ceil((xpForLevel(5) - have) / 30);
  for (let i = 0; i < tasks; i++) {
    await completeTask(page, {
      title: `力量训练 ${i}`,
      priority: 4, // 30 XP
      contributions: [{ attributeId: strength, weight: 2 }],
    });
  }
  expect((await query<Balances>(page, "rewards.balances")).level).toBe(5);

  await openDashboard(page);
  await expect(page.getByTestId("dashboard-level")).toHaveText("Lv.5");
  const card = page.getByTestId("next-level-reward");
  await expect(card.getByTestId("level-reward-name")).toHaveText("奶茶");
  await expect(card.getByTestId("level-reward-state")).toHaveAttribute("data-state", "claimable");

  await card.getByRole("link", { name: "去领取" }).click();
  await expect(page).toHaveURL(/\/rewards\?tab=level$/);
  const row = page.getByTestId("level-reward").filter({ hasText: "奶茶" });
  await row.getByRole("button", { name: "免费领取" }).click();
  await expect(row).toHaveAttribute("data-state", "claimed");

  await openDashboard(page);
  await expect(card.getByTestId("level-reward-name")).toHaveText("喜欢的一顿饭");
  await expect(card.getByTestId("level-reward-state")).toHaveAttribute("data-state", "early");
  await expect(page.getByTestId("dashboard-level")).toHaveText("Lv.5");
});

test("G — the phone layout has no horizontal overflow and keeps every section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const order = [
    "character-header",
    "dash-active",
    "dash-growth",
    "dash-level",
    "growth-section",
    "next-level-reward",
    "recent-activity",
  ];
  const tops: number[] = [];
  for (const id of order) {
    const section = page.getByTestId(id);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    const box = (await section.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    tops.push(box.y + (await page.evaluate(() => window.scrollY)));
  }
  // Character → XP → growth → reward → activity, top to bottom.
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
});

test("H — dark mode keeps the dashboard and its charts readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openDashboard(page);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  const colors = await page.evaluate(() => {
    // Any CSS colour (oklch included) → sRGB through a 1×1 canvas.
    const context = document.createElement("canvas").getContext("2d")!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    };
    const style = (testId: string) =>
      getComputedStyle(document.querySelector(`[data-testid="${testId}"]`)!);
    const bar = document.querySelector('[data-testid="trend-bar"]')!;
    const radar = document.querySelector('[data-testid="attribute-radar"] polygon:last-of-type')!;
    return {
      surface: luminance(style("growth-section").backgroundColor),
      text: luminance(style("dashboard-level").color),
      bar: luminance(getComputedStyle(bar).fill),
      radarStroke: luminance(getComputedStyle(radar).stroke),
    };
  });
  expect(colors.surface).toBeLessThan(0.2);
  expect(colors.text).toBeGreaterThan(0.8);
  expect(colors.bar - colors.surface).toBeGreaterThan(0.25);
  expect(colors.radarStroke - colors.surface).toBeGreaterThan(0.25);
});
