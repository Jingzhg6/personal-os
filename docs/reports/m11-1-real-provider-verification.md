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
**No real model call has succeeded.**

### Kinds of evidence

These are distinct; only the last would prove that a real model works with this app.

| Kind                        | What it is                                                                                                              | Proves real model behaviour? |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Mock provider**           | `AI_PROVIDER=mock`: fixed rules, labelled 模拟 in the UI (unit, DB, e2e tests and screenshots)                          | No                           |
| **Scripted fake providers** | Test doubles returning chosen outputs or errors (DB integration tests)                                                  | No                           |
| **Fake `fetch`**            | The real SDK adapter, with HTTP responses written by the test to match the documented API (`anthropic-adapter.test.ts`) | No                           |
| **Real API error response** | A real request to `api.anthropic.com` that the API refuses (invalid key → 401). Free.                                   | No (error path only)         |
| **Real model success**      | A real request with a valid key that returns a generation                                                               | **Yes — not done**           |

### 1. Verified (real API)

- `api.anthropic.com` is reachable from the server: an unauthenticated `GET /v1/models` returns 401
  `authentication_error`.
- Invalid API key: the real adapter sent one request with a deliberately invalid key and got
  `ai.auth_failed` after exactly 1 HTTP request (no retry, no crash). Re-run in the acceptance
  review.

### 2. Verified offline only (docs, SDK source, fakes, mocks)

- The model id `claude-opus-5-5` appears on the official pricing page (fetched 2026-10-28,
  $4 / $20 per MTok) and in the SDK skill's model table. Whether this account may use it is
  unverified.
- The request format matches the SDK and docs: endpoint, headers, body, structured output, no
  sampling parameters, and the refusal fallback (fake `fetch`).
- The structured-output schemas use only documented keywords and stay within documented limits
  (static analysis).
- Error mapping, the single retry rule, the deadline abort, incomplete or malformed output, and
  usage capture (fake `fetch`).
- Limits under concurrency, approval re-checks, and no execution before approval (DB tests with
  scripted fakes).
- Mock-driven UI flows (e2e).
- Request sizes in characters (measured with the mock).

### 3. Not yet verified (needs a valid key)

- Any successful real generation, for all four proposal types.
- Whether the API accepts and compiles the schemas (above all the automation draft).
- Chinese output quality.
- Actual input, output and thinking token usage, and therefore actual cost per call.
- Latency at `medium` effort against `AI_TIMEOUT_MS`.
- Real 404 for an unknown model.
- Refusal-fallback behaviour, and whether the account can use `claude-opus-5-5`.

## Acceptance review (2026-10-28)

The baseline was `a3d24c3` on `m11-1-real-provider-verification`. It was identical to the remote,
the working tree was clean, and all M11.1 changes were committed. This review fixed the review
findings below, in tests and docs only. No features were added.

| #   | Finding                                                                                                                                                                                   | Fix                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The call budget for `AI_LIVE_VERIFY=1` was stated as "at most 7 calls, 5 billed". This ignored the adapter's single retry after a 429, 5xx or lost connection, so the HTTP ceiling is 13. | Docs now state 7 provider calls, at most 13 HTTP requests, and at most 5 billable generations. The suite records the HTTP request count per check and asserts that the unknown-model check makes exactly 1 request. |
| 2   | Live smoke tests 1 and 2 would pass if the model returned no recommendations or no tasks.                                                                                                 | They now require at least one recommendation and at least one task.                                                                                                                                                 |
| 3   | The model-id evidence said "pricing page and model docs", but only the pricing page was fetched.                                                                                          | Corrected: the pricing page and the SDK skill's model table; account availability unverified.                                                                                                                       |
| 4   | "Thinking tokens are billed as output" was stated as fact, but not confirmed or measured.                                                                                                 | Marked as expected, not confirmed.                                                                                                                                                                                  |
| 5   | The cost estimate assumed 2.5–4 characters per token, which is optimistic for Chinese text.                                                                                               | Widened to 1.5–4: about $0.01–0.23 per call and about $7 per user per day worst case, labelled as estimates. The M11 report is aligned.                                                                             |
| 6   | The union-parameter count was presented as the API's count.                                                                                                                               | Marked as an approximation.                                                                                                                                                                                         |
| 7   | README had no verification status, and ADR 0022 did not record that live behaviour is still unverified.                                                                                   | Both state it now. The M11 report notes the M11.1 retry change.                                                                                                                                                     |
| 8   | The summary did not separate kinds of evidence.                                                                                                                                           | Restructured into three categories (verified, offline only, not verified), with an evidence legend.                                                                                                                 |

Checked and found correct, with no change needed:

- Model id: `claude-opus-5-5` throughout.
- Request format: the bearer header and `anthropic-version: 2026-10-21`.
- Retry rules: consistent across the report, ADR and code.
- Rate limits: 5 per minute and 30 per day, atomic.
- `ai:verify` reads only `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL`. The adapter ignores ambient
  `ANTHROPIC_*` (tested), and results contain no key or content.
- Without a key, `AI_LIVE_VERIFY=1` exits 1 with a clear message before any billable call.

Results after the review:

| Command                                    | Result                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                               | ✅ exit 0. 45 files passed, 1 skipped; **506 passed**, 7 skipped (the live suite, by design)                                            |
| `pnpm build`                               | ✅ exit 0. The client-bundle scan found 0 matches for the key name, `sk-ant`, `x-api-key`, the SDK, the system prompt and the beta name |
| `pnpm test:e2e`                            | ✅ exit 0, **114 passed**                                                                                                               |
| `pnpm ai:verify` (no flag)                 | 7 skipped, no network                                                                                                                   |
| `AI_LIVE_VERIFY=auth pnpm ai:verify`       | ✅ 1 passed (live invalid key, 1 HTTP request), 6 skipped                                                                               |
| `AI_LIVE_VERIFY=1 pnpm ai:verify` (no key) | Exit 1: "needs AI_PROVIDER=anthropic and AI_API_KEY"; the invalid-key check passed, and no smoke call was made                          |

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
  - Thinking is always on for this model (per the SDK model guide), and its tokens count against
    `max_tokens`. They are expected to be billed as output tokens, but this was not confirmed on
    the pricing page in this session and not measured.
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
parameters, supported keywords only). "Union params" counts object properties whose schema is an
`anyOf`. This is my reading of the documented limit, an approximation of how the API counts; only
a live call can confirm it.

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

**Estimate (not measured).** Assumptions:

- 1.5–4 characters per token: Chinese text tokenises denser than English JSON keys. This range
  was widened in the acceptance review from the earlier 2.5–4.
- The output schema counts as input.

Results:

- input about 0.7k–8k tokens for these requests, up to about 18k at the context cap;
- output: the JSON (about 0.3k–2k) plus thinking at `medium` effort, at most 8k;
- at $4 / $20 per MTok: about **$0.01–0.23 per call**, worst case about **$7 per user per day** at
  30 calls.

A retried call is normally not billed twice, since a retry only follows a 429, 5xx or lost
connection; this is unverified. The M11 report's original figure ("$0.03–0.18, about $5 per day")
has been aligned with this one. All of these are **estimates**: no cost per call is verified.

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
3. Run `AI_LIVE_VERIFY=1 pnpm ai:verify` (needs PostgreSQL and the test database; it empties the
   test database).
   - **Provider calls (7):**
     - 5 smoke generations: priorities, goal plan, contributions, a supported automation draft,
       and an unsupported one;
     - 2 checks that are refused and unbilled: invalid key and unknown model.
   - **HTTP requests:** the adapter retries a call once after a 429, 5xx or lost connection, so
     the ceiling is 13. At most 5 can return a billable generation.
   - The actual HTTP request count is recorded per check. Expected cost is well under $1 (an
     estimate).
   - Without a key, the suite stops before any billable call: exit code 1, "needs
     AI_PROVIDER=anthropic and AI_API_KEY".
4. Read `test-results/ai-live.json`. For each call it records:
   - whether it succeeded, the error code and the status;
   - input and output tokens, duration and HTTP requests;
   - the cost, computed from measured tokens and the listed price. Then check the Chinese quality in the UI with a
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
