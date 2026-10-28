CREATE TABLE "discipline_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_title" text NOT NULL,
	"seq" integer NOT NULL,
	"reason" text NOT NULL,
	"outcome" text NOT NULL,
	"points" integer NOT NULL,
	"net_after" integer NOT NULL,
	"source_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discipline_ledger_points_nonzero" CHECK ("discipline_ledger"."points" <> 0),
	CONSTRAINT "discipline_ledger_seq_positive" CHECK ("discipline_ledger"."seq" >= 1),
	CONSTRAINT "discipline_ledger_points_fixed" CHECK ("discipline_ledger"."points" between -20 and 20 and "discipline_ledger"."net_after" in (-5, -3, 0, 3, 10, 15)),
	CONSTRAINT "discipline_ledger_outcome_valid" CHECK ("discipline_ledger"."outcome" in ('none', 'early', 'on_time', 'late', 'overdue', 'failed', 'cancelled')),
	CONSTRAINT "discipline_ledger_reason_valid" CHECK ("discipline_ledger"."reason" in ('completed_early', 'completed_on_time', 'completed_late', 'overdue', 'failed', 'cancelled', 'reopened', 'not_eligible'))
);
--> statement-breakpoint
ALTER TABLE "task_statuses" DROP CONSTRAINT "task_statuses_category_valid";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "planned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discipline_ledger" ADD CONSTRAINT "discipline_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_ledger" ADD CONSTRAINT "discipline_ledger_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discipline_ledger_task_seq_uq" ON "discipline_ledger" USING btree ("task_id","seq");--> statement-breakpoint
CREATE INDEX "discipline_ledger_user_created_idx" ON "discipline_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "discipline_ledger_user_task_idx" ON "discipline_ledger" USING btree ("user_id","task_id");--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_category_valid" CHECK ("task_statuses"."category" in ('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'failed'));--> statement-breakpoint
ALTER TABLE "development_attributes" ADD CONSTRAINT "development_attributes_discipline_fixed" CHECK ("development_attributes"."system_key" is distinct from 'discipline' or ("development_attributes"."name" is null and "development_attributes"."archived_at" is null));--> statement-breakpoint
-- 自制力 history is append-only: no UPDATE, no direct DELETE. Rows only disappear through the
-- cascade when their user is deleted (fired from a foreign-key trigger, so depth > 1).
CREATE FUNCTION "discipline_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'discipline_ledger is append-only (% rejected)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "discipline_ledger_append_only" BEFORE UPDATE OR DELETE ON "discipline_ledger"
FOR EACH ROW EXECUTE FUNCTION "discipline_ledger_append_only"();
--> statement-breakpoint
-- Backfill for existing accounts (new ones are seeded at registration). Idempotent through the
-- partial unique (user_id, system_key) indexes.
-- 1. The "failed" status (the only status of the new category, so any valid sort key works).
INSERT INTO "task_statuses" ("id", "user_id", "system_key", "category", "color", "sort_key")
SELECT gen_random_uuid(), u."id", 'failed', 'failed', 'red', 'a0' FROM "users" u
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2. The fixed 自制力 attribute, placed after the user's last attribute (appending a character to
-- the largest fractional-index key yields a valid, larger key).
INSERT INTO "development_attributes" ("id", "user_id", "system_key", "icon", "color", "sort_key")
SELECT gen_random_uuid(), u."id", 'discipline', '🎯', 'violet',
  COALESCE((SELECT max(a."sort_key" COLLATE "C") FROM "development_attributes" a WHERE a."user_id" = u."id") || 'V', 'a0')
FROM "users" u
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 3. Planning time of existing deadlines: unknown before M10.5; the task's creation time is the
-- best available (documented approximation in ADR 0021).
UPDATE "tasks" SET "planned_at" = "created_at" WHERE "due_date" IS NOT NULL AND "planned_at" IS NULL;
