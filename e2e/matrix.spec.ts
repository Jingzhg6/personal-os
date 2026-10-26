import { expect, test, type Page } from "@playwright/test";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;
const zone = (page: Page, placement: string) => page.getByTestId(`matrix-zone-${placement}`);
const card = (page: Page, title: string) =>
  page.getByTestId("matrix-card").filter({ hasText: title });
const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });

async function addTo(page: Page, placementTitle: string, title: string) {
  const input = page.getByLabel(`添加到「${placementTitle}」`);
  await input.fill(title);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

async function moveWithMenu(page: Page, title: string, placementTitle: string) {
  await card(page, title)
    .getByRole("button", { name: `移动「${title}」到其他象限` })
    .click();
  await page.getByRole("menuitemradio", { name: placementTitle, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/tasks/matrix");
  await expect(page.getByRole("heading", { level: 1, name: "四象限矩阵" })).toBeVisible();
});

test("places tasks by their urgent / important flags and adds tasks into a quadrant", async ({
  page,
}) => {
  const title = unique("季度规划");
  await addTo(page, "重要不紧急", title);
  await expect(zone(page, "schedule").getByText(title)).toBeVisible();

  // The same task, unchanged, in the task list: important, not urgent.
  await page.goto(`/tasks?q=${encodeURIComponent(title)}`);
  const row = page.getByTestId("task-row").filter({ hasText: title });
  await expect(row).toContainText("重要");
  await expect(row).not.toContainText("紧急");
});

test("moves a card with the menu and keeps the flags", async ({ page }) => {
  const title = unique("报税");
  await addTo(page, "未分类", title);
  await expect(zone(page, "unsorted").getByText(title)).toBeVisible();

  await moveWithMenu(page, title, "重要且紧急");
  await expect(zone(page, "do").getByText(title)).toBeVisible();
  await expect(zone(page, "unsorted").getByText(title)).toHaveCount(0);

  await page.reload();
  await expect(zone(page, "do").getByText(title)).toBeVisible();
  await card(page, title).locator("[data-row-main]").click();
  await expect(panel(page).getByLabel("紧急", { exact: true })).toHaveValue("yes");
  await expect(panel(page).getByLabel("重要", { exact: true })).toHaveValue("yes");
  await page.keyboard.press("Escape");

  // Back to 未分类 clears both flags.
  await moveWithMenu(page, title, "未分类");
  await expect(zone(page, "unsorted").getByText(title)).toBeVisible();
  await card(page, title).locator("[data-row-main]").click();
  await expect(panel(page).getByLabel("紧急", { exact: true })).toHaveValue("");
  await expect(panel(page).getByLabel("重要", { exact: true })).toHaveValue("");
});

test("moves a card by dragging it to another quadrant", async ({ page }) => {
  const title = unique("整理照片");
  await addTo(page, "未分类", title);
  const source = card(page, title).locator("[data-row-main]");
  const target = zone(page, "eliminate");
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await expect(target).toHaveClass(/border-primary/);
  await page.mouse.up();

  await expect(zone(page, "eliminate").getByText(title)).toBeVisible();
  await page.reload();
  await expect(zone(page, "eliminate").getByText(title)).toBeVisible();
});

test("opens the shared detail panel and completes tasks from a card", async ({ page }) => {
  const title = unique("回复邮件");
  await addTo(page, "紧急不重要", title);
  await card(page, title).locator("[data-row-main]").click();
  await expect(page).toHaveURL(/\/tasks\/matrix\?task=/);
  await expect(panel(page).getByRole("textbox", { name: "标题" })).toHaveValue(title);
  await page.keyboard.press("Escape");

  await card(page, title)
    .getByRole("checkbox", { name: `完成「${title}」` })
    .click();
  await expect(card(page, title)).toHaveCount(0); // the matrix shows open tasks only
});

test("shows subtasks with their parent", async ({ page }) => {
  const parent = unique("考试准备");
  const child = unique("口语练习");
  await addTo(page, "重要不紧急", parent);
  await card(page, parent).locator("[data-row-main]").click();
  await panel(page).getByLabel("添加子任务，按回车保存").fill(child);
  await panel(page).getByLabel("添加子任务，按回车保存").press("Enter");
  await expect(panel(page).getByRole("button", { name: child, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(zone(page, "unsorted").getByText(child)).toBeVisible();
  await expect(card(page, child)).toContainText(`属于「${parent}」`);
});
