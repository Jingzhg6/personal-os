# M10.6 — 自制力 scoring consistency fix: report

Branch `m10-6-discipline-consistency`, created from the M10.5 tip `cd96e96` (verified: local and
`origin/m10-5-discipline` identical, clean working tree). Not merged, not deployed; M11 not
started. Design updates: [ADR 0021 §8](../decisions/0021-discipline-attribute.md).

## 1. Behaviour changed

1. **Cancellation after an overdue penalty keeps −3.** A cancelled task's target is `overdue` (−3)
   when an overdue entry was ever recorded for it, else `cancelled` (0).
   - overdue → cancelled: no entry, net −3 (was: +3 entry, net 0);
   - overdue → completed late (+3) → cancelled: one `cancelled` entry of −6, net −3;
   - never-penalised task cancelled: no entry, net 0 (unchanged);
   - repeated cancellations, a second cancelled status, redelivered events, sweeps and
     reopen → cancel cycles leave the score unchanged; reopening uses the existing sticky-miss rule
     (overdue −3) and completing scores late (+3), all as append-only entries.
2. **Back-filled planning times are no longer treated as planning.** Migration `0015` (additive)
   adds `tasks.planned_at_inferred` and marks the rows back-filled by `0014`
   (`planned_at = created_at`). Marked tasks are skipped by scoring and by the overdue sweep, and
   their existing entries, if any, are left untouched (no reversal). Without this, the first
   sweep after M10.5 would have penalised every open pre-M10.5 task whose deadline had passed,
   using the approximate timestamp as if it were planning. Setting a deadline anew records real
   planning and clears the mark; new tasks follow the documented rules. `planned_at` values are
   kept as they are.

## 2. Made explicit (no behaviour change)

- Completion precedence: **late → early → on time**. Early = completed on a local calendar date
  before the due date; on time = otherwise by the deadline (any time on the due date). One outcome
  per completion; tested with and without a due time.
- No new date fields; `planned_at` still only means "when the deadline was first set".

## 3. Intentionally unchanged

Scoring values (+15 / +10 / +3 / −3 once / −5 / 0), eligibility (deadline set ≥ 1 h ahead),
deadline semantics, the fixed system attribute and its radar toggle, the append-only
`discipline_ledger`, the overdue sweep in the worker tick, failure handling, Trash behaviour, and
all XP, Level XP, reward and balance logic. Task, project, goal and automation behaviour are
unchanged except that new deadlines set `planned_at_inferred = false`.

## 4. Tests

| Command                                                                          | Result                             |
| -------------------------------------------------------------------------------- | ---------------------------------- |
| `pnpm vitest run --project unit src/modules/character/domain/discipline.test.ts` | 13 passed (10 + 3 new)             |
| `pnpm vitest run --project db src/server/discipline.db.test.ts`                  | 21 passed (17 + 4 new; 1 updated)  |
| `pnpm check` (lint, typecheck, format, i18n 1637 keys, all Vitest)               | 39 files, 423 passed               |
| `pnpm build`                                                                     | passed                             |
| `pnpm test:e2e`                                                                  | 104 passed (second run; see below) |
| `pnpm drizzle-kit generate`                                                      | no schema drift                    |

Required cases: before due date +15, on the due date +10 (not +15), after the deadline +3,
overdue at most once (overlapping sweeps and worker tick), cancelling an overdue task keeps −3,
cancelling an unscored task yields 0, failed −5 including after overdue, delete / restore / purge
keep history without duplicates, reopen / recomplete without duplicate or contradictory entries,
XP and reward balances unchanged (existing M10.5 tests, all passing).

The one updated assertion is the M10.5 test that encoded the old rule (overdue → cancelled →
net 0); it now asserts the new rule (net −3, no extra entry). With the fixes temporarily
reverted, four of the new integration tests fail.

The first full E2E run had one failure in `e2e/finance.spec.ts` test 9 (phone layout of the M9.5
finance pages, code not touched here); it passed when run alone and in a second full run
(104 / 104). It looks timing-related and is recorded here as a known intermittent test.

## 5. Remaining limitations

- Deadlines that existed before M10.5 are outside 自制力 until their deadline is set again.
- A recorded (non-inferred) `planned_at` that happens to equal `created_at` to the microsecond
  would have been marked inferred by 0015; since M10.5 the two values come from different clocks
  (application vs database), so this is not expected in practice.
- Overdue penalties still need the worker or 立即检查 (unchanged from M10.5).

## 6. Merge / deployment

No merge and no deployment occurred. No M11 work. Waiting for review.
