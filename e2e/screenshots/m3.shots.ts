import { devices, expect, test, type Page } from "@playwright/test";

import { day, doc, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m3";

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
  const french = (
    await mutate<Created>(page, "tasks.tags.create", { name: "法语", color: "violet" })
  ).id;
  const tax = (await mutate<Created>(page, "tasks.tags.create", { name: "税务", color: "amber" }))
    .id;
  const task = (input: Record<string, unknown>) => mutate<Created>(page, "tasks.create", input);
  const flags = (isUrgent: boolean, isImportant: boolean) => ({ isUrgent, isImportant });

  // 重要且紧急
  await task({
    title: "整理 2025 年度报税材料",
    areaId: area("admin"),
    tagIds: [tax],
    priority: 3,
    dueDate: day(-2),
    ...flags(true, true),
  });
  await task({
    title: "回复客户邮件",
    areaId: area("work"),
    priority: 2,
    dueDate: day(0),
    dueTime: "17:00",
    ...flags(true, true),
  });
  const delf = await task({
    title: "准备 DELF B2 考试",
    areaId: area("learning"),
    tagIds: [french],
    priority: 4,
    dueDate: day(3),
    description: doc("每天练习一小时，重点是听力和口语。"),
    ...flags(true, true),
  });
  await task({
    title: "口语练习 30 分钟",
    parentTaskId: delf.id,
    dueDate: day(1),
    ...flags(true, true),
  });
  await task({ title: "听力模拟题", parentTaskId: delf.id });
  // 重要不紧急
  await task({
    title: "准备季度业务复盘",
    areaId: area("business"),
    priority: 3,
    dueDate: day(6),
    ...flags(false, true),
  });
  await task({
    title: "续签居留卡",
    areaId: area("admin"),
    dueDate: day(20),
    ...flags(false, true),
  });
  await task({ title: "健身房力量训练", areaId: area("health"), ...flags(false, true) });
  await task({ title: "读完《原则》第三章", areaId: area("learning"), ...flags(false, true) });
  // 紧急不重要
  await task({
    title: "预约空调维修",
    areaId: area("personal"),
    dueDate: day(1),
    ...flags(true, false),
  });
  await task({ title: "回复物业通知", areaId: area("admin"), ...flags(true, false) });
  // 不紧急不重要
  await task({ title: "整理旧照片", areaId: area("personal"), ...flags(false, false) });
  await task({ title: "试用新的笔记软件", ...flags(false, false) });
  // 未分类
  await task({ title: "给父母打电话", areaId: area("personal") });
  await task({ title: "更新个人网站作品集", areaId: area("work"), priority: 1 });
  await task({ title: "学习 Rust 基础", areaId: area("learning"), isImportant: true });
  return { delfId: delf.id };
}

const card = (page: Page, title: string) =>
  page.getByTestId("matrix-card").filter({ hasText: title }).first();

test("M3 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await registerDemoUser(page);
  const { delfId } = await seed(page);

  // 1. The matrix: four quadrants plus the unsorted tray.
  await page.goto("/tasks/matrix");
  await expect(card(page, "试用新的笔记软件")).toBeVisible();
  await shot(page, `${OUT}/01-matrix.png`);

  // 2. Pointer drag in progress: an unsorted task over 重要不紧急.
  const source = card(page, "学习 Rust 基础").locator("[data-row-main]");
  const target = page.getByTestId("matrix-zone-schedule");
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 40, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 70, { steps: 20 });
  await expect(target).toHaveClass(/border-primary/);
  await page.screenshot({ path: `${OUT}/02-dragging.png`, animations: "disabled" });
  await page.mouse.up();
  await expect(page.getByTestId("matrix-zone-schedule").getByText("学习 Rust 基础")).toBeVisible();

  // 3. Keyboard / touch alternative: the "移到" menu on a card.
  await card(page, "给父母打电话")
    .getByRole("button", { name: "移动「给父母打电话」到其他象限" })
    .click();
  await expect(page.getByRole("menuitemradio", { name: "未分类" })).toBeChecked();
  await shot(page, `${OUT}/03-move-menu.png`);
  await page.keyboard.press("Escape");

  // 4. The same detail panel as the task list, opened from a card.
  await page.goto(`/tasks/matrix?task=${delfId}`);
  await expect(
    page.getByRole("complementary", { name: "任务详情" }).getByRole("textbox", { name: "标题" }),
  ).toHaveValue("准备 DELF B2 考试");
  await shot(page, `${OUT}/04-detail-panel.png`);

  // 5. Filtered to one area, dark theme.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/tasks/matrix");
  await page.getByRole("button", { name: "领域" }).click();
  await page.getByRole("menuitemcheckbox", { name: "学习" }).click();
  await page.keyboard.press("Escape");
  await expect(card(page, "回复客户邮件")).toHaveCount(0);
  await shot(page, `${OUT}/05-filtered-dark.png`);

  // 6. Phone layout (touch, no hover).
  const phone = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL,
    locale: "zh-CN",
    colorScheme: "light",
    storageState: await page.context().storageState(),
  });
  const mobile = await phone.newPage();
  await mobile.goto("/tasks/matrix");
  await expect(card(mobile, "回复客户邮件")).toBeVisible();
  await shot(mobile, `${OUT}/06-mobile.png`);
  await phone.close();
});
