# Phase 1 — Recurring tasks: report

- **Branch:** `recurring-tasks`
- **Base:** `08450c1` (`phase1-integration`, approved)
- **Final commit:** the recurring-tasks commit on this branch (see `git log`)
- **Design source:**
  - `docs/architecture.md` §5.3, which defines `task_recurrences` and the additive
    `tasks.recurrence_id`;
  - ADR 0006 (one table, many views);
  - the `rrule` library planned in §3.

  The missing semantics are recorded in **ADR 0023**. It is numbered 0023 because 0022 belongs to
  the frozen AI branch, and reusing the number would collide when that branch returns.

- Nothing was merged or deployed, AI stays frozen, and the next stage was not started.

## What was built

| Part      | Details                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data      | Migration `0016_task_recurrences` (additive): table `task_recurrences` as designed, plus `tasks.recurrence_id` and `tasks.recurrence_index`. Constraints: unique `(recurrence_id, recurrence_index)`; CHECKs "id and index together" and "recurring tasks are top-level".                                                 |
| Domain    | `tasks/domain/recurrence.ts` (pure): the structured rule (daily, weekly, monthly or yearly; interval; weekdays; day of month or last day; end never, until or count ≤ 1000), RRULE text in both directions, `planNext` (fixed or after completion, skipping missed occurrences, UNTIL and COUNT) and an upcoming preview. |
| Service   | `tasks/server/recurrence.ts`: set or edit (newest instance only), skip (cancels the instance), stop, read, and `generateNextInstance`. The last runs from `task.status_changed` when an instance is closed, inside that transaction, under a lock on the series row and the unique index.                                 |
| Guards    | A recurring task cannot become a subtask or lose its due date (`recurrence.subtask`, `recurrence.needs_due_date`).                                                                                                                                                                                                        |
| API       | `tasks.recurrence.get`, `set`, `skip` and `stop`, all scoped to `ctx.userId`. Another user's task gives `task.not_found`.                                                                                                                                                                                                 |
| UI        | A 「重复」 section in the task panel (summary, position, next three dates, 跳过本次 / 停止重复, and an editor with frequency, interval, weekdays, day of month, end and mode) and a ↻ marker on list rows and cards. All text is zh-CN.                                                                                   |
| Integrity | `pnpm db:integrity` has 2 new checks: instances belong to the series' user, and a series has at most one open instance. That makes 38 invariants, 40 checks in total.                                                                                                                                                     |

## Edge cases

| Case                                                          | Behaviour                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete the open instance                                    | The next instance is created in the same transaction, copying fields (start date shifted, due time kept).                                                                       |
| Complete again, or reopen then complete                       | Nothing new: its successor already exists.                                                                                                                                      |
| Concurrent completes                                          | One successor (series lock plus unique index; a test also checks that the database refuses a duplicate position).                                                               |
| Skip (跳过本次)                                               | The instance is cancelled (0 自制力) and the next one is created. Skipping a closed instance is refused.                                                                        |
| Fail                                                          | The next one is created too: the series continues.                                                                                                                              |
| Long overdue (fixed)                                          | Missed occurrences are skipped and the next one is due today or later; no backlog.                                                                                              |
| After-completion mode                                         | Counted from the closing day; weekly without weekdays = 7 days after.                                                                                                           |
| Edit the rule                                                 | Newest instance only; it applies from that instance on. Older instances are history (`recurrence.not_latest`).                                                                  |
| Stop                                                          | No new instances; existing ones are unchanged; a stopped series can't be edited.                                                                                                |
| UNTIL / COUNT                                                 | The series ends by itself and `ended_at` is set.                                                                                                                                |
| Delete the open instance                                      | The series pauses (nothing is generated); after restore and completion it continues. Deleting a closed instance doesn't affect the series.                                      |
| Project closed, milestone completed, attribute archived since | The instance is created without that reference (bare fallback). The status change never fails.                                                                                  |
| Time zone                                                     | "Today" and the closing day are computed in the series' zone. Tested with Asia/Shanghai: 17:00 UTC is already the next local day. `next_due_at` is the start of that local day. |
| Month ends and leap years                                     | Last day of the month: 02-28 or 02-29. Day 31 skips 30-day months. Year boundary handled.                                                                                       |

**Defect found and fixed during the tests.** The e2e run showed "after completion + weekly without
weekdays" anchoring on the old due date's weekday instead of the completion day. It was fixed in
`planNext`, with a unit test.

## Tests

| Command                                                     | Result                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                | ✅ exit 0. 41 files, **448 passed** (423 before)                                                                        |
| `pnpm build`                                                | ✅ exit 0                                                                                                               |
| `pnpm test:e2e`                                             | ✅ exit 0. **117 passed** of 117 listed (20 files), none skipped                                                        |
| `pnpm db:integrity`                                         | ✅ 40/40 on the dev database (17 migrations), the test database after e2e and the freshly migrated `personal_os_verify` |
| `pnpm screenshots e2e/screenshots/recurring-tasks.shots.ts` | ✅ 6 screenshots                                                                                                        |

New tests:

- `tasks/domain/recurrence.test.ts` (10): validation, RRULE round trip, fixed schedule,
  completion-independent dates, skipping missed occurrences, after completion (including the
  weekly anchor), month ends and leap years, UNTIL and COUNT, preview.
- `src/server/recurrence.db.test.ts` (15): preconditions, first instance, guards, copying, views
  (project progress, timeline), idempotency (repeat, reopen, concurrency, unique index), skip and
  fail, rule changes, stop, COUNT and UNTIL, Trash pause and restore, closed references, missed
  occurrences, after completion, time zone, isolation.
- `e2e/recurring-tasks.spec.ts` (7): setting a rule in the panel, completing (list, matrix,
  project, Gantt timeline, no duplicate on reopen), skipping, editing on the newest instance only,
  stopping, cross-user 404s, phone layout.

## Screenshots

`docs/screenshots/recurring-tasks/`:

1. `01-task-list.png`
2. `02-panel-summary.png`
3. `03-panel-edit.png`
4. `04-matrix.png`
5. `05-mobile-panel.png` (phone)
6. `06-dark-panel.png` (dark)

Reviewed; the summary text was corrected to "每月最后一天" (no space).

## Known limitations

- **Migration numbering:** the frozen AI branch also has a `0016_ai_advisor` migration. If AI is
  resumed, its migration must be regenerated as the next free number (0017+). Its ADR stays 0022.
  The test database still carries the old AI migration (18 applied vs 17 in the journal); this is
  harmless.
- **Not copied:** subtasks, dependencies and goal links. The next instance has no subtasks.
- **No reminders or calendar export** (Phase 2). Instances appear when the previous one closes,
  not ahead of time; the panel previews the next three dates instead.
- **Sorting:** a new instance is added at the end of the manual order.
- **Time zone changes:** a series keeps the zone it was started in; changing the settings zone
  later does not move existing series.
