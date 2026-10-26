# 0009 — Projects, milestones and the Kanban board (M4)

**Projects reference tasks; they never copy them.** A task has an optional `project_id` and
`milestone_id`. The project page's 任务 and 看板 tabs are the shared task list and board with a
project filter, so a task edited anywhere shows the same everywhere.

**Only top-level tasks carry a project.** Subtasks belong to their root task's project
(`tasks_subtasks_have_no_project`). Making a task a subtask clears its own project; promoting a
subtask to the top level gives it the project of the root it came from. The project filter also
matches first-level subtasks, so search inside a project still finds them.

**A milestone implies its project.** `milestone_id` requires `project_id`; choosing a milestone
in the detail panel sets the project, and changing the project clears the milestone. The service
rejects a milestone from another project (`milestone.project_mismatch`).

**Progress is computed, not stored.** Total / completed / overdue counts come from the project's
top-level, non-deleted, non-cancelled tasks at read time, for projects and for milestones. Task
mutations invalidate project queries on the client so progress never goes stale.

**Status and dates.** Five statuses (planned / active / paused / completed / cancelled) stored as
stable identifiers; `completed_at` follows the status; events `project.created`,
`project.completed`, `project.reopened` and `milestone.completed` are published for M6 (XP).
The start date may not be after the target date (DB check plus a translated domain error).

**Deleting a project** hard-deletes it and its milestones. Its tasks are kept and only lose the
reference; the service clears `project_id` and `milestone_id` first in the same transaction, so
the two `ON DELETE SET NULL` cascades cannot race the milestone check constraint.

**Kanban is a view of task statuses.** One column per configured status, in workflow order.
Dropping a card (or using its 「移到」 menu) is an ordinary status change, with the same
completion rules and events as the checkbox. Closed columns show at most 20 cards. Columns keep
a 256 px minimum width and scroll horizontally (snap on phones) rather than squeezing cards.

**Module dependencies.** `tasks` imports only `projects/db` (tables) and domain types;
`projects` uses `tasks/server` (progress queries) and `tasks/ui` (embedded list and board). No
cycle at runtime.

**Deferred.** Manual ordering within a board column; projects in Quick Add syntax; project
archive / soft delete; Gantt and dependencies (M5).
