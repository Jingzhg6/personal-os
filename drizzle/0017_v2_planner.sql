CREATE TABLE "finance_investments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cost_amount" numeric(24, 6) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"purchase_date" date NOT NULL,
	"quantity" numeric(24, 8),
	"current_value" numeric(24, 6),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_investments_kind_valid" CHECK ("finance_investments"."kind" in ('stock', 'fund', 'etf', 'other')),
	CONSTRAINT "finance_investments_cost_nonnegative" CHECK ("finance_investments"."cost_amount" >= 0),
	CONSTRAINT "finance_investments_value_nonnegative" CHECK ("finance_investments"."current_value" is null or "finance_investments"."current_value" >= 0),
	CONSTRAINT "finance_investments_quantity_positive" CHECK ("finance_investments"."quantity" is null or "finance_investments"."quantity" > 0),
	CONSTRAINT "finance_investments_currency_format" CHECK ("finance_investments"."currency_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_end_after_start" CHECK ("schedule_blocks"."end_at" > "schedule_blocks"."start_at")
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "dashboard_panels" text[];--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_investments" ADD CONSTRAINT "finance_investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_investments_user_date_idx" ON "finance_investments" USING btree ("user_id","purchase_date");--> statement-breakpoint
CREATE INDEX "schedule_blocks_user_start_idx" ON "schedule_blocks" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "schedule_blocks_task_idx" ON "schedule_blocks" USING btree ("task_id");