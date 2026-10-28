# M11.1 — Real AI provider verification: report

- **Branch:** `m11-1-real-provider-verification`
- **Starting commit:** `d6806b0`, the tip of `m11-ai-advisor`, identical to
  `origin/m11-ai-advisor`. The tree was clean.
- **Final commit:** the M11.1 commit on this branch (see `git log`).
- **Not done:** nothing was merged or deployed, and M12 was not started.

## Summary: live verification is NOT complete

**No real API key was available** in this environment. `AI_API_KEY`, `AI_PROVIDER` and
`ANTHROPIC_API_KEY` are not set, and `.env.local` has none. I did not ask for a key, did not use
any other credentials present in the environment, and did not substitute mock results as proof.

| Item                                    | Verified how                                                                                                                                       | Live?                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| API reachable from the server           | Unauthenticated `GET /v1/models` returns 401 `authentication_error`                                                                                | ✅ live                                    |
| Invalid API key                         | The real adapter against `api.anthropic.com` with a deliberately invalid key gives `ai.auth_failed` after exactly 1 HTTP call (no retry), no crash | ✅ live (free)                             |
| Model id `claude-opus-5-5` valid        | Listed in the official pricing page and model docs ($4 / $20 per MTok); account availability needs a key                                           | ⚠️ documented, not checked for the account |
| Request format accepted                 | Wire request checked against the SDK and docs (fake `fetch`): endpoint, headers, body, structured output, no sampling parameters                   | ❌ offline only                            |
| Structured outputs (4 proposal types)   | Schemas checked against the documented supported keywords and limits                                                                               | ❌ offline only                            |
| Chinese output quality, latency, tokens | —                                                                                                                                                  | ❌ needs a key                             |

## Provider and model

- **SDK:** `@anthropic-ai/sdk` 1.3.0. It sends `anthropic-version: 2026-10-21` and the API key as
  `Authorization: Bearer <key>`; this was verified on the wire.
- **Model:** `AI_MODEL`, default `claude-opus-5-5`. It is unchanged; the official pricing page
  lists it at $4 input / $20 output per million tokens. `AI_MODEL` is now format-checked at
  startup (an id without spaces or quotes). An unknown model id gives `ai.model_unavailable`: the
  API's documented 404 `not_found_error`, tested through the adapter. The live check is in
  `ai:verify`.
- **Request:**
  - `beta.messages.create` with `output_config: { effort, format: json_schema }`, `max_tokens`
    from `AI_MAX_OUTPUT_TOKENS`, and the server-side refusal fallback
    (`server-side-fallback-2026-07-01`, `fallbacks: "default"`).
  - Not sent: `temperature`, `top_p` or `top_k` (rejected under 2026-10-21), forced
    `tool_choice`, thinking configuration or prefill.
  - Thinking is always on for this model, and its tokens count against `max_tokens` and are
    billed as output.
- **Credentials:** only `AI_API_KEY` and `AI_BASE_URL` are used. A test sets ambient
  `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL`; the adapter ignores both. The key is never in
  the request body, logs or results.

## Defects found and fixed

All five are in the AI integration only. XP, 自制力, rewards, finance and automation semantics are
unchanged.

1. **Closed value sets were not enforced by the API.**
   - Cause: the SDK helper `zodOutputFormat` (v1.3.0, see `lib/transform-json-schema.js`) folds
     `enum` and `const` into description text, although the API supports them.
   - Effect: areas, actions, uncertainty and the automation trigger, condition and action types
     were only hints, which increases malformed-output failures.
   - Fix: `server/output-schema.ts` builds the schema itself, keeping `enum`, `const`,
     `anyOf`/`$ref`, supported formats and `minItems` 0/1. Other constraints stay hints, and the
     app's zod validation enforces them.
   - Tests: every schema uses only documented keywords, objects have
     `additionalProperties: false`, and enums are present.
2. **Enum capitalisation was not tolerated.**
   - The docs state that structured outputs do not guarantee the case of `enum`/`const` values.
   - Fix: `normalizeEnumCase` maps values of enum-typed fields that differ only in case. Free text
     is never touched, and unknown values still fail validation.
3. **The per-minute limit was not atomic.**
   - Reproduced: with a limit of 2, **5 of 6** concurrent requests passed. The test failed when
     the fix was removed.
   - Fix: limits are checked and the call reserved inside a per-user advisory lock. Now exactly 2
     pass.
   - A request refused before the call (for example an unknown goal) no longer counts against the
     limits.
4. **Timeouts and retries were not bounded as intended.**
   - The SDK retried timeouts, and the app's backstop rejected without aborting, so a timed-out
     request kept running and could still be billed.
   - Fix: SDK retries are off. One app deadline (`AI_TIMEOUT_MS`) covers the call and any retry
     and aborts the request. There is at most one retry, only for 429, 5xx/529 and connection
     errors, honouring `retry-after` (capped at 5 s). 4xx errors and timeouts are never retried.
     The backstop also aborts.
5. **Error codes were too coarse and output problems were mislabelled.**
   - New codes:
     - `ai.auth_failed` (401/403; previously `ai.not_configured`);
     - `ai.model_unavailable` (404);
     - `ai.request_rejected` (400/422, for example a schema the API refuses);
     - `ai.incomplete_output` (`max_tokens`, context window exceeded, or no or empty text;
       previously `ai.malformed_output`).
   - The status shows `missing_key` when a provider is chosen without a key.
   - Usage is recorded for failed calls too, since they may be billed.
   - Only the HTTP status and error type are logged, never the provider's message, which may echo
     input.

## Error handling

All cases below were exercised through the real SDK adapter with a fake `fetch`, unless marked live.

| Case                  | Result                                                  |
| --------------------- | ------------------------------------------------------- |
| Missing key           | Unavailable state, "没有设置 AI_API_KEY"; no call       |
| Invalid key           | `ai.auth_failed`, 1 call (also **live**)                |
| Invalid model         | `ai.model_unavailable`, no retry                        |
| Rate limit (429)      | 1 retry, then `ai.rate_limited`                         |
| Timeout               | Request aborted at the deadline, `ai.timeout`, no retry |
| Server error / 529    | 1 retry; recovers if the retry succeeds                 |
| Malformed or non-JSON | `ai.malformed_output`                                   |
| Schema-invalid JSON   | Rejected by strict validation (`ai.malformed_output`)   |
| Empty or truncated    | `ai.incomplete_output`, with usage recorded             |
| Refusal               | `ai.refused`                                            |

Other features keep working after any failure (existing test 15 and e2e test 8).

## Schema validation per proposal type

Checked against the documented limits (at most 16 union-type parameters, at most 24 optional
parameters, supported keywords only). "Union params" means union-type parameters.

| Type          | Schema chars | Properties | Union params | Optional | Offline result        |
| ------------- | -----------: | ---------: | -----------: | -------: | --------------------- |
| Priorities    |        1,158 |          9 |            2 |        0 | ✅ within limits      |
| Goal plan     |        1,710 |         13 |            2 |        0 | ✅                    |
| Contributions |          633 |          5 |            0 |        0 | ✅                    |
| Automation    |        7,878 |         59 |           11 |        0 | ✅ (largest; closest) |

The API also has an undocumented limit on compiled-grammar size. Whether these schemas compile
can only be confirmed live. A rejection surfaces as `ai.request_rejected` and changes nothing.

Each type's checks (discipline excluded, IDs allow-listed, unsupported automation explained,
nothing executed before approval) are covered by the existing integration tests with scripted
providers. `ai:verify` checks the same on live output.

## Tokens and cost

**Measured:** request size in characters, with realistic data (15 tasks, a goal and a project):

| Type          | System | Prompt + data | Schema |
| ------------- | -----: | ------------: | -----: |
| Priorities    |  1,352 |         4,857 |  1,158 |
| Goal plan     |  1,352 |           918 |  1,710 |
| Contributions |  1,352 |           709 |    633 |
| Automation    |  1,352 |         2,514 |  7,878 |
| Review        |  1,352 |         1,162 |  1,372 |
| Question      |  1,352 |         5,235 |    553 |

The context is capped at 24,000 characters (about 60 tasks).

**Not measured:** tokens. The tokenizer and the per-request `usage` need a key. The adapter reads
`usage.input_tokens` and `usage.output_tokens` (tested) and stores them in `ai_requests`, for
failed calls too.

**Estimate** (assuming about 2.5–4 characters per token for this mixed JSON/Chinese text, and that
the schema counts as input):

- input about 1k–4k tokens typically, up to about 9k at the context cap;
- output the JSON (about 0.3k–2k) plus thinking at `medium` effort, at most 8k;
- at $4 / $20 per MTok: about **$0.01–0.20 per call**, worst case about **$6 per user per day**
  at 30 calls.

The M11 report's "$0.03–0.18, about $5 per day" is in the same range. Both are **estimates**: no
cost per call is verified.

**Limits:**

- 5 per minute and 30 per day are enforced. The concurrency boundary is fixed (defect 3).
- Neither limit was raised, and no background or recurring calls exist.
- The per-minute limit is per user. There is no global, cross-user budget: total spend scales with
  the number of users.

## Privacy and security

- **Server-side only:** after `pnpm build`, a client-bundle scan found 0 files containing
  `AI_API_KEY`, `sk-ant`, `x-api-key`, `@anthropic-ai/sdk`, the system-prompt text or the beta
  name.
- **Finance:** only completeness counts are sent (existing test). The live test seeds no finance
  data.
- **Authorization:** unchanged and re-run. Ownership is re-read through the owning modules,
  approval re-checks owner, status, expiry, staleness and target, and stale proposals are rejected
  (`ai.proposal_stale`).
- **No path to protected records:** the four allow-listed operations cannot reach XP, 自制力,
  rewards, finance balances or FX. Existing test 14 still passes.
- No new permissions, tools or operations were added.

## Tests

| Command                              | Result                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm check`                         | ✅ 45 files passed, 1 skipped (the live suite); **506 passed**, 7 skipped (live, by design) |
| `pnpm build`                         | ✅                                                                                          |
| `pnpm test:e2e`                      | ✅ **114 passed**                                                                           |
| `AI_LIVE_VERIFY=auth pnpm ai:verify` | ✅ 1 passed (live invalid-key check), 6 skipped                                             |
| `pnpm ai:verify` (no flag)           | 7 skipped (no calls)                                                                        |

New and changed tests:

- `src/modules/ai/server/anthropic-adapter.test.ts` (new, 18 tests): wire format, credential
  isolation, schema enums, every error class, retries, abort, incomplete output, usage.
- `src/modules/ai/server/output-schema.test.ts` (new, 10 tests).
- Three new DB tests in `src/server/ai.db.test.ts`: concurrent limit, usage on failure, and a
  refused request not counting.
- `status-notice.test.tsx`: missing key, plus the three new error messages.
- `src/server/ai.live.test.ts` (new, opt-in).

Two assertions were updated for intended changes, without weakening them:

- 401 now expects `ai.auth_failed`, previously `ai.not_configured`;
- the status object now includes `unavailableReason: null`.

## To finish live verification (requires the owner's key)

1. Put the key in `.env.local`. Never commit it, and never paste it in chat.

   ```
   AI_PROVIDER=anthropic
   AI_API_KEY=<key>
   ```

2. Optionally add `AI_MODEL=claude-opus-5-5` (the default).
3. Run `AI_LIVE_VERIFY=1 pnpm ai:verify`. It makes at most 7 calls: 5 billed smoke calls (priorities,
   goal plan, contributions, a supported and an unsupported automation draft) plus 2 unbilled
   checks (invalid key, unknown model). Expected cost is well under $1.
4. Read `test-results/ai-live.json`: per call, whether it succeeded, its error code, status, input
   and output tokens, duration and estimated cost. Then check the Chinese quality in the UI with a
   few manual clicks.
5. If a schema is rejected (`ai.request_rejected` with 400 "Schema is too complex"), simplify that
   output schema. The automation draft is the most likely candidate.

## Remaining limitations

- Chinese output quality, latency at `medium` effort, actual token use, and the refusal-fallback
  behaviour are unverified.
- With thinking always on, `AI_MAX_OUTPUT_TOKENS=8000` could truncate long goal plans. That now
  shows clearly as `ai.incomplete_output`. Tune it after live measurement.
- When the fallback serves a request, the served model may differ from `AI_MODEL`. Only the
  configured model is recorded.
- There is no global (cross-user) spending cap.
