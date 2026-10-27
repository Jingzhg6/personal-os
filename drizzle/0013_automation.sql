CREATE TABLE "automation_effects" (
	"execution_id" uuid NOT NULL,
	"action_index" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_effects_execution_id_action_index_pk" PRIMARY KEY("execution_id","action_index"),
	CONSTRAINT "automation_effects_index" CHECK ("automation_effects"."action_index" >= 0 and "automation_effects"."action_index" < 5)
);
--> statement-breakpoint
CREATE TABLE "automation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"facts" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"chain_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_events_status_valid" CHECK ("automation_events"."status" in ('pending', 'processed', 'failed')),
	CONSTRAINT "automation_events_depth" CHECK ("automation_events"."depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "automation_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_key" text NOT NULL,
	"event_id" uuid,
	"scheduled_for" timestamp with time zone,
	"facts" jsonb NOT NULL,
	"rule_snapshot" jsonb NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"chain_rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"condition_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"missed_occurrences" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "automation_executions_rule_key_uq" UNIQUE("rule_id","trigger_key"),
	CONSTRAINT "automation_executions_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "automation_executions_status_valid" CHECK ("automation_executions"."status" in ('running', 'succeeded', 'failed', 'partial', 'skipped')),
	CONSTRAINT "automation_executions_attempts" CHECK ("automation_executions"."attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "automation_notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"trigger_type" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"time_zone" text,
	"next_run_at" timestamp with time zone,
	"last_triggered_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "automation_rules_name_not_blank" CHECK (length(btrim("automation_rules"."name")) > 0),
	CONSTRAINT "automation_rules_trigger_type_valid" CHECK ("automation_rules"."trigger_type" in ('task.completed', 'task.status_changed', 'project.completed', 'goal.status_changed', 'finance.snapshot_saved', 'schedule')),
	CONSTRAINT "automation_rules_enabled_not_archived" CHECK (not ("automation_rules"."enabled" and "automation_rules"."archived_at" is not null)),
	CONSTRAINT "automation_rules_enabled_at" CHECK (not "automation_rules"."enabled" or "automation_rules"."enabled_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "automation_worker_status" (
	"id" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL,
	"last_tick_summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_effects" ADD CONSTRAINT "automation_effects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_effects" ADD CONSTRAINT "automation_effects_execution_fk" FOREIGN KEY ("execution_id","user_id") REFERENCES "public"."automation_executions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_rule_fk" FOREIGN KEY ("rule_id","user_id") REFERENCES "public"."automation_rules"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_events_pending_idx" ON "automation_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "automation_events_user_idx" ON "automation_events" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "automation_executions_rule_idx" ON "automation_executions" USING btree ("rule_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_executions_user_idx" ON "automation_executions" USING btree ("user_id","status","started_at");--> statement-breakpoint
CREATE INDEX "automation_notifications_user_idx" ON "automation_notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_user_trigger_idx" ON "automation_rules" USING btree ("user_id","trigger_type","enabled");--> statement-breakpoint
CREATE INDEX "automation_rules_due_idx" ON "automation_rules" USING btree ("next_run_at");