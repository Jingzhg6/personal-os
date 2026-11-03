import { expect, test } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { query } from "./screenshots/support";

/* V2 (ADR 0028): dashboard panel order and investments, through the UI, for a fresh user. */

test.use({ storageState: { cookies: [], origins: [] } });

test("dashboard panels are reordered by dragging and kept after reload", async ({ page }) => {
  await register(page, { name: "面板", email: uniqueEmail() });
  const order = () =>
    page
      .locator("[data-panel]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-panel")));
  await expect(page.getByTestId("dashboard-panels")).toBeVisible();
  expect((await order())[0]).toBe("character");
  // Drag 角色 by its handle onto 本周.
  const handle = (await page.getByTestId("panel-handle-character").boundingBox())!;
  const target = (await page.getByTestId("panel-week").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, handle.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await order())[0]).not.toBe("character");
  const saved = await order();
  await expect
    .poll(
      async () =>
        (await query<{ dashboardPanels: string[] | null }>(page, "settings.get")).dashboardPanels,
    )
    .toEqual(saved);
  await page.reload();
  await expect.poll(order).toEqual(saved);
  await page.getByTestId("dashboard-reset-layout").click();
  await expect.poll(async () => (await order())[0]).toBe("character");
});

test("investments are added, edited and deleted, and counted in the totals", async ({ page }) => {
  await register(page, { name: "投资", email: uniqueEmail() });
  await page.goto("/finance/investments");
  await page.getByTestId("investment-add").click();
  await page.getByTestId("investment-name").fill("沪深300 ETF");
  await page.getByTestId("investment-kind").selectOption("etf");
  await page.getByTestId("investment-date").fill("2026-01-05");
  await page.getByTestId("investment-cost-input").fill("1000");
  await page.getByTestId("investment-quantity").fill("250");
  await page.getByTestId("investment-submit").click();
  const row = page.getByTestId("investment-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("未估值");

  await row.getByTestId("investment-edit").click();
  await page.getByTestId("investment-value-input").fill("1180.5");
  await page.getByTestId("investment-submit").click();
  await expect(row).not.toContainText("未估值");
  const overview = await query<{ assets: string; investments: { cost: string; value: string } }>(
    page,
    "finance.overview",
  );
  expect(overview.investments).toMatchObject({ cost: "1000.00", value: "1180.50" });
  expect(overview.assets).toBe("1180.50");
  await page.goto("/finance");
  await expect(page.getByTestId("finance-investments-value")).toContainText("1,180.50");

  await page.goto("/finance/investments");
  await page.getByTestId("investment-delete").click();
  await page.getByRole("dialog").getByRole("button", { name: "删除" }).click();
  await expect(row).toHaveCount(0);
});
