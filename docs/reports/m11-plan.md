# M11 — AI Advisor: implementation plan (written before code)

Start: `b26e2c0` (M10.6) on branch `m11-ai-advisor`. No existing AI integration (no SDK, no
provider code, no env vars).

## Audit summary

- **Auth / scoping:** `protectedProcedure` supplies `ctx.userId` from the Better Auth session;
  every module service takes `userId` and scopes its queries. The AI module will only ever pass
  `ctx.userId` — never a client-supplied user id.
- **Read models usable as context (all user-scoped, public server entry points):**
  tasks `listTasks` (+ `openBlockerCount`, contributions, status category); projects
  `listProjects` (progress, next milestone); development `getDevelopmentOverview` (goals, focus,
  attributes); character `listAttributes`, `isGrowthTarget`, `getDisciplineSummary`; finance
  `getFinanceOverview` (missing / stale / unconverted lists); automation `listRules`, `getHealth`.
- **Write services an approval may call:** tasks `updateTask` (priority, contributions — it
  already rejects 自制力 with `attribute.system_scored`), development `createGoalTask` (creates an
  ordinary task linked to a goal through the tasks service, events included), automation
  `createRule` (always saves disabled, checks reference ownership). Nothing else.
- **Event bus / notifications:** synchronous, in-transaction; mutations trigger
  `afterMutation` (automation drain). An approved apply is an ordinary mutation, so automation
  reacts to AI-approved changes exactly as to manual ones. No new events needed.

## Design

1. New module `src/modules/ai` (`domain`, `db`, `server`, `ui`). It reads other modules only via
   their public read models and writes only through the three services above.
2. **Provider abstraction** (`server/providers`): `AiProvider.generate({system, data, schema,
maxOutputTokens, timeoutMs})` → typed result or a closed error code (`ai.not_configured`,
   `ai.timeout`, `ai.rate_limited`, `ai.malformed_output`, `ai.refused`, `ai.provider_error`).
   - `anthropic`: official SDK, credentials only from `AI_API_KEY` (explicit `apiKey` and
     `baseURL`, never the ambient credential chain), model `AI_MODEL` (default
     `claude-opus-5-5`), structured output (`output_config.format` JSON schema), bounded
     `max_tokens`, timeout and one retry. Output re-validated with zod (untrusted).
   - `mock`: deterministic, derived from the supplied context; for tests and e2e only, opt-in via
     `AI_PROVIDER=mock`, and labelled 模拟 in the UI. Never a silent fallback.
   - unset / `off` → "AI 不可用" state.
3. **Context builders**: bounded, minimised JSON (ids, titles, dates, counts). Finance is sent as
   completeness counts only — no amounts, balances, FX or account names. Stored text is wrapped as
   untrusted data in the prompt; outputs may only reference ids present in the context
   (allow-list), checked server-side.
4. **Typed proposals** (`ai_proposals`, migration 0016): kind, source refs with a fingerprint
   (`updatedAt` of each source entity), structured changes, explanation/assumptions, expiry
   (24 h), status (`proposed`, `applied`, `failed`, `stale`, `expired`, `discarded`; analysis
   kinds are `analysis`), apply result. `ai_requests` keeps per-call metadata (capability, status,
   error code, sizes, token counts — no content) for rate limits.
5. **Apply flow** (one transaction): lock the proposal row, verify owner + status `proposed`,
   expiry, staleness (re-read source entities), explicit `confirm: true`, re-validate the
   (optionally user-edited) changes with the same strict schemas, execute via the owning
   services, record the result. A second approval finds `applied` and returns the stored result —
   no duplicate effects.
6. **Capabilities:** review (deterministic facts + AI interpretation/recommendations), priority
   recommendations (optional approved priority change), goal plan (tasks to create under a goal),
   growth contribution suggestions (growth attributes only, never 自制力), automation rule draft
   (validated by `ruleConfigSchema`, saved disabled), one-shot question (no memory).
7. **Limits:** per-user 5 calls / minute and `AI_DAILY_LIMIT` (default 30) / day; question ≤ 1000
   chars; context ≤ 24 000 chars; output ≤ `AI_MAX_OUTPUT_TOKENS` (default 8000); timeout
   `AI_TIMEOUT_MS` (default 60 s). No AI call happens implicitly: every call is a button press.
8. **UI:** nav section 「AI 顾问」 with `/ai`, `/ai/review`, `/ai/planning`, `/ai/history`;
   proposal cards distinguish analysis, proposed, applied, failed, stale, expired, discarded.
9. **Tests:** domain unit tests, DB integration tests with injected fake providers (16 required
   cases), Playwright with the mock provider; screenshots in `docs/screenshots/m11/`.
