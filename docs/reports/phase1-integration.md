# Phase 1 — Stage 1: integration of M0–M10.6

- **Branch:** `phase1-integration`
- **Base:** `b26e2c0` (M10.6)
- **Final commit:** the stage-1 commit on this branch (see `git log`)
- **Scope:** integrate and verify the existing modules. No new features. The AI advisor (M11) is
  on hold and not included.
- Nothing was merged or deployed, and no history was rewritten.

## Branch and history analysis

- All 17 milestone branches (`m2-…` to `m10-6-…`) and `main` (M1, `93b2f68`) are **ancestors of
  `b26e2c0`**. The history is a single linear chain with no merge commits.
- So the integration needs no merges and has no conflicts. `phase1-integration` starts at
  `b26e2c0`, and `main` can later be fast-forwarded to it (owner's decision; not done).
- Not included: `m11-ai-advisor` (`d6806b0`) and `m11-1-real-provider-verification` (`da949eb`).
  They stay as they are (AI on hold), and their only migration (`0016_ai_advisor`) is not on this
  line.

## Database migrations

| Check                                                                  | Result                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal vs files                                                       | 16 migrations, `0000`–`0015`, contiguous, one snapshot each; no duplicates                                                                                                    |
| Fresh database (`personal_os_verify`), `pnpm db:migrate` from zero     | ✅ 16 applied, 42 tables, 0 unvalidated constraints                                                                                                                           |
| Schema drift (`drizzle-kit generate` against the code)                 | ✅ "No schema changes"                                                                                                                                                        |
| Existing dev database vs fresh database (`pg_dump --schema-only` diff) | ✅ identical (only pg_dump's random `\restrict` tokens differ)                                                                                                                |
| Test database                                                          | 17 applied: it also has `0016_ai_advisor` from earlier AI-branch runs. This is harmless (the extra tables are only truncated by tests). Not reset, per the forward-only rule. |

## Data integrity: `pnpm db:integrity` (new, read-only)

It checks:

- pending migrations and unvalidated constraints;
- **36 invariants** that foreign keys cannot express. Every cross-table reference must stay
  within one user: tasks → areas, projects, milestones, parent and status; tags; dependencies;
  contributions; goal links; focus; plans; XP ledger, credits and reversals; 自制力 ledger;
  reward ledger.
- domain invariants: a milestone is in the task's project, subtasks have no project, status
  category matches its timestamps, due time and planning time need a due date, no
  self-dependency, an XP reversal undoes its entry exactly once, a task's 自制力 net equals its
  latest `net_after`, entry numbers run 1..n, exactly one 自制力 attribute per user, default
  statuses exist.

| Database                                                                                                                                     | Result                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Dev database (10 users)                                                                                                                      | ✅ 38/38                                                             |
| Fresh database (empty)                                                                                                                       | ✅ 38/38                                                             |
| Test database after the full e2e run (10 users, 194 tasks, 156 XP entries, 6 自制力 entries, 11 automation executions, 10 finance snapshots) | ✅ 38/38                                                             |
| **Negative check:** a planted cross-user reference in the scratch database                                                                   | ✅ detected (`tasks → areas: 1 row`, exit 1). Cleaned up afterwards. |

## Cross-module regression: `e2e/integration.spec.ts` (new, 6 tests)

1. **One task, captured once,** is the same record in the task list, the project, the matrix and
   the goal page.
2. **Completing it** updates XP, project progress and goal actions, and shows it in the dashboard
   activity. The automation rule creates exactly one follow-up, in the same project.
3. **Reopening** reverses the XP and reopens the goal action. Completing again creates **no**
   second follow-up.
4. **Deleting** soft-deletes it: it moves to the Trash and leaves the lists and project progress.
   Restoring brings it back.
5. **Another user** gets 404 for this user's task, project, goal and rule, for both reads and
   writes. They cannot attach the project to their own task, and see none of it.
6. **Every navigation page** (all sidebar links) renders with a Chinese heading, no error state
   and no horizontal overflow, at 1440 px and 390 px.

Findings during this stage:

- **No product defect found.** Test 2's first draft assumed the project would still have 1 task.
  The M10 rule "follow-ups go where the trigger lives" adds the follow-up to the project, so the
  test now asserts that.
- A stale `.next/types` folder (left by the last AI-branch build) made `tsc` fail on this branch.
  `.next` is a build artifact; it was deleted and rebuilt. Anyone switching branches should
  rebuild too.

## Tests

| Command                                                        | Result                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm check` (lint, typecheck, format, i18n, unit, DOM, DB)    | ✅ exit 0. 39 files, **423 passed**                              |
| `pnpm build`                                                   | ✅ exit 0                                                        |
| `pnpm test:e2e`                                                | ✅ exit 0. **110 passed** of 110 listed (19 files), none skipped |
| `pnpm db:integrity` (dev, fresh and test databases)            | ✅ 38/38 each                                                    |
| `pnpm screenshots e2e/screenshots/phase1-integration.shots.ts` | ✅ 8 screenshots                                                 |

The counts are lower than on the AI branch (506 / 114) because the AI tests are not on this line.

## Screenshots

`docs/screenshots/phase1-integration/`:

1. `01-dashboard.png`
2. `02-tasks.png`
3. `03-project.png`
4. `04-gantt.png`
5. `05-development.png`
6. `06-finance.png`
7. `07-mobile-matrix.png` (phone)
8. `08-dark-character.png` (dark)

All were reviewed. The only adjustment was to the demo data: the base currency is set to CNY so
that net worth shows the recorded value instead of "missing exchange rate".

## Files changed

- `scripts/db-integrity.ts` (new) and the `db:integrity` script in `package.json`
- `e2e/integration.spec.ts` (new) and `e2e/screenshots/phase1-integration.shots.ts` (new)
- Docs:
  - `README.md` (status, database checks)
  - `docs/architecture.md` (roadmap: AI on hold, integration)
  - `docs/screenshots/README.md`
  - this report

No application code was changed.

## Not done yet (later stages, after approval)

1. Recurring tasks: `task_recurrences`, as designed in `docs/architecture.md` §5.3.
2. Settings polish.
3. JSON export.
4. Docker Compose deployment (app, PostgreSQL, migrations, health check), with separate local,
   container and production notes.
5. A final full E2E sweep and UX polish, and production-readiness notes.

## Open questions for the owner

- Whether and when to fast-forward `main` to `phase1-integration`. It is a pure fast-forward, but
  it is not done without approval.
