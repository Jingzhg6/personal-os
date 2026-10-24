import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => `${label} ${Math.random().toString(36).slice(2, 7)}`;

async function quickAdd(page: Page, text: string) {
  const input = page.getByLabel("快速添加任务");
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });

async function openTask(page: Page, title: string) {
  await row(page, title)
    .getByRole("button", { name: new RegExp(title) })
    .click();
  await expect(page.getByRole("complementary", { name: "任务详情" })).toBeVisible();
  return page.getByRole("complementary", { name: "任务详情" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "全部任务" })).toBeVisible();
});

test("Quick Add parses tags, area and priority", async ({ page }) => {
  const title = unique("完成法语听力练习");
  await quickAdd(page, `${title} #法语 @学习 !3`);

  const created = row(page, title);
  await expect(created).toContainText("法语");
  await expect(created).toContainText("学习");

  const panel = await openTask(page, title);
  await expect(panel.getByLabel("优先级")).toHaveValue("3");
  await expect(panel.getByLabel("领域").locator("option:checked")).toHaveText("学习");
  await expect(panel.getByText("法语", { exact: true })).toBeVisible();
});

test("edits every task field in the detail panel and keeps them after reload", async ({ page }) => {
  const title = unique("准备 DELF 考试");
  await quickAdd(page, title);
  const panel = await openTask(page, title);

  await panel.getByLabel("状态").selectOption({ label: "进行中" });
  await panel.getByLabel("优先级").selectOption({ label: "最高" });
  await panel.getByLabel("紧急", { exact: true }).selectOption({ label: "紧急" });
  await panel.getByLabel("重要", { exact: true }).selectOption({ label: "重要" });
  await panel.getByLabel("开始日期").fill("2026-10-20");
  await panel.getByLabel("截止日期").fill("2026-10-27");
  await panel.getByLabel("截止时间").fill("19:30");
  await panel.getByLabel("预计时长").fill("90");
  await panel.getByLabel("预计时长").press("Enter");
  await expect(panel.getByText("1 小时 30 分钟")).toBeVisible();

  await panel.getByRole("button", { name: "添加标签" }).click();
  await panel.getByLabel("搜索或新建标签").fill("考试");
  await panel.getByRole("button", { name: "新建标签「考试」" }).click();
  await expect(panel.getByRole("button", { name: "移除标签「考试」" })).toBeVisible();
  await page.keyboard.press("Escape");

  const editor = panel.getByRole("textbox", { name: "描述" });
  await editor.click();
  await page.keyboard.type("每天练习一小时");
  await panel.getByRole("button", { name: "粗体" }).click();
  await page.keyboard.type("，重点是口语");
  await expect(panel.getByText("已保存")).toBeVisible();

  const newTitle = `${title}（修订）`;
  const titleField = panel.getByRole("textbox", { name: "标题" });
  await titleField.fill(newTitle);
  await titleField.press("Enter");
  await expect(row(page, newTitle)).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole("complementary", { name: "任务详情" });
  await expect(reloaded.getByRole("textbox", { name: "标题" })).toHaveValue(newTitle);
  await expect(reloaded.getByLabel("状态").locator("option:checked")).toHaveText("进行中");
  await expect(reloaded.getByLabel("优先级")).toHaveValue("4");
  await expect(reloaded.getByLabel("紧急", { exact: true })).toHaveValue("yes");
  await expect(reloaded.getByLabel("重要", { exact: true })).toHaveValue("yes");
  await expect(reloaded.getByLabel("开始日期")).toHaveValue("2026-10-20");
  await expect(reloaded.getByLabel("截止日期")).toHaveValue("2026-10-27");
  await expect(reloaded.getByLabel("截止时间")).toHaveValue("19:30");
  await expect(reloaded.getByLabel("预计时长")).toHaveValue("90");
  await expect(reloaded.getByText("考试", { exact: true })).toBeVisible();
  await expect(reloaded.getByRole("textbox", { name: "描述" })).toContainText(
    "每天练习一小时，重点是口语",
  );
  await expect(reloaded.locator(".tiptap-content strong")).toHaveText("，重点是口语");

  const listed = row(page, newTitle);
  await expect(listed).toContainText("紧急");
  await expect(listed).toContainText("重要");
  await expect(listed).toContainText("考试");
});

test("rejects a start date after the due date with a translated message", async ({ page }) => {
  const title = unique("日期校验");
  await quickAdd(page, title);
  const panel = await openTask(page, title);
  await panel.getByLabel("截止日期").fill("2026-10-27");
  await expect(panel.getByLabel("截止日期")).toHaveValue("2026-10-27");
  await panel.getByLabel("开始日期").fill("2026-12-31");
  await expect(
    page.getByRole("alert").filter({ hasText: "开始日期不能晚于截止日期。" }),
  ).toBeVisible();
  await expect(panel.getByLabel("开始日期")).toHaveValue("");
});

test("manages subtasks", async ({ page }) => {
  const title = unique("搬家准备");
  await quickAdd(page, title);
  const panel = await openTask(page, title);

  const addSubtask = panel.getByLabel("添加子任务，按回车保存");
  for (const sub of ["打包书籍", "预约搬家公司"]) {
    await addSubtask.fill(sub);
    await addSubtask.press("Enter");
    await expect(panel.getByRole("button", { name: sub })).toBeVisible();
  }

  await panel.getByRole("checkbox", { name: "完成「打包书籍」" }).click();
  await expect(panel.getByRole("checkbox", { name: "重新打开「打包书籍」" })).toBeChecked();
  await expect(row(page, title)).toContainText("1/2");

  // Subtasks open in the same panel, with a link back to the parent.
  await panel.getByRole("button", { name: "预约搬家公司" }).click();
  await expect(panel.getByRole("textbox", { name: "标题" })).toHaveValue("预约搬家公司");
  await panel.getByRole("button", { name: title }).click();
  await expect(panel.getByRole("textbox", { name: "标题" })).toHaveValue(title);

  // Subtasks are not listed at the top level.
  await expect(row(page, "打包书籍")).toHaveCount(0);
});

test("completes and reopens a task from the list", async ({ page }) => {
  const title = unique("背单词");
  await quickAdd(page, title);

  await row(page, title)
    .getByRole("checkbox", { name: `完成「${title}」` })
    .click();
  await expect(row(page, title)).toHaveCount(0); // moved to the collapsed "completed" group

  await page.getByRole("button", { name: /显示已完成/ }).click();
  const done = row(page, title);
  await expect(done.getByRole("checkbox", { name: `重新打开「${title}」` })).toBeChecked();

  await done.getByRole("checkbox").click();
  await expect(
    row(page, title).getByRole("checkbox", { name: `完成「${title}」` }),
  ).not.toBeChecked();
});

test("deletes a task and its subtasks", async ({ page }) => {
  const title = unique("要删除的任务");
  await quickAdd(page, title);
  const panel = await openTask(page, title);
  await panel.getByLabel("添加子任务，按回车保存").fill("子任务");
  await panel.getByLabel("添加子任务，按回车保存").press("Enter");
  await expect(panel.getByRole("button", { name: "子任务", exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "删除任务" }).click();
  const dialog = page.getByRole("dialog", { name: "删除这个任务？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "删除" }).click();

  await expect(page.getByRole("complementary", { name: "任务详情" })).toBeHidden();
  await expect(row(page, title)).toHaveCount(0);
  await page.reload();
  await expect(row(page, title)).toHaveCount(0);
});

test("closes the detail panel with Escape and the close button", async ({ page }) => {
  const title = unique("面板");
  await quickAdd(page, title);
  await openTask(page, title);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/tasks$/);
  await openTask(page, title);
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.getByRole("complementary", { name: "任务详情" })).toBeHidden();
});
