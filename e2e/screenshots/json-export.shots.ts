import { copyFile } from "node:fs/promises";

import { devices, expect, test, type Page } from "@playwright/test";

import { day, mutate, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/json-export";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* A demo user with some data exports it from 设置 › 通用. */

async function centerExportCard(page: Page) {
  await page.getByTestId("export-data").evaluate((el) => el.scrollIntoView({ block: "center" }));
}

test("JSON export visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const project = await mutate<{ id: string }>(page, "projects.create", { name: "新版官网" });
  await mutate(page, "tasks.create", { title: "整理需求", projectId: project.id, dueDate: day(2) });
  await mutate(page, "tasks.create", { title: "预约牙医", dueDate: day(5) });

  // 1. The export card at the bottom of 设置 › 通用.
  await page.goto("/settings");
  await centerExportCard(page);
  await shot(page, `${OUT}/01-export-card.png`);

  // 2. After exporting: the file is saved, the toast and the card say what was saved.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-button").click(),
  ]);
  await expect(page.getByTestId("export-last")).toBeVisible();
  // The toast confirmed it; once closed, the card keeps the result (上次导出).
  await expect(page.getByText(/^已导出 \d+ 条记录/)).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  if (process.env.EXPORT_SAMPLE)
    await copyFile((await download.path())!, process.env.EXPORT_SAMPLE);
  await centerExportCard(page);
  await shot(page, `${OUT}/02-export-done.png`);

  // 3. A failed export (the server answering 500) is reported and nothing is saved.
  await page.route("**/api/export", (route) =>
    route.fulfill({ status: 500, body: '{"error":"export_failed"}' }),
  );
  await page.reload();
  await centerExportCard(page);
  await page.getByTestId("export-button").click();
  await expect(page.getByText("导出失败，请稍后再试。")).toBeVisible();
  await shot(page, `${OUT}/03-export-failed.png`);
  await page.unroute("**/api/export");

  const storage = await page.context().storageState();
  const phone = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "light",
  });
  const mobile = await phone.newPage();
  await mobile.goto("/settings");
  await mobile.getByTestId("export-button").scrollIntoViewIfNeeded();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  const [mobileDownload] = await Promise.all([
    mobile.waitForEvent("download"),
    mobile.getByTestId("export-button").tap(),
  ]);
  expect(mobileDownload.suggestedFilename()).toMatch(/\.json$/);
  await expect(mobile.getByTestId("export-last")).toBeVisible();
  await mobile.getByRole("button", { name: "关闭" }).click();
  await centerExportCard(mobile);
  await shot(mobile, `${OUT}/04-mobile-export.png`);
  await phone.close();

  const dark = await browser.newContext({
    baseURL,
    storageState: storage,
    locale: "zh-CN",
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
  });
  const darkPage = await dark.newPage();
  await darkPage.goto("/settings");
  await centerExportCard(darkPage);
  await shot(darkPage, `${OUT}/05-dark-export.png`);
  await dark.close();
});
