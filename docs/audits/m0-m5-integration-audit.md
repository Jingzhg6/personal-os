# M0–M5 integration audit

Date: 2026-10-27 · Branch: `m5-integration-audit` (from `m5-gantt-dependencies`) · No new features.

Goal: confirm "capture once, use everywhere" before M6 (XP) starts consuming domain events.

## Method

- Code review of every write path (`tasks`, `projects`, `areas` services), the event bus, the
  read queries behind each view, and every client mutation and its cache invalidation.
- New cross-module test `src/server/integration.db.test.ts` (8 tests): one task followed through
  every view's real query, concurrent duplicate commands, lifecycle edge cases, and 21 cross-user
  attempts.
- SQL integrity sweep (15 invariants) over the dev DB and over the test DB after the full e2e run.

## Findings

| #   | Area      | Finding                                                                                                                                            | Severity                        | Fix                                                            |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| 1   | Events    | Concurrent completions of one task published `task.completed` 3× (no row lock between read and write). Same race for `task.reopened`.              | High (M6 XP would double-count) | Row lock in `setTaskStatus` (ADR 0011)                         |
| 2   | Events    | Concurrent project updates to 完成 published `project.completed` 6×; same pattern for `project.reopened` and `milestone.completed`.                | High                            | Row lock in `updateProject`, `setMilestoneCompleted`           |
| 3   | Events    | Concurrent delete / restore of one task published an extra `task.deleted` / `task.restored` with an empty id list.                                 | Low                             | Row lock in `deleteTask` and when reading a trashed task       |
| 4   | Lifecycle | A subtask restored as a top-level task (its parent still in the Trash) lost its project, while moving a subtask to the top level by hand keeps it. | Medium                          | `restoreTask` assigns the root's project, like `setTaskParent` |
| 5   | Sync      | Gantt bars jumped back to the old dates until the refetch finished: the timeline cache was not part of the shared optimistic update.               | Low (visual)                    | Timeline cache included in `optimistic()` and its rollback     |
| 6   | Sync      | Deleting an area (Settings) refreshed only the area list; cached tasks / projects / view scopes stayed stale for up to 30 s.                       | Low                             | Area delete invalidates all queries                            |

## Verified, no change needed

- **Single source of truth.** Every view (全部任务, 四象限, scoped views, project list / board,
  global Kanban, Gantt, search, filters, Trash, detail) reads the one `tasks` table through
  `loadTasks`; the test checks the same id and field values in each. The client uses one shared
  mutation hook (`useTaskActions`) from every view; all task mutations invalidate `tasks.*`
  (list, byId, timeline) and `projects.*`.
- **Matrix** stores nothing: placement is `matrixPlacement(isUrgent, isImportant)`; no quadrant
  column or table exists.
- **Derived fields.** `completed_at` / `cancelled_at` follow the status category (status
  categories cannot change after creation; deleting a status needs a same-category replacement);
  project `completed_at` follows its status; progress and `openBlockerCount` are computed on read.
- **Project / milestone / task consistency.** DB checks (`tasks_subtasks_have_no_project`,
  `tasks_milestone_needs_project`) plus service checks; milestones cannot move between projects;
  project deletion clears references on live and trashed tasks.
- **Dependencies.** Self-edges refused (service + DB check); cycles refused under a per-user
  advisory lock; edges hidden while a task is in the Trash, restored with it, removed by cascade
  on purge / empty Trash.
- **Ownership.** All 21 cross-user attempts return NOT_FOUND; list, timeline, project and
  milestone queries never return another user's rows; removing another user's edge is a no-op.
- **Event bus.** One instance per server; duplicate handler names are rejected, so a handler
  cannot be registered twice. Events are published inside the command's transaction.
- **Integrity sweep.** 0 violations of all 15 invariants (status / completion fields, cross-user
  references, milestone ↔ project, orphaned live subtasks, dependency cycles, date order, view
  scopes).

## Notes for M6 (not changed now)

- There is no `milestone.reopened` event (tasks and projects have one). XP reversal for a
  milestone un-completed will need it.
- Completed → cancelled publishes `task.reopened` / `project.reopened` (documented behaviour):
  XP should treat it as a reversal.
- Deleting / purging a completed task publishes only `task.deleted` (purge: nothing); deleting a
  project or milestone publishes nothing. M6 must decide whether XP is kept or reversed.
- Restoring a completed task publishes `task.restored`, not `task.completed`.
