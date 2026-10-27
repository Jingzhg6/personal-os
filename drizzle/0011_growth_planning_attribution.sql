CREATE TABLE "development_goal_allocations" (
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"share" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_goal_allocations_goal_id_task_id_attribute_id_pk" PRIMARY KEY("goal_id","task_id","attribute_id"),
	CONSTRAINT "development_goal_allocations_share_range" CHECK ("development_goal_allocations"."share" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "development_plan_tasks" (
	"plan_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_plan_tasks_plan_id_task_id_pk" PRIMARY KEY("plan_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "development_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_plans_id_goal_uq" UNIQUE("id","goal_id"),
	CONSTRAINT "development_plans_title_not_blank" CHECK (length(btrim("development_plans"."title")) > 0),
	CONSTRAINT "development_plans_status_valid" CHECK ("development_plans"."status" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "development_plans_archived_shape" CHECK (("development_plans"."status" = 'archived') = ("development_plans"."archived_at" is not null)),
	CONSTRAINT "development_plans_completed_shape" CHECK ("development_plans"."status" <> 'completed' or "development_plans"."completed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "development_goal_allocations" ADD CONSTRAINT "development_goal_allocations_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_allocations" ADD CONSTRAINT "development_goal_allocations_link_fk" FOREIGN KEY ("goal_id","task_id") REFERENCES "public"."development_goal_tasks"("goal_id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_tasks" ADD CONSTRAINT "development_plan_tasks_plan_fk" FOREIGN KEY ("plan_id","goal_id") REFERENCES "public"."development_plans"("id","goal_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plan_tasks" ADD CONSTRAINT "development_plan_tasks_link_fk" FOREIGN KEY ("goal_id","task_id") REFERENCES "public"."development_goal_tasks"("goal_id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_goal_id_development_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."development_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "development_goal_allocations_task_idx" ON "development_goal_allocations" USING btree ("task_id","attribute_id");--> statement-breakpoint
CREATE INDEX "development_plan_tasks_task_idx" ON "development_plan_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "development_plans_goal_idx" ON "development_plans" USING btree ("goal_id","sort_key");--> statement-breakpoint
-- Allocation, not duplication: the shares of one (task, attribute) across all goals never exceed
-- 100 %. Serialized per task so two concurrent writes cannot both pass the check.
CREATE FUNCTION "development_goal_allocations_total"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('allocation:' || NEW.task_id::text));
  SELECT coalesce(sum(share), 0) INTO total
    FROM development_goal_allocations
   WHERE task_id = NEW.task_id
     AND attribute_id = NEW.attribute_id
     AND goal_id <> NEW.goal_id;
  IF total + NEW.share > 100 THEN
    RAISE EXCEPTION 'allocation of task % attribute % exceeds 100%%', NEW.task_id, NEW.attribute_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'development_goal_allocations_total';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "development_goal_allocations_total"
  BEFORE INSERT OR UPDATE ON "development_goal_allocations"
  FOR EACH ROW EXECUTE FUNCTION "development_goal_allocations_total"();
--> statement-breakpoint
-- History (ADR 0018): a task linked to exactly one goal attributes 100 % of its growth in the
-- goal's attributes to that goal — those it contributes to now or was credited for in the past.
-- Tasks linked to several goals stay unallocated ("未分配") until the user decides.
INSERT INTO "development_goal_allocations" ("goal_id", "task_id", "attribute_id", "share")
SELECT DISTINCT gt.goal_id, gt.task_id, ga.attribute_id, 100
  FROM "development_goal_tasks" gt
  JOIN "development_goal_attributes" ga ON ga.goal_id = gt.goal_id
 WHERE (SELECT count(*) FROM "development_goal_tasks" other WHERE other.task_id = gt.task_id) = 1
   AND (
     EXISTS (SELECT 1 FROM "task_development_contributions" c
              WHERE c.task_id = gt.task_id AND c.attribute_id = ga.attribute_id)
     OR EXISTS (SELECT 1 FROM "xp_attribute_credits" cr
                  JOIN "xp_ledger" l ON l.id = cr.ledger_entry_id
                 WHERE l.source_type = 'task' AND l.source_id = gt.task_id
                   AND cr.attribute_id = ga.attribute_id)
   );
