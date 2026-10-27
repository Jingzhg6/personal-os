import { devices, expect, test, type Page } from "@playwright/test";

import { mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m6-1";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Keyed {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

/**
 * Real app operations only: development attributes are created / archived through the API, tasks
 * carry an area AND development contributions, and XP comes from completing / reopening them.
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
  const guitar = await mutate<Created>(page, "character.attributes.create", {
    name: "吉他",
    icon: "🎸",
    color: "pink",
  });
  await mutate(page, "character.attributes.update", {
    id: guitar.id,
    patch: { archived: true },
  });
  const attr = (key: string) =>
    key === "python" ? python.id : seeded.find((a) => a.systemKey === key)!.id;
  const c = (key: string, weight = 2) => ({ attributeId: attr(key), weight });

  const task = (title: string, areaKey: string, extra: Record<string, unknown> = {}) =>
    mutate<Created>(page, "tasks.create", { title, areaId: area(areaKey), ...extra });
  const done = async (title: string, areaKey: string, extra: Record<string, unknown> = {}) => {
    const created = await task(title, areaKey, extra);
    await mutate(page, "tasks.complete", { id: created.id });
    return created;
  };

  await done("法语口语练习 30 分钟", "learning", { priority: 2, contributions: [c("french", 3)] });
  await done("用法语读 30 页书", "learning", {
    priority: 2,
    contributions: [c("french", 3), c("reading", 2)],
  });
  await done("听一集英语播客", "learning", { contributions: [c("english")] });
  await done("读完《原则》第三章", "learning", { priority: 1, contributions: [c("reading")] });
  await done("骑自行车 45 分钟", "health", { priority: 2, contributions: [c("cardio")] });
  await done("深蹲 5×5", "health", { priority: 1, contributions: [c("strength")] });
  await done("硬拉与核心训练", "health", { priority: 3, contributions: [c("strength")] });
  await done("Python 数据清洗练习", "work", {
    priority: 3,
    contributions: [c("python", 3), c("english", 1)],
  });
  await done("用 Python 写周报统计脚本", "work", { priority: 2, contributions: [c("python")] });
  // No development contribution: overall XP only.
  await done("回复银行邮件", "admin");
  await done("提交居留材料", "admin", { priority: 3 });
  // Reversal: completed, then reopened.
  const run = await done("跑步 5 公里", "health", { contributions: [c("cardio")] });
  await mutate(page, "tasks.reopen", { id: run.id });

  // Open tasks for the detail panel.
  const single = await task("Python 练习：pandas 分组聚合", "work", {
    priority: 2,
    contributions: [c("python", 3)],
  });
  const multiple = await task("用法语写一篇读书笔记", "learning", {
    priority: 3,
    isImportant: true,
    contributions: [c("french", 3), c("reading", 1)],
  });
  return { single: single.id, multiple: multiple.id };
}

async function showContributions(page: Page) {
  const section = page
    .getByRole("complementary", { name: "任务详情" })
    .getByRole("heading", { name: "成长贡献" });
  await section.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("contribution-preview")).toBeVisible();
}

test("M6.1 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await registerDemoUser(page);
  const { single, multiple } = await seed(page);

  // 1. Overview: overall XP vs development XP, dynamic radar, development attributes.
  await page.goto("/character");
  await expect(page.getByTestId("attribute-row")).toHaveCount(6);
  await shot(page, `${OUT}/01-character-overview.png`);

  // 2. Radar of the current development attributes (hover tooltip).
  await page.getByTestId("attribute-radar").scrollIntoViewIfNeeded();
  await page.getByTestId("radar-point").nth(5).hover({ force: true });
  await shot(page, `${OUT}/02-dynamic-radar.png`);

  // 3. Settings: active (ordered, editable) and archived attributes.
  await page.goto("/character/attributes");
  await expect(page.getByTestId("attribute-archived")).toHaveCount(1);
  await shot(page, `${OUT}/03-attribute-settings.png`);

  // 4. Task detail: area 工作 + one development contribution, picker open.
  await page.goto(`/tasks?task=${single}`);
  await showContributions(page);
  await page
    .getByRole("complementary", { name: "任务详情" })
    .getByRole("button", { name: "添加成长能力" })
    .click();
  await expect(page.getByRole("listbox", { name: "选择成长能力" })).toBeVisible();
  await shot(page, `${OUT}/04-task-contribution.png`);
  await page.keyboard.press("Escape");

  // 5. Task with two contributions: weights and the split preview (XP is not doubled).
  await page.goto(`/tasks?task=${multiple}`);
  await showContributions(page);
  await expect(page.getByTestId("contribution")).toHaveCount(2);
  await shot(page, `${OUT}/05-task-multiple-contributions.png`);

  // 6. XP history: per-entry split, overall-only entries, a reversal.
  await page.goto("/character/xp");
  await expect(page.getByTestId("xp-entry").first()).toBeVisible();
  await shot(page, `${OUT}/06-xp-history.png`);

  // 7. Dark mode.
  const dark = await browser.newContext({
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    storageState: await page.context().storageState(),
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/character");
  await expect(darkPage.getByTestId("attribute-row")).toHaveCount(6);
  await shot(darkPage, `${OUT}/07-character-dark.png`);
  await dark.close();

  // 8. Phone: overview (light) and task contributions (dark).
  for (const scheme of ["light", "dark"] as const) {
    const phone = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL,
      locale: "zh-CN",
      colorScheme: scheme,
      storageState: await page.context().storageState(),
    });
    const mobile = await phone.newPage();
    if (scheme === "light") {
      await mobile.goto("/character");
      await expect(mobile.getByTestId("level-card")).toBeVisible();
      await shot(mobile, `${OUT}/08-mobile-character.png`);
    } else {
      await mobile.goto(`/tasks?task=${multiple}`);
      await showContributions(mobile);
      await shot(mobile, `${OUT}/09-mobile-task-contributions-dark.png`);
    }
    await phone.close();
  }
});
