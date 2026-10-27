import { devices, expect, test, type Page } from "@playwright/test";

import { mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m9";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Keyed {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

/**
 * Real app operations only (API): attributes, goals, plans, tasks created in plans or linked,
 * completions (XP from the normal rules), and explicit allocations.
 */
async function seed(page: Page) {
  const seeded = await query<Keyed[]>(page, "character.attributes.list");
  const create = (name: string, icon: string, color: string) =>
    mutate<Created>(page, "character.attributes.create", { name, icon, color });
  const sql = await create("SQL", "🗄️", "teal");
  const python = await create("Python", "🐍", "green");
  const focus = await create("专注力", "🎯", "violet");
  const attr = (key: string) =>
    ({ sql: sql.id, python: python.id, focus: focus.id })[key] ??
    seeded.find((a) => a.systemKey === key)!.id;

  await mutate(page, "development.updateVision", {
    vision: "我希望成为一个能够流利使用法语、具备数据分析能力并且能够长期保持专注的人。",
  });
  await mutate(page, "development.setFocus", {
    attributeIds: [attr("french"), attr("sql"), attr("focus")],
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
  const analyst = await goal({
    title: "成为数据分析师",
    priority: 3,
    attributes: [
      { attributeId: attr("sql"), weight: 3 },
      { attributeId: attr("python"), weight: 2 },
    ],
  });
  const pythonGoal = await goal({
    title: "掌握 Python",
    priority: 2,
    attributes: [{ attributeId: attr("python"), weight: 3 }],
  });

  const plan = (goalId: string, title: string, description?: string) =>
    mutate<Created>(page, "development.plans.create", { goalId, title, description });
  const planTask = (planId: string, title: string, extra: Record<string, unknown> = {}) =>
    mutate<Created>(page, "development.plans.createTask", { planId, task: { title, ...extra } });
  const complete = (id: string) => mutate(page, "tasks.complete", { id });

  const daily = await plan(french.id, "建立每日法语输入习惯", "每天至少进行 30 分钟法语学习。");
  const speaking = await plan(french.id, "提高法语口语", "每周至少进行一次口语练习。");
  for (const title of ["学习法语 30 分钟", "精听一期法语播客", "背诵 30 个 DELF 词"]) {
    await complete((await planTask(daily.id, title, { priority: 2 })).id);
  }
  await planTask(daily.id, "读一篇法语新闻");
  await complete((await planTask(speaking.id, "和语伴练习口语 20 分钟", { priority: 4 })).id);
  await planTask(speaking.id, "录一段 2 分钟自我介绍", { dueDate: "2026-11-08" });

  // Partial attribution: 法语 fully, 专注力 only half to this goal.
  const reading = await mutate<Created>(page, "development.goals.createTask", {
    goalId: french.id,
    task: {
      title: "专注读法语小说 1 小时",
      priority: 4,
      contributions: [
        { attributeId: attr("french"), weight: 2 },
        { attributeId: attr("focus"), weight: 2 },
      ],
    },
  });
  await complete(reading.id);
  await mutate(page, "development.attribution.set", {
    taskId: reading.id,
    allocations: [
      { goalId: french.id, attributeId: attr("french"), share: 100 },
      { goalId: french.id, attributeId: attr("focus"), share: 50 },
    ],
  });

  // Same attribute, no goal: grows 法语 but is not this goal's evidence.
  const trip = await mutate<Created>(page, "tasks.create", {
    title: "法国旅游准备",
    priority: 4,
    contributions: [{ attributeId: attr("french"), weight: 2 }],
  });
  await complete(trip.id);

  // Data analyst: SQL plan, and one task shared with 掌握 Python (60 / 40).
  const sqlPlan = await plan(analyst.id, "系统学习 SQL");
  await complete((await planTask(sqlPlan.id, "完成 SQL 窗口函数练习", { priority: 2 })).id);
  await planTask(sqlPlan.id, "用 SQL 分析一份公开数据集");
  const project = await mutate<Created>(page, "tasks.create", {
    title: "写一个 Python 数据分析项目",
    priority: 4,
    contributions: [{ attributeId: attr("python"), weight: 2 }],
  });
  await mutate(page, "development.goals.setForTask", {
    taskId: project.id,
    goalIds: [analyst.id, pythonGoal.id],
  });
  await complete(project.id);
  await mutate(page, "development.attribution.set", {
    taskId: project.id,
    allocations: [
      { goalId: analyst.id, attributeId: attr("python"), share: 60 },
      { goalId: pythonGoal.id, attributeId: attr("python"), share: 40 },
    ],
  });
  // Shared and not yet allocated.
  const notebook = await mutate<Created>(page, "tasks.create", {
    title: "整理 pandas 学习笔记",
    priority: 2,
    contributions: [{ attributeId: attr("python"), weight: 2 }],
  });
  await mutate(page, "development.goals.setForTask", {
    taskId: notebook.id,
    goalIds: [analyst.id, pythonGoal.id],
  });
  await complete(notebook.id);

  return { french: french.id, pythonGoal: pythonGoal.id, reading: reading.id, project: project.id };
}

test("M9 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);

  // 9. Empty state: a brand-new goal has no plans and no actions yet.
  const attributes = await query<Keyed[]>(page, "character.attributes.list");
  const empty = await mutate<Created>(page, "development.goals.create", {
    title: "建立稳定的阅读习惯",
    attributes: [{ attributeId: attributes.find((a) => a.systemKey === "reading")!.id, weight: 3 }],
  });
  await page.goto(`/development/goals/${empty.id}`);
  await expect(page.getByTestId("plans-empty")).toBeVisible();
  await shot(page, `${OUT}/09-empty-state.png`, { fullPage: true });
  await mutate(page, "development.goals.delete", { id: empty.id });

  const ids = await seed(page);

  // 1. Development overview.
  await page.goto("/development");
  await expect(page.getByTestId("plans-overview")).toBeVisible();
  await shot(page, `${OUT}/01-development-overview.png`, { fullPage: true });

  // 2. Goal detail.
  await page.goto(`/development/goals/${ids.french}`);
  await expect(page.getByTestId("plan").first()).toBeVisible();
  await shot(page, `${OUT}/02-goal-detail.png`, { fullPage: true });

  // 3. Goal with growth plans (both expanded).
  const plans = page.getByTestId("goal-plans");
  await plans.getByTestId("plan").nth(1).getByRole("button").first().click();
  await plans.scrollIntoViewIfNeeded();
  await plans.screenshot({ path: `${OUT}/03-goal-plans.png` });

  // 6. Goal statistics: separate evidence, each with its source.
  await page.getByTestId("goal-evidence").screenshot({ path: `${OUT}/06-goal-statistics.png` });

  // 5. Partial attribution: 法语 100 %, 专注力 50 % (the rest stays 未归属).
  await page.getByRole("button", { name: "编辑「专注读法语小说 1 小时」的成长归属" }).click();
  await expect(page.getByTestId("attribution-dialog")).toBeVisible();
  await shot(page, `${OUT}/05-partial-attribution.png`);
  await page.getByTestId("attribution-dialog").getByRole("button", { name: "取消" }).click();

  // 4. Attribution editor: one task shared by two goals, 60 / 40.
  await page.goto(`/development/goals/${ids.pythonGoal}`);
  await page.getByRole("button", { name: "编辑「写一个 Python 数据分析项目」的成长归属" }).click();
  await expect(page.getByTestId("attribution-dialog")).toBeVisible();
  await shot(page, `${OUT}/04-attribution-editor.png`);
  await page.getByTestId("attribution-dialog").getByRole("button", { name: "取消" }).click();

  // 10. Dashboard regression.
  await page.goto("/");
  await expect(page.getByTestId("character-header")).toBeVisible();
  await expect(page.getByTestId("ranking-row").first()).toBeVisible();
  await shot(page, `${OUT}/10-dashboard-regression.png`, { fullPage: true });

  const storage = await page.context().storageState();

  // 7. Mobile goal detail.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto(`/development/goals/${ids.french}`);
  await expect(mobile.getByTestId("plan").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/07-mobile-goal-detail.png`, { fullPage: true });
  await phone.close();

  // 8. Dark mode.
  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(`/development/goals/${ids.french}`);
  await expect(darkPage.getByTestId("plan").first()).toBeVisible();
  await shot(darkPage, `${OUT}/08-dark-goal-detail.png`, { fullPage: true });
  await dark.close();
});
