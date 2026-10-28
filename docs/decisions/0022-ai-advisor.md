# 0022 — AI advisor: the model proposes, the user decides, services execute

- Status: Accepted (M11)
- Date: 2026-10-28

## Context

M11 adds AI-assisted review and planning on top of tasks, projects, goals, growth (including
自制力), finance completeness and automation health. A language model is non-deterministic and its
output is untrusted. The app already has deterministic services that own every write (tasks,
development, automation) and ledgers that must never be touched by anything but their own rules
(XP, 自制力, rewards, finance snapshots and FX).

## Decision

1. **A separate `ai` module** (`domain`, `db`, `server`, `ui`). It reads other modules only
   through their public read models, always with the signed-in user's id, and writes only its own
   tables (`ai_proposals`, `ai_requests`, migration 0016).
2. **Provider boundary.** `AiProvider.generate()` takes a fixed system prompt, a task and a
   bounded `<data>` block, and returns raw JSON or a closed error code. Providers:
   - `anthropic`: the official SDK.
     - The key (`AI_API_KEY`), base URL and model (`AI_MODEL`, default `claude-opus-5-5`) are
       passed explicitly, never taken from ambient credentials.
     - Structured JSON output; bounded `max_tokens`, timeout and one retry.
     - Server-side refusal fallback is enabled.
   - `mock`: deterministic, test-only, opt-in and labelled 模拟 in the UI.

   Without configuration AI is unavailable and says so. No fake answer is ever substituted.

3. **Untrusted output.** Every output is parsed with a strict zod schema (unknown keys, types and
   sizes rejected), then every id it names is checked against the ids that request actually sent
   (an allow-list). A failure is `ai.malformed_output` or `ai.invalid_reference`; nothing is
   stored as a proposal.
4. **Typed proposals.** A proposal stores:
   - the request;
   - the analysis (model output plus app-computed facts);
   - the exact operations an approval would run (`proposalChange`: `set_task_priority`,
     `set_task_contributions`, `create_goal_task`, `create_automation_rule` — nothing else
     exists);
   - its source entities with the `updatedAt` it saw;
   - an expiry (24 h) and its status (`analysis`, `proposed`, `applied`, `failed`, `stale`,
     `expired` or `discarded`).
5. **Approval** (`ai.proposals.approve`) is the only path to a change. It requires
   `confirm: true` and runs in one transaction holding the proposal's row lock:
   - It checks ownership, the status, expiry and staleness (re-reading the sources).
   - Each approved item must match a stored item's key and target. User edits may change values,
     never what is changed.
   - It runs the owning services inside a savepoint: `tasks.updateTask`,
     `development.createGoalTask` and `automation.createRule` (always saved disabled).
   - It records the result. A repeated or concurrent approval finds `applied` and returns the
     stored result without running anything again.
   - A service refusal (e.g. `attribute.system_scored`) rolls the changes back and records
     `failed`.
6. **Facts are not AI.** The review's facts are computed by the app (`ai.reviewFacts`) and shown
   even when AI is off. The model adds labelled interpretations and recommendations.
7. **Data minimisation.** Contexts carry ids, titles, dates, statuses and counts.
   - Finance is sent as completeness counts only: no amounts, balances, currencies, rates or
     account names.
   - Never sent: credentials, sessions, e-mail addresses, XP or reward ledgers.
   - 自制力 is never offered as a contribution target.
   - Stored text sits inside `<data>` with `<` escaped, and the system prompt declares it
     untrusted.
8. **Limits.**
   - Per-user calls per minute (`AI_PER_MINUTE_LIMIT`, 5) and per day (`AI_DAILY_LIMIT`, 30),
     counted from `ai_requests`, which holds metadata only.
   - User text up to 1,000 characters; context up to 24,000 characters.
   - The output budget is bounded; there is a hard timeout.
   - No AI call happens without a button press: none on task changes, scoring or schedules.
9. **Retention.** Proposals and request metadata are user-scoped. They are deleted with the
   account, by the user (one record or all of them), or after 90 days. There is no long-term
   memory: each question is independent.

## Consequences

- A model can only ever cause what a person could do through the same services, and only after
  that person approved the specific change. XP, 自制力, rewards, finance and auth are out of
  reach by construction (no operation exists for them).
- A stale or expired proposal must be regenerated; the UI offers 重新生成.
- Quality depends on the provider. Real-provider behaviour (schema acceptance of the structured
  output format, latency, cost) must be verified with a real key; tests use the mock and fakes.
- The structured-output schema includes the automation engine's own trigger, condition and action
  schemas, so a new automation capability becomes proposable automatically. It is still validated
  by `ruleConfigSchema` and `createRule`.
