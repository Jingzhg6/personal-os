import { devices, expect, test } from "@playwright/test";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/nav-task-ux";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* Navigation and task-handling round: data made through the app's API, pages as the user sees them. */

test("Navigation and task handling visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const areas = await query<{ id: string; systemKey: string | null }[]>(page, "areas.list");
  const work = areas.find((a) => a.systemKey === "work")!.id;
  const admin = areas.find((a) => a.systemKey === "admin")!.id;
  const site = await mutate<{ id: string }>(page, "projects.create", {
    name: "官网改版",
    status: "active",
    areaId: work,
  });
  await mutate(page, "projects.create", { name: "年度报税", status: "active", areaId: admin });
  const move = await mutate<{ id: string }>(page, "tasks.create", {
    title: "准备搬家",
    startDate: day(0),
    dueDate: day(6),
    priority: 3,
    isImportant: true,
  });
  for (const title of ["订纸箱", "约搬家公司", "办理宽带迁移"]) {
    await mutate(page, "tasks.create", { title, parentTaskId: move.id });
  }
  await mutate(page, "tasks.create", {
    title: "设计首页",
    projectId: site.id,
    startDate: day(0),
    dueDate: day(3),
    priority: 2,
  });
  await mutate(page, "tasks.create", { title: "整理发票", areaId: admin, dueDate: day(10) });
  await mutate(page, "tasks.create", { title: "续订域名" });

  // 1. 全部任务: properties edited in place, subtasks expanded under their task.
  await page.goto("/tasks");
  const parent = page.getByTestId("task-row").filter({ hasText: "准备搬家" }).first();
  await parent.getByRole("button", { name: "展开「准备搬家」的子任务" }).click();
  await expect(parent.getByTestId("subtask-rows").getByTestId("task-row")).toHaveCount(3);
  await shot(page, `${OUT}/01-all-tasks.png`);

  // 2. A property menu open (area).
  await page
    .getByTestId("task-row")
    .filter({ hasText: "续订域名" })
    .getByRole("button", { name: /「续订域名」的领域/ })
    .click();
  await expect(page.getByRole("menuitemradio").first()).toBeVisible();
  await shot(page, `${OUT}/02-quick-edit-menu.png`);
  await page.keyboard.press("Escape");

  // 3. Completion asks for the date; an open subtask can be completed with its parent.
  await parent.getByRole("checkbox", { name: "完成「准备搬家」" }).click();
  await expect(page.getByTestId("complete-dialog")).toBeVisible();
  await page.getByRole("button", { name: "昨天" }).click();
  await shot(page, `${OUT}/03-complete-dialog.png`);
  await page
    .getByRole("dialog", { name: "确认完成" })
    .getByRole("button", { name: "取消" })
    .click();

  // 4. Projects: unassigned tasks below the cards, ready to be dragged in.
  await page.goto("/projects");
  await expect(page.getByTestId("unassigned-task").first()).toBeVisible();
  await shot(page, `${OUT}/04-projects-unassigned.png`);

  // 5. The sidebar with 财务 collapsed (remembered after reload).
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByRole("button", { name: "财务" }).click();
  await nav.getByRole("button", { name: "个人成长与生活" }).click();
  await page.reload();
  await expect(nav.getByRole("button", { name: "财务" })).toHaveAttribute("aria-expanded", "false");
  await shot(page, `${OUT}/05-sidebar-collapsed.png`);

  // 6–7. Phone: the task list and the navigation drawer.
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: await page.context().storageState(),
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/tasks");
  await expect(mobile.getByTestId("task-quick-fields").first()).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await shot(mobile, `${OUT}/06-mobile-tasks.png`);
  await mobile.getByRole("button", { name: "打开导航" }).click();
  await expect(mobile.getByRole("dialog").getByRole("navigation")).toBeVisible();
  await shot(mobile, `${OUT}/07-mobile-navigation.png`);
  await phone.close();
});
