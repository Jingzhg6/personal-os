import { afterEach, describe, expect, it, vi } from "vitest";

import { contributionsOutput, outputSchemas, prioritiesOutput } from "../domain";
import { SYSTEM_PROMPT } from "./prompts";
import { providerFromEnv, type AiEnv, type GenerateRequest } from "./provider";

/*
 * M11.1: the real Anthropic adapter (official SDK), driven through a fake `fetch` that plays the
 * API's documented HTTP responses. This checks what goes over the wire and how every failure is
 * handled — it is not a live call (see docs/reports/m11-1-real-provider-verification.md).
 */

const KEY = "test-key-not-a-real-secret";
const env = (patch: Partial<AiEnv> = {}): AiEnv => ({
  AI_PROVIDER: "anthropic",
  AI_API_KEY: KEY,
  AI_MODEL: "claude-opus-5-5",
  AI_BASE_URL: "https://api.anthropic.com",
  AI_EFFORT: "medium",
  AI_TIMEOUT_MS: 60_000,
  AI_MAX_OUTPUT_TOKENS: 8000,
  ...patch,
});

const request: GenerateRequest = {
  capability: "contributions",
  system: SYSTEM_PROMPT,
  prompt: "<task>t</task>\n<data>{}</data>",
  data: {},
  userText: null,
  schema: contributionsOutput,
};

const validOutput = { explanation: "e", contributions: [] };

function message(patch: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: JSON.stringify(validOutput) },
    ],
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 1234, output_tokens: 321 },
    ...patch,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const apiError = (status: number, type: string, headers?: Record<string, string>) =>
  json(status, { type: "error", error: { type, message: `${type} (may echo input)` } }, headers);

function fakeFetch(...responses: (Response | "hang")[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift() ?? apiError(500, "api_error");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }
    return next;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const headerOf = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

afterEach(() => vi.restoreAllMocks());

describe("Anthropic adapter: request", () => {
  it("sends the documented Messages request with explicit credentials and a strict schema", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "ambient-token-must-not-be-used");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://ambient.example.invalid");
    const { fetch, calls } = fakeFetch(json(200, message()));
    const result = await providerFromEnv(env(), { fetch })!.generate(request);
    vi.unstubAllEnvs();

    expect(result).toEqual({
      ok: true,
      raw: validOutput,
      usage: { inputTokens: 1234, outputTokens: 321 },
    });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    // The configured base URL and key only — never ambient ANTHROPIC_* credentials.
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    // SDK 1.3.0 (API version 2026-10-21) sends the API key as a bearer credential.
    expect(headerOf(init, "authorization")).toBe(`Bearer ${KEY}`);
    expect(headerOf(init, "anthropic-version")).toBe("2026-10-21");
    expect(headerOf(init, "anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: request.prompt }],
      output_config: { effort: "medium", format: { type: "json_schema" } },
      fallbacks: "default",
    });
    // No sampling parameters, no forced tool choice, no prefill, no thinking budget.
    for (const key of ["temperature", "top_p", "top_k", "tool_choice", "tools", "thinking"]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it("keeps closed value sets enforceable in the schema sent to the API", async () => {
    const { fetch, calls } = fakeFetch(
      json(200, message({ content: [{ type: "text", text: "{}" }] })),
    );
    await providerFromEnv(env(), { fetch })!.generate({ ...request, schema: prioritiesOutput });
    const schema = JSON.stringify(
      JSON.parse(String(calls[0]!.init.body)).output_config.format.schema,
    );
    expect(schema).toContain(
      '"enum":["do_now","schedule","unblock_first","break_down","defer","review_deadline"]',
    );
    expect(schema).toContain('"enum":["low","medium","high"]');
  });
});

describe("Anthropic adapter: failures", () => {
  it.each([
    [401, "authentication_error", "ai.auth_failed"],
    [403, "permission_error", "ai.auth_failed"],
    [404, "not_found_error", "ai.model_unavailable"],
    [400, "invalid_request_error", "ai.request_rejected"],
    [413, "request_too_large", "ai.provider_error"],
  ])("maps HTTP %i (%s) to %s without retrying", async (status, type, code) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch, calls } = fakeFetch(apiError(status, type));
    expect(await providerFromEnv(env(), { fetch })!.generate(request)).toEqual({ ok: false, code });
    expect(calls).toHaveLength(1);
  });

  it("retries a rate limit once, honouring a short retry-after, then reports it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch, calls } = fakeFetch(
      apiError(429, "rate_limit_error", { "retry-after": "0" }),
      apiError(429, "rate_limit_error", { "retry-after": "0" }),
    );
    expect(await providerFromEnv(env(), { fetch })!.generate(request)).toEqual({
      ok: false,
      code: "ai.rate_limited",
    });
    expect(calls).toHaveLength(2);
    // Only status and type are logged — never the provider's message (it may echo input).
    expect(JSON.stringify(log.mock.calls)).not.toContain("may echo input");
    expect(JSON.stringify(log.mock.calls)).toContain("rate_limit_error");
  });

  it("recovers from one server error or overload", async () => {
    for (const status of [500, 529]) {
      const { fetch, calls } = fakeFetch(
        apiError(status, status === 529 ? "overloaded_error" : "api_error", { "retry-after": "0" }),
        json(200, message()),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await providerFromEnv(env(), { fetch })!.generate(request)).ok).toBe(true);
      expect(calls).toHaveLength(2);
    }
  });

  it("aborts the request at the deadline and does not retry a timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch, calls } = fakeFetch("hang", json(200, message()));
    const started = Date.now();
    const result = await providerFromEnv(env({ AI_TIMEOUT_MS: 100 }), { fetch })!.generate(request);
    expect(result).toEqual({ ok: false, code: "ai.timeout" });
    expect(calls).toHaveLength(1);
    expect((calls[0]!.init.signal as AbortSignal).aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops when the caller aborts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetch } = fakeFetch("hang");
    const controller = new AbortController();
    const pending = providerFromEnv(env(), { fetch })!.generate({
      ...request,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: "ai.timeout" });
  });
});

describe("Anthropic adapter: responses", () => {
  const usage = { inputTokens: 1234, outputTokens: 321 };
  it.each([
    ["truncated by max_tokens", message({ stop_reason: "max_tokens" }), "ai.incomplete_output"],
    [
      "context window exceeded",
      message({ stop_reason: "model_context_window_exceeded" }),
      "ai.incomplete_output",
    ],
    [
      "only thinking, no text",
      message({ content: [{ type: "thinking", thinking: "", signature: "s" }] }),
      "ai.incomplete_output",
    ],
    ["empty text", message({ content: [{ type: "text", text: "  " }] }), "ai.incomplete_output"],
    [
      "not JSON",
      message({ content: [{ type: "text", text: "好的，以下是建议" }] }),
      "ai.malformed_output",
    ],
    [
      "refused",
      message({
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: null, explanation: null },
        content: [],
      }),
      "ai.refused",
    ],
  ])("reports %s, with the usage it cost", async (_, body, code) => {
    const { fetch } = fakeFetch(json(200, body));
    expect(await providerFromEnv(env(), { fetch })!.generate(request)).toEqual({
      ok: false,
      code,
      usage,
    });
  });

  it("returns schema-invalid JSON as raw data for the caller's strict validation", async () => {
    const { fetch } = fakeFetch(
      json(200, message({ content: [{ type: "text", text: '{"explanation":"e"}' }] })),
    );
    const result = await providerFromEnv(env(), { fetch })!.generate(request);
    expect(result.ok && outputSchemas.contributions.safeParse(result.raw).success).toBe(false);
  });
});
