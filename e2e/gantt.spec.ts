import { expect, test, type Page } from "@playwright/test";

import { day, mutate, query } from "./screenshots/support";

const unique = (label: string) => `${label}${Math.random().toString(36).slice(2, 7)}`;
const panel = (page: Page) => page.getByRole("complementary", { name: "任务详情" });

interface Created {
  id: string;
}
interface Detail {
  startDate: string | null;
  dueDate: string | null;
}

/** A project with dated tasks, created through the API so the test can focus on the chart. */
async function seedProject(page: Page) {
  const project = await mutate<Created>(page, "projects.create", { name: unique("排期") });
  const task = (title: string, dates: Record<string, string>) =>
    mutate<Created>(page, "tasks.create", { title, projectId: project.id, ...dates });
  const design = await task(unique("设计"), { startDate: day(0), dueDate: day(4) });
  const build = await task(unique("开发"), { startDate: day(6), dueDate: day(12) });
  return { project, design, build };
}

test("adds, rejects and removes dependencies in the task panel", async ({ page }) => {
  await page.goto("/tasks");
  const { design, build } = await seedProject(page);
  const titles = await Promise.all(
    [design, build].map((t) => query<{ title: string }>(page, "tasks.byId", { id: t.id })),
  );
  const [designTitle, buildTitle] = titles.map((t) => t.title) as [string, string];

  await page.goto(`/tasks?task=${build.id}`);
  const blockedBy = panel(page).getByTestId("dependencies-blockedBy");
  await expect(blockedBy).toContainText("无");
  await panel(page).getByRole("button", { name: "添加前置" }).click();
  await page.getByRole("textbox", { name: "搜索任务" }).fill(designTitle);
  await page.getByRole("option", { name: designTitle }).click();
  await expect(page.getByText("已添加依赖")).toBeVisible();
  await expect(blockedBy).toContainText(designTitle);
  await expect(panel(page).getByText("1 个前置任务未完成")).toBeVisible();

  // The list marks the waiting task.
  await expect(
    page.getByTestId("task-row").filter({ hasText: buildTitle }).getByLabel("等待 1 个前置任务"),
  ).toBeVisible();

  // The other direction is listed on the blocking task, and a cycle is refused.
  await page.goto(`/tasks?task=${design.id}`);
  await expect(panel(page).getByTestId("dependencies-blocking")).toContainText(buildTitle);
  await panel(page).getByRole("button", { name: "添加前置" }).click();
  await page.getByRole("textbox", { name: "搜索任务" }).fill(buildTitle);
  await page.getByRole("option", { name: buildTitle }).click();
  await expect(page.getByText("不能添加：这会形成循环依赖")).toBeVisible();
  await page.keyboard.press("Escape");

  // Remove it again from the blocked task.
  await page.goto(`/tasks?task=${build.id}`);
  await panel(page)
    .getByRole("button", { name: `移除与「${designTitle}」的依赖` })
    .click();
  await expect(page.getByText("已移除依赖")).toBeVisible();
  await expect(blockedBy).toContainText("无");
});

test("shows a project's Gantt chart and reschedules tasks by keyboard and drag", async ({
  page,
}) => {
  await page.goto("/projects");
  const { project, design, build } = await seedProject(page);
  await mutate(page, "tasks.dependencies.add", {
    blockingTaskId: design.id,
    blockedTaskId: build.id,
  });

  await page.goto(`/projects/${project.id}?view=gantt`);
  const bars = page.getByTestId("gantt-bar");
  await expect(bars).toHaveCount(2);
  await expect(page.getByTestId("gantt-arrows").locator("path[marker-end]")).toHaveCount(1);
  await expect(page.getByTestId("gantt-arrows").locator("path[data-conflict]")).toHaveCount(0);

  // Keyboard: → moves both dates by a day, Shift + → extends the due date.
  const buildBar = page.locator(`[data-testid="gantt-bar"][data-task-id="${build.id}"]`);
  await buildBar.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => query<Detail>(page, "tasks.byId", { id: build.id }))
    .toMatchObject({ startDate: day(7), dueDate: day(13) });
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => query<Detail>(page, "tasks.byId", { id: build.id }))
    .toMatchObject({ startDate: day(7), dueDate: day(14) });

  // Drag the build bar 5 days earlier (week scale: 16 px per day): it now starts before
  // its prerequisite is due, so the arrow turns into a conflict.
  const box = (await buildBar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => query<Detail>(page, "tasks.byId", { id: build.id }))
    .toMatchObject({ startDate: day(2), dueDate: day(9) });
  await expect(page.getByTestId("gantt-arrows").locator("path[data-conflict]")).toHaveCount(1);

  // A click opens the shared detail panel.
  await page.locator(`[data-testid="gantt-bar"][data-task-id="${design.id}"]`).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByTestId("dependencies-blocking")).toBeVisible();

  // Zoom is kept in the URL.
  await page.getByRole("button", { name: "日", exact: true }).click();
  await expect(page).toHaveURL(/zoom=day/);
});
