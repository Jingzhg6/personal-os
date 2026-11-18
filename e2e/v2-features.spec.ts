import { expect, test } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { query } from "./screenshots/support";

/* V2 (ADR 0028): dashboard panel order through the UI, for a fresh user. (Investments: V3.) */

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
