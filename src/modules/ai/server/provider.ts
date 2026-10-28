import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

import type { Env } from "@/shared/config/env";

import type { AiCapability, AiErrorCode, AiProviderId } from "../domain";
import { mockGenerate } from "./mock-provider";
import { structuredOutputSchema } from "./output-schema";

/*
 * The provider boundary. A provider turns (instructions, data) into raw JSON or a closed error
 * code — it never sees the database, never runs tools, and its output is validated by the caller.
 */

export interface GenerateRequest {
  capability: AiCapability;
  /** The fixed system prompt (never sent to the browser). */
  system: string;
  /** The task description plus the <data> block. */
  prompt: string;
  /** The context object (the mock provider reads it directly; real providers get `prompt`). */
  data: unknown;
  /** Free text the user typed, if any (question, automation request, planning note). */
  userText: string | null;
  /** The JSON schema the output must follow (structured output). */
  schema: z.ZodType;
  /** Aborted when the app's deadline passes: the provider must stop (and stop billing) then. */
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export type GenerateResult =
  | {
      ok: true;
      /** Unvalidated JSON. */
      raw: unknown;
      usage: Usage;
    }
  | { ok: false; code: AiErrorCode; usage?: Usage };

export interface AiProvider {
  id: Exclude<AiProviderId, "off">;
  model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export type AiEnv = Pick<
  Env,
  | "AI_PROVIDER"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "AI_BASE_URL"
  | "AI_EFFORT"
  | "AI_TIMEOUT_MS"
  | "AI_MAX_OUTPUT_TOKENS"
>;

/** Why AI is unavailable (shown to the user without revealing configuration values). */
export function unavailableReason(env: Pick<Env, "AI_PROVIDER" | "AI_API_KEY">) {
  if (env.AI_PROVIDER === "off") return "off" as const;
  if (env.AI_PROVIDER === "anthropic" && !env.AI_API_KEY) return "missing_key" as const;
  return null;
}

/** The configured provider, or null when AI is off or not configured (no key). */
export function providerFromEnv(
  env: AiEnv,
  options: { fetch?: typeof fetch } = {},
): AiProvider | null {
  if (env.AI_PROVIDER === "mock") return mockProvider;
  if (env.AI_PROVIDER === "anthropic" && env.AI_API_KEY) return anthropicProvider(env, options);
  return null;
}

export const mockProvider: AiProvider = {
  id: "mock",
  model: "mock",
  generate: async (request) => mockGenerate(request),
};

/**
 * Maps SDK failures to the closed set of codes. Never returns the provider's message (it may echo
 * request content); only the HTTP status and error type are logged.
 */
export function classifyProviderError(error: unknown): AiErrorCode {
  if (error instanceof Anthropic.APIUserAbortError) return "ai.timeout";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "ai.timeout";
  if (error instanceof Anthropic.RateLimitError) return "ai.rate_limited";
  if (error instanceof Anthropic.AuthenticationError) return "ai.auth_failed";
  if (error instanceof Anthropic.PermissionDeniedError) return "ai.auth_failed";
  // An unknown or unavailable model id answers 404 (not_found_error).
  if (error instanceof Anthropic.NotFoundError) return "ai.model_unavailable";
  if (error instanceof Anthropic.BadRequestError) return "ai.request_rejected";
  if (error instanceof Anthropic.UnprocessableEntityError) return "ai.request_rejected";
  return "ai.provider_error";
}

/** Transient failures worth one more attempt: rate limits, overload, 5xx, lost connections. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || (typeof error.status === "number" && error.status >= 500);
  }
  return false;
}

function logFailure(error: unknown) {
  const e = error as { status?: unknown; error?: { error?: { type?: unknown } }; name?: unknown };
  console.error("ai.provider failed", {
    name: e?.name,
    status: e?.status ?? null,
    type: e?.error?.error?.type ?? null,
  });
}

/** Seconds to wait before the single retry: the server's hint, capped, else one second. */
function retryDelayMs(error: unknown): number {
  const header = (error as { headers?: Headers })?.headers?.get?.("retry-after");
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 5) * 1000 : 1000;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Claude via the official SDK. The key, base URL and model come only from server env vars, passed
 * explicitly so that no ambient credential (ANTHROPIC_* variables, CLI profiles) is ever used.
 *
 * Time and retries are bounded by the app, not the SDK: one deadline (AI_TIMEOUT_MS) covers the
 * whole call, the request is aborted when it passes, and at most one retry is made — only for
 * transient failures (429, 5xx, lost connection), never for 4xx errors or timeouts.
 */
function anthropicProvider(env: AiEnv, options: { fetch?: typeof fetch }): AiProvider {
  const client = new Anthropic({
    apiKey: env.AI_API_KEY!,
    authToken: null,
    baseURL: env.AI_BASE_URL,
    timeout: env.AI_TIMEOUT_MS,
    maxRetries: 0,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const call = (request: GenerateRequest, signal: AbortSignal) =>
    client.beta.messages.create(
      {
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          effort: env.AI_EFFORT,
          format: { type: "json_schema", schema: structuredOutputSchema(request.schema) },
        },
        // A request declined by a safety classifier is retried on a fallback model chosen by
        // the API; if the whole chain declines, the result is shown as refused.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );

  return {
    id: "anthropic",
    model: env.AI_MODEL,
    async generate(request) {
      const deadline = AbortSignal.timeout(env.AI_TIMEOUT_MS);
      const signal = request.signal ? AbortSignal.any([deadline, request.signal]) : deadline;
      let response: Awaited<ReturnType<typeof call>>;
      try {
        try {
          response = await call(request, signal);
        } catch (error) {
          if (!isRetryable(error) || signal.aborted) throw error;
          await sleep(retryDelayMs(error), signal);
          if (signal.aborted) throw error;
          response = await call(request, signal);
        }
      } catch (error) {
        logFailure(error);
        return { ok: false, code: signal.aborted ? "ai.timeout" : classifyProviderError(error) };
      }
      return readResponse(response);
    },
  };
}

interface ResponseLike {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
  usage: { input_tokens?: number | null; output_tokens?: number | null };
}

/** Turns a provider response into raw JSON, or a precise failure code. */
export function readResponse(response: ResponseLike): GenerateResult {
  const usage: Usage = {
    inputTokens: response.usage.input_tokens ?? null,
    outputTokens: response.usage.output_tokens ?? null,
  };
  if (response.stop_reason === "refusal") return { ok: false, code: "ai.refused", usage };
  // Cut off by the output budget (thinking counts against it) or the context window.
  if (
    response.stop_reason === "max_tokens" ||
    response.stop_reason === "model_context_window_exceeded"
  ) {
    return { ok: false, code: "ai.incomplete_output", usage };
  }
  const text = response.content
    .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
    .join("");
  if (text.trim() === "") return { ok: false, code: "ai.incomplete_output", usage };
  try {
    return { ok: true, raw: JSON.parse(text), usage };
  } catch {
    return { ok: false, code: "ai.malformed_output", usage };
  }
}
