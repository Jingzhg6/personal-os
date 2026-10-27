# 0010 — Task dependencies and the Gantt chart (M5)

**One edge, two directions.** A dependency is a row in `task_dependencies`
(`blocking_task_id → blocked_task_id`). The detail panel shows it as 前置任务 on one task and
后续任务 on the other; nothing is stored twice. Only finish-to-start exists — the common case and
the only one a personal planner needs. A `type` column can be added later without migration pain.

**Cycles are impossible.** Adding `A → B` is refused (`dependency.cycle`) when B already reaches A.
The check is a recursive CTE run under a per-user advisory transaction lock, so two concurrent
requests cannot each add half of a cycle. Self-edges are refused by the service and a DB check.
Any task level may take part (a subtask can wait for another project's task).

**Dependencies inform, they do not block.** A blocked task can still be started or completed:
the app shows 受阻 (open prerequisites) and flags date conflicts (the later task starts before
the earlier one is due; finishing and starting on the same day is fine), but does not reschedule
or forbid anything automatically. Auto-scheduling is a possible later feature.

**Trash.** Edges are kept while a task is in the Trash but hidden everywhere; restoring the task
brings them back; purging deletes them by cascade.

**The Gantt chart is a date view of the same tasks.** A bar spans `start_date` → `due_date`; a task
with only one of them is a one-day bar; undated tasks are listed under 未排期. Moving a bar is an
ordinary `tasks.update` of the two dates (same validation, same optimistic cache update as the
detail panel). It shows top-level tasks, grouped by project with the project's date span and its
milestones; cancelled tasks are hidden unless the status filter asks for them; all M2 filters
apply. The layout maths (window, day offsets, move / resize) lives in the tasks domain
(`timeline.ts`) and is unit-tested.

**Interaction and accessibility.** Pointer: drag the body to move, drag an end to resize, click to
open the shared detail panel. Keyboard: every bar is a button; ← / → move by one day, Shift + ← / →
change the due date, Enter opens the panel; changes are announced in a live region. Dependency
arrows are decorative (`aria-hidden`); the same information is in the detail panel. Scale
(日 / 周 / 月) is in the URL. The task-name column stays pinned while the timeline scrolls
sideways, which is also the phone layout.

**Deferred.** Creating dependencies by dragging between bars, showing subtasks in the chart,
auto-scheduling successors, critical path, other dependency types (start-to-start, lag).
