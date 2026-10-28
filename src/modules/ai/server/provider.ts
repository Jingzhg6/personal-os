import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

import type { Env } from "@/shared/config/env";

import type { AiCapability, AiErrorCode, AiProviderId } from "../domain";
import { mockGenerate } from "./mock-provider";

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
}

export type GenerateResult =
  | {
      ok: true;
      /** Unvalidated JSON. */
      raw: unknown;
      usage: { inputTokens: number | null; outputTokens: number | null };
    }
  | { ok: false; code: AiErrorCode };

export interface AiProvider {
  id: Exclude<AiProviderId, "off">;
  model: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

type AiEnv = Pick<
  Env,
  | "AI_PROVIDER"
  | "AI_API_KEY"
  | "AI_MODEL"
  | "AI_BASE_URL"
  | "AI_EFFORT"
  | "AI_TIMEOUT_MS"
  | "AI_MAX_OUTPUT_TOKENS"
>;

/** The configured provider, or null when AI is off or not configured (no key). */
export function providerFromEnv(env: AiEnv): AiProvider | null {
  if (env.AI_PROVIDER === "mock") return mockProvider;
  if (env.AI_PROVIDER === "anthropic" && env.AI_API_KEY) return anthropicProvider(env);
  return null;
}

export const mockProvider: AiProvider = {
  id: "mock",
  model: "mock",
  generate: async (request) => mockGenerate(request),
};

/** Maps SDK failures to the closed set of codes. Never logs or returns the provider's message. */
export function classifyProviderError(error: unknown): AiErrorCode {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "ai.timeout";
  if (error instanceof Anthropic.RateLimitError) return "ai.rate_limited";
  if (error instanceof Anthropic.AuthenticationError) return "ai.not_configured";
  if (error instanceof Anthropic.PermissionDeniedError) return "ai.not_configured";
  if (error instanceof Anthropic.BadRequestError) return "ai.provider_error";
  if (error instanceof Anthropic.APIError) return "ai.provider_error";
  return "ai.provider_error";
}

/**
 * Claude via the official SDK. The key, base URL and model come only from server env vars, passed
 * explicitly so that no ambient credential (ANTHROPIC_* variables, CLI profiles) is ever used.
 * One retry for transient failures; bounded time and output; structured JSON output.
 */
function anthropicProvider(env: AiEnv): AiProvider {
  const client = new Anthropic({
    apiKey: env.AI_API_KEY!,
    authToken: null,
    baseURL: env.AI_BASE_URL,
    timeout: env.AI_TIMEOUT_MS,
    maxRetries: 1,
  });
  return {
    id: "anthropic",
    model: env.AI_MODEL,
    async generate(request) {
      try {
        const response = await client.beta.messages.create({
          model: env.AI_MODEL,
          max_tokens: env.AI_MAX_OUTPUT_TOKENS,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: {
            effort: env.AI_EFFORT,
            format: zodOutputFormat(request.schema),
          },
          // A request declined by a safety classifier is retried on a fallback model chosen by
          // the API; if the whole chain declines, the result is shown as refused.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
        if (response.stop_reason === "refusal") return { ok: false, code: "ai.refused" };
        if (response.stop_reason === "max_tokens")
          return { ok: false, code: "ai.malformed_output" };
        const text = response.content.flatMap((block) =>
          block.type === "text" ? [block.text] : [],
        );
        if (text.length === 0) return { ok: false, code: "ai.malformed_output" };
        let raw: unknown;
        try {
          raw = JSON.parse(text.join(""));
        } catch {
          return { ok: false, code: "ai.malformed_output" };
        }
        return {
          ok: true,
          raw,
          usage: {
            inputTokens: response.usage.input_tokens ?? null,
            outputTokens: response.usage.output_tokens ?? null,
          },
        };
      } catch (error) {
        return { ok: false, code: classifyProviderError(error) };
      }
    },
  };
}
