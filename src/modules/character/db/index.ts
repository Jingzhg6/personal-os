import { sql } from "drizzle-orm";
import {
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

import { areas } from "@/modules/areas/db";
import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** The character's ability dimensions (system-key pattern, like areas and statuses). */
export const attributes = pgTable(
  "attributes",
  {
    id: primaryId(),
    userId: userId(),
    systemKey: text("system_key").notNull(),
    name: text("name"),
    color: text("color").notNull(),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("attributes_user_system_key_uq").on(t.userId, t.systemKey)],
);

/** Which attribute an area's completed items credit. An unmapped area credits overall XP only. */
export const attributeAreas = pgTable(
  "attribute_areas",
  {
    areaId: uuid("area_id")
      .primaryKey()
      .references(() => areas.id, { onDelete: "cascade" }),
    userId: userId(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),
  },
  (t) => [index("attribute_areas_attribute_idx").on(t.attributeId)],
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
    attributeId: uuid("attribute_id").references(() => attributes.id, { onDelete: "set null" }),
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
