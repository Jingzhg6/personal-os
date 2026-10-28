# 0021 — 自制力 (Discipline): a fixed, system-scored growth attribute

Status: Accepted (M10.5; corrected in M10.6, see §8). Builds on ADR 0012/0014 (XP ledger and economy), 0013 (development
attributes), 0006 (task model) and 0020 (automation worker).

## 1. What it is

自制力 measures how planned tasks are carried out. It is a normal row of `development_attributes`
(`system_key = 'discipline'`), so it appears in the attribute list, the radar and the development
pages, but its value comes from fixed rules in code, not from task contributions:

- seeded with the other attributes at registration and back-filled once by migration 0014
  (idempotent: the partial unique index `(user_id, system_key)`; `ensureDisciplineAttribute`
  converges concurrent calls on one row);
- users may move it and toggle its radar visibility; hiding it never stops scoring;
- it cannot be renamed, re-iconed, recoloured, archived or deleted: the service refuses
  (`attribute.system_locked`) and a CHECK constraint forbids a name or `archived_at` on it;
- it is never a Growth XP target: task contributions, goal attributes and the development focus
  refuse it (`attribute.system_scored`) and the pickers do not offer it.

## 2. Separate from the XP economy

Scores live in their own append-only table, `discipline_ledger`. No row of `xp_ledger` or
`xp_attribute_credits` is written for 自制力, so Active XP, Level XP, Growth XP, the level curve,
reward prices and balances are untouched (tested: a planned and an unplanned completion produce
identical XP entries). `DevelopmentAttribute.xp` stays Growth XP (always 0 for 自制力); its score is
`points`. For the level badge and the radar the attribute curve is applied to `max(0, points)`; a
negative score sits at the radar's centre while the list, tooltip and page show the real value.

## 3. Dates and eligibility

Tasks already had `start_date` (when work may begin; Gantt bar start), `due_date` (the deadline,
a local calendar date) and an optional `due_time`. There was no "scheduled execution date", and no
record of when a deadline was set. M10.5 adds the smallest field needed: `tasks.planned_at`, the
moment the current deadline was first set (set when a due date appears, cleared when it is
removed, kept when it is only moved). Existing deadlines were back-filled with the task's
creation time (the best available approximation).

- **Deadline instant**: `due_date` at `due_time` in the user's time zone, or the end of `due_date`
  (next local midnight) without a time. DST: as ADR 0020 §8.
- **Planned** (eligible): the task has a deadline and `planned_at + 1 h ≤` both the judged moment
  (completion / failure) and the deadline. A task created and done on the spot, or a deadline set
  after it had passed, is not planned. `start_date` alone does not make a task planned.
- **Early**: completed on a local date before the due date. **On time**: completed by the
  deadline. **Late**: completed after the deadline, or after the deadline had already been missed
  once (moving the date afterwards does not undo a miss).
- **Overdue**: still open (backlog / unstarted / started) after its planned deadline.

## 4. Scoring: target outcome, net per task

| Outcome                                | Points (the task's net) |
| -------------------------------------- | ----------------------: |
| early                                  |                     +15 |
| on time                                |                     +10 |
| late                                   |                      +3 |
| overdue (open past the deadline)       |                      −3 |
| failed                                 |                      −5 |
| cancelled                              |                       0 |
| not planned / open before the deadline |                       0 |

Each task has a _target outcome_ computed from its current state. When it differs from what the
ledger says, one entry records `target points − current net`, with a reason (`completed_early`,
`completed_late`, `overdue`, `failed`, `cancelled`, `reopened`, `not_eligible`, …), the resulting
outcome and `net_after`. So the net always equals the current outcome's points:

- overdue (−3) then completed late → +6 → net **+3**;
- overdue (−3) then failed → −2 → net **−5** (never −8);
- completed (+10), reopened (−10 → 0), completed again (+10) → net **+10** (never +20);
- overdue (−3) then cancelled → no entry → net **−3** (M10.6: a cancellation neither adds a
  penalty nor erases an earned one; a cancelled task never gets the failure penalty);
- failed, then deleted and restored → no entries (Trash neither scores nor unscores);
- a missed deadline is sticky: reopening an overdue-then-completed task makes it overdue again.

Corrections are new entries; nothing is updated or deleted (trigger). `task_id` has no foreign key,
so history survives purging (like `xp_ledger.source_id`); user deletion cascades.

## 5. Failure

A new status category `failed` (seeded status 已失败, back-filled), distinct from `cancelled`:
closed, not done; `tasks.failed_at` is set while in it; failing a completed task reverses its XP
through the existing `task.reopened` path. "标记为失败" in the task panel (`tasks.fail`). Project
progress and goal action counts treat failed like cancelled (closed without being done).

## 6. When scoring runs

- **Status changes**: the character module subscribes to `task.status_changed` (and
  `task.completed`, for tasks created completed) and reconciles the task inside the same
  transaction — the score commits or rolls back with the change. Changes made by automation rules
  are scored by the same handler; automation cannot write the ledger.
- **Overdue**: `sweepOverdueDiscipline`, called by the M10 worker tick (`workerTick`) and by
  立即检查 for one user. It selects open, planned tasks past their deadline in each user's time zone
  that were never marked overdue, and reconciles each in its own transaction. Without a worker, no
  overdue penalty is applied automatically; the 自制力 page says so.
- **Idempotency**: reconciliation is serialised per task (advisory lock) and the unique
  `(task_id, seq)` index is the database backstop; repeated or overlapping deliveries and ticks
  find nothing to change. After downtime a task is penalised once, at the first sweep after its
  deadline — or, if it was completed or closed in between, that outcome is scored instead.
- Editing dates of a closed task does not rescore it; deleting / restoring does not score.

## 7. Not included

User-editable rules, streaks or bonuses, Discipline XP for levels or rewards, notifications for
penalties, back-scoring of tasks completed before M10.5.

## 8. M10.6 corrections

- **Cancellation after an overdue penalty keeps −3.** Target for a cancelled task: `overdue` (−3)
  if an overdue entry was ever recorded for it, otherwise `cancelled` (0). Cancelling an overdue
  open task therefore writes nothing; cancelling a task completed after its overdue penalty writes
  one `cancelled` entry back to −3. Repeated cancellations, other cancelled statuses, redelivered
  events and sweeps change nothing.
- **Completion precedence is explicit**: late (after the deadline, or missed before) → early
  (completed on a local date before the due date) → on time (anything else by the deadline,
  including any time on the due date). One outcome per completion.
- **Back-filled planning times are not planning.** Migration 0014 set `planned_at = created_at`
  for deadlines that existed before M10.5. Migration 0015 adds `tasks.planned_at_inferred` and
  marks exactly those rows (`planned_at = created_at`); since M10.5 the app records `planned_at`
  separately from the creation time. Marked tasks are outside 自制力: never scored or penalised,
  and any entries already recorded for them are left as they are (no reversal). Setting a
  deadline anew (after removing it) records real planning and clears the mark. Tasks completed
  before M10.5 are never back-scored.
