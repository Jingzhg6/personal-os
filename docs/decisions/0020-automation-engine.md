# 0020 — Automation engine: typed rules, transactional outbox, at-most-once effects

Status: Accepted (M10). Builds on ADR 0011 (events published under row locks) and 0012 (XP ledger).

## 1. Scope

A user-owned rule is **Trigger → Conditions → Actions**, all typed data. The engine is
deterministic and auditable; nothing is AI, nothing calls an external service, and a rule never
runs until the user enables it.

The audit before M10 found no recurring-task, reminder, notification or scheduler code, and an
in-process synchronous event bus (no durable delivery). M10 therefore adds the smallest durable
mechanism that fits a single-user app: a database outbox, a per-change drain and an optional
worker endpoint — no queue service.

## 2. Rule representation

`automation_rules` stores `trigger`, `conditions` and `actions` as JSON validated by strict zod
schemas (`modules/automation/domain`). Unknown fields, unknown types, malformed dates, times or
time zones are rejected at the API. Stored JSON is re-parsed every time it is used; if it no
longer parses (manual edits, a future version), the rule is shown as invalid, recorded as
`skipped: invalid_config` and cannot be enabled — never executed. There are no expressions,
scripts, SQL or dynamic imports. Templates replace only `{task}`, `{project}`, `{goal}` and
`{date}`.

Lifecycle: create (always `enabled = false`) → enable (validates config and referenced ids again)
→ disable → edit → archive / restore → delete only if the rule never ran. Editing an enabled rule
moves `enabled_at` to now, so events from before the edit are not processed with the new
configuration; no replay exists.

## 3. Supported triggers, conditions and actions

| Trigger            | Source event (owning module)                             | Idempotency key                  |
| ------------------ | -------------------------------------------------------- | -------------------------------- |
| 任务完成时         | `task.completed` (tasks, existing)                       | per task (re-completion ignored) |
| 任务状态变化时     | `task.status_changed` (tasks, **new**)                   | per event                        |
| 项目完成时         | `project.completed` (projects, existing)                 | per project                      |
| 成长目标状态变化时 | `goal.status_changed` (development, **new**)             | per event                        |
| 保存余额记录时     | `finance.snapshot_saved` (finance, **new**, counts only) | per valuation date               |
| 按计划时间         | once / daily / weekly / monthly                          | per occurrence instant           |

The three new events are published by their owning services inside the same transaction, only on
real changes; `finance.snapshot_saved` carries the date, entry count, unconverted count and
whether it was a correction — no balances, rates or names.

Conditions (AND, optional, at most 5): task priority / area / project / status, project priority /
area, goal's new status, "every balance has a rate". Each is only offered for triggers whose facts
contain it (enforced by the schema).

Actions (in order, at most 5):

- **create_task** — `createTask` of the tasks module; default (unstarted) status, never completed;
  area / project checked by the tasks service; optional due date = the trigger's local date + n.
- **create_follow_up_task** — the same service, in the triggering task's or project's project and
  area (the only relationship the data model supports).
- **notify** — a minimal in-app notification (`automation_notifications`, read/unread), because no
  notification system existed. No push, e-mail or SMS.
- **set_task_priority** — `updateTask` with only `priority`, on the triggering task. Changing
  status (and therefore completing tasks) is deliberately not an action.

Automation never writes XP, rewards, finance data or another module's tables; XP for automated
tasks comes only from completing them through the normal flow.

## 4. Event delivery

1. A capture subscriber (`automation.capture`, registered last on the bus) runs inside the
   publisher's transaction. If the user has an enabled rule for the event type, it writes the event
   and its **facts** (ids, titles, counts — the state at that moment) to `automation_events`, in a
   savepoint: a capture failure is logged (without payload) and never undoes the user's change.
2. After a tRPC mutation commits, `afterMutation` drains the user's pending events. Each event is
   processed in its own transaction holding its row lock (`FOR UPDATE SKIP LOCKED`); concurrent
   drains never take the same event. An engine error leaves the event pending (retried by the next
   drain) and fails it after 5 attempts.
3. The worker tick drains everyone's pending events too.

Rules enabled (or edited) after an event occurred never see it.

## 5. Durable execution, idempotency and retries

- `automation_executions` has one row per **(rule, trigger key)** (unique index). A repeated
  occurrence — redelivery, two drains, a re-completed task — increments `duplicates` instead of
  running again.
- Each action runs in a savepoint together with its row in `automation_effects`
  (primary key `(execution, action index)`). The effect and the proof that it happened commit
  together, so an action's effect happens **at most once**, across retries and workers. Since all
  actions are database writes in the same transaction, this is effectively exactly-once for
  committed executions; we do not claim exactly-once delivery in general.
- Actions stop at the first failure; later ones are `not_run`. Status is `succeeded`, `partial`
  (some ran) or `failed`. Business-rule refusals (a deleted project, a foreign area) are
  **permanent** and not retryable; other errors are **transient** and may be retried manually.
- A retry reuses the same execution (same key), the configuration snapshot taken when it started
  and the captured facts, and only runs actions without an effect. At most 3 retries; disabled
  rules cannot be retried.

## 6. Loop prevention and limits

Changes made by actions are published through a bus wrapper that adds an **origin** (`depth`,
`ruleIds`) to the event context; capture stores it on the event. A rule never reacts to an event
whose chain already contains it (`skipped: loop`), and events deeper than 2 are not acted on
(`skipped: depth`). With today's actions no chain can actually form (none of them changes status
or completes anything), but the guard is enforced by the engine and tested with real events.

Limits: 5 actions and 5 conditions per rule, 50 enabled rules per user, 60 executions per rule per
hour (more are `skipped: rate_limited`), 50 events per drain, 100 schedules per tick, 10 s
statement timeout per execution.

## 7. Scheduler and runtime assumptions

Scheduled rules store `next_run_at`. They run only when something calls `tickSchedules`:

- `POST /api/automation/tick` with `Authorization: Bearer $AUTOMATION_WORKER_SECRET`, from cron,
  a systemd timer or `pnpm automation:worker` (calls it every minute). Without the secret the
  endpoint answers 503 and the UI says that schedules will not run automatically. Each tick writes
  a heartbeat; the health view calls the scheduler operational only with a heartbeat < 5 min old.
- 立即检查 (manual path) runs the signed-in user's due schedules and pending events, without a
  heartbeat.

Next.js has no reliable in-process timer in production, so nothing pretends otherwise.

**Misfire policy.** When a due rule is processed late, all missed occurrences are coalesced into
the latest one; it runs if it is at most 6 hours late, otherwise one `skipped: misfired` record is
written. The count is stored (`missed_occurrences`). Nothing is back-filled one by one.

## 8. Time zones and daylight saving

A schedule is a local time in an IANA zone fixed on the rule (the user's zone when it was created).
Occurrences are computed with `Intl` (no new dependency):

- a local time that does not exist (spring-forward gap) runs as far after the gap as it was inside
  it: 02:30 on a 02:00→03:00 day runs at 03:30;
- a local time that exists twice (fall-back) runs once, at its first occurrence;
- monthly day 29–31 runs on the last day of shorter months; a past one-time schedule cannot be
  enabled.

## 9. Observability

`/automation` shows: event processing (pending count, last processed), scheduler (configured,
last heartbeat, operational, scheduled and due rules), recent failures and the last success.
Execution history shows trigger, subject, result, per-action outcomes, error class, duplicates,
missed occurrences, attempts and whether it was caused by another automation. No stack traces.

## 10. Deferred

Visual workflow canvas, arbitrary expressions, RRULE, OR / nested conditions, numeric threshold
conditions (no stable event carries such values yet), status-changing actions, push / e-mail
notifications, webhooks, replay of past events, multi-worker distribution beyond row locks,
automation of finance values.
