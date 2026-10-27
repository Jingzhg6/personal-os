import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { mutate, query } from "./screenshots/support";

/*
 * M6.2 growth RPG, as one story for one fresh user (the shared e2e user is used by parallel
 * tests, and sign-up is rate-limited, so the scenarios run in order on a single new account).
 * XP is earned through real task completions via the app's API; every assertion is exact.
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
interface Balances {
  lifetimeActiveXp: number;
  spendableActiveXp: number;
  lifetimeLevelXp: number;
  spendableLevelXp: number;
  level: number;
}

/** Same curve as character/domain/levels.ts (kept here: e2e does not import app code). */
const required = (level: number) => Math.round(100 * 1.08 ** (level - 1));
const xpForLevel = (level: number) =>
  Array.from({ length: level - 1 }, (_, i) => required(i + 1)).reduce((a, b) => a + b, 0);

const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });
const balances = (page: Page) => query<Balances>(page, "rewards.balances");

async function attributeId(page: Page, key: string) {
  const list = await query<Keyed[]>(page, "character.attributes.list");
  return list.find((a) => a.systemKey === key)!.id;
}

/**
 * Completes `times` tasks worth `xp` Active XP each (10 + 5 × priority), contributing to
 * `attribute` (growth → Level XP) when given.
 */
async function complete(page: Page, xp: number, times: number, attribute?: string) {
  const priority = (xp - 10) / 5;
  for (let i = 0; i < times; i++) {
    const task = await mutate<{ id: string }>(page, "tasks.create", {
      title: `练习 ${i}`,
      priority,
      contributions: attribute ? [{ attributeId: attribute, weight: 2 }] : [],
    });
    await mutate(page, "tasks.complete", { id: task.id });
  }
}

/** Earns growth XP until the character reaches `level` (30 XP per task). */
async function reachLevel(page: Page, level: number, attribute: string) {
  const have = (await balances(page)).lifetimeLevelXp;
  await complete(page, 30, Math.ceil((xpForLevel(level) - have) / 30), attribute);
  expect((await balances(page)).level).toBe(level);
}

async function createReward(page: Page, input: Record<string, unknown>) {
  return mutate<{ id: string }>(page, "rewards.create", input);
}

const card = (page: Page, testId: string) => ({
  lifetime: page.getByTestId(`${testId}-lifetime`),
  spendable: page.getByTestId(`${testId}-spendable`),
});

test("A — an ordinary task earns Active XP only, the level stays", async ({ page }) => {
  await page.goto("/tasks");
  const input = page.getByLabel("快速添加任务");
  await input.fill("回复邮件");
  await input.press("Enter");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "回复邮件" })
    .getByRole("checkbox", { name: "完成「回复邮件」" })
    .click();

  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "角色", exact: true })
    .click();
  await expect(card(page, "active-xp").lifetime).toHaveText("10");
  await expect(card(page, "active-xp").spendable).toHaveText("10");
  await expect(card(page, "level-xp").lifetime).toHaveText("0");
  await expect(card(page, "growth-xp").lifetime).toHaveText("0");
  await expect(page.getByTestId("character-level")).toHaveText("Lv 1");
  await expect(
    page.getByTestId("recent-grants").getByTestId("xp-entry").filter({ hasText: "回复邮件" }),
  ).toContainText("仅行动经验");
});

test("B — a growth task earns Active, Growth and Level XP", async ({ page }) => {
  await page.goto("/tasks");
  const input = page.getByLabel("快速添加任务");
  await input.fill("学习法语");
  await input.press("Enter");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "学习法语" })
    .locator("[data-row-main]")
    .click();
  await panel(page).getByRole("button", { name: "添加成长能力" }).click();
  await page.getByRole("option", { name: "法语" }).click();
  await expect(panel(page).getByTestId("contribution")).toHaveCount(1);
  await panel(page).getByRole("button", { name: "完成" }).click();
  await expect(panel(page).getByRole("button", { name: "重新打开" })).toBeVisible();

  await page.goto("/character");
  await expect(card(page, "active-xp").lifetime).toHaveText("20"); // 10 from A + 10
  await expect(card(page, "growth-xp").lifetime).toHaveText("10");
  await expect(card(page, "level-xp").lifetime).toHaveText("10");
  await expect(card(page, "level-xp").spendable).toHaveText("10");
  const entry = page
    .getByTestId("recent-grants")
    .getByTestId("xp-entry")
    .filter({ hasText: "学习法语" });
  await expect(entry).toContainText("行动 +10");
  await expect(entry.getByTestId("xp-credit")).toHaveText(/法语\+10$/);
  await expect(entry.getByTestId("xp-level")).toHaveText("升级 +10");
});

test("C — spending Level XP keeps lifetime Level XP and the level", async ({ page }) => {
  const french = await attributeId(page, "french");
  expect((await balances(page)).lifetimeLevelXp).toBe(10); // from B
  await complete(page, 30, 33, french); // +990 → 1,000 Level XP
  const big = await createReward(page, { name: "大件", value: 3500, payWithActive: false }); // 700 Level XP
  await mutate(page, "rewards.redeem", {
    rewardId: big.id,
    payment: { strategy: "level_first" },
    idempotencyKey: crypto.randomUUID(),
  });
  const before = await balances(page);
  expect(before).toMatchObject({ lifetimeLevelXp: 1000, spendableLevelXp: 300 });

  // Create a reward in the UI and pay it with Level XP.
  await page.goto("/rewards");
  await page.getByRole("button", { name: "新建奖励" }).click();
  const dialog = page.getByRole("dialog", { name: "新建奖励" });
  await dialog.getByLabel("名称").fill("看电影");
  await dialog.getByLabel("图标（emoji）").fill("🎬");
  await dialog.getByLabel("价值（购买力单位）").fill("500");
  await expect(dialog.getByText("= 500 行动经验 或 100 升级经验")).toBeVisible();
  await dialog.getByRole("button", { name: "创建" }).click();

  await page.getByRole("button", { name: "兑换「看电影」" }).click();
  const redeem = page.getByRole("dialog", { name: "兑换「看电影」" });
  await redeem.getByRole("radio", { name: "优先升级经验" }).click();
  await expect(redeem.getByTestId("redeem-preview")).toContainText(
    "支付：0 行动经验 + 100 升级经验",
  );
  await redeem.getByRole("button", { name: "确认兑换" }).click();
  await expect(page.getByTestId("balance-level-spendable")).toHaveText("200");
  await expect(page.getByTestId("balance-level")).toContainText("累计 1,000");

  await page.goto("/character");
  await expect(card(page, "level-xp").lifetime).toHaveText("1,000");
  await expect(card(page, "level-xp").spendable).toHaveText("200");
  await expect(page.getByTestId("character-level")).toHaveText(`Lv ${before.level}`);
});

test("D — spending Active XP keeps lifetime Active XP", async ({ page }) => {
  await complete(page, 30, 5); // +150 Active XP, no growth
  const before = await balances(page);
  const fmt = (n: number) => n.toLocaleString("en");
  await createReward(page, { name: "奶茶", emoji: "🧋", value: 500 });
  await page.goto("/rewards");
  await expect(page.getByTestId("balance-active-spendable")).toHaveText(
    fmt(before.spendableActiveXp),
  );
  await page.getByRole("button", { name: "兑换「奶茶」" }).click();
  const redeem = page.getByRole("dialog", { name: "兑换「奶茶」" });
  await expect(redeem.getByTestId("redeem-preview")).toContainText(
    "支付：500 行动经验 + 0 升级经验",
  );
  await redeem.getByRole("button", { name: "确认兑换" }).click();
  await expect(page.getByTestId("balance-active-spendable")).toHaveText(
    fmt(before.spendableActiveXp - 500),
  );
  await expect(page.getByTestId("balance-active")).toContainText(
    `累计 ${fmt(before.lifetimeActiveXp)}`,
  );

  await page.getByRole("link", { name: "兑换记录" }).click();
  const entry = page.getByTestId("reward-history-entry").filter({ hasText: "奶茶" });
  await expect(entry).toContainText("-500 行动经验");
  expect(await balances(page)).toEqual({
    ...before,
    spendableActiveXp: before.spendableActiveXp - 500,
  });
});

test("E — mixed payment: 300 Active XP + 40 Level XP for a 500 reward", async ({ page }) => {
  const before = await balances(page);
  expect(before.spendableActiveXp).toBeGreaterThanOrEqual(300);
  expect(before.spendableLevelXp).toBeGreaterThanOrEqual(40);
  await createReward(page, { name: "电影票", emoji: "🎬", value: 500 });

  await page.goto("/rewards");
  await page.getByRole("button", { name: "兑换「电影票」" }).click();
  const redeem = page.getByRole("dialog", { name: "兑换「电影票」" });
  await redeem.getByRole("radio", { name: "自定义组合" }).click();
  await redeem.getByLabel("行动经验").fill("300");
  await redeem.getByLabel("升级经验").fill("39");
  await expect(redeem.getByRole("alert")).toHaveText("购买力还差 5。");
  await expect(redeem.getByRole("button", { name: "确认兑换" })).toBeDisabled();
  await redeem.getByLabel("升级经验").fill("40");
  await expect(redeem.getByTestId("redeem-preview")).toContainText("购买力：500 / 500");
  await redeem.getByRole("button", { name: "确认兑换" }).click();

  await expect(page.getByTestId("balance-active-spendable")).toHaveText(
    (before.spendableActiveXp - 300).toLocaleString("en"),
  );
  await expect(page.getByTestId("balance-level-spendable")).toHaveText(
    (before.spendableLevelXp - 40).toLocaleString("en"),
  );
  expect(await balances(page)).toEqual({
    ...before,
    spendableActiveXp: before.spendableActiveXp - 300,
    spendableLevelXp: before.spendableLevelXp - 40,
  });
  const history = await query<
    { activeXpSpent: number; levelXpSpent: number; purchaseValue: number }[]
  >(page, "rewards.history");
  expect(history[0]).toMatchObject({ activeXpSpent: 300, levelXpSpent: 40, purchaseValue: 500 });
});

test("F — reaching level 10 makes its reward free, once", async ({ page }) => {
  await reachLevel(page, 10, await attributeId(page, "cardio"));
  const before = await balances(page);
  await page.goto("/rewards?tab=level");
  const meal = page.getByTestId("level-reward").filter({ hasText: "喜欢的一顿饭" });
  await expect(meal).toHaveAttribute("data-state", "claimable");
  await meal.getByRole("button", { name: "免费领取" }).click();
  await expect(meal).toHaveAttribute("data-state", "claimed");
  await expect(meal).toContainText("已领取");
  expect(await balances(page)).toEqual(before); // no XP spent

  await page.getByRole("link", { name: "兑换记录" }).click();
  await expect(
    page.getByTestId("reward-history-entry").filter({ hasText: "喜欢的一顿饭" }),
  ).toContainText("免费");
});

test("G — claiming a future level's reward early costs spendable Level XP, never the level", async ({
  page,
}) => {
  const strength = await attributeId(page, "strength");
  await reachLevel(page, 17, strength);
  const before = await balances(page);
  const cost = xpForLevel(20) - before.lifetimeLevelXp;

  await page.goto("/rewards?tab=level");
  const trip = page.getByTestId("level-reward").filter({ hasText: "周末旅行" });
  const europe = page.getByTestId("level-reward").filter({ hasText: "欧洲旅行" });
  await expect(trip).toHaveAttribute("data-state", "early");
  await expect(europe).toHaveAttribute("data-state", "locked"); // beyond the next stage band
  await trip
    .getByRole("button", { name: `提前领取：${cost.toLocaleString("en")} 升级经验` })
    .click();
  await page
    .getByRole("dialog", { name: "提前领取「周末旅行」？" })
    .getByRole("button", { name: "确认提前领取" })
    .click();
  await expect(trip).toHaveAttribute("data-state", "claimed");

  expect(await balances(page)).toMatchObject({
    lifetimeLevelXp: before.lifetimeLevelXp,
    spendableLevelXp: before.spendableLevelXp - cost,
    lifetimeActiveXp: before.lifetimeActiveXp,
    level: 17,
  });
  await page.goto("/character");
  await expect(page.getByTestId("character-level")).toHaveText("Lv 17");
  await expect(page.getByTestId("growth-stage")).toHaveText("实践者");

  // Without enough spendable Level XP an early claim is refused (no reward debt).
  await mutate(page, "rewards.levelRewards.create", { level: 19, name: "新跑鞋", emoji: "👟" });
  const left = (await balances(page)).spendableLevelXp;
  const drain = await createReward(page, {
    name: "清空",
    value: (left - 10) * 5,
    payWithActive: false,
  });
  await mutate(page, "rewards.redeem", {
    rewardId: drain.id,
    payment: { strategy: "level_first" },
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto("/rewards?tab=level");
  const shoes = page.getByTestId("level-reward").filter({ hasText: "新跑鞋" });
  await expect(shoes).toHaveAttribute("data-state", "early");
  await expect(shoes.getByRole("button", { name: /提前领取/ })).toBeDisabled();
  await expect(shoes).toContainText("可用升级经验不足");
  const response = await page.request.post("/api/trpc/rewards.levelRewards.claim", {
    data: {
      json: {
        levelRewardId: (
          await query<{ id: string; level: number }[]>(page, "rewards.levelRewards.list")
        ).find((r) => r.level === 19)!.id,
        idempotencyKey: crypto.randomUUID(),
      },
    },
  });
  expect(response.status()).toBe(400);
  expect((await balances(page)).spendableLevelXp).toBe(10);
});
