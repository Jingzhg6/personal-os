import { expect, test } from "@playwright/test";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;

/*
 * The e2e user is shared by parallel tests, so these assertions follow entries by their unique
 * titles rather than comparing totals.
 */

test("completing and reopening a task in the list earns and reverses XP", async ({ page }) => {
  const title = unique("周报");
  const nav = page.getByRole("navigation", { name: "主导航" });
  // Visit the character page first: coming back must not show cached, stale XP.
  await page.goto("/character");
  await expect(page.getByTestId("level-card")).toBeVisible();
  await nav.getByRole("link", { name: "全部任务" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  const input = page.getByLabel("快速添加任务");
  await input.fill(`${title} @工作 !2`);
  await input.press("Enter");
  const row = page.getByTestId("task-row").filter({ hasText: title });
  await row.getByRole("checkbox", { name: `完成「${title}」` }).click();
  await expect(row).toHaveCount(0); // completed tasks fold away

  await nav.getByRole("link", { name: "角色", exact: true }).click();
  const grant = page
    .getByTestId("recent-grants")
    .getByTestId("xp-entry")
    .filter({ hasText: title });
  await expect(grant).toContainText("完成任务");
  await expect(grant).toContainText("工作");
  await expect(grant).toContainText("+20"); // 10 + priority 2 × 5

  // Reopen from the task panel (opened from the XP entry's link).
  await grant.getByRole("link", { name: `打开「${title}」` }).click();
  await expect(page).toHaveURL(/\/tasks\?task=/);
  await page
    .getByRole("complementary", { name: "任务详情" })
    .getByRole("button", { name: "重新打开" })
    .click();
  await expect(
    page.getByRole("complementary", { name: "任务详情" }).getByRole("button", { name: "完成" }),
  ).toBeVisible();

  await page.goto("/character/xp?kind=reversal");
  const reversal = page.getByTestId("xp-entry").filter({ hasText: title });
  await expect(reversal).toHaveAttribute("data-kind", "reversal");
  await expect(reversal).toContainText("-20");

  await page.getByRole("button", { name: "获得", exact: true }).click();
  await expect(page).toHaveURL(/kind=grant/);
  await expect(page.getByTestId("xp-entry").filter({ hasText: title })).toContainText("已撤销");
});

test("shows level, attributes and radar, and edits the area → attribute links", async ({
  page,
}) => {
  await page.goto("/character");
  await expect(page.getByTestId("level-card")).toContainText(/等级 \d+/);
  await expect(page.getByTestId("attribute-row")).toHaveCount(6);
  await expect(page.getByRole("img", { name: "属性雷达图" })).toBeVisible();

  await page.getByRole("button", { name: "设置来源领域" }).click();
  const dialog = page.getByRole("dialog", { name: "领域与属性" });
  const select = dialog.getByLabel("「健康」计入");
  await expect(select).toHaveValue(/.+/);
  await select.selectOption({ label: "仅计入总经验" });
  await expect(page.getByText("已保存")).toBeVisible();
  await expect(page.getByTestId("attribute-row").filter({ hasText: "健身" })).toContainText(
    "未关联领域",
  );
  await select.selectOption({ label: "健身" });
  await expect(page.getByTestId("attribute-row").filter({ hasText: "健身" })).toContainText(
    "来源：健康",
  );
});
