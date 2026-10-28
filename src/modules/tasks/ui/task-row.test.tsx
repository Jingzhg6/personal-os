import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import type { Area } from "@/modules/areas/domain";
import { sourceMessages } from "@/shared/i18n/messages";

import type { Task } from "../domain";
import { TaskRow, type TaskLookups } from "./task-row";
import type { useTaskActions } from "./use-task-data";

const now = new Date("2026-10-25T04:00:00Z"); // 12:00 in Shanghai

const baseTask: Task = {
  id: "t1",
  title: "完成法语听力练习",
  description: null,
  areaId: "a1",
  projectId: null,
  milestoneId: null,
  parentTaskId: null,
  parentTitle: null,
  statusId: "s1",
  statusCategory: "unstarted",
  priority: 3,
  isUrgent: true,
  isImportant: false,
  startDate: null,
  dueDate: "2026-10-24",
  dueTime: null,
  estimatedMinutes: null,
  sortKey: "a0",
  tagIds: ["tag1"],
  subtaskCount: 3,
  completedSubtaskCount: 1,
  contributions: [],
  openBlockerCount: 0,
  completedAt: null,
  cancelledAt: null,
  failedAt: null,
  plannedAt: null,
  recurrenceId: null,
  createdAt: now,
  updatedAt: now,
};

const area: Area = {
  id: "a1",
  systemKey: "learning",
  name: null,
  color: "blue",
  icon: "graduation-cap",
  sortKey: "a0",
};

const lookups: TaskLookups = {
  statuses: new Map([
    [
      "s1",
      {
        id: "s1",
        systemKey: "todo",
        name: null,
        category: "unstarted",
        color: "blue",
        sortKey: "a1",
      },
    ],
  ]),
  areas: new Map([["a1", area]]),
  tags: new Map([["tag1", { id: "tag1", name: "法语", color: "violet" }]]),
};

function renderRow(task: Partial<Task> = {}) {
  const complete = vi.fn();
  const reopen = vi.fn();
  const onOpen = vi.fn();
  const actions = {
    complete: { mutate: complete },
    reopen: { mutate: reopen },
  } as unknown as ReturnType<typeof useTaskActions>;
  render(
    <NextIntlClientProvider
      locale="zh-CN"
      messages={sourceMessages}
      timeZone="Asia/Shanghai"
      now={now}
    >
      <ul>
        <TaskRow
          task={{ ...baseTask, ...task }}
          lookups={lookups}
          selected={false}
          onOpen={onOpen}
          actions={actions}
        />
      </ul>
    </NextIntlClientProvider>,
  );
  return { complete, reopen, onOpen };
}

describe("TaskRow", () => {
  it("shows the task's flags, tags, area, subtask progress and due date", () => {
    renderRow();
    const row = screen.getByTestId("task-row");
    expect(row).toHaveTextContent("完成法语听力练习");
    expect(row).toHaveTextContent("紧急");
    expect(row).not.toHaveTextContent("重要");
    expect(row).toHaveTextContent("法语");
    expect(row).toHaveTextContent("学习"); // translated default area name
    expect(row).toHaveTextContent("1/3");
    expect(screen.getByTitle("截止：10月24日")).toHaveClass("text-danger"); // overdue
    expect(screen.getByTitle("优先级：高")).toBeInTheDocument();
  });

  it("labels today and tomorrow relative to the user's timezone", () => {
    renderRow({ dueDate: "2026-10-25", dueTime: "19:30" });
    expect(screen.getByTitle("截止：今天 19:30")).toBeInTheDocument();
  });

  it("completes an open task and reopens a completed one", async () => {
    const user = userEvent.setup();
    const { complete } = renderRow();
    await user.click(screen.getByRole("checkbox", { name: "完成「完成法语听力练习」" }));
    expect(complete).toHaveBeenCalledWith({ id: "t1" });
  });

  it("strikes through completed tasks and offers reopen", async () => {
    const user = userEvent.setup();
    const { reopen, onOpen } = renderRow({ statusCategory: "completed" });
    const toggle = screen.getByRole("checkbox", { name: "重新打开「完成法语听力练习」" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(reopen).toHaveBeenCalledWith({ id: "t1" });
    await user.click(screen.getByText("完成法语听力练习"));
    expect(onOpen).toHaveBeenCalledWith("t1");
  });
});
