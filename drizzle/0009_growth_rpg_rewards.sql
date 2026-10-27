CREATE TABLE "level_rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"system_key" text,
	"name" text,
	"emoji" text,
	"description" text,
	"real_world_cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "level_rewards_level_min" CHECK ("level_rewards"."level" >= 2),
	CONSTRAINT "level_rewards_label_present" CHECK ("level_rewards"."system_key" is not null or length(btrim("level_rewards"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reward_id" uuid,
	"level_reward_id" uuid,
	"title" text,
	"title_key" text,
	"emoji" text,
	"active_xp_spent" integer DEFAULT 0 NOT NULL,
	"level_xp_spent" integer DEFAULT 0 NOT NULL,
	"purchase_value" integer DEFAULT 0 NOT NULL,
	"early" boolean DEFAULT false NOT NULL,
	"level_at_claim" integer,
	"idempotency_key" uuid,
	"refund_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_ledger_title_present" CHECK ("reward_ledger"."title" is not null or "reward_ledger"."title_key" is not null),
	CONSTRAINT "reward_ledger_kind_shape" CHECK (("reward_ledger"."kind" = 'reward_redeemed' and "reward_ledger"."reward_id" is not null and "reward_ledger"."active_xp_spent" >= 0 and "reward_ledger"."level_xp_spent" >= 0 and "reward_ledger"."active_xp_spent" + "reward_ledger"."level_xp_spent" > 0)
       or ("reward_ledger"."kind" = 'reward_refunded' and "reward_ledger"."refund_of" is not null and "reward_ledger"."active_xp_spent" <= 0 and "reward_ledger"."level_xp_spent" <= 0)
       or ("reward_ledger"."kind" = 'milestone_reward_claimed' and "reward_ledger"."level_reward_id" is not null and "reward_ledger"."active_xp_spent" = 0 and "reward_ledger"."level_xp_spent" >= 0 and ("reward_ledger"."early" or "reward_ledger"."level_xp_spent" = 0)))
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text,
	"category" text DEFAULT 'other' NOT NULL,
	"value" integer NOT NULL,
	"pay_with_active" boolean DEFAULT true NOT NULL,
	"pay_with_level" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"repeatable" boolean DEFAULT true NOT NULL,
	"max_redemptions" integer,
	"real_world_cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_name_not_blank" CHECK (length(btrim("rewards"."name")) > 0),
	CONSTRAINT "rewards_value_positive" CHECK ("rewards"."value" > 0),
	CONSTRAINT "rewards_payable" CHECK ("rewards"."pay_with_active" or "rewards"."pay_with_level"),
	CONSTRAINT "rewards_max_redemptions_positive" CHECK ("rewards"."max_redemptions" is null or "rewards"."max_redemptions" > 0),
	CONSTRAINT "rewards_real_cost_nonnegative" CHECK ("rewards"."real_world_cost_cents" is null or "rewards"."real_world_cost_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "xp_attribute_credits" ADD COLUMN "level_xp" integer;--> statement-breakpoint
ALTER TABLE "level_rewards" ADD CONSTRAINT "level_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_level_reward_id_level_rewards_id_fk" FOREIGN KEY ("level_reward_id") REFERENCES "public"."level_rewards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_refund_of_reward_ledger_id_fk" FOREIGN KEY ("refund_of") REFERENCES "public"."reward_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "level_rewards_user_level_uq" ON "level_rewards" USING btree ("user_id","level");--> statement-breakpoint
CREATE INDEX "reward_ledger_user_created_idx" ON "reward_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reward_ledger_reward_idx" ON "reward_ledger" USING btree ("reward_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_ledger_idempotency_uq" ON "reward_ledger" USING btree ("user_id","idempotency_key") WHERE "reward_ledger"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_ledger_level_claim_uq" ON "reward_ledger" USING btree ("level_reward_id") WHERE "reward_ledger"."kind" = 'milestone_reward_claimed';--> statement-breakpoint
CREATE UNIQUE INDEX "reward_ledger_refund_uq" ON "reward_ledger" USING btree ("refund_of") WHERE "reward_ledger"."kind" = 'reward_refunded';--> statement-breakpoint
CREATE INDEX "rewards_user_idx" ON "rewards" USING btree ("user_id","created_at");
--> statement-breakpoint
-- Spending is append-only like the XP ledger.
CREATE FUNCTION "reward_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'reward_ledger is append-only (% rejected)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "reward_ledger_append_only" BEFORE UPDATE OR DELETE ON "reward_ledger"
FOR EACH ROW EXECUTE FUNCTION "reward_ledger_append_only"();
--> statement-breakpoint
-- Example level rewards for existing accounts (new accounts: rewards.seedLevelRewards). Values
-- mirror `defaultLevelRewards` in the rewards domain. `xp_attribute_credits.level_xp` is added
-- NULL for existing rows on purpose: history is not rewritten (see historicLevelXp).
INSERT INTO "level_rewards" ("id", "user_id", "level", "system_key", "emoji")
SELECT gen_random_uuid(), u."id", d.level, d.system_key, d.emoji
FROM "users" u
CROSS JOIN (VALUES
  (5, 'bubble_tea', '🧋'),
  (10, 'favourite_meal', '🍜'),
  (20, 'weekend_trip', '🏨'),
  (30, 'europe_trip', '✈️')
) AS d(level, system_key, emoji)
ON CONFLICT DO NOTHING;
