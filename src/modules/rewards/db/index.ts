import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, timestamps } from "@/shared/db/columns";

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/**
 * A real-world reward the user defines and prices. The price is a value in purchasing units
 * (see REWARD_XP_RATES), payable with Active XP and/or Level XP as the reward allows; the Active
 * and Level XP costs are derived from it, so they can never disagree.
 */
export const rewards = pgTable(
  "rewards",
  {
    id: primaryId(),
    userId: userId(),
    name: text("name").notNull(),
    description: text("description"),
    emoji: text("emoji"),
    category: text("category").notNull().default("other"),
    value: integer("value").notNull(),
    payWithActive: boolean("pay_with_active").notNull().default(true),
    payWithLevel: boolean("pay_with_level").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    repeatable: boolean("repeatable").notNull().default(true),
    /** Total redemptions allowed (null: unlimited when repeatable). */
    maxRedemptions: integer("max_redemptions"),
    /** What it costs in real life, for the user's reference (cents, no currency). */
    realWorldCostCents: integer("real_world_cost_cents"),
    ...timestamps(),
  },
  (t) => [
    index("rewards_user_idx").on(t.userId, t.createdAt),
    check("rewards_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("rewards_value_positive", sql`${t.value} > 0`),
    check("rewards_payable", sql`${t.payWithActive} or ${t.payWithLevel}`),
    check(
      "rewards_max_redemptions_positive",
      sql`${t.maxRedemptions} is null or ${t.maxRedemptions} > 0`,
    ),
    check(
      "rewards_real_cost_nonnegative",
      sql`${t.realWorldCostCents} is null or ${t.realWorldCostCents} >= 0`,
    ),
  ],
);

/** A reward unlocked by reaching a character level (claimable once). */
export const levelRewards = pgTable(
  "level_rewards",
  {
    id: primaryId(),
    userId: userId(),
    level: integer("level").notNull(),
    /** Seeded examples: translated label until renamed. */
    systemKey: text("system_key"),
    name: text("name"),
    emoji: text("emoji"),
    description: text("description"),
    realWorldCostCents: integer("real_world_cost_cents"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("level_rewards_user_level_uq").on(t.userId, t.level),
    check("level_rewards_level_min", sql`${t.level} >= 2`),
    check(
      "level_rewards_label_present",
      sql`${t.systemKey} is not null or length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * Append-only record of spending (a trigger rejects UPDATE and direct DELETE). Spendable
 * balances are lifetime XP minus what this ledger spent; lifetime XP is never touched.
 *  - reward_redeemed:          a store reward bought with Active and/or Level XP
 *  - reward_refunded:          reserved — a refund of one redemption (negative amounts)
 *  - milestone_reward_claimed: a level reward claimed, free or early (paid with Level XP)
 */
export const rewardLedger = pgTable(
  "reward_ledger",
  {
    id: primaryId(),
    userId: userId(),
    kind: text("kind").notNull(),
    rewardId: uuid("reward_id").references(() => rewards.id, { onDelete: "restrict" }),
    levelRewardId: uuid("level_reward_id").references(() => levelRewards.id, {
      onDelete: "restrict",
    }),
    /**
     * Name and emoji when spent, so editing a reward never rewrites history. A seeded level reward
     * that was never renamed has no name: its stable key is kept in `title_key` instead.
     */
    title: text("title"),
    titleKey: text("title_key"),
    emoji: text("emoji"),
    activeXpSpent: integer("active_xp_spent").notNull().default(0),
    levelXpSpent: integer("level_xp_spent").notNull().default(0),
    /** Purchasing units paid (store) — 0 for claims. */
    purchaseValue: integer("purchase_value").notNull().default(0),
    /** Level rewards: claimed before reaching the level. */
    early: boolean("early").notNull().default(false),
    /** Level rewards: the character level when claimed. */
    levelAtClaim: integer("level_at_claim"),
    /** Client-generated key: retrying the same request never spends twice. */
    idempotencyKey: uuid("idempotency_key"),
    refundOf: uuid("refund_of").references((): AnyPgColumn => rewardLedger.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reward_ledger_user_created_idx").on(t.userId, t.createdAt),
    index("reward_ledger_reward_idx").on(t.rewardId),
    uniqueIndex("reward_ledger_idempotency_uq")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex("reward_ledger_level_claim_uq")
      .on(t.levelRewardId)
      .where(sql`${t.kind} = 'milestone_reward_claimed'`),
    uniqueIndex("reward_ledger_refund_uq")
      .on(t.refundOf)
      .where(sql`${t.kind} = 'reward_refunded'`),
    check("reward_ledger_title_present", sql`${t.title} is not null or ${t.titleKey} is not null`),
    check(
      "reward_ledger_kind_shape",
      sql`(${t.kind} = 'reward_redeemed' and ${t.rewardId} is not null and ${t.activeXpSpent} >= 0 and ${t.levelXpSpent} >= 0 and ${t.activeXpSpent} + ${t.levelXpSpent} > 0)
       or (${t.kind} = 'reward_refunded' and ${t.refundOf} is not null and ${t.activeXpSpent} <= 0 and ${t.levelXpSpent} <= 0)
       or (${t.kind} = 'milestone_reward_claimed' and ${t.levelRewardId} is not null and ${t.activeXpSpent} = 0 and ${t.levelXpSpent} >= 0 and (${t.early} or ${t.levelXpSpent} = 0))`,
    ),
  ],
);
