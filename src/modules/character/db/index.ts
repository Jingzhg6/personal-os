import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/**
 * Development attributes: what the user is growing (法语, 阅读, 有氧, …). User data, not an
 * enum: seeded examples carry a `system_key` (translated label until renamed); everything else has
 * a `name`. Archived attributes keep their XP history and leave the radar.
 */
export const developmentAttributes = pgTable(
  "development_attributes",
  {
    id: primaryId(),
    userId: userId(),
    systemKey: text("system_key"),
    name: text("name"),
    /** Optional emoji shown before the name. */
    icon: text("icon"),
    color: text("color").notNull(),
    onRadar: boolean("on_radar").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("development_attributes_user_system_key_uq")
      .on(t.userId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    index("development_attributes_user_sort_idx").on(t.userId, t.sortKey),
    check(
      "development_attributes_label_present",
      sql`${t.systemKey} is not null or length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * Append-only XP ledger (a trigger rejects UPDATE and direct DELETE). Totals, levels and
 * attribute values are sums over it. Idempotency is enforced here, not only in code:
 *  - one entry per (source event, rule): a redelivered event inserts nothing;
 *  - one grant per (rule, source, cycle): a completion is granted once until it is reversed;
 *  - one reversal per grant.
 * `source_id` has no foreign key: history outlives the task, project or milestone.
 */
export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: primaryId(),
    userId: userId(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    ruleKey: text("rule_key").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    sourceEventType: text("source_event_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceTitle: text("source_title"),
    /**
     * Legacy (M6, area-derived) single attribute, kept as recorded. Not written since M6.1: the
     * attribute split of new entries lives in `xp_attribute_credits`.
     */
    attributeId: uuid("attribute_id").references(() => developmentAttributes.id, {
      onDelete: "restrict",
    }),
    /** Completion cycle of the source for this rule: 0, then +1 after each reversal. */
    cycle: integer("cycle").notNull(),
    reversalOf: uuid("reversal_of").references((): AnyPgColumn => xpLedger.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("xp_ledger_event_rule_uq").on(t.sourceEventId, t.ruleKey),
    uniqueIndex("xp_ledger_grant_uq")
      .on(t.userId, t.ruleKey, t.sourceType, t.sourceId, t.cycle)
      .where(sql`${t.kind} = 'grant'`),
    uniqueIndex("xp_ledger_reversal_uq")
      .on(t.reversalOf)
      .where(sql`${t.kind} = 'reversal'`),
    index("xp_ledger_user_created_idx").on(t.userId, t.createdAt),
    index("xp_ledger_source_idx").on(t.userId, t.sourceType, t.sourceId),
    check(
      "xp_ledger_kind_shape",
      sql`(${t.kind} = 'grant' and ${t.amount} > 0 and ${t.reversalOf} is null) or (${t.kind} = 'reversal' and ${t.amount} < 0 and ${t.reversalOf} is not null)`,
    ),
  ],
);

/**
 * Append-only split of a ledger entry's overall XP across development attributes. The credits of
 * one entry add up to at most its amount, so overall XP is never counted twice; attribute XP is
 * the sum of an attribute's credits. A reversal carries the negated credits of the grant it
 * cancels.
 */
export const xpAttributeCredits = pgTable(
  "xp_attribute_credits",
  {
    id: primaryId(),
    userId: userId(),
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => xpLedger.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => developmentAttributes.id, { onDelete: "restrict" }),
    /** Growth XP credited to the attribute (signed). */
    amount: integer("amount").notNull(),
    /**
     * Level XP produced by this growth, fixed when earned (M6.2). NULL on credits recorded before
     * M6.2: their Level XP follows `historicLevelXp` (1:1, legacy attributes 0).
     */
    levelXp: integer("level_xp"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("xp_attribute_credits_entry_attribute_uq").on(t.ledgerEntryId, t.attributeId),
    index("xp_attribute_credits_user_attribute_idx").on(t.userId, t.attributeId),
    check("xp_attribute_credits_amount_nonzero", sql`${t.amount} <> 0`),
  ],
);
