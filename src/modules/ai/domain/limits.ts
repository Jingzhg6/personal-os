/*
 * AI advisor (M11, ADR 0022): the model proposes, the user decides, deterministic services
 * execute. Pure definitions: no clock, no database, no provider.
 */

/** Every AI call is one of these, started by an explicit user action. */
export const aiCapabilities = [
  "review",
  "priorities",
  "goal_plan",
  "contributions",
  "automation_rule",
  "question",
] as const;
export type AiCapability = (typeof aiCapabilities)[number];

/** Hard bounds on what goes to and comes from a provider. */
export const AI_LIMITS = {
  /** A free-text question or automation request typed by the user. */
  userTextChars: 1000,
  /** The serialised context sent with one request. */
  contextChars: 24_000,
  /** Default calls per user per rolling minute, all capabilities together (AI_PER_MINUTE_LIMIT). */
  perMinute: 5,
  /** Default calls per user per rolling 24 hours (AI_DAILY_LIMIT overrides). */
  defaultDaily: 30,
  /** Default output budget per call (AI_MAX_OUTPUT_TOKENS overrides, max 16 000). */
  defaultMaxOutputTokens: 8000,
  /** Default provider timeout (AI_TIMEOUT_MS overrides). */
  defaultTimeoutMs: 60_000,
  /** An unapproved proposal expires after this long. */
  proposalTtlMs: 24 * 60 * 60_000,
  /** Proposals and analyses are deleted after this many days (documented retention). */
  retentionDays: 90,
  /** Items per list in a context (the rest is summarised as a count). */
  contextItems: { tasks: 60, projects: 20, goals: 20, attributes: 20, rules: 30 },
  /** Changes one proposal may carry. */
  changesPerProposal: 10,
} as const;

/**
 * Closed set of failure codes (i18n keys under `errors`). A failure is always shown as such:
 * the app never substitutes a made-up answer.
 */
export const aiErrorCodes = [
  "ai.not_configured",
  "ai.timeout",
  "ai.rate_limited",
  "ai.quota_exceeded",
  "ai.malformed_output",
  "ai.invalid_reference",
  "ai.refused",
  "ai.auth_failed",
  "ai.model_unavailable",
  "ai.request_rejected",
  "ai.incomplete_output",
  "ai.provider_error",
  "ai.input_too_large",
] as const;
export type AiErrorCode = (typeof aiErrorCodes)[number];

export const aiProviderIds = ["off", "anthropic", "mock"] as const;
export type AiProviderId = (typeof aiProviderIds)[number];

/** What the UI may know about the provider: never a key, URL or prompt. */
export interface AiStatus {
  available: boolean;
  /** "off": not enabled; "missing_key": a provider is chosen but its key is not set. */
  unavailableReason: "off" | "missing_key" | null;
  provider: AiProviderId;
  /** Model id (anthropic) or "mock". Null when unavailable. */
  model: string | null;
  /** True for the deterministic test provider: its output is not AI-generated. */
  simulated: boolean;
  limits: { perMinute: number; daily: number; usedToday: number };
}
