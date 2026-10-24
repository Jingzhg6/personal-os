import { expect, test } from "@playwright/test";

test("renames, recolours and reorders areas", async ({ page }) => {
  await page.goto("/settings/areas");
  const rows = page.getByTestId("area-row");
  await expect(rows).toHaveCount(6);

  const personal = page.getByLabel("名称: 个人生活");
  await personal.fill("家庭");
  await personal.press("Enter");
  await expect(page.getByText("默认：个人生活")).toBeVisible();

  await page.getByRole("button", { name: "下移: 家庭" }).click();
  await expect(rows.nth(1).getByLabel("名称: 家庭")).toBeVisible();
  await rows.nth(1).getByRole("radio", { name: "紫色" }).click();
  await expect(rows.nth(1).getByRole("radio", { name: "紫色" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await page.reload();
  await expect(rows.nth(1).getByLabel("名称: 家庭")).toHaveValue("家庭");

  // Restore the translated default name, then the original order.
  await page.getByRole("button", { name: "恢复默认名称" }).click();
  await expect(rows.nth(1).getByLabel("名称: 个人生活")).toHaveValue("个人生活");
  await page.getByRole("button", { name: "上移: 个人生活" }).click();
  await expect(rows.nth(0).getByLabel("名称: 个人生活")).toBeVisible();
});

test("adds and deletes a custom area", async ({ page }) => {
  await page.goto("/settings/areas");
  await page.getByLabel("新领域名称").fill("旅行");
  await page.getByRole("button", { name: "添加领域" }).click();
  await expect(page.getByLabel("名称: 旅行")).toBeVisible();

  await page.getByRole("button", { name: "删除: 旅行" }).click();
  await page
    .getByRole("dialog", { name: "删除领域「旅行」？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByLabel("名称: 旅行")).toHaveCount(0);
});

test("adds a custom status that tasks can use", async ({ page }) => {
  await page.goto("/settings/statuses");
  await page.getByLabel("新状态名称").fill("待审核");
  await page.getByRole("combobox", { name: "状态" }).selectOption({ label: "进行中" });
  await page.getByRole("button", { name: "添加状态" }).click();
  await expect(page.getByLabel("名称: 待审核")).toBeVisible();
  // The last status of a category cannot be deleted.
  await expect(page.getByRole("button", { name: "删除: 已完成" })).toBeDisabled();

  await page.goto("/tasks");
  const input = page.getByLabel("快速添加任务");
  await input.fill("审核合同");
  await input.press("Enter");
  await page
    .getByTestId("task-row")
    .filter({ hasText: "审核合同" })
    .getByRole("button", { name: /审核合同/ })
    .click();
  const panel = page.getByRole("complementary", { name: "任务详情" });
  await panel.getByLabel("状态").selectOption({ label: "待审核" });
  await expect(panel.getByLabel("状态").locator("option:checked")).toHaveText("待审核");

  // Deleting a status in use moves its tasks to the chosen replacement.
  await page.goto("/settings/statuses");
  await page.getByRole("button", { name: "删除: 待审核" }).click();
  const dialog = page.getByRole("dialog", { name: "删除状态「待审核」？" });
  await dialog.getByRole("combobox").selectOption({ label: "进行中" });
  await dialog.getByRole("button", { name: "删除" }).click();
  await expect(page.getByLabel("名称: 待审核")).toHaveCount(0);
});

test("creates, renames and deletes tags", async ({ page }) => {
  await page.goto("/settings/tags");
  await page.getByLabel("标签名称（不含空格）").fill("阅读");
  await page.getByRole("button", { name: "添加标签" }).click();
  const name = page.getByLabel("名称: 阅读");
  await expect(name).toBeVisible();
  await name.fill("读书");
  await name.press("Enter");
  await expect(page.getByLabel("名称: 读书")).toBeVisible();

  await page.getByRole("button", { name: "删除: 读书" }).click();
  await page
    .getByRole("dialog", { name: "删除标签「读书」？" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.getByLabel("名称: 读书")).toHaveCount(0);
});
