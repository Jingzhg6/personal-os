import { devices, expect, test, type Page } from "@playwright/test";

import { mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m7";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Keyed {
  id: string;
  systemKey: string | null;
  level?: number;
}
interface Created {
  id: string;
}

/**
 * Real app operations only: tasks with areas and development contributions are created and
 * completed through the API (XP comes from the events), rewards are created, redeemed and claimed
 * through the API. The dashboard then reads it all back.
 */
async function seed(page: Page) {
  const areas = await query<Keyed[]>(page, "areas.list");
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const seeded = await query<Keyed[]>(page, "character.attributes.list");
  const python = await mutate<Created>(page, "character.attributes.create", {
    name: "Python",
    icon: "🐍",
    color: "teal",
  });
  const attr = (key: string) =>
    key === "python" ? python.id : seeded.find((a) => a.systemKey === key)!.id;

  const done = async (
    title: string,
    areaKey: string,
    contributions: [string, number][],
    priority = 4,
  ) => {
    const task = await mutate<Created>(page, "tasks.create", {
      title,
      areaId: area(areaKey),
      priority,
      contributions: contributions.map(([key, weight]) => ({ attributeId: attr(key), weight })),
    });
    await mutate(page, "tasks.complete", { id: task.id });
    return task;
  };

  const growth: [string, string, [string, number][]][] = [
    ["法语口语练习 30 分钟", "learning", [["french", 2]]],
    ["法语听力精听", "learning", [["french", 2]]],
    ["英语播客一集", "learning", [["english", 2]]],
    ["跑步 5 公里", "health", [["cardio", 2]]],
    ["力量训练：深蹲 5×5", "health", [["strength", 2]]],
    ["用 Python 写周报脚本", "work", [["python", 2]]],
    ["读完《原则》一章", "learning", [["reading", 2]]],
  ];
  const ordinary: [string, string][] = [
    ["回复银行邮件", "admin"],
    ["提交报销单", "admin"],
    ["预约牙医", "personal"],
  ];
  for (let round = 0; round < 6; round++) {
    for (const [index, [title, areaKey, contributions]] of growth.entries()) {
      // French gets the most attention, reading the least.
      if (title.startsWith("读完") && round % 3 !== 0) continue;
      await done(title, areaKey, contributions);
      if (index % 3 === 2) {
        const [ordinaryTitle, ordinaryArea] = ordinary[(round + index) % ordinary.length]!;
        await done(ordinaryTitle, ordinaryArea, [], 1);
      }
    }
  }

  const reward = (input: Record<string, unknown>) => mutate<Created>(page, "rewards.create", input);
  const tea = await reward({ name: "奶茶", emoji: "🧋", category: "treat", value: 500 });
  await reward({ name: "喜欢的一顿饭", emoji: "🍜", category: "food", value: 1500 });
  await reward({
    name: "游戏时间 2 小时",
    emoji: "🎮",
    category: "entertainment",
    value: 800,
    payWithLevel: false,
  });
  await reward({
    name: "周末短途旅行",
    emoji: "🏕️",
    category: "travel",
    value: 12000,
    repeatable: false,
  });
  await reward({ name: "新耳机", emoji: "🎧", category: "shopping", value: 6000 });
  await mutate(page, "rewards.redeem", {
    rewardId: tea.id,
    payment: { strategy: "level_first" },
    idempotencyKey: crypto.randomUUID(),
  });
  const levelRewards = await query<Keyed[]>(page, "rewards.levelRewards.list");
  await mutate(page, "rewards.levelRewards.claim", {
    levelRewardId: levelRewards.find((r) => r.level === 5)!.id,
    idempotencyKey: crypto.randomUUID(),
  });

  // The latest activity: an ordinary task, a reopened one, and a task growing two attributes.
  await done("整理行政文件", "admin", [], 1);
  const wrong = await done("跑步 3 公里", "health", [["cardio", 2]], 0);
  await mutate(page, "tasks.reopen", { id: wrong.id });
  await done(
    "用法语读 30 页书",
    "learning",
    [
      ["french", 3],
      ["reading", 1],
    ],
    4,
  );
}

test("M7 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);

  // 6. A brand-new account: every section has a proper empty state.
  await expect(page.getByTestId("character-header")).toBeVisible();
  await expect(page.getByTestId("radar-empty")).toBeVisible();
  await shot(page, `${OUT}/06-empty-dashboard.png`, { fullPage: true });

  await seed(page);

  // 1. Desktop: the whole dashboard.
  await page.goto("/");
  await expect(page.getByTestId("ranking-row").first()).toBeVisible();
  await shot(page, `${OUT}/01-dashboard-desktop.png`, { fullPage: true });

  // 2. Growth: radar, ranking and trend (7-day view), with a trend tooltip.
  await page.getByRole("radio", { name: "7天" }).click();
  await expect(page.getByRole("radio", { name: "7天" })).toHaveAttribute("aria-checked", "true");
  const section = page.getByTestId("growth-section");
  await section.scrollIntoViewIfNeeded();
  await page.getByTestId("trend-bar").last().hover({ force: true });
  await expect(page.getByTestId("trend-tooltip")).toBeVisible();
  await section.screenshot({ path: `${OUT}/02-growth-radar.png` });

  // 3. Rewards: growth focus, next level reward and the store preview.
  await page.mouse.move(0, 0);
  const rewardsRow = page.getByTestId("next-level-reward").locator("..");
  await rewardsRow.scrollIntoViewIfNeeded();
  await rewardsRow.screenshot({ path: `${OUT}/03-reward-section.png` });

  // 7. This week and recent activity.
  const activityRow = page.getByTestId("recent-activity").locator("..");
  await activityRow.screenshot({ path: `${OUT}/07-week-and-activity.png` });

  const storage = await page.context().storageState();

  // 4. Phone: deliberate single-column order, no horizontal scrolling.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/");
  await expect(mobile.getByTestId("ranking-row").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/04-mobile-dashboard.png`, { fullPage: true });
  await phone.close();

  // 5. Dark mode, desktop.
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/");
  await expect(darkPage.getByTestId("ranking-row").first()).toBeVisible();
  await shot(darkPage, `${OUT}/05-dark-dashboard.png`, { fullPage: true });
  await dark.close();

  // 8. Tablet portrait.
  const tablet = await browser.newContext({
    ...devices["iPad Mini"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const tabletPage = await tablet.newPage();
  await tabletPage.goto("/");
  await expect(tabletPage.getByTestId("ranking-row").first()).toBeVisible();
  await shot(tabletPage, `${OUT}/08-tablet-dashboard.png`, { fullPage: true });
  await tablet.close();
});
