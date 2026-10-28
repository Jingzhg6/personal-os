import { expect, test, type BrowserContext } from "@playwright/test";

import { register, uniqueEmail } from "./helpers";
import { day, mutate, query } from "./screenshots/support";

test("the interface is Simplified Chinese only, with no language switch", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("radio", { name: /English|Français/ })).toHaveCount(0);
  await expect(page.getByText("界面语言")).toHaveCount(0);
  // The theme setting is still there.
  await expect(page.getByRole("heading", { name: "外观" })).toBeVisible();
});

/*
 * Settings (profile, time zone, week start) for one fresh user, so the shared e2e account keeps
 * its own values; then checked from the shared account (isolation) and on a phone.
 */
test.describe("profile, time zone and week start", () => {
  test.describe.configure({ mode: "serial" });

  let account: Awaited<ReturnType<BrowserContext["storageState"]>>;
  let taskId = "";

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await register(page, { name: "设置测试", email: uniqueEmail() });
    await mutate(page, "settings.update", { timeZone: "UTC", weekStartsOn: 1 });
    taskId = (
      await mutate<{ id: string }>(page, "tasks.create", { title: "周会", dueDate: day(1) })
    ).id;
    account = await context.storageState();
    await context.close();
  });

  test.use({ storageState: async ({}, provide) => provide(account) });

  test("the display name is changed and shown in the shell", async ({ page }) => {
    await page.goto("/settings");
    const name = page.getByTestId("profile-name");
    await expect(name).toHaveValue("设置测试");
    await name.fill("   ");
    await page.getByTestId("profile-save").click();
    await expect(page.getByText("请输入显示名称。")).toBeVisible();
    await name.fill("  小林 ");
    await page.getByTestId("profile-save").click();
    await expect(page.getByText("设置已保存。")).toBeVisible();
    await expect(page.getByTestId("current-user-name").first()).toHaveText("小林");
    await page.reload();
    await expect(page.getByTestId("profile-name")).toHaveValue("小林");
  });

  test("the time zone is chosen, saved and moves 'today'", async ({ page }) => {
    await page.goto("/settings");
    const zone = page.getByTestId("settings-time-zone");
    await expect(zone).toHaveValue("UTC");
    await expect(page.getByText("已有的重复任务和自动化定时规则保留创建时的时区")).toBeVisible();
    await zone.selectOption("Pacific/Kiritimati");
    await expect(page.getByTestId("settings-zone-now")).toBeVisible();
    await page.getByTestId("settings-save").click();
    await expect(page.getByText("设置已保存。")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("settings-time-zone")).toHaveValue("Pacific/Kiritimati");
    // The dashboard's "today" is the local date in that zone (UTC+14).
    const kiritimati = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(
      new Date(),
    );
    const overview = await query<{ today: string }>(page, "dashboard.overview", undefined);
    expect(overview.today).toBe(kiritimati);
  });

  test("the week start orders weekday pickers and the dashboard week", async ({ page }) => {
    await page.goto("/settings");
    await page.getByTestId("settings-week-start").selectOption("0");
    await page.getByTestId("settings-save").click();
    await expect(page.getByText("设置已保存。")).toBeVisible();

    await page.goto(`/tasks?task=${taskId}`);
    const field = page.getByTestId("task-recurrence");
    await field.getByTestId("recurrence-edit").click();
    await field.getByTestId("recurrence-frequency").selectOption("weekly");
    const days = field.getByRole("group", { name: "重复的星期" }).getByRole("button");
    await expect(days.first()).toHaveText("日");
    await expect(days.last()).toHaveText("六");

    const overview = await query<{ today: string; week: { from: string } }>(
      page,
      "dashboard.overview",
      undefined,
    );
    expect(new Date(`${overview.week.from}T00:00:00Z`).getUTCDay()).toBe(0);
  });

  test("another user sees only their own settings", async ({ browser }, testInfo) => {
    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      locale: "zh-CN",
      storageState: "e2e/.auth/user.json",
    });
    const page = await other.newPage();
    await page.goto("/settings");
    await expect(page.getByTestId("profile-name")).not.toHaveValue("小林");
    const settings = await query<{ timeZone: string | null; weekStartsOn: number }>(
      page,
      "settings.get",
      undefined,
    );
    expect(settings.timeZone).not.toBe("Pacific/Kiritimati");
    await other.close();
  });

  test("the settings page fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await expect(page.getByTestId("regional-form")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
