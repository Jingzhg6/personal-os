# M11 — AI Advisor & Intelligence: report

- **Branch:** `m11-ai-advisor`
- **Starting commit:** `b26e2c0` (M10.6, which contains M10.5 `cd96e96`). The tree was clean.
- **Final commit:** the M11 commit on this branch (see `git log`).
- **Not done:** nothing was merged or deployed, and M12 was not started.
- **Principle:** the model proposes, the user decides, and the app's deterministic services
  execute. The plan written before coding is in [`m11-plan.md`](./m11-plan.md); the decision is
  [ADR 0022](../decisions/0022-ai-advisor.md).

## Real provider: not configured, not tested

There is no API key in this environment. The Anthropic adapter (official SDK `@anthropic-ai/sdk`
1.3.0) is implemented and type-checked, and its error mapping is unit-tested. It has **never made a
live call**.

Every result in tests and screenshots comes from the deterministic mock provider or scripted fakes.
The UI labels them 模拟; they are not AI output.

**Live verification is still outstanding**, in particular:

- whether the API accepts the structured-output JSON schemas generated from the zod output
  schemas (including the automation trigger/condition/action unions);
- real latency against `AI_TIMEOUT_MS`;
- token usage and cost;
- the quality of the Chinese output;
- refusal-fallback behaviour.

> **M11.1 update** ([verification report](./m11-1-real-provider-verification.md)): still no
> successful live call (no key was available). Offline checks against the SDK source and the
> official docs found and fixed five defects in the integration:
>
> - closed value sets were not enforced in the schema;
> - enum capitalisation was not tolerated;
> - the per-minute limit was not atomic under concurrency;
> - a timed-out request was not aborted;
> - error codes were too coarse.
>
> The invalid-key path was verified against the real API. Run `AI_LIVE_VERIFY=1 pnpm ai:verify`
> with a key to finish verification.

## What was built

### Module and data

The new `ai` module has `domain`, `db`, `server` and `ui` layers. Migration `0016_ai_advisor.sql`
is additive and creates:

- `ai_proposals`, user-scoped, holding the request, analysis, typed items, source versions, expiry,
  status and apply result;
- `ai_requests`, holding per-call metadata only (no content), used for rate limits.

### Providers

- `anthropic`: the SDK with an explicit key, base URL and model (default `claude-opus-5-5`).
  - Structured output, bounded `max_tokens`, timeout, one retry, server-side refusal fallback.
  - M11.1 changed the retry: the app now makes a single retry, only after a 429, 5xx or lost
    connection, within one deadline.
  - Errors map to closed codes; provider messages are never shown or logged.
- `mock`: deterministic and test-only, labelled 模拟.
- `off` (the default): AI is unavailable and the UI shows an unavailable state.

A missing key is treated as unavailable. There is never a silent fallback to the mock.

### Capabilities

| Capability                      | Where          | Result                                                                                                                             | Approval runs                                |
| ------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A. Review                       | `/ai/review`   | App-computed facts (always available); AI summary, interpretations and recommendations (labelled AI)                               | — (analysis)                                 |
| B. Priority recommendations     | `/ai/review`   | Action, reason, benefit, uncertainty, next step and source task; optional priority change; blocked tasks never get "do now"        | `tasks.updateTask` (priority)                |
| C. Goal plan                    | `/ai/planning` | Steps, candidate tasks (relative due dates converted by the app), contributions and assumptions; tasks are editable and selectable | `development.createGoalTask`                 |
| D. Growth contributions         | `/ai/planning` | Growth attributes and weights with reasons; 自制力 is never offered and is refused if returned                                     | `tasks.updateTask` (contributions)           |
| E. Automation draft             | `/ai/planning` | A rule built only from the engine's triggers, conditions and actions, validated by `ruleConfigSchema`; unsupported parts explained | `automation.createRule` (saved **disabled**) |
| Question (conversation, scoped) | `/ai`          | A one-shot answer from the user's data, with its basis and data gaps; no memory between questions                                  | — (analysis)                                 |

### Proposal lifecycle

`analysis` · `proposed` → `applied` | `failed` | `stale` | `expired` (24 h) | `discarded`.

Approval requires `confirm: true` and a confirmation dialog that lists each change. It runs as one
locked transaction:

1. Check ownership.
2. Check expiry and staleness, re-reading the source entities.
3. Check each item's key and target (user edits change values, never targets).
4. Run the owning services inside a savepoint (all or nothing).
5. Record the result.

Repeated or concurrent approvals return the stored result and do nothing else. Stale proposals
also show as 已过时 in the history as soon as their source changes, and offer 重新生成.

### UI

The new navigation section **AI 顾问** contains 顾问 `/ai`, 回顾 `/ai/review`, 规划 `/ai/planning`
and 历史记录 `/ai/history`.

The UI provides:

- states for loading, empty, unavailable, simulated, failure (timeout, rate limit, quota,
  malformed, invalid reference, refused, provider error) and stale/expired;
- per-status badges and the ability to delete one record or the whole history;
- zh-CN text, a phone layout and a dark theme.

There is no agent canvas.

## Security and privacy

- **Authorization:** every procedure is `protectedProcedure` and works on `ctx.userId`. Goal and
  task ids are re-read through their owning modules, so another user's id gives `NOT_FOUND`.
  Proposals are read and updated with `user_id` in every query.
- **Output trust:**
  - Strict schemas (unknown keys, types and sizes are rejected).
  - Every id is checked against the ids sent in that request (`ai.invalid_reference`).
  - An automation rule is re-validated by the engine's schema, and `createRule` checks reference
    ownership again.
- **Allow-list of operations:** `proposalChange` has exactly 4 types. There is no SQL, code, URL
  or generic method path, and no operation reaches XP, 自制力, rewards, finance or auth.
- **Prompt injection:** stored text goes only inside `<data>`, JSON-encoded with `<` escaped. The
  system prompt declares that content untrusted. Output that "obeys" an injection is caught by the
  schema or allow-list (tested).
- **Data minimisation:**
  - Finance is sent as completeness counts only: no amounts, balances, currencies, rates or
    account names. A test asserts the prompt contains none of them.
  - Never sent: e-mail, credentials, sessions, XP or reward ledgers.
- **Credentials:**
  - Read only from server env and passed explicitly to the SDK.
  - `ai.status` exposes provider id, model name, simulated flag and limits — no key, URL or prompt.
  - The production client bundles were scanned for `AI_API_KEY` and the system-prompt text: no
    match.
- **Logging:** only error class names or codes are logged, never prompts or outputs.
- **Limits:**
  - 5 calls per user per minute and 30 per day (`AI_PER_MINUTE_LIMIT`, `AI_DAILY_LIMIT`).
  - User text up to 1,000 characters; context up to 24,000 characters.
  - `max_tokens` from `AI_MAX_OUTPUT_TOKENS` (default 8,000) and a hard app-side timeout.
- **No implicit calls:** nothing calls a provider on task create, complete or reopen, on scoring,
  schedules or workers. Every call is a button press.
- **Retention:** proposals and call metadata are deleted after 90 days (purged on the next
  generation), by the user (one record or 清空历史记录), or with the account (cascade). There is
  no long-term memory and no background agent.

## Confirmations

- **No AI modification of ledgers or balances:** XP, 自制力, rewards and finance records were not
  modified by AI. Test 14 runs every capability and approves every proposal, then asserts that the
  `xp_ledger`, `xp_attribute_credits`, `discipline_ledger`, `reward_ledger` and `finance_snapshots`
  counts are unchanged. Test 8 shows that an edited 自制力 contribution is refused by the tasks
  service and the ledgers stay unchanged.
- **Disabled rules:** automation rules created from AI proposals are saved disabled (integration
  test 10 and e2e test 6).

## Tests

| Command                                                  | Result                            |
| -------------------------------------------------------- | --------------------------------- |
| `pnpm check` (lint, typecheck, format, i18n, all Vitest) | ✅ 43 files, **471 tests** passed |
| `pnpm test:e2e`                                          | ✅ **114 passed** (5.4 min)       |
| `pnpm build`                                             | ✅                                |
| `pnpm screenshots e2e/screenshots/m11.shots.ts`          | ✅ 8 screenshots                  |

New tests:

- `src/server/ai.db.test.ts`: 24 integration tests through the real routers and event bus.
- `src/modules/ai/domain/ai.test.ts`: 9 tests.
- `src/modules/ai/server/provider.test.ts`: 5 tests.
- `src/modules/ai/ui/status-notice.test.tsx`: 9 tests.
- `e2e/ai.spec.ts`: 10 tests.

Coverage of the required cases:

1. **Missing config:** `providerFromEnv` (off, or anthropic without a key, is null), `ai.not_configured`, unavailable UI (DOM test).
2. **Timeout, rate limit and failure:** scripted failures, an app-side timeout on a hanging provider, request rows recorded, quota limits; e2e timeout.
3. **Malformed or unsupported output:** wrong shape, extra keys, non-object output, unknown actions, actions that don't fit the trigger.
4. **Cross-user references:**
   - other users' tasks named by the model;
   - another user's goal or task as input;
   - a foreign project in a rule;
   - reading, approving or discarding another user's proposal;
   - re-targeting an edit.
5. **Prompt injection treated as data:** an injected title is escaped inside `<data>`; output obeying it is rejected; nothing changed.
6. **Recommendations from actual data:** only the user's open tasks; a blocked task gets "unblock first", and "do now" for a blocked task is ignored and counted.
7. **Missing finance values not shown as zero:** shown as 未记录（不计为 0）; only counts are sent.
8. **Contributions cannot target 自制力:** never offered; refused from the model; refused by the service on approval.
9. **Automation suggestions use only supported capabilities:** unsupported requests are explained, with nothing to approve.
10. **Rules stay disabled until enabled:** saved disabled.
11. **Approval requires auth and explicit confirmation:** `UNAUTHORIZED` without a session; `BAD_REQUEST` without `confirm: true`.
12. **Stale proposals rejected:** stale after an edit or deletion, expired after 24 h, stale shown in the history before approval.
13. **Duplicate approvals don't duplicate effects:** 3 concurrent approvals plus 1 repeat create one set of tasks.
14. **AI can't modify the ledgers:** only the allow-listed operations exist and the ledgers are unchanged.
15. **Provider failures don't break other workflows:** task create and complete and the review facts work after a failure.
16. **Chinese UI, mobile and dark mode:** e2e 10 (phone, no overflow, dark) and the screenshots.

Known intermittent test (from earlier milestones): finance e2e test 9 (phone) once failed and then
passed on rerun. It did not occur in this run.

## Screenshots

`docs/screenshots/m11/`, listed in [`docs/screenshots/README.md`](../screenshots/README.md):

1. `01-home.png`
2. `02-review.png`
3. `03-approve-dialog.png`
4. `04-goal-plan.png`
5. `05-automation-draft.png`
6. `06-history.png`
7. `07-mobile-review.png` (phone)
8. `08-dark-error.png` (dark mode, timeout)

All AI content in them is from the mock provider. The unavailable state is covered by the DOM test,
not a screenshot, because the e2e server runs the mock.

## Deferred and limitations

- **Real provider verification** (above). If the API rejects a generated schema, calls fail
  visibly with `ai.request_rejected` (M11.1; previously `ai.provider_error`). The fallback is to simplify that output schema; the app-side zod
  validation stays as it is.
- **Cost:** each click is one paid call. With `claude-opus-5-5` at $4 / $20 per million input /
  output tokens (price confirmed on the official pricing page in M11.1), a call is an estimated
  0.7–18k input tokens and up to `AI_MAX_OUTPUT_TOKENS` (8k) output tokens, thinking included.
  Request sizes were measured in characters in M11.1; token counts remain estimates. That is about
  $0.01–0.23 per call, so at most about $7 per user per day at the default limit of 30. These are
  estimates, not measurements. Lower
  `AI_DAILY_LIMIT` or choose a smaller `AI_MODEL` to reduce this.
- **Runtime:** generation is synchronous in the request and not streamed. It is bounded by
  `AI_TIMEOUT_MS`, which covers the request and any retry; the request is aborted at the deadline
  (M11.1). Concurrent requests can no longer exceed the per-user limits (fixed in M11.1).
- **Out of scope:**
  - multi-turn chat or memory;
  - recommendations for project or milestone changes, plan creation and goal creation (plans
    create tasks under an existing goal);
  - automation rule edits or enabling;
  - any autonomous or recurring AI.
- **Context bounds:** at most 60 open tasks, 20 goals, 20 projects and 20 attributes. The rest are
  counted as omitted and not sent.
- **Context timing:** contexts are built at request time. A proposal records `updatedAt` versions
  only for the entities it would change (a task, a goal, or nothing for rule drafts).

## Next milestone

M12, per the roadmap, after the owner reviews and approves M11. It was not started.
