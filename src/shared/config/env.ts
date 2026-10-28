import "server-only";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  AUTH_ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /**
   * Shared secret of the automation worker (M10). When unset, the tick endpoint is disabled and
   * scheduled rules are not run automatically (the UI says so).
   */
  AUTOMATION_WORKER_SECRET: z.string().min(32).optional(),
  /**
   * AI advisor (M11, ADR 0022). "off" (default) disables every AI feature; "anthropic" needs
   * AI_API_KEY; "mock" is the deterministic test provider (labelled 模拟 in the UI). Credentials are
   * read only here, on the server, and never sent to the browser or logged.
   */
  AI_PROVIDER: z.enum(["off", "anthropic", "mock"]).default("off"),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).max(100).default("claude-opus-5-5"),
  AI_BASE_URL: z.url().default("https://api.anthropic.com"),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(16_000).default(8_000),
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(1_000).default(30),
  AI_PER_MINUTE_LIMIT: z.coerce.number().int().min(1).max(60).default(5),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated server environment. Parsed lazily so that importing a module
 * never fails at build time; the first real access throws a readable error.
 */
export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
    }
    cached = result.data;
  }
  return cached;
}
