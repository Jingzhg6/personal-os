ALTER TABLE "tasks" ADD COLUMN "planned_at_inferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Mark the planning times back-filled by migration 0014 ("planned_at" = "created_at" for every
-- deadline that existed before M10.5). Since M10.5 the app records "planned_at" when a deadline is
-- set, independently of the row's creation time. Marked rows keep their value (history unchanged)
-- but no longer count as planned for 自制力.
UPDATE "tasks" SET "planned_at_inferred" = true
WHERE "planned_at" IS NOT NULL AND "planned_at" = "created_at";
