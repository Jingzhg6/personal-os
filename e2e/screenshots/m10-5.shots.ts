import { devices, expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";

import { day, mutate, query, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/m10-5";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/**
 * Real app operations (API) plus one fixture: deadlines are backdated as "planned three days ago"
 * in `tasks.planned_at`, the only way to produce planned tasks within one test run.
 */
async function seed(page: Page, pool: Pool) {
  const attributes = await query<{ id: string; systemKey: string | null }[]>(
    page,
    "character.attributes.list",
  );
  const french = attributes.find((a) => a.systemKey === "french")!.id;
  const reading = attributes.find((a) => a.systemKey === "reading")!.id;
  const task = async (title: string, dueOffset: number, contributions: string[] = []) => {
    const created = await mutate<{ id: string }>(page, "tasks.create", {
      title,
      dueDate: day(dueOffset),
      priority: 2,
      contributions: contributions.map((attributeId) => ({ attributeId, weight: 2 })),
    });
    await pool.query("update tasks set planned_at = now() - interval '3 days' where id = $1", [
      created.id,
    ]);
    return created.id;
  };
  const complete = (id: string) => mutate(page, "tasks.complete", { id });

  await complete(await task("完成法语语法练习", 2, [french]));
  await complete(await task("读完《活着》第三章", 1, [reading]));
  await complete(await task("提交季度报告", 0));
  await complete(await task("整理旅行照片", -1));
  const failed = await task("每天早起跑步", 4);
  await mutate(page, "tasks.fail", { id: failed });
  const overdue = await task("预约牙医", -2);
  await mutate(page, "automation.runDue");
  const reopened = await task("背 50 个单词", 0, [french]);
  await complete(reopened);
  await mutate(page, "tasks.reopen", { id: reopened });
  await complete(reopened);
  const discipline = attributes.find((a) => a.systemKey === "discipline")!.id;
  return { discipline, failed, overdue };
}

test("M10.5 visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await registerDemoUser(page);
    await mutate(page, "settings.update", { timeZone: "UTC" });
    const attributes = await query<{ id: string; systemKey: string | null }[]>(
      page,
      "character.attributes.list",
    );
    const disciplineId = attributes.find((a) => a.systemKey === "discipline")!.id;

    // 8. A fresh account: 自制力 at 0, empty history.
    await page.goto(`/development/attributes/${disciplineId}`);
    await expect(page.getByTestId("discipline-panel")).toBeVisible();
    await shot(page, `${OUT}/08-empty.png`);

    const ids = await seed(page, pool);

    // 1. The 自制力 page: score, rules, history, worker state.
    await page.goto(`/development/attributes/${ids.discipline}`);
    await expect(page.getByTestId("discipline-entry").first()).toBeVisible();
    await shot(page, `${OUT}/01-discipline-page.png`, { fullPage: true });

    // 2. Growth attributes on /development, 自制力 among them.
    await page.goto("/development");
    await expect(page.getByTestId("discipline-card")).toBeVisible();
    await page.getByTestId("discipline-card").scrollIntoViewIfNeeded();
    await shot(page, `${OUT}/02-development-attributes.png`);

    // 3. Character page: radar and attribute list with 自制力 (score in 分).
    await page.goto("/character");
    await expect(page.getByTestId("attribute-radar")).toBeVisible();
    await shot(page, `${OUT}/03-character-radar.png`, { fullPage: true });

    // 4. Settings: 自制力 is locked; only radar visibility and position change.
    await page.goto("/character/attributes");
    await expect(page.locator('[data-system="discipline"]')).toBeVisible();
    await shot(page, `${OUT}/04-settings-locked.png`, { fullPage: true });

    // 5. Task panel: a failed task with its 自制力 result.
    await page.goto(`/tasks?task=${ids.failed}`);
    await expect(page.getByTestId("task-discipline-net")).toBeVisible();
    await page.getByTestId("task-discipline").scrollIntoViewIfNeeded();
    await shot(page, `${OUT}/05-task-failed.png`);

    const storage = await page.context().storageState();
    const phone = await browser.newContext({
      ...devices["iPhone 13"],
      baseURL,
      storageState: storage,
      locale: "zh-CN",
      colorScheme: "light",
    });
    const mobile = await phone.newPage();
    await mobile.goto(`/development/attributes/${ids.discipline}`);
    await expect(mobile.getByTestId("discipline-panel")).toBeVisible();
    expect(
      await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await shot(mobile, `${OUT}/06-mobile-discipline.png`, { fullPage: true });
    await phone.close();

    const dark = await browser.newContext({
      baseURL,
      storageState: storage,
      locale: "zh-CN",
      colorScheme: "dark",
      viewport: { width: 1440, height: 900 },
    });
    const darkPage = await dark.newPage();
    await darkPage.goto(`/development/attributes/${ids.discipline}`);
    await expect(darkPage.getByTestId("discipline-entry").first()).toBeVisible();
    await shot(darkPage, `${OUT}/07-dark-discipline.png`, { fullPage: true });
    await dark.close();
  } finally {
    await pool.end();
  }
});
