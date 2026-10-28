import { devices, expect, test } from "@playwright/test";

import { day, mutate, registerDemoUser, shot } from "./support";

const OUT = "docs/screenshots/settings";

test.use({ storageState: { cookies: [], origins: [] }, locale: "zh-CN", colorScheme: "light" });

/* Settings for a demo user, then the views that follow them (Gantt weeks, weekday picker). */

test("Settings visual check", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await registerDemoUser(page);
  await mutate(page, "settings.update", { timeZone: "UTC" });
  const project = await mutate<{ id: string }>(page, "projects.create", { name: "新版官网" });
  const task = (title: string, startDate: string, dueDate: string) =>
    mutate<{ id: string }>(page, "tasks.create", {
      title,
      startDate,
      dueDate,
      projectId: project.id,
    });
  const review = await task("整理需求", day(-3), day(2));
  await task("设计首页", day(1), day(9));
  await task("开发与上线", day(8), day(20));

  // 1. The general tab: profile, time zone and week start, appearance.
  await page.goto("/settings");
  await expect(page.getByTestId("regional-form")).toBeVisible();
  await shot(page, `${OUT}/01-settings.png`);

  // 2. Choosing another zone: its local time is previewed before saving.
  await page.getByTestId("settings-time-zone").selectOption("Asia/Shanghai");
  await page.getByTestId("settings-week-start").selectOption("0");
  await expect(page.getByTestId("settings-save")).toBeEnabled();
  await page.getByTestId("regional-form").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/02-time-zone-edit.png`);
  await page.getByTestId("settings-save").click();
  await expect(page.getByText("设置已保存。")).toBeVisible();

  // 3. The Gantt chart's week scale now starts on Sunday.
  await page.goto("/projects/gantt");
  await expect(page.getByText("设计首页").first()).toBeVisible();
  await shot(page, `${OUT}/03-gantt-weeks-sunday.png`);

  // 4. The weekday picker of a recurrence rule, in the same order.
  await page.goto(`/tasks?task=${review.id}`);
  const field = page.getByTestId("task-recurrence");
  await field.getByTestId("recurrence-edit").click();
  await field.getByTestId("recurrence-frequency").selectOption("weekly");
  await field.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await shot(page, `${OUT}/04-weekday-picker.png`);

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
  await expect(mobile.getByTestId("regional-form")).toBeVisible();
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await mobile.getByTestId("regional-form").scrollIntoViewIfNeeded();
  await shot(mobile, `${OUT}/05-mobile-settings.png`);
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
  await expect(darkPage.getByTestId("regional-form")).toBeVisible();
  await shot(darkPage, `${OUT}/06-dark-settings.png`);
  await dark.close();
});
