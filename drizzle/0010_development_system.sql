CREATE TABLE "development_focus" (
	"user_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_focus_user_id_attribute_id_pk" PRIMARY KEY("user_id","attribute_id"),
	CONSTRAINT "development_focus_position_nonnegative" CHECK ("development_focus"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "development_goal_attributes" (
	"goal_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"weight" smallint DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_goal_attributes_goal_id_attribute_id_pk" PRIMARY KEY("goal_id","attribute_id"),
	CONSTRAINT "development_goal_attributes_weight_range" CHECK ("development_goal_attributes"."weight" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "development_goal_projects" (
	"goal_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_goal_projects_goal_id_project_id_pk" PRIMARY KEY("goal_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "development_goal_tasks" (
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_goal_tasks_goal_id_task_id_pk" PRIMARY KEY("goal_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "development_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" smallint DEFAULT 2 NOT NULL,
	"target_date" date,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_goals_title_not_blank" CHECK (length(btrim("development_goals"."title")) > 0),
	CONSTRAINT "development_goals_status_valid" CHECK ("development_goals"."status" in ('active', 'paused', 'completed', 'archived')),
	CONSTRAINT "development_goals_priority_range" CHECK ("development_goals"."priority" between 1 and 3),
	CONSTRAINT "development_goals_archived_shape" CHECK (("development_goals"."status" = 'archived') = ("development_goals"."archived_at" is not null)),
	CONSTRAINT "development_goals_completed_shape" CHECK ("development_goals"."status" <> 'completed' or "development_goals"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "development_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"vision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "development_focus" ADD CONSTRAINT "development_focus_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_focus" ADD CONSTRAINT "development_focus_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_attributes" ADD CONSTRAINT "development_goal_attributes_goal_id_development_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."development_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_attributes" ADD CONSTRAINT "development_goal_attributes_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_projects" ADD CONSTRAINT "development_goal_projects_goal_id_development_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."development_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_projects" ADD CONSTRAINT "development_goal_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_tasks" ADD CONSTRAINT "development_goal_tasks_goal_id_development_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."development_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goal_tasks" ADD CONSTRAINT "development_goal_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_goals" ADD CONSTRAINT "development_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_profiles" ADD CONSTRAINT "development_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "development_goal_attributes_attribute_idx" ON "development_goal_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "development_goal_projects_project_idx" ON "development_goal_projects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "development_goal_tasks_task_idx" ON "development_goal_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "development_goals_user_idx" ON "development_goals" USING btree ("user_id","status");