import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, timestamps } from "@/shared/db/columns";

/*
 * Automation (M10, ADR 0020). Owns rules, the event outbox, executions, their effects and the
 * minimal in-app notifications. It never stores another module's data beyond ids and the facts a
 * rule needs; actions go through the owning modules' services.
 */

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const at = (name: string) => timestamp(name, { withTimezone: true });

/** A user's rule. Configuration is validated JSON (domain schemas), never code. */
export const automationRules = pgTable(
  "automation_rules",
  {
    id: primaryId(),
    userId: userId(),
    name: text("name").notNull(),
    description: text("description"),
    /** New rules are disabled; enabling is always an explicit action. */
    enabled: boolean("enabled").notNull().default(false),
    /** When the rule was last enabled: older events never trigger it. */
    enabledAt: at("enabled_at"),
    triggerType: text("trigger_type").notNull(),
    trigger: jsonb("trigger").notNull(),
    conditions: jsonb("conditions").notNull().default([]),
    actions: jsonb("actions").notNull(),
    timeZone: text("time_zone"),
    /** Scheduled rules: the next occurrence (null when disabled or finished). */
    nextRunAt: at("next_run_at"),
    lastTriggeredAt: at("last_triggered_at"),
    archivedAt: at("archived_at"),
    ...timestamps(),
  },
  (t) => [
    unique("automation_rules_id_user_uq").on(t.id, t.userId),
    index("automation_rules_user_trigger_idx").on(t.userId, t.triggerType, t.enabled),
    index("automation_rules_due_idx").on(t.nextRunAt),
    check("automation_rules_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "automation_rules_trigger_type_valid",
      sql`${t.triggerType} in ('task.completed', 'task.status_changed', 'project.completed', 'goal.status_changed', 'finance.snapshot_saved', 'schedule')`,
    ),
    check(
      "automation_rules_enabled_not_archived",
      sql`not (${t.enabled} and ${t.archivedAt} is not null)`,
    ),
    check("automation_rules_enabled_at", sql`not ${t.enabled} or ${t.enabledAt} is not null`),
  ],
);

/**
 * Transactional outbox: a domain event worth automating, written in the same transaction as the
 * change that caused it, then processed after commit. Only written when the user has an enabled
 * rule for the event type.
 */
export const automationEvents = pgTable(
  "automation_events",
  {
    /** The domain event id. */
    id: uuid("id").primaryKey(),
    userId: userId(),
    eventType: text("event_type").notNull(),
    facts: jsonb("facts").notNull(),
    occurredAt: at("occurred_at").notNull(),
    /** 0 = caused by a person; n = caused by an automation n steps down a chain. */
    depth: integer("depth").notNull().default(0),
    /** Rules that already acted in the chain that led here (loop guard). */
    chainRuleIds: jsonb("chain_rule_ids").notNull().default([]),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    processedAt: at("processed_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("automation_events_pending_idx").on(t.status, t.createdAt),
    index("automation_events_user_idx").on(t.userId, t.status),
    check("automation_events_status_valid", sql`${t.status} in ('pending', 'processed', 'failed')`),
    check("automation_events_depth", sql`${t.depth} >= 0`),
  ],
);

/** One attempt of one rule for one trigger occurrence. Unique per (rule, trigger key). */
export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: primaryId(),
    userId: userId(),
    ruleId: uuid("rule_id").notNull(),
    triggerType: text("trigger_type").notNull(),
    /** Logical occurrence identity (domain `triggerKey`): the idempotency key. */
    triggerKey: text("trigger_key").notNull(),
    eventId: uuid("event_id"),
    scheduledFor: at("scheduled_for"),
    /** Facts the rule saw (ids, titles, counts — never balances). */
    facts: jsonb("facts").notNull(),
    /** Conditions and actions as they were when the execution started (retries reuse them). */
    ruleSnapshot: jsonb("rule_snapshot").notNull(),
    depth: integer("depth").notNull().default(0),
    chainRuleIds: jsonb("chain_rule_ids").notNull().default([]),
    status: text("status").notNull(),
    skipReason: text("skip_reason"),
    conditionResults: jsonb("condition_results").notNull().default([]),
    actionResults: jsonb("action_results").notNull().default([]),
    errorCode: text("error_code"),
    retryable: boolean("retryable").notNull().default(false),
    attempts: integer("attempts").notNull().default(1),
    /** Later deliveries of the same occurrence, ignored. */
    duplicates: integer("duplicates").notNull().default(0),
    /** Schedules: missed occurrences coalesced into (or skipped with) this one. */
    missedOccurrences: integer("missed_occurrences").notNull().default(0),
    startedAt: at("started_at").notNull().defaultNow(),
    completedAt: at("completed_at"),
  },
  (t) => [
    unique("automation_executions_rule_key_uq").on(t.ruleId, t.triggerKey),
    unique("automation_executions_id_user_uq").on(t.id, t.userId),
    foreignKey({
      columns: [t.ruleId, t.userId],
      foreignColumns: [automationRules.id, automationRules.userId],
      name: "automation_executions_rule_fk",
    }).onDelete("cascade"),
    index("automation_executions_rule_idx").on(t.ruleId, t.startedAt),
    index("automation_executions_user_idx").on(t.userId, t.status, t.startedAt),
    check(
      "automation_executions_status_valid",
      sql`${t.status} in ('running', 'succeeded', 'failed', 'partial', 'skipped')`,
    ),
    check("automation_executions_attempts", sql`${t.attempts} >= 1`),
  ],
);

/**
 * The effect of one action of one execution, written in the same transaction (savepoint) as the
 * effect itself. Its primary key makes an action run at most once, across retries and workers.
 */
export const automationEffects = pgTable(
  "automation_effects",
  {
    executionId: uuid("execution_id").notNull(),
    actionIndex: integer("action_index").notNull(),
    userId: userId(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.actionIndex] }),
    foreignKey({
      columns: [t.executionId, t.userId],
      foreignColumns: [automationExecutions.id, automationExecutions.userId],
      name: "automation_effects_execution_fk",
    }).onDelete("cascade"),
    check("automation_effects_index", sql`${t.actionIndex} >= 0 and ${t.actionIndex} < 5`),
  ],
);

/** Minimal in-app notifications created by the `notify` action (no push, e-mail or SMS). */
export const automationNotifications = pgTable(
  "automation_notifications",
  {
    id: primaryId(),
    userId: userId(),
    /** Kept when the rule is deleted. */
    ruleId: uuid("rule_id"),
    title: text("title").notNull(),
    body: text("body"),
    readAt: at("read_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("automation_notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/** Scheduler heartbeat (system-wide): the last tick of the worker endpoint. */
export const automationWorkerStatus = pgTable("automation_worker_status", {
  id: text("id").primaryKey(),
  lastTickAt: at("last_tick_at").notNull(),
  lastTickSummary: jsonb("last_tick_summary").notNull().default({}),
});
