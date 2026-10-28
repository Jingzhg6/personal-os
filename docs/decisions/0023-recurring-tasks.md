# 0023 — Recurring tasks: a rule plus ordinary task instances

- Status: Accepted (Phase 1, recurring tasks)
- Date: 2026-10-28

## Context

`docs/architecture.md` §5.3 and ADR 0006 fixed the shape of recurring tasks:

- a `task_recurrences` table (`id, user_id, rrule, mode(fixed|after_completion), timezone,
next_due_at, ended_at`);
- an additive, nullable `tasks.recurrence_id`;
- the `rrule` library.

They did not define when instances are created, how a series ends, or the edge cases. This ADR
records only those missing details.

## Decision

1. **Instances are ordinary tasks.** Every view (list, matrix, project, Kanban, Gantt,
   dashboard) shows them unchanged — capture once, use everywhere. A series has **one open
   instance at a time**: no list of future copies is created.
2. **The next instance is created when the open one is closed**, inside the transaction of that
   status change (handler `tasks.generateNextInstance` on `task.status_changed`). "Closed" means
   completed, cancelled or failed.
   - **Skip** (跳过本次) is cancelling the instance: 0 自制力, never a failure.
   - **Failed** instances are followed too, so a series does not die from one bad day.
3. **Created at most once per instance.**
   - `tasks.recurrence_index` (1-based, added with `recurrence_id`) is unique per series.
   - Generation locks the series row and does nothing if the successor (index + 1) exists.
   - So repeated completes, reopen-and-complete, retries or concurrent closes never produce a
     second successor.
   - A deleted (Trash) instance produces nothing.
4. **Dates** are local calendar dates in the series' time zone (captured from settings when the
   series starts).
   - **fixed:** the schedule's next occurrence after the source instance's due date. Occurrences
     already in the past are **skipped** (the next instance is due on or after today), so an
     overdue series never floods the list.
   - **after_completion:** the first occurrence after the day the instance was closed, counted
     from that day. A weekly rule without weekdays means "one week after".
   - The start date keeps its distance to the due date; the due time is kept.
   - Monthly day 31 skips shorter months (RFC 5545); "last day" is `BYMONTHDAY=-1`.
5. **Ending.**
   - The user stops the series (停止重复): `ended_at` is set.
   - The series also ends when the next occurrence would pass `UNTIL`, or after `COUNT`
     instances (counted by index).
   - Existing instances are never changed or deleted by ending.
6. **Editing** the rule or mode is allowed on the newest instance only. It applies from that
   instance on (DTSTART becomes its due date); earlier instances are history.
7. **What is copied** to the next instance:
   - title, description, area, project, milestone, priority, urgent and important flags, dates,
     estimate, tags and development contributions;
   - but not subtasks, dependencies or goal links;
   - a closed project or completed milestone is dropped;
   - if the copy is refused (for example an attribute archived since), a bare instance is created
     instead. Generation never fails the status change that triggered it.
8. **Rules for instances.** Recurring tasks stay top-level and keep a due date: re-parenting
   and removing the due date are refused (`recurrence.subtask`, `recurrence.needs_due_date`).
   DB CHECKs back this up.
9. **Storage.** `rrule` holds `DTSTART;VALUE=DATE:YYYYMMDD` plus `RRULE:` text, written only from
   the validated structured rule:
   - frequency daily, weekly, monthly or yearly;
   - interval 1–365;
   - weekdays (weekly);
   - day of month or last day (monthly);
   - end never, until or count (≤ 1000).

   A stored rule that cannot be read is reported and never run.

## Consequences

- Every existing rule follows instances for free: XP, 自制力 (cancelled = skipped = 0), project
  progress, automation (an instance's `task.completed` fires rules like any task) and the
  integrity checks.
- `pnpm db:integrity` gained two checks: instances belong to the series' user, and a series has
  at most one open instance.
- Not included: no reminders and no calendar export (Phase 2); no copying of subtasks; a series
  paused by deleting its open instance continues only after restore.
