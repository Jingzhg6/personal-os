# 0028 — V2: recurring series rework, Schedule Planner, investments, dashboard order

Status: accepted (2026-11, branch `v2-planner`, migration `0017_v2_planner`, additive)

## Recurring tasks

- `task_recurrences` is the template (rule, mode, start, end, `paused_at`); every occurrence is
  its own task (`recurrence_id`, `recurrence_index`, unique together) with its own date, status,
  time, XP and history.
- **按日历周期生成** (`fixed`): instances are created ahead for a rolling 30-day window, whether or
  not earlier ones are done. Generation continues after the newest instance ever made (Trash
  included) and never before yesterday, so history is never recreated and nothing is generated
  twice. Topped up when the series is set or resumed, on instance close, by the worker tick and
  when a task view opens (`tasks.recurrence.refresh`).
- **完成上一次后再生成** (`after_completion`): one open instance; the next is due one interval
  after the actual completion date. Replaces V1's 完成后再计.
- A start date is required; the end is optional (date or count); no due date is forced.
- Edits apply to future instances: untouched future instances (open, no schedule block, subtask,
  dependency, goal or plan link) are replaced, or kept (`applyTo: "new"`). Pause and stop remove
  untouched future instances, except the one being edited. Completed history stays.

## Schedule Planner (`/schedule`)

- `schedule_blocks` (task FK, cascade): when a task is planned. Many blocks per task; blocks
  never copy task data — title, status and quadrant are read from the task at query time.
  Deleting a block keeps the task; a trashed task's blocks are hidden; purging removes them.
- Left: one Eisenhower quadrant (dropdown) of open tasks. Right: 日 / 周 / 月 over one dataset.
- One pointer drag engine (no library): drop targets are day columns (time from pointer height,
  15-minute snap) and day cells. Day/week: move, resize both edges, conflicts flagged; week/month:
  move across days, stretch all-day bars over several days. Saved on drop (optimistic).
  Keyboard: 安排 button per task; Enter on a block opens the editor (times, all-day, delete).

## Other

- Investments: `finance_investments` (name, kind, cost, date, optional quantity and current
  value, notes) in the base currency. Totals add the current value — or the cost while none is
  entered, labelled 未估值 — to assets and net worth. Kept apart from accounts: a holding is
  recorded once.
- Gantt hides completed tasks by default (status filter shows them); a recurring series shares
  one row with a bar per instance.
- Dashboard panels are reorderable (dnd-kit sortable, keyboard too); the order is saved in
  `user_settings.dashboard_panels` (null = default), merged with panels added later.
