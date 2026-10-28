import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, timestamps } from "@/shared/db/columns";

/*
 * AI advisor (M11, ADR 0022). Owns proposals and per-call metadata. It stores ids of other
 * modules' entities and the versions it saw, never copies of their tables; approved changes are
 * executed by the owning modules' services.
 */

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One generated analysis or proposal. Deleted by the user, or after the retention period. */
export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: primaryId(),
    userId: userId(),
    capability: text("capability").notNull(),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** The validated request (capability and its input), so a stale proposal can be regenerated. */
    request: jsonb("request").notNull(),
    /** What the user saw: validated model output plus app-computed facts (plain data). */
    analysis: jsonb("analysis").notNull(),
    /** The operations an approval would run (validated `proposalChange` items). */
    items: jsonb("items").notNull().default([]),
    /** Entities the proposal was based on, with the `updatedAt` it saw. */
    sourceRefs: jsonb("source_refs").notNull().default([]),
    labels: jsonb("labels").notNull().default({}),
    expiresAt: at("expires_at"),
    decidedAt: at("decided_at"),
    applyResult: jsonb("apply_result"),
    errorCode: text("error_code"),
    ...timestamps(),
  },
  (t) => [
    unique("ai_proposals_id_user_uq").on(t.id, t.userId),
    index("ai_proposals_user_created_idx").on(t.userId, t.createdAt),
    check(
      "ai_proposals_capability_valid",
      sql`${t.capability} in ('review', 'priorities', 'goal_plan', 'contributions', 'automation_rule', 'question')`,
    ),
    check(
      "ai_proposals_status_valid",
      sql`${t.status} in ('analysis', 'proposed', 'applied', 'failed', 'stale', 'expired', 'discarded')`,
    ),
  ],
);

/**
 * One provider call: metadata only (no prompt, no output, no personal data). Used for rate limits
 * and to show usage; deleted with the account or after the retention period.
 */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: primaryId(),
    userId: userId(),
    capability: text("capability").notNull(),
    provider: text("provider").notNull(),
    /** running → succeeded | failed. */
    status: text("status").notNull(),
    errorCode: text("error_code"),
    inputChars: integer("input_chars").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ai_requests_user_created_idx").on(t.userId, t.createdAt),
    check("ai_requests_status_valid", sql`${t.status} in ('running', 'succeeded', 'failed')`),
  ],
);
