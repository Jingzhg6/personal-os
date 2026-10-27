# M10.1 — Automation final audit & hardening: report

Branch `m10-1-automation-audit`, created from the accepted M10 tip `36d5e26` (local and
`origin/m10-automation` identical, clean working tree, based on M9.5 `a352dbf`). Not merged, not
deployed; no Discipline / 自制力 work, no new triggers, actions, XP rules or rewards.

## 1. Audit A — test report consistency

- The "26" in the M10 log was an intermediate run; the 27th integration test (new-event
  regression) was added afterwards. The M10 final report's 27 was correct.
- Authoritative M10 counts (re-run at `36d5e26`): automation unit **17**, automation DB
  integration **27**, automation E2E **11** (+ setup), full Playwright list **97 tests in 17 files**.
- Failures produce a non-zero exit code: a deliberately failing Vitest test and a deliberately
  failing Playwright test both exited **1** (temporary files, removed).
- `pnpm test` includes `src/server/automation.db.test.ts` (db project glob `src/**/*.db.test.ts`);
  `pnpm test:e2e` includes `e2e/automation.spec.ts`.

## 2. Confirmed issues and fixes

Every fix has a regression test that failed before the fix.

| #   | Issue (confirmed by a failing test or a real run)                                                                                                                                                                     | Fix                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `drainEvents`: an error before an event was claimed was blamed on the previously processed event (reset to `pending`, attempts +1); with the database failing it looped forever (could hang a request or the worker). | Track the event claimed in each iteration; with nothing claimed, stop; only a claimed, still-pending event is updated.                                      |
| D2  | `tickSchedules`: one rule whose processing threw aborted the whole tick, blocked every later due rule on every tick and prevented the heartbeat.                                                                      | Per-rule error isolation: the failing rule is logged, counted (`failed` in the summary), stays due and is retried next tick; others proceed.                |
| D2b | A scheduled rule whose stored configuration no longer parses was silently taken off the schedule (no record).                                                                                                         | Recorded as `skipped: invalid_config`, then taken off the schedule.                                                                                         |
| D3  | Capture's rule lookup ran outside its savepoint: its failure undid the person's own change (contrary to ADR 0020).                                                                                                    | The lookup runs inside the savepoint.                                                                                                                       |
| D4  | Actions called `createTask` without the tasks module's input schema: a template could render an empty title (rejected only by a DB check, misreported) or a title over 500 characters (stored).                       | Task input is validated with `createTaskInput`; failures are `automation.invalid_task`, permanent.                                                          |
| D5  | PostgreSQL data / integrity errors (SQLSTATE 22xxx / 23xxx) were classified as transient and offered for retry.                                                                                                       | Classified as permanent `automation.invalid_data`; timeouts / serialization failures stay transient.                                                        |
| D6  | Events that failed permanently (5 attempts) were invisible; the health card showed 正常.                                                                                                                              | Health counts them; the card shows "N 个事件多次处理失败，已停止重试" with a warning dot.                                                                   |
| D7  | Finished one-time schedules were counted as active; enabled schedules were not marked as waiting for a worker in the list / detail.                                                                                   | Only schedules with a next run are counted ("N 条计划规则等待下次运行"); list badge "等待后台 worker：不会自动运行", detail notice, "一次性计划已执行完毕". |
| D8  | **`pnpm automation:worker` crashed on start** (top-level await is not supported by tsx's CommonJS output): the documented worker had never worked.                                                                    | No top-level await; a test spawns the real script and expects its configuration error (fails with the old script).                                          |
| —   | Tick endpoint: an unexpected error gave an unstructured 500.                                                                                                                                                          | Returns `{error: "tick_failed"}` 500 without writing a heartbeat; error name logged.                                                                        |

Checked and **no fix needed**: concurrent drains / ticks (row locks + unique occurrence key;
tested with 3 concurrent drains, 3 concurrent ticks, 5 overlapping live HTTP ticks); retry limits
and enabled check; cross-user rejection (rules, executions, retries, references); loop and depth
guards; finance facts (counts and date only; logs contain event type / error name / codes only);
`task.status_changed` / `goal.status_changed` only on real changes (no-op repeats publish nothing;
`updateTask` cannot change status); `finance.snapshot_saved` payload; XP / rewards / balances
untouched by automation; migration (no schema change in M10.1 — `drizzle-kit generate` reports
nothing to migrate).

## 3. Verified guarantees

- **Atomicity**: all actions are writes to the same PostgreSQL database. Action effect, effect
  record, execution row and outbox status commit in one transaction. New test: a failure injected
  after the actions (before the outbox update) leaves no task, no effect and no execution; the next
  drain creates exactly one task.
- **At most once / exactly once**: each action takes effect at most once; when processing
  eventually succeeds, exactly once. Delivery is at-least-once until commit.
- **Not guaranteed**: an event whose capture fails is lost (by design the person's change wins;
  logged); an event failing 5 times is not processed (now visible); schedules run only with a
  worker.

## 4. Verified worker / scheduler operation

Production build (`pnpm start`) with `AUTOMATION_WORKER_SECRET` set, the real
`pnpm automation:worker` (15 s interval) and a one-time schedule due at 21:38 UTC:

- endpoint: no auth → 401, wrong secret → 401, right secret → 200 with summary;
- worker ticked at 21:38:06: `executed: 1`; next tick `executed: 0`;
- one notification created; one execution (`succeeded`, 0 duplicates);
- five overlapping HTTP ticks afterwards: all `executed: 0`;
- health: `configured: true, operational: true`, no remaining scheduled rules.

Operating model: the app must have `AUTOMATION_WORKER_SECRET` (≥ 32 characters); something must
call `POST /api/automation/tick` with `Authorization: Bearer <secret>` — the bundled worker
(`APP_URL=… AUTOMATION_WORKER_SECRET=… pnpm automation:worker`, every `AUTOMATION_TICK_MS`, default
60 s) kept alive by a process manager, or cron once a minute. Occurrences run at the first tick
after they are due; missed ones coalesce into the latest within 6 h, older ones are recorded as
missed. Without a worker: schedules are saved, not executed; the UI says so; 立即检查 runs the
user's due schedules manually. Instructions: README "Automation worker", ADR 0020 §7.

## 5. Tests and commands (final)

| Command                                                                            | Result                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm vitest run --project unit src/modules/automation`                            | 18 passed (17 + D5)                                                                                                             |
| `pnpm vitest run --project db src/server/automation.db.test.ts`                    | 35 passed (27 + 8 audit: D1, D2, D2b, D3, D4+D5, D6, D7, crash atomicity)                                                       |
| `pnpm vitest run --project unit src/server/automation-worker-script.test.ts`       | 1 passed (D8)                                                                                                                   |
| `pnpm check` (lint, typecheck, format, i18n 1586 keys / 16 namespaces, all Vitest) | 37 files, 388 passed                                                                                                            |
| `pnpm build`                                                                       | passed                                                                                                                          |
| `pnpm test:e2e`                                                                    | 97 passed (automation test 10 extended: awaiting-worker badge and notice, finished one-time schedule, corrected health wording) |

No assertion was weakened. Two expectations of tests changed: the tick result now also reports
`failed: 0` (stricter `toEqual`), and the new crash test expects the corrected `invalid_data`
classification of the injected constraint error.

## 6. Screenshots

The rule list, detail and health card changed, so `docs/screenshots/m10/` was re-captured with the
same script (`e2e/screenshots/m10.shots.ts`); `01-rules` and `08-mobile-rules` now show the
"等待后台 worker" badge and the corrected scheduler line.

## 7. Remaining limitations

- Scheduled rules need an operated worker or cron; none is deployed by this project.
- Events are drained after tRPC mutations and on ticks; changes made outside tRPC wait for a tick.
- A failed capture loses that event (logged, not retried); permanently failed events are shown but
  not re-queued automatically.
- A healthy heartbeat means ticks arrive, not that every action succeeded (failures are listed).
- Single-database design: the guarantees rely on all actions being database writes; any future
  external side effect (e-mail, webhooks) would need an idempotency key at the receiver.

## 8. Merge / deployment

No merge, no deployment, no M11 / Discipline implementation. Waiting for review.
