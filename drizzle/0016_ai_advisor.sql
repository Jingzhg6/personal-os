CREATE TABLE "ai_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"request" jsonb NOT NULL,
	"analysis" jsonb NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"apply_result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proposals_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "ai_proposals_capability_valid" CHECK ("ai_proposals"."capability" in ('review', 'priorities', 'goal_plan', 'contributions', 'automation_rule', 'question')),
	CONSTRAINT "ai_proposals_status_valid" CHECK ("ai_proposals"."status" in ('analysis', 'proposed', 'applied', 'failed', 'stale', 'expired', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"input_chars" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_requests_status_valid" CHECK ("ai_requests"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_proposals_user_created_idx" ON "ai_proposals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_user_created_idx" ON "ai_requests" USING btree ("user_id","created_at");