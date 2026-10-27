CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"account_type" text NOT NULL,
	"asset_category" text,
	"currency_code" char(3) NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"notes" text,
	"sort_key" text COLLATE "C" NOT NULL,
	"archived_at" timestamp with time zone,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_accounts_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "finance_accounts_id_user_currency_uq" UNIQUE("id","user_id","currency_code"),
	CONSTRAINT "finance_accounts_name_not_blank" CHECK (length(btrim("finance_accounts"."name")) > 0),
	CONSTRAINT "finance_accounts_kind_valid" CHECK ("finance_accounts"."kind" in ('asset', 'liability')),
	CONSTRAINT "finance_accounts_type_valid" CHECK ("finance_accounts"."account_type" in ('current', 'savings', 'investment', 'ewallet', 'cash', 'credit_card', 'loan', 'other')),
	CONSTRAINT "finance_accounts_category_shape" CHECK (("finance_accounts"."kind" = 'asset' and "finance_accounts"."asset_category" in ('cash', 'bank_deposit', 'ewallet', 'savings', 'investment', 'other'))
       or ("finance_accounts"."kind" = 'liability' and "finance_accounts"."asset_category" is null)),
	CONSTRAINT "finance_accounts_currency_format" CHECK ("finance_accounts"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_accounts_closed_only_archived" CHECK ("finance_accounts"."closed_on" is null or "finance_accounts"."archived_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "finance_fx_defaults" (
	"user_id" uuid NOT NULL,
	"currency_code" char(3) NOT NULL,
	"base_currency" char(3) NOT NULL,
	"rate" numeric(20, 10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_fx_defaults_user_id_currency_code_base_currency_pk" PRIMARY KEY("user_id","currency_code","base_currency"),
	CONSTRAINT "finance_fx_defaults_rate_positive" CHECK ("finance_fx_defaults"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "finance_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"country" text,
	"notes" text,
	"sort_key" text COLLATE "C" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_providers_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "finance_providers_name_not_blank" CHECK (length(btrim("finance_providers"."name")) > 0),
	CONSTRAINT "finance_providers_type_valid" CHECK ("finance_providers"."provider_type" in ('bank', 'ewallet', 'cash', 'broker', 'other'))
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"base_currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_settings_base_format" CHECK ("finance_settings"."base_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "finance_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"valuation_date" date NOT NULL,
	"amount" numeric(24, 6) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"base_currency" char(3) NOT NULL,
	"fx_rate" numeric(20, 10),
	"fx_source" text,
	"base_amount" numeric(24, 6),
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_snapshots_account_date_uq" UNIQUE("account_id","valuation_date"),
	CONSTRAINT "finance_snapshots_amount_nonnegative" CHECK ("finance_snapshots"."amount" >= 0),
	CONSTRAINT "finance_snapshots_rate_positive" CHECK ("finance_snapshots"."fx_rate" is null or "finance_snapshots"."fx_rate" > 0),
	CONSTRAINT "finance_snapshots_valuation_shape" CHECK (("finance_snapshots"."fx_rate" is null and "finance_snapshots"."fx_source" is null and "finance_snapshots"."base_amount" is null)
       or ("finance_snapshots"."fx_rate" is not null and "finance_snapshots"."fx_source" in ('identity', 'manual') and "finance_snapshots"."base_amount" is not null)),
	CONSTRAINT "finance_snapshots_identity_rate" CHECK ("finance_snapshots"."currency_code" <> "finance_snapshots"."base_currency" or ("finance_snapshots"."fx_rate" = 1 and "finance_snapshots"."fx_source" = 'identity')),
	CONSTRAINT "finance_snapshots_base_format" CHECK ("finance_snapshots"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_snapshots_revision_positive" CHECK ("finance_snapshots"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_provider_fk" FOREIGN KEY ("provider_id","user_id") REFERENCES "public"."finance_providers"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_fx_defaults" ADD CONSTRAINT "finance_fx_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_providers" ADD CONSTRAINT "finance_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_snapshots" ADD CONSTRAINT "finance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_snapshots" ADD CONSTRAINT "finance_snapshots_account_fk" FOREIGN KEY ("account_id","user_id","currency_code") REFERENCES "public"."finance_accounts"("id","user_id","currency_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_accounts_provider_idx" ON "finance_accounts" USING btree ("provider_id","sort_key");--> statement-breakpoint
CREATE INDEX "finance_providers_user_idx" ON "finance_providers" USING btree ("user_id","sort_key");--> statement-breakpoint
CREATE INDEX "finance_snapshots_user_date_idx" ON "finance_snapshots" USING btree ("user_id","valuation_date");