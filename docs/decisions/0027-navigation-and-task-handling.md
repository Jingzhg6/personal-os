# 0027 — Navigation order and task handling (2026-11 round)

- Status: Accepted
- Date: 2026-11-01

## Context

After daily use of Phase 1 the owner asked for:

- work and administration before finance and the system in the sidebar;
- project areas as task defaults;
- moving loose tasks into projects;
- in-place editing in 全部任务;
- expandable subtasks;
- recording when a task was actually completed.

## Decision

1. **Sidebar order.** Seven collapsible sections: 概览 → 工作与事务 → 任务 → 个人成长与生活 → 资料与记录
   → 财务 → 系统与自动化. Settings moves into 系统与自动化.
   - Collapsed sections are remembered per browser (`localStorage`). Everything starts open, and
     the section of the current page reopens.
   - 目标 opens the development goals (M8) at `/development#goals`. It no longer leads to a
     placeholder.
   - Unbuilt modules stay listed with their phase badge.
2. **A project's area is the default area of its tasks.**
   - On create, a task without an area takes the project's area. An explicit `null` (no area) or
     another area is kept.
   - When a task is moved into a project, its area is filled from the project **only if the task
     has none**, so a user's choice is never overwritten. Later edits never touch the area.
   - Applied in the task service, so every way of creating or moving a task behaves the same.
3. **Moving tasks into projects** (project list, 未分配项目的任务) is an ordinary
   `tasks.update({ projectId })`. The task keeps its id, links and history; nothing is recreated.
   Dragging a task onto a project card and the 「移到项目」 menu (keyboard, touch) do the same.
4. **全部任务 and the other list views** edit status, priority, area, project, start and due date
   in place (menus render their options only while open), and expand subtasks under their task.
   The title still opens the detail panel.
5. **Start date default.**
   - Tasks created through the list views' Quick Add start today.
   - Applied by the client at creation only, never by the server, never on edit, and never to
     existing tasks.
   - Automation, recurrence and the API are unchanged.
6. **Completion with a confirmed date.** Every UI path that completes a task asks for the
   completion date: the checkbox, `x`, the panel, a status menu, and Kanban.
   - Today is the default, and means "now". An earlier day is stored at **12:00 local time**
     that day, so it falls on that date in the user's zone. Future dates are refused
     (`task.completed_in_future`).
   - Cancelling changes nothing. Completing an already completed task is a no-op, so an existing
     `completed_at` is never overwritten.
   - Open subtasks can be completed with the parent, on the same date. The dialog offers this
     when there are open subtasks.
   - XP is credited when the completion is recorded (the ledger keeps its own time). 自制力
     judges punctuality from `completed_at`, i.e. from the confirmed date.

## Consequences

- No migration and no new table: existing data is untouched.
- A completion recorded for an earlier day shows on that day in every view (lists, dashboard
  counts, project progress), while its XP appears in the XP history on the day it was recorded.
- New list tasks start today. A due date earlier than today then needs the start date changed
  first, since the start may not be after the due date.
