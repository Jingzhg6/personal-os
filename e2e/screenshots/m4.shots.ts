import { devices, expect, test, type Page } from "@playwright/test";

import { day, doc, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m4";

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

  const delf = await project({
    name: "通过 DELF B2 考试",
    areaId: area("learning"),
    color: "violet",
    priority: 4,
    startDate: day(-40),
    targetDate: day(48),
    description: doc("目标：四项都达到 15 分以上。", "考试日期 12 月中旬，地点巴黎法语联盟。"),
  });
  const signUp = await milestone({ projectId: delf.id, name: "完成报名", dueDate: day(-5) });
  const mock = await milestone({ projectId: delf.id, name: "两次完整模拟考试", dueDate: day(20) });
  await milestone({ projectId: delf.id, name: "考前一周复盘", dueDate: day(41) });
  await mutate(page, "projects.milestones.setCompleted", { id: signUp.id, completed: true });
  for (const [title, extra] of [
    ["提交报名表", { milestoneId: signUp.id, statusId: status("done") }],
    ["缴纳考试费", { milestoneId: signUp.id, statusId: status("done") }],
    [
      "第一次模拟考试",
      { milestoneId: mock.id, statusId: status("in_progress"), dueDate: day(6), priority: 3 },
    ],
    ["整理口语话题", { milestoneId: mock.id, statusId: status("in_progress"), priority: 2 }],
    [
      "听力精听 20 篇",
      { milestoneId: mock.id, dueDate: day(-1), isUrgent: true, isImportant: true },
    ],
    ["写作范文 10 篇", { milestoneId: mock.id, dueDate: day(14) }],
    ["第二次模拟考试", { milestoneId: mock.id, dueDate: day(18) }],
    ["预订考试当天交通", { statusId: status("backlog") }],
  ] as const) {
    await task({ title, projectId: delf.id, ...extra });
  }

  const site = await project({
    name: "个人网站改版",
    areaId: area("work"),
    color: "blue",
    targetDate: day(-3),
  });
  await milestone({ projectId: site.id, name: "上线新首页", dueDate: day(10) });
  await task({ title: "设计新首页", projectId: site.id, statusId: status("done") });
  await task({
    title: "迁移博客文章",
    projectId: site.id,
    statusId: status("in_progress"),
    dueDate: day(-2),
  });
  await task({ title: "配置域名和 HTTPS", projectId: site.id });

  const review = await project({
    name: "第四季度业务复盘",
    areaId: area("business"),
    color: "amber",
    status: "planned",
    targetDate: day(30),
  });
  await task({ title: "收集销售数据", projectId: review.id });
  await task({ title: "访谈三位客户", projectId: review.id });

  const move = await project({
    name: "搬家到里昂",
    areaId: area("personal"),
    color: "green",
    status: "completed",
  });
  await task({ title: "退租", projectId: move.id, statusId: status("done") });
  await task({ title: "办理地址变更", projectId: move.id, statusId: status("done") });

  await task({ title: "回复房东邮件", areaId: area("personal"), dueDate: day(0) });
  return { delfId: delf.id };
}

test("M4 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  await registerDemoUser(page);
  const { delfId } = await seed(page);

  // 1. Project list with computed progress, target dates and next milestones.
  await page.goto("/projects");
  await expect(page.getByTestId("project-card")).toHaveCount(3);
  await shot(page, `${OUT}/01-projects.png`);

  // 2. Create dialog.
  await page.getByRole("button", { name: "新建项目" }).first().click();
  await page.getByLabel("名称").fill("准备马拉松");
  await shot(page, `${OUT}/02-new-project.png`);
  await page.keyboard.press("Escape");

  // 3. Project page, 任务 tab: the shared task list filtered to this project.
  await page.goto(`/projects/${delfId}`);
  await expect(page.getByRole("heading", { level: 1, name: "通过 DELF B2 考试" })).toBeVisible();
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  await shot(page, `${OUT}/03-project-tasks.png`);

  // 4. 看板 tab: same tasks by status.
  await page.goto(`/projects/${delfId}?view=board`);
  await expect(page.getByTestId("kanban-card").first()).toBeVisible();
  await shot(page, `${OUT}/04-project-board.png`);

  // 5. 里程碑 tab.
  await page.goto(`/projects/${delfId}?view=milestones`);
  await expect(page.getByTestId("milestone-row")).toHaveCount(3);
  await shot(page, `${OUT}/05-milestones.png`);

  // 6. Global board with the task panel open (project + milestone fields).
  await page.goto("/projects/kanban");
  await page
    .getByTestId("kanban-card")
    .filter({ hasText: "第一次模拟考试" })
    .locator("[data-row-main]")
    .click();
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await expect(panel.getByLabel("里程碑")).toBeVisible();
  await shot(page, `${OUT}/06-kanban-panel.png`);

  // 7. Phone: project page, board tab scrolls horizontally.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    storageState: await page.context().storageState(),
  });
  const mobile = await phone.newPage();
  await mobile.goto(`/projects/${delfId}?view=board`);
  await expect(mobile.getByTestId("kanban-card").first()).toBeVisible();
  await shot(mobile, `${OUT}/07-mobile-board-dark.png`);
  await phone.close();
});
