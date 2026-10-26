-- pg_trgm powers substring search on titles and descriptions (works for Chinese text).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "task_views" (
	"user_id" uuid NOT NULL,
	"view_key" text NOT NULL,
	"area_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_views_user_id_view_key_pk" PRIMARY KEY("user_id","view_key")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description_text" text;--> statement-breakpoint
ALTER TABLE "task_views" ADD CONSTRAINT "task_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_user_deleted_idx" ON "tasks" USING btree ("user_id","deleted_at") WHERE "tasks"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tasks_description_text_trgm_idx" ON "tasks" USING gin ("description_text" gin_trgm_ops);--> statement-breakpoint
-- Backfill the plain-text copy of existing rich-text descriptions.
UPDATE "tasks" SET "description_text" = NULLIF(btrim((
  SELECT string_agg(value #>> '{}', ' ')
  FROM jsonb_path_query("tasks"."description", 'strict $.**.text') AS value
)), '')
WHERE "description" IS NOT NULL;
