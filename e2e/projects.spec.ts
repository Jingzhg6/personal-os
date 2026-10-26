import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;
const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });
const row = (page: Page, title: string) => page.getByTestId("task-row").filter({ hasText: title });
const card = (page: Page, title: string) =>
  page.getByTestId("kanban-card").filter({ hasText: title });
const column = (page: Page, status: string) =>
  page.locator(`[data-testid="kanban-column"][data-status="${status}"]`);

async function quickAdd(page: Page, text: string, label = "快速添加任务") {
  const input = page.getByLabel(label);
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

/** Creates a project through the dialog and lands on its page. */
async function createProject(page: Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "新建项目" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog.getByLabel("名称").fill(name);
  await dialog.getByLabel("状态").selectOption({ label: "进行中" });
  await dialog.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

test("creates a project, adds tasks to it and computes progress", async ({ page }) => {
  const name = unique("法语考试");
  const url = await createProject(page, name);

  await quickAdd(page, "报名");
  await quickAdd(page, "模拟考试");
  await expect(page.getByText("0/2 个任务")).toBeVisible();

  await row(page, "报名").getByRole("checkbox", { name: "完成「报名」" }).click();
  await expect(page.getByText("1/2 个任务")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "1/2 个任务" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );

  await page.goto("/projects");
  await expect(page.getByTestId("project-card").filter({ hasText: name })).toContainText(
    "1/2 个任务",
  );

  // The same tasks appear in 全部任务, labelled with the project.
  await page.goto(`/tasks?q=${encodeURIComponent("模拟考试")}`);
  await expect(row(page, "模拟考试").first()).toContainText(name);
  expect(url).toMatch(/\/projects\/[0-9a-f-]{36}$/);
});

test("moves tasks between statuses on the board", async ({ page }) => {
  const name = unique("看板项目");
  const url = await createProject(page, name);
  await quickAdd(page, "写初稿");
  await quickAdd(page, "排版");
  await page.goto(`${url}?view=board`);
  await expect(column(page, "待办").getByText("写初稿")).toBeVisible();

  // Menu (keyboard / touch path).
  await card(page, "写初稿").getByRole("button", { name: "修改「写初稿」的状态" }).click();
  await page.getByRole("menuitemradio", { name: "进行中" }).click();
  await expect(column(page, "进行中").getByText("写初稿")).toBeVisible();

  // Pointer drag into 已完成.
  const source = card(page, "排版").locator("[data-row-main]");
  const target = column(page, "已完成");
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 15, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 });
  await page.mouse.up();
  await expect(column(page, "已完成").getByText("排版")).toBeVisible();
  await expect(page.getByText("1/2 个任务")).toBeVisible();

  // Same task, same status everywhere.
  await page.goto(`${url}`);
  await row(page, "写初稿").locator("[data-row-main]").click();
  await expect(panel(page).getByLabel("状态").locator("option:checked")).toHaveText("进行中");
});

test("manages milestones and assigns tasks to them", async ({ page }) => {
  const name = unique("里程碑项目");
  const url = await createProject(page, name);
  await quickAdd(page, "提交申请");
  await page.goto(`${url}?view=milestones`);
  await page.getByLabel("里程碑名称").fill("第一阶段");
  await page.getByRole("button", { name: "添加里程碑" }).click();
  await expect(page.getByTestId("milestone-row")).toContainText("还没有任务");

  await page.goto(url);
  await row(page, "提交申请").locator("[data-row-main]").click();
  await panel(page).getByLabel("里程碑").selectOption({ label: "第一阶段" });
  await expect(row(page, "提交申请")).toContainText("第一阶段");
  await page.keyboard.press("Escape");

  await page.goto(`${url}?view=milestones`);
  const milestone = page.getByTestId("milestone-row");
  await expect(milestone).toContainText("0/1 个任务");
  await milestone.getByRole("checkbox", { name: "完成里程碑「第一阶段」" }).click();
  await expect(
    milestone.getByRole("checkbox", { name: "重新打开里程碑「第一阶段」" }),
  ).toBeChecked();

  await milestone.getByRole("link", { name: "查看任务" }).click();
  await expect(page).toHaveURL(/milestone=/);
  await expect(row(page, "提交申请")).toBeVisible();
});

test("moves an existing task into a project, filters the global board, edits and deletes the project", async ({
  page,
}) => {
  const name = unique("迁移项目");
  const loose = unique("独立任务");
  const url = await createProject(page, name);

  await page.goto("/tasks");
  await quickAdd(page, loose);
  await row(page, loose).locator("[data-row-main]").click();
  await panel(page).getByLabel("项目").selectOption({ label: name });
  await expect(row(page, loose)).toContainText(name);
  await page.keyboard.press("Escape");

  await page.goto(url);
  await expect(row(page, loose)).toBeVisible();

  // Global board filtered to the project.
  await page.goto("/projects/kanban");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/project=/);
  await expect(page.getByTestId("kanban-card")).toHaveCount(1);

  // Edit: mark the project completed; it moves to 已结束.
  await page.goto(url);
  await page.getByRole("button", { name: "编辑项目" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑项目" });
  await dialog.getByLabel("状态").selectOption({ label: "已完成" });
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已完成").first()).toBeVisible();
  await page.goto("/projects?status=closed");
  await expect(page.getByTestId("project-card").filter({ hasText: name })).toBeVisible();

  // Delete: the task stays, without a project.
  await page.goto(url);
  await page.getByRole("button", { name: "删除项目" }).click();
  await page
    .getByRole("dialog", { name: `删除项目「${name}」？` })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto(`/tasks?q=${encodeURIComponent(loose)}`);
  await expect(row(page, loose)).toBeVisible();
  await expect(row(page, loose)).not.toContainText(name);
});
