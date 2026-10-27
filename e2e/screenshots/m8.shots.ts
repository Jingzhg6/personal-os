import { devices, expect, test, type Page } from "@playwright/test";

import { mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m8";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Keyed {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

/**
 * Real app operations only: attributes, goals, links, tasks (created from goals or on their own),
 * completions, a project, the vision and the chosen focus — all through the app's API. XP comes
 * from the completions, as always.
 */
async function seed(page: Page) {
  const seeded = await query<Keyed[]>(page, "character.attributes.list");
  const sql = await mutate<Created>(page, "character.attributes.create", {
    name: "SQL",
    icon: "🗄️",
    color: "teal",
  });
  const focus = await mutate<Created>(page, "character.attributes.create", {
    name: "专注力",
    icon: "🎯",
    color: "violet",
  });
  const attr = (key: string) =>
    key === "sql"
      ? sql.id
      : key === "focus"
        ? focus.id
        : seeded.find((a) => a.systemKey === key)!.id;

  await mutate(page, "development.updateVision", {
    vision:
      "我希望成为一个能够流利使用法语和英语、具备数据分析能力、身体健康并且能够长期保持专注的人。",
  });

  const goal = (input: Record<string, unknown>) =>
    mutate<Created>(page, "development.goals.create", input);
  const french = await goal({
    title: "法语达到 B1",
    description: "能看懂法语新闻，和朋友用法语聊 20 分钟。",
    priority: 3,
    targetDate: "2027-06-30",
    attributes: [
      { attributeId: attr("french"), weight: 3 },
      { attributeId: attr("focus"), weight: 1 },
    ],
  });
  const data = await goal({
    title: "掌握 SQL 数据分析",
    description: "能独立写出带窗口函数的分析查询。",
    priority: 3,
    targetDate: "2027-03-31",
    attributes: [
      { attributeId: attr("sql"), weight: 3 },
      { attributeId: attr("focus"), weight: 1 },
    ],
  });
  const cardio = await goal({
    title: "提升心肺耐力",
    description: "10 公里跑进 60 分钟。",
    priority: 2,
    attributes: [
      { attributeId: attr("cardio"), weight: 3 },
      { attributeId: attr("strength"), weight: 1 },
    ],
  });
  const reading = await goal({
    title: "建立稳定的阅读习惯",
    priority: 1,
    attributes: [{ attributeId: attr("reading"), weight: 3 }],
  });
  await mutate(page, "development.goals.setStatus", { id: reading.id, status: "paused" });
  const archived = await goal({
    title: "英语雅思 7 分",
    priority: 2,
    attributes: [{ attributeId: attr("english"), weight: 3 }],
  });
  await mutate(page, "development.goals.setStatus", { id: archived.id, status: "archived" });

  const goalTask = (goalId: string, title: string, extra: Record<string, unknown> = {}) =>
    mutate<Created>(page, "development.goals.createTask", { goalId, task: { title, ...extra } });
  const complete = (id: string) => mutate(page, "tasks.complete", { id });

  // 法语: two done, two open.
  for (const title of ["法语口语练习 30 分钟", "精听一期法语播客"]) {
    await complete((await goalTask(french.id, title, { priority: 2 })).id);
  }
  await goalTask(french.id, "背 50 个 DELF 高频词", { dueDate: "2026-11-05" });
  await goalTask(french.id, "报名 DELF B1 考试", { dueDate: "2026-12-01" });
  // An existing task, linked afterwards.
  const existing = await mutate<Created>(page, "tasks.create", { title: "整理法语语法笔记" });
  await mutate(page, "development.goals.linkTask", { goalId: french.id, taskId: existing.id });

  // SQL: one done, one open, plus a project.
  await complete((await goalTask(data.id, "完成 SQL 窗口函数练习", { priority: 2 })).id);
  await goalTask(data.id, "用 SQL 分析一份公开数据集");
  const project = await mutate<Created>(page, "projects.create", {
    name: "SQL 入门课程",
    color: "teal",
  });
  await mutate(page, "development.goals.linkProject", { goalId: data.id, projectId: project.id });
  for (const title of ["课程第 1 章", "课程第 2 章"]) {
    const task = await mutate<Created>(page, "tasks.create", { title, projectId: project.id });
    if (title.endsWith("1 章")) await complete(task.id);
  }

  // Lots of recent growth in 英语 and 有氧 — measured, not chosen.
  for (let i = 0; i < 4; i++) {
    await complete((await goalTask(cardio.id, `跑步 ${5 + i} 公里`, { priority: 4 })).id);
    const english = await mutate<Created>(page, "tasks.create", {
      title: `英语播客一集 ${i + 1}`,
      priority: 4,
      contributions: [{ attributeId: attr("english"), weight: 2 }],
    });
    await complete(english.id);
  }
  // An ordinary task: Active XP only, no goal.
  await complete((await mutate<Created>(page, "tasks.create", { title: "回复银行邮件" })).id);

  await mutate(page, "development.setFocus", {
    attributeIds: [attr("french"), attr("sql"), attr("focus")],
  });
  return { french: french.id, sqlAttribute: sql.id, frenchAttribute: attr("french") };
}

test("M8 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);

  // 7. A brand-new account: vision, focus and goals each say what to do next.
  await page.goto("/development");
  await expect(page.getByTestId("vision-empty")).toBeVisible();
  await expect(page.getByTestId("goals-empty")).toBeVisible();
  await shot(page, `${OUT}/07-empty-state.png`, { fullPage: true });

  const ids = await seed(page);

  // 1. Desktop: the development page.
  await page.goto("/development");
  await expect(page.getByTestId("goal-card").first()).toBeVisible();
  await shot(page, `${OUT}/01-development-desktop.png`, { fullPage: true });

  // 8. Focus selection: at the limit, the other attributes are disabled.
  await page.getByTestId("focus").getByRole("button", { name: "调整" }).click();
  await expect(page.getByTestId("focus-dialog")).toBeVisible();
  await shot(page, `${OUT}/08-focus-selection.png`);
  await page.getByRole("button", { name: "取消" }).click();

  // 4. Goal detail.
  await page.goto(`/development/goals/${ids.french}`);
  await expect(page.getByTestId("goal-task").first()).toBeVisible();
  await shot(page, `${OUT}/04-goal-detail.png`, { fullPage: true });

  // 6. Goal with linked tasks: the actions list, and a linked task's panel showing its goals.
  await page.getByRole("button", { name: "打开「背 50 个 DELF 高频词」" }).click();
  await expect(page.getByTestId("task-goal")).toHaveCount(1);
  await page.getByTestId("task-goals").scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/06-goal-linked-tasks.png`);

  // 5. Attribute detail.
  await page.goto(`/development/attributes/${ids.frenchAttribute}`);
  await expect(page.getByTestId("attribute-identity")).toBeVisible();
  await shot(page, `${OUT}/05-attribute-detail.png`, { fullPage: true });

  // 9. Dashboard: the M7 focus card now also shows the chosen focus and links here.
  await page.goto("/");
  await expect(page.getByTestId("chosen-focus")).toBeVisible();
  const row = page.getByTestId("growth-focus").locator("..");
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: `${OUT}/09-dashboard-focus.png` });

  const storage = await page.context().storageState();

  // 2. Dark mode.
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/development");
  await expect(darkPage.getByTestId("goal-card").first()).toBeVisible();
  await shot(darkPage, `${OUT}/02-development-dark.png`, { fullPage: true });
  await dark.close();

  // 3. Phone.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/development");
  await expect(mobile.getByTestId("goal-card").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/03-development-mobile.png`, { fullPage: true });
  await mobile.goto(`/development/goals/${ids.french}`);
  await expect(mobile.getByTestId("goal-task").first()).toBeVisible();
  await shot(mobile, `${OUT}/10-goal-detail-mobile.png`, { fullPage: true });
  await phone.close();
});
