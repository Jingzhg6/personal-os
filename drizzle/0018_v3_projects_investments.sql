CREATE TABLE "finance_investment_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"account_type" text NOT NULL,
	"currency_code" char(3) NOT NULL,
	"notes" text,
	"legacy" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_investment_accounts_type_valid" CHECK ("finance_investment_accounts"."account_type" in ('brokerage', 'retirement', 'platform', 'crypto', 'other')),
	CONSTRAINT "finance_investment_accounts_currency_format" CHECK ("finance_investment_accounts"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "finance_investment_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"holding_id" uuid,
	"kind" text NOT NULL,
	"trade_date" date NOT NULL,
	"quantity" numeric(24, 8),
	"unit_price" numeric(24, 8),
	"amount" numeric(24, 6) NOT NULL,
	"fee" numeric(24, 6) DEFAULT '0' NOT NULL,
	"currency_code" char(3) NOT NULL,
	"notes" text,
	"opening" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_investment_transactions_kind_valid" CHECK ("finance_investment_transactions"."kind" in ('buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee')),
	CONSTRAINT "finance_investment_transactions_holding_fits_kind" CHECK (("finance_investment_transactions"."kind" not in ('buy', 'sell') or "finance_investment_transactions"."holding_id" is not null) and ("finance_investment_transactions"."kind" not in ('deposit', 'withdrawal') or "finance_investment_transactions"."holding_id" is null)),
	CONSTRAINT "finance_investment_transactions_sell_quantity" CHECK ("finance_investment_transactions"."kind" <> 'sell' or "finance_investment_transactions"."quantity" > 0),
	CONSTRAINT "finance_investment_transactions_amount_nonnegative" CHECK ("finance_investment_transactions"."amount" >= 0),
	CONSTRAINT "finance_investment_transactions_fee_nonnegative" CHECK ("finance_investment_transactions"."fee" >= 0),
	CONSTRAINT "finance_investment_transactions_quantity_positive" CHECK ("finance_investment_transactions"."quantity" is null or "finance_investment_transactions"."quantity" > 0),
	CONSTRAINT "finance_investment_transactions_currency_format" CHECK ("finance_investment_transactions"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "finance_investments" DROP CONSTRAINT "finance_investments_kind_valid";--> statement-breakpoint
ALTER TABLE "finance_investments" DROP CONSTRAINT "finance_investments_cost_nonnegative";--> statement-breakpoint
ALTER TABLE "finance_investments" ALTER COLUMN "cost_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_investments" ALTER COLUMN "purchase_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "nav_layout" jsonb;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD COLUMN "ticker" text;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD COLUMN "current_price" numeric(24, 8);--> statement-breakpoint
ALTER TABLE "finance_investments" ADD COLUMN "price_date" date;--> statement-breakpoint
ALTER TABLE "finance_investment_accounts" ADD CONSTRAINT "finance_investment_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investment_transactions" ADD CONSTRAINT "finance_investment_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investment_transactions" ADD CONSTRAINT "finance_investment_transactions_account_id_finance_investment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_investment_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_investment_transactions" ADD CONSTRAINT "finance_investment_transactions_holding_id_finance_investments_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."finance_investments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_investment_accounts_user_idx" ON "finance_investment_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "finance_investment_transactions_account_idx" ON "finance_investment_transactions" USING btree ("account_id","trade_date");--> statement-breakpoint
CREATE INDEX "finance_investment_transactions_holding_idx" ON "finance_investment_transactions" USING btree ("holding_id");--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_account_id_finance_investment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_investment_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_investments_account_idx" ON "finance_investments" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_price_nonnegative" CHECK ("finance_investments"."current_price" is null or "finance_investments"."current_price" >= 0);--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_kind_valid" CHECK ("finance_investments"."kind" in ('stock', 'fund', 'etf', 'bond', 'crypto', 'other'));--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_cost_nonnegative" CHECK ("finance_investments"."cost_amount" is null or "finance_investments"."cost_amount" >= 0);--> statement-breakpoint
-- V2 → V3 investments (data only; nothing is changed or removed). One "原有投资" account per user
-- and currency holds that user's V2 records; each record becomes an opening buy with its V2 cost,
-- units and date. Its V2 "current value" stays as the manual valuation.
INSERT INTO "finance_investment_accounts" ("id", "user_id", "name", "account_type", "currency_code", "legacy")
SELECT gen_random_uuid(), "user_id", '原有投资', 'other', "currency_code", true
FROM "finance_investments"
WHERE "account_id" IS NULL
GROUP BY "user_id", "currency_code";--> statement-breakpoint
UPDATE "finance_investments" h
SET "account_id" = a."id"
FROM "finance_investment_accounts" a
WHERE h."account_id" IS NULL AND a."legacy" AND a."user_id" = h."user_id" AND a."currency_code" = h."currency_code";--> statement-breakpoint
INSERT INTO "finance_investment_transactions"
  ("id", "user_id", "account_id", "holding_id", "kind", "trade_date", "quantity", "unit_price", "amount", "fee", "currency_code", "opening")
SELECT gen_random_uuid(), h."user_id", h."account_id", h."id", 'buy', h."purchase_date", h."quantity",
  CASE WHEN h."quantity" > 0 THEN round(h."cost_amount" / h."quantity", 8) END,
  h."cost_amount", 0, h."currency_code", true
FROM "finance_investments" h
WHERE h."cost_amount" IS NOT NULL AND h."purchase_date" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "finance_investment_transactions" x WHERE x."holding_id" = h."id");
