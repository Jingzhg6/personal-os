CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_name_not_blank" CHECK (length(btrim("milestones"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" jsonb,
	"area_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"color" text DEFAULT 'indigo' NOT NULL,
	"start_date" date,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_valid" CHECK ("projects"."status" in ('planned', 'active', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "projects_priority_range" CHECK ("projects"."priority" between 0 and 4),
	CONSTRAINT "projects_name_not_blank" CHECK (length(btrim("projects"."name")) > 0),
	CONSTRAINT "projects_dates_ordered" CHECK ("projects"."start_date" is null or "projects"."target_date" is null or "projects"."start_date" <= "projects"."target_date")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestones_project_idx" ON "milestones" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_user_sort_idx" ON "projects" USING btree ("user_id","sort_key");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_milestone_id_idx" ON "tasks" USING btree ("milestone_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subtasks_have_no_project" CHECK ("tasks"."parent_task_id" is null or ("tasks"."project_id" is null and "tasks"."milestone_id" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_needs_project" CHECK ("tasks"."milestone_id" is null or "tasks"."project_id" is not null);