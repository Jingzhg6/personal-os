import { devices, expect, test, type Page } from "@playwright/test";

import { day, doc, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m2";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

interface Area {
  id: string;
  systemKey: string | null;
}
interface Created {
  id: string;
}

async function seed(page: Page) {
  const areas = await query<Area[]>(page, "areas.list");
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const tag = async (name: string, color: string) =>
    (await mutate<Created>(page, "tasks.tags.create", { name, color })).id;
  const [french, exam, tax, client] = [
    await tag("法语", "violet"),
    await tag("考试", "red"),
    await tag("税务", "amber"),
    await tag("客户", "blue"),
  ];
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);

  await task({
    title: "完成法语听力练习",
    areaId: area("learning"),
    tagIds: [french],
    priority: 3,
    isImportant: true,
    dueDate: day(0),
    estimatedMinutes: 50,
  });
  const delf = await task({
    title: "准备 DELF B2 考试",
    areaId: area("learning"),
    tagIds: [exam, french],
    priority: 4,
    isUrgent: true,
    isImportant: true,
    startDate: day(-14),
    dueDate: day(3),
    estimatedMinutes: 600,
    description: doc("目标：四项都达到 15 分以上。", "每天练习一小时，重点是听力和口语。"),
  });
  const mock = await task({ title: "听力模拟题", parentTaskId: delf.id });
  await mutate(page, "tasks.complete", { id: mock.id });
  await task({ title: "口语练习 30 分钟", parentTaskId: delf.id, dueDate: day(1) });
  await task({ title: "整理语法错题", parentTaskId: delf.id });
  await task({
    title: "整理 2025 年度报税材料",
    areaId: area("admin"),
    tagIds: [tax],
    priority: 3,
    isUrgent: true,
    dueDate: day(-2),
  });
  await task({
    title: "续签居留卡",
    areaId: area("admin"),
    priority: 2,
    isImportant: true,
    dueDate: day(20),
  });
  await task({
    title: "回复客户邮件",
    areaId: area("work"),
    tagIds: [client],
    priority: 2,
    isUrgent: true,
    dueDate: day(0),
    dueTime: "17:00",
  });
  await task({
    title: "准备季度业务复盘",
    areaId: area("business"),
    priority: 3,
    isImportant: true,
    dueDate: day(6),
  });
  await task({ title: "更新个人网站作品集", areaId: area("work"), priority: 1 });
  await task({ title: "健身房力量训练", areaId: area("health"), estimatedMinutes: 60 });
  await task({ title: "给父母打电话", areaId: area("personal") });
  await task({ title: "读完《原则》第三章", areaId: area("learning") });
  const done = await task({ title: "提交报销单", areaId: area("work") });
  await mutate(page, "tasks.complete", { id: done.id });

  const old = await task({ title: "旧的会议准备" });
  await task({ title: "打印议程", parentTaskId: old.id });
  await mutate(page, "tasks.delete", { id: old.id });
  const stale = await task({ title: "已取消的旅行计划" });
  await mutate(page, "tasks.delete", { id: stale.id });

  return { delfId: delf.id };
}

test("M2 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await registerDemoUser(page);
  const { delfId } = await seed(page);

  // 1. All tasks: filter bar, metadata, drag handles.
  await page.goto("/tasks");
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  await page.getByTestId("task-row").filter({ hasText: "准备 DELF B2 考试" }).hover();
  await shot(page, `${OUT}/01-all-tasks.png`);

  // 2. Filter menu open with two priorities selected (state is in the URL).
  await page.getByRole("button", { name: "优先级" }).click();
  await page.getByRole("menuitemcheckbox", { name: "高", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "最高" }).click();
  await expect(page).toHaveURL(/priority=/);
  await shot(page, `${OUT}/02-filter-priority.png`);
  await page.keyboard.press("Escape");

  // 3. Search across levels: a subtask shows its parent.
  await page.goto(`/tasks?q=${encodeURIComponent("听力")}`);
  // Matches two titles and one description ("…重点是听力和口语").
  await expect(page.getByText("找到 3 个任务")).toBeVisible();
  // The matching subtask is completed: expand that group to show its parent hint.
  await page.getByRole("button", { name: /显示已完成/ }).click();
  await expect(page.getByText("属于「准备 DELF B2 考试」")).toBeVisible();
  await shot(page, `${OUT}/03-search.png`);

  // 4. Detail panel: parent field, sortable subtasks, rich text.
  await page.goto(`/tasks?task=${delfId}`);
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await expect(panel.getByRole("textbox", { name: "标题" })).toHaveValue("准备 DELF B2 考试");
  await panel.getByTestId("subtask-row").nth(1).hover();
  await shot(page, `${OUT}/04-detail-panel.png`);

  // 5. Scoped navigation view.
  await page.goto("/work");
  await expect(page.getByText("包含领域")).toBeVisible();
  await shot(page, `${OUT}/05-work-view.png`);

  // 6. Deadlines grouped by due date (includes subtasks).
  await page.goto("/admin/deadlines");
  await expect(page.getByRole("region", { name: /^已逾期/ })).toBeVisible();
  await shot(page, `${OUT}/06-deadlines.png`);

  // 7. Trash.
  await page.goto("/tasks/trash");
  await expect(page.getByTestId("trash-row")).toHaveCount(2);
  await shot(page, `${OUT}/07-trash.png`);

  // 8. Phone (touch, no hover), dark theme, same signed-in session.
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale: "zh-CN",
    colorScheme: "dark",
    storageState: await page.context().storageState(),
  });
  const mobile = await phone.newPage();
  await mobile.goto("/tasks");
  await expect(mobile.getByTestId("task-row").first()).toBeVisible();
  await shot(mobile, `${OUT}/08-mobile-dark.png`);
  await phone.close();
});
