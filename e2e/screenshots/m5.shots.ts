import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m5";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Area {
  id: string;
  systemKey: string | null;
}
interface Status {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

async function seed(page: Page) {
  const areas = await query<Area[]>(page, "areas.list");
  const statuses = await query<Status[]>(page, "tasks.statuses.list");
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const status = (key: string) => statuses.find((s) => s.systemKey === key)!.id;
  const project = (input: Record<string, unknown>) =>
    mutate<Created>(page, "projects.create", input);
  const milestone = (input: Record<string, unknown>) =>
    mutate<Created>(page, "projects.milestones.create", input);
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);
  const depends = (blocking: Created, blocked: Created) =>
    mutate(page, "tasks.dependencies.add", {
      blockingTaskId: blocking.id,
      blockedTaskId: blocked.id,
    });

  const site = await project({
    name: "官网改版 v2",
    areaId: area("work"),
    color: "blue",
    priority: 3,
    startDate: day(-12),
    targetDate: day(32),
  });
  await milestone({ projectId: site.id, name: "设计定稿", dueDate: day(8) });
  await milestone({ projectId: site.id, name: "正式上线", dueDate: day(30) });
  const s = { projectId: site.id };
  const interviews = await task({
    ...s,
    title: "需求访谈",
    startDate: day(-12),
    dueDate: day(-8),
    statusId: status("done"),
  });
  const ia = await task({
    ...s,
    title: "信息架构",
    startDate: day(-7),
    dueDate: day(-2),
    statusId: status("done"),
  });
  const design = await task({
    ...s,
    title: "视觉设计",
    startDate: day(-1),
    dueDate: day(8),
    statusId: status("in_progress"),
    priority: 3,
  });
  const build = await task({ ...s, title: "前端开发", startDate: day(6), dueDate: day(22) });
  const content = await task({ ...s, title: "内容迁移", startDate: day(10), dueDate: day(24) });
  const qa = await task({ ...s, title: "测试与修复", startDate: day(23), dueDate: day(28) });
  const launch = await task({ ...s, title: "上线发布", dueDate: day(30), priority: 4 });
  await depends(interviews, ia);
  await depends(ia, design);
  await depends(ia, content);
  await depends(design, build); // starts before the design is due: shown as a conflict
  await depends(build, qa);
  await depends(content, qa);
  await depends(qa, launch);

  const delf = await project({
    name: "通过 DELF B2 考试",
    areaId: area("learning"),
    color: "violet",
    startDate: day(-30),
    targetDate: day(45),
  });
  await milestone({ projectId: delf.id, name: "两次完整模拟考试", dueDate: day(18) });
  const d = { projectId: delf.id };
  await task({
    ...d,
    title: "听力精听 20 篇",
    startDate: day(-14),
    dueDate: day(-1),
    isUrgent: true,
    isImportant: true,
  });
  const writing = await task({
    ...d,
    title: "写作范文 10 篇",
    startDate: day(2),
    dueDate: day(14),
  });
  const mock1 = await task({
    ...d,
    title: "第一次模拟考试",
    dueDate: day(5),
    statusId: status("in_progress"),
  });
  const mock2 = await task({ ...d, title: "第二次模拟考试", dueDate: day(17) });
  await depends(mock1, mock2);
  await depends(writing, mock2);
  await task({ ...d, title: "参加考试", dueDate: day(45), priority: 4 });

  await task({ title: "预约年度体检", areaId: area("personal"), dueDate: day(3) });
  await task({
    title: "准备报税材料",
    areaId: area("admin"),
    startDate: day(12),
    dueDate: day(16),
  });
  await task({ title: "整理书架", areaId: area("personal") });
  await task({ title: "研究新相机", areaId: area("personal") });
  return { siteId: site.id };
}

test("M5 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  await registerDemoUser(page);
  const { siteId } = await seed(page);

  // 1. Global Gantt (week scale): project groups, milestones, dependency arrows, a conflict.
  await page.goto("/projects/gantt");
  await expect(page.getByTestId("gantt-bar")).toHaveCount(14);
  await expect(page.getByTestId("gantt-arrows")).toBeVisible();
  await shot(page, `${OUT}/01-gantt.png`);

  // 2. Clicking a bar opens the shared detail panel with its dependencies.
  await page.getByRole("button", { name: /^前端开发，/ }).click();
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await expect(panel.getByTestId("dependencies-blockedBy")).toContainText("视觉设计");
  await panel.getByRole("heading", { name: "依赖" }).scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/02-gantt-dependencies.png`);

  // 3. Adding a prerequisite from the panel.
  await panel.getByRole("button", { name: "添加前置" }).click();
  await page.getByRole("textbox", { name: "搜索任务" }).fill("报税");
  await expect(page.getByRole("option", { name: /准备报税材料/ })).toBeVisible();
  await shot(page, `${OUT}/03-add-dependency.png`);
  await page.keyboard.press("Escape");

  // 4. Project page, 甘特图 tab, day scale.
  await page.goto(`/projects/${siteId}?view=gantt&zoom=day`);
  await expect(page.getByTestId("gantt-bar")).toHaveCount(7);
  await shot(page, `${OUT}/04-project-gantt-day.png`);

  // 5. Month scale with the unscheduled tasks listed below.
  await page.goto("/projects/gantt?zoom=month");
  await page.getByRole("button", { name: "未排期（2）" }).click();
  await shot(page, `${OUT}/05-gantt-month.png`, { fullPage: true });

  // 6. Task list: blocked tasks carry a 受阻 marker.
  await page.goto("/tasks");
  await expect(page.getByLabel(/^等待 \d 个前置任务$/).first()).toBeVisible();
  await shot(page, `${OUT}/06-tasks-blocked.png`);

  // 7. Phone, dark: the chart scrolls sideways with the task names pinned.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    storageState: await page.context().storageState(),
  });
  const mobile = await phone.newPage();
  await mobile.goto(`/projects/${siteId}?view=gantt`);
  await expect(mobile.getByTestId("gantt-bar").first()).toBeVisible();
  await shot(mobile, `${OUT}/07-mobile-gantt-dark.png`);
  await phone.close();
});
