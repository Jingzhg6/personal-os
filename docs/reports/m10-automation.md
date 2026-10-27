# M10 — Automation engine: completion report

Branch `m10-automation`, created from the accepted M9.5 commit `a352dbf` (tip of
`origin/m9-5-personal-finance`, no discrepancy). Not merged, not deployed. Design:
[ADR 0020](../decisions/0020-automation-engine.md).

## 1. Pre-implementation audit and plan

- Event bus: in-process, synchronous, handlers join the publisher's transaction; no durable
  delivery. Events available: `task.created/completed/reopened/deleted/restored`,
  `project.created/completed/reopened`, `milestone.*`. **Missing**: task status changes, goal
  status changes, finance batch saves.
- No recurring-task, reminder, notification, inbox, cron or job-queue code existed.
- Idempotent actions possible through existing services: `createTask` (validates area, project,
  status; publishes events), `updateTask` (priority). Status changes / completion excluded on
  purpose (XP semantics).
- Plan: add the three missing events in their owning services → typed domain (schemas, conditions,
  schedules, keys) → outbox + executions + effects tables (one forward migration) → engine
  (capture, drain, schedules, retry) → rules API → UI → tests → docs.

## 2. Implementation summary

- `src/modules/automation/{db,domain,server,ui}`: rules, outbox capture, engine, read models,
  router, guided builder, rule list, rule detail with history, notifications, health card.
- New events: `task.status_changed` (tasks), `goal.status_changed` (development; `setGoalStatus`
  now takes the bus), `finance.snapshot_saved` (finance; `saveBatch` now takes the bus; counts
  only).
- `EventContext.origin` (optional, additive) carries the automation chain.
- tRPC: `protectedProcedure` calls the context's `afterMutation` after a successful mutation; the
  app context drains the user's pending automation events there (never failing the mutation).
- `POST /api/automation/tick` worker endpoint (`AUTOMATION_WORKER_SECRET`, optional env) and
  `pnpm automation:worker` (calls it every minute).
- Navigation: section 自动化 with 规则 and 通知.

## 3. Schema and migrations

One additive migration, `drizzle/0013_automation.sql`; no earlier migration changed, no reset.
Applied cleanly to the dev and test databases on top of the M9.5 schema.

| Table                      | Purpose                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `automation_rules`         | user rules: name, enabled (default false), enabled_at, typed JSON config, time zone, next run, archive                            |
| `automation_events`        | outbox: event id, facts, depth, rule chain, status, attempts                                                                      |
| `automation_executions`    | unique (rule, trigger key); status, skip reason, condition / action results, error class, retries, duplicates, missed occurrences |
| `automation_effects`       | PK (execution, action index), written with each effect                                                                            |
| `automation_notifications` | in-app notifications, read / unread                                                                                               |
| `automation_worker_status` | scheduler heartbeat                                                                                                               |

Ownership: every row has `user_id` (cascade on user deletion); executions and effects reference
their parent through composite `(id, user_id)` keys.

## 4. Triggers, conditions and actions

- Triggers: 任务完成时, 任务状态变化时, 项目完成时, 成长目标状态变化时, 保存余额记录时, 按计划时间
  (once / daily / weekly / monthly).
- Conditions (AND, optional): task priority / area / project / status; project priority / area;
  goal's new status; all balances have a rate.
- Actions: create task, create follow-up task (in the trigger's project and area), in-app
  notification, set the triggering task's priority. Templates: `{task}`, `{project}`, `{goal}`,
  `{date}`.

## 5. Event delivery and scheduling

Capture in the publisher's transaction (savepoint; failure never undoes the change) → drain after
the mutation commits → one event per transaction under `FOR UPDATE SKIP LOCKED` → pending events
retried by the next drain or the worker, failed after 5 engine errors. Schedules run only via the
worker endpoint or the manual 立即检查; misfires coalesce into the latest occurrence within 6 h,
otherwise one `misfired` record. DST: gap → shifted forward by the gap; overlap → first
occurrence; monthly 29–31 → last day of shorter months.

## 6. Idempotency, retries, loop prevention

- One execution per (rule, trigger key): re-completion, redelivery and concurrent drains /
  ticks only increment `duplicates`.
- Each action commits together with its effect record: effects at most once; a retry reuses the
  same execution and configuration snapshot and runs only the missing actions.
- Permanent failures (business-rule refusals) are not retryable; transient ones can be retried up
  to 3 times while the rule is enabled.
- Loop guard: events from actions carry depth and rule chain; a rule never reacts to its own chain;
  depth > 2 is not acted on. Rate limit 60 executions / rule / hour; at most 5 actions and 5
  conditions per rule; 50 enabled rules per user; 10 s statement timeout per execution.

## 7. Tests (exact counts)

| Suite                                 | Result                                  |
| ------------------------------------- | --------------------------------------- |
| Automation domain (unit)              | 17 passed                               |
| Automation integration (db, real bus) | 27 passed                               |
| `pnpm test` (all Vitest projects)     | 36 files, 378 passed                    |
| `pnpm test:e2e`                       | 97 passed (86 existing + 11 automation) |

Unit tests: schema validation (unknown triggers, fields, actions, malformed schedules, time zones,
too many actions), trigger / condition / action compatibility, invalid persisted configuration,
condition evaluation, templates, idempotency keys, error classification, partial-failure status,
DST gap / overlap, daily / weekly / monthly / once occurrences, misfire coalescing and skipping.

Integration tests: lifecycle (disabled on create, enable / disable, archive, delete only without
history), foreign references and cross-user access refused, execution through the tasks service
with XP only from the real completion, disabled rules never run and no outbox rows without an
enabled rule, condition skips, re-completion deduplicated, concurrent drains and redelivery, edits
not applied to earlier events, priority action via `updateTask`, goal and finance triggers (no
balances in facts, snapshots untouched), partial failure + safe retry without repeating finished
actions, retry refusals (other user, limit, disabled rule), invalid stored config, loop and depth
guards with real events, rate limit, schedules in a time zone with three concurrent ticks,
downtime coalescing / misfire, past one-time schedule refused, worker heartbeat, no direct XP /
finance writes, a broken outbox never blocks a completion, the three new events published once per
real change.

E2E (`e2e/automation.spec.ts`): 1 empty state · 2 builder saves a disabled rule · 3+8 explicit
enable / disable, nothing runs while disabled · 4+6 event runs the action once despite
re-completion · 5 non-matching conditions prevent the action · 7 failure visible with reason ·
9 finance trigger without balances · 10 schedule runtime warning, endpoint 503 without secret,
manual path runs a due one-time schedule exactly once · cross-user denied · 11 phone · 12 dark.

## 8. Lint, typecheck, formatting, i18n, build

`pnpm check` passes (ESLint incl. module boundaries and no hard-coded UI text, `tsc`, Prettier,
i18n: 1580 keys in 16 namespaces, Vitest). `pnpm build` passes; new routes `/automation`,
`/automation/new`, `/automation/[id]`, `/automation/notifications`, `/api/automation/tick`.

## 9. Screenshots (`docs/screenshots/m10/`)

`01-rules`, `02-rule-builder`, `03-rule-history`, `04-failed-execution`, `05-schedule-runtime`,
`06-notifications`, `07-empty-state`, `08-mobile-rules`, `09-mobile-rule-detail`,
`10-dark-rule-detail` (see the screenshots index). Review fixes: trigger labels (message keys may
not contain dots), numbered steps 3 and 4, full-page capture scrolled to the top.

## 10. Security and data integrity

- Rules are data validated by strict schemas; no code, SQL, expressions or dynamic imports.
- Every query is scoped by user; referenced areas / projects / statuses must be the user's own,
  checked at save, at enable and again by the services at run time.
- Actions go through the tasks module's services (validation, events, transactions); automation
  never writes XP, rewards, finance data or task rows itself; it never creates completed tasks.
- Finance: the event carries counts and the date only; no balances are read, logged or stored.
- The worker endpoint uses a bearer secret compared in constant time, and is disabled without it.
- Authentication rate limits and other security controls are unchanged.

## 11. Known limitations and runtime requirements

- **Schedules need an external caller**: set `AUTOMATION_WORKER_SECRET` and run
  `pnpm automation:worker` (or cron / systemd calling `POST /api/automation/tick` every minute).
  Without it, schedules run only via 立即检查, and the UI says so.
- Event processing happens after tRPC mutations and on worker ticks; changes made outside tRPC
  would wait for the next drain.
- Effects are at most once and, being same-database writes, exactly once when committed; delivery
  itself is not claimed to be exactly once.
- No numeric threshold conditions, no status-changing actions, no OR logic, no replay, no push /
  e-mail notifications, no nav badge for unread notifications.
- The native date / time inputs follow the browser's locale format.

## 12. Merge / deployment

No merge and no deployment occurred. M11 is not started; waiting for review and approval.

## Addendum (M10.1 audit)

The M10.1 audit ([report](./m10-1-automation-audit.md)) confirmed and fixed eight defects,
including a worker script that could not start (`pnpm automation:worker`), a drain that could
loop forever and blame the wrong event, a tick that one failing rule could block, and a capture
lookup that could undo the person's change. Current verified counts: automation unit 18, DB
integration 35, worker script 1, Vitest total 388, E2E 97. Guarantees are restated precisely in
ADR 0020 §5 and §11.
