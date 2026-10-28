# M10.5 — 自制力 (Discipline): completion report

Branch `m10-5-discipline`, created from the M10.1 audit commit `39f9c1e` (verified as the tip of
`origin/m10-1-automation-audit`, clean working tree). Not merged, not deployed; M11 not started.
Design: [ADR 0021](../decisions/0021-discipline-attribute.md).

## 1. Audit before design (findings)

- Tasks had `start_date` (work may begin; Gantt), `due_date` (a deadline, local date) and
  `due_time`; no execution date, no record of when a deadline was set → `tasks.planned_at` added.
- No failure outcome existed: five status categories, `cancelled` the only "closed, not done" one
  → new category `failed` (status 已失败), distinct from cancellation.
- Attribute values are sums of `xp_attribute_credits`, which also drive Level XP; Growth XP for an
  attribute only comes from task contributions → Discipline gets its own ledger and is excluded as
  a contribution / goal / focus target.
- Append-only convention: `xp_ledger` trigger (UPDATE / direct DELETE rejected, user cascade
  allowed) → reused for `discipline_ledger`.
- Events: `task.status_changed` (M10) fires on every real status change inside the transaction;
  the M10 worker tick (fixed in M10.1) is the only reliable periodic runner → overdue sweep there.

## 2. What was built

- System attribute `discipline` (自制力, 🎯): seeded for new users, back-filled for existing ones,
  locked (service `attribute.system_locked` + CHECK), radar toggle and ordering allowed.
- `discipline_ledger` (append-only, unique `(task_id, seq)`), domain rules in
  `character/domain/discipline.ts`, scoring in `character/server/discipline.ts`.
- Task `failed` category + `tasks.fail` + "标记为失败"; `failed_at`, `planned_at`.
- Overdue sweep in `workerTick` and in 立即检查 (`automation.runDue`).
- UI: 自制力 page (score, level, worker state, fixed rules, history) on the existing attribute
  detail route; attribute card; radar (score floored at 0, tooltip shows the real score); list
  shows 分; settings row locked; task panel shows the 自制力 result and failure time.
- Migration `drizzle/0014_discipline.sql` (additive): new table + trigger, new columns, updated
  category CHECK, attribute CHECK, back-fills (failed status, 自制力 attribute, `planned_at =
created_at` for existing deadlines). Applied to dev and test databases; `drizzle-kit generate`
  reports no drift.

## 3. Eligibility and dates

| Term               | Definition                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Deadline           | `due_date` at `due_time` (user's time zone), or the end of `due_date` (next local midnight) |
| Planned (eligible) | has a deadline and `planned_at + 1 h ≤` the judged moment and `≤` the deadline              |
| Early              | completed on a local date before the due date                                               |
| On time            | completed at or before the deadline                                                         |
| Late               | completed after the deadline, or after the deadline was already missed once                 |
| Overdue            | open (backlog / unstarted / started) after its planned deadline                             |

Ad hoc tasks (deadline set less than 1 h before completion), tasks without a due date and tasks
with only a start date are not scored (ordinary XP only).

## 4. Scoring and net examples

| Outcome                          |     Net points |
| -------------------------------- | -------------: |
| Completed early / on time / late | +15 / +10 / +3 |
| Open past the deadline           |      −3 (once) |
| Failed                           |             −5 |
| Cancelled                        |              0 |

| Sequence                                           | Entries                         |       Net |
| -------------------------------------------------- | ------------------------------- | --------: |
| overdue → completed late                           | −3, +6                          |        +3 |
| overdue → failed                                   | −3, −2                          |        −5 |
| overdue → cancelled                                | −3, +3                          |         0 |
| completed on time → reopened → completed           | +10, −10, +10                   |       +10 |
| completed late → reopened → date moved → completed | +3, −3, +3 (or −3 … while open) |        +3 |
| failed → deleted → restored                        | −5                              |        −5 |
| cancelled (not overdue)                            | —                               |         0 |
| repeated / overlapping sweeps or deliveries        | one entry                       | unchanged |

## 5. Tests (exact commands and counts)

| Command                                                                            | Result                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `pnpm vitest run --project unit src/modules/character/domain/discipline.test.ts`   | 10 passed                                                |
| `pnpm vitest run --project db src/server/discipline.db.test.ts`                    | 17 passed                                                |
| `pnpm vitest run --project unit src/modules/tasks` (incl. new failed transition)   | 45 passed                                                |
| `pnpm check` (lint, typecheck, format, i18n 1637 keys / 16 namespaces, all Vitest) | 39 files, 416 passed                                     |
| `pnpm build`                                                                       | passed                                                   |
| `pnpm test:e2e`                                                                    | 104 passed (97 existing + 7 in `e2e/discipline.spec.ts`) |

Coverage of the required list: idempotent attribute creation (repeated seeding, 5 concurrent
ensures) · radar toggle without stopping scoring, persisted · rename / recolour / archive / delete
refused (service and DB) · early, on time, late · no planning info · ad hoc · overdue exactly once
with overlapping sweeps and a worker tick · overdue → late (+3) · overdue → failed (−5) ·
cancellation 0 · failure → delete → restore → purge · complete → reopen → complete · concurrent
duplicate reconciles · time zone boundary (Asia/Shanghai midnight) and DST deadlines (unit) ·
cross-user denial (read, fail, reconcile) · XP / Level XP / balances / custom attributes unchanged
· append-only ledger · not a contribution / goal / focus target · mobile and dark (E2E).

A deliberately wrong rule value (late +4) made three integration tests fail; restored.

Existing tests changed only where the new seeded rows appear: status lists now include 已失败
(auth, tasks), attribute lists / counts include 自制力 (character, dashboard, development E2E),
and the transition tests now expect `failedAt: null` in results. No assertion was removed.

## 6. Screenshots (`docs/screenshots/m10-5/`)

`01-discipline-page`, `02-development-attributes`, `03-character-radar`, `04-settings-locked`,
`05-task-failed`, `06-mobile-discipline`, `07-dark-discipline`, `08-empty`. Review fixes: the
自制力 card no longer shows the goal / growth-record footer that does not apply to it; the task
shot scrolls to the 自制力 result.

## 7. XP economy

Unchanged by 自制力: no writes to `xp_ledger`, `xp_attribute_credits`, rewards or balances;
`DevelopmentAttribute.xp` remains Growth XP (0 for 自制力); totals and Level XP are computed from
the XP tables only (tested). Failing a completed task reverses its completion XP through the
pre-existing `task.reopened` rule, exactly like cancelling it did before.

## 8. Limitations

- Overdue penalties need the worker (or 立即检查); without it, open overdue tasks are not
  penalised automatically (the 自制力 page says so). Completion / failure / cancellation scoring
  does not depend on the worker.
- `planned_at` of deadlines that existed before M10.5 is the task's creation time.
- Cancelling an overdue task returns its net to 0 (as specified); this is visible in the history.
- Editing the dates of a closed task does not rescore it.
- The sweep's SQL pre-selection resolves an ambiguous fall-back local time differently from the
  code (second vs first occurrence); the code decides, so at most one sweep interval of delay.
- Tasks completed before M10.5 are not back-scored.

## 9. Merge / deployment

No merge and no deployment occurred. Waiting for review.
