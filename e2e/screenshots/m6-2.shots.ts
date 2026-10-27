import { devices, expect, test, type Page } from "@playwright/test";

import { mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m6-2";

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
 * completed through the API (XP comes from the events), rewards are created, redeemed and
 * claimed through the API, and the screenshots then drive the real UI.
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
  };

  const growth: [string, string, [string, number][]][] = [
    ["法语口语练习 30 分钟", "learning", [["french", 2]]],
    ["法语听力精听", "learning", [["french", 2]]],
    [
      "用法语读 30 页书",
      "learning",
      [
        ["french", 3],
        ["reading", 2],
      ],
    ],
    ["英语播客一集", "learning", [["english", 2]]],
    ["读完《原则》一章", "learning", [["reading", 2]]],
    ["跑步 5 公里", "health", [["cardio", 2]]],
    ["骑自行车 45 分钟", "health", [["cardio", 2]]],
    ["力量训练：深蹲 5×5", "health", [["strength", 2]]],
    [
      "Python 数据清洗练习",
      "work",
      [
        ["python", 3],
        ["english", 1],
      ],
    ],
    ["用 Python 写周报脚本", "work", [["python", 2]]],
  ];
  const ordinary: [string, string][] = [
    ["回复银行邮件", "admin"],
    ["提交报销单", "admin"],
    ["预约牙医", "personal"],
    ["整理会议纪要", "work"],
    ["缴纳水电费", "admin"],
  ];
  // Growth and ordinary tasks interleaved, as in real life.
  for (let round = 0; round < 11; round++) {
    for (const [index, [title, areaKey, contributions]] of growth.entries()) {
      await done(title, areaKey, contributions);
      if (index % 3 === 2 && round < 10) {
        const [ordinaryTitle, ordinaryArea] = ordinary[(round + index) % ordinary.length]!;
        await done(ordinaryTitle, ordinaryArea, [], 2);
      }
    }
  }

  const reward = (input: Record<string, unknown>) => mutate<Created>(page, "rewards.create", input);
  const redeem = (id: string, payment: Record<string, unknown>) =>
    mutate(page, "rewards.redeem", {
      rewardId: id,
      payment,
      idempotencyKey: crypto.randomUUID(),
    });
  const tea = await reward({
    name: "奶茶",
    emoji: "🧋",
    category: "treat",
    value: 500,
    realWorldCostCents: 600,
  });
  const movie = await reward({
    name: "看电影",
    emoji: "🎬",
    category: "entertainment",
    value: 1000,
    description: "周末去电影院，爆米花也算上。",
  });
  const book = await reward({ name: "买一本书", emoji: "📚", category: "learning", value: 800 });
  await reward({ name: "按摩一次", emoji: "💆", category: "health", value: 500 });
  await reward({
    name: "新跑鞋",
    emoji: "👟",
    category: "shopping",
    value: 3000,
    repeatable: false,
    realWorldCostCents: 89900,
  });
  await reward({
    name: "游戏之夜",
    emoji: "🎮",
    category: "entertainment",
    value: 1500,
    payWithLevel: false,
  });
  await redeem(tea.id, { strategy: "active_first" });
  await redeem(movie.id, { strategy: "level_first" });
  await redeem(book.id, { strategy: "custom", activeXp: 300, levelXp: 100 });

  const levelRewards = await query<Keyed[]>(page, "rewards.levelRewards.list");
  for (const level of [5, 10]) {
    await mutate(page, "rewards.levelRewards.claim", {
      levelRewardId: levelRewards.find((r) => r.level === level)!.id,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  await mutate(page, "rewards.levelRewards.create", { level: 15, name: "降噪耳机", emoji: "🎧" });
}

test("M6.2 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await seed(page);

  // 1. Character: level, growth stage, lifetime Level XP and progress.
  await page.goto("/character");
  await expect(page.getByTestId("growth-stage")).toBeVisible();
  await shot(page, `${OUT}/01-character-level.png`);

  // 2. Active vs growth: the XP history shows ordinary tasks (Active XP only) next to growth.
  await page.goto("/character/xp");
  await expect(page.getByTestId("xp-entry").first()).toBeVisible();
  await shot(page, `${OUT}/02-action-vs-growth.png`);

  // 3. Lifetime vs spendable Level XP (after spending in the store).
  await page.goto("/character");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("xp-currencies").screenshot({ path: `${OUT}/03-level-xp-balance.png` });

  // 4. Growth attributes and radar.
  await page
    .getByTestId("attribute-radar")
    // Card headings stay below the sticky top bar: the radar's card starts ~100px above the chart.
    .evaluate((element) =>
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 180),
    );
  await shot(page, `${OUT}/04-growth-attributes.png`);

  // 5. Level rewards: claimed, claimable, early, locked.
  await page.goto("/rewards?tab=level");
  await expect(page.getByTestId("level-reward")).toHaveCount(5);
  await shot(page, `${OUT}/05-level-reward.png`);

  // 6. Early claim of the level 20 reward.
  await page
    .getByTestId("level-reward")
    .filter({ hasText: "周末旅行" })
    .getByRole("button", { name: /提前领取/ })
    .click();
  await expect(page.getByRole("dialog", { name: "提前领取「周末旅行」？" })).toBeVisible();
  await shot(page, `${OUT}/06-early-claim.png`);
  await page.getByRole("button", { name: "确认提前领取" }).click();
  await expect(page.getByTestId("level-reward").filter({ hasText: "周末旅行" })).toHaveAttribute(
    "data-state",
    "claimed",
  );

  // 7. Reward store.
  await page.goto("/rewards");
  await expect(page.getByTestId("reward-card")).toHaveCount(6);
  await shot(page, `${OUT}/07-reward-store.png`);

  // 8. Mixed payment: 300 Active XP + 40 Level XP for a 500-value reward.
  await page.getByRole("button", { name: "兑换「按摩一次」" }).click();
  const dialog = page.getByRole("dialog", { name: "兑换「按摩一次」" });
  await dialog.getByRole("radio", { name: "自定义组合" }).click();
  await dialog.getByLabel("行动经验").fill("300");
  await dialog.getByLabel("升级经验").fill("40");
  await expect(dialog.getByTestId("redeem-preview")).toContainText("购买力：500 / 500");
  await shot(page, `${OUT}/08-mixed-payment.png`);
  await dialog.getByRole("button", { name: "确认兑换" }).click();
  await expect(dialog).toBeHidden();

  // 9. Reward history.
  await page.goto("/rewards?tab=history");
  await expect(page.getByTestId("reward-history-entry").first()).toBeVisible();
  await shot(page, `${OUT}/09-reward-history.png`);

  // 10. Phone: reward store.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale: "zh-CN",
    colorScheme: "light",
    storageState: await page.context().storageState(),
  });
  const mobile = await phone.newPage();
  await mobile.goto("/rewards");
  await expect(mobile.getByTestId("reward-card").first()).toBeVisible();
  await shot(mobile, `${OUT}/10-mobile-rewards.png`);
  await phone.close();

  // 11. Dark theme: character.
  const dark = await browser.newContext({
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    storageState: await page.context().storageState(),
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/character");
  await expect(darkPage.getByTestId("growth-stage")).toBeVisible();
  await shot(darkPage, `${OUT}/11-dark-character.png`);
  await dark.close();
});
