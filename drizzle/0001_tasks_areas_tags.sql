CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"system_key" text,
	"name" text,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "areas_label_present" CHECK ("areas"."system_key" is not null or "areas"."name" is not null)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"system_key" text,
	"name" text,
	"category" text NOT NULL,
	"color" text NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_statuses_category_valid" CHECK ("task_statuses"."category" in ('backlog', 'unstarted', 'started', 'completed', 'cancelled')),
	CONSTRAINT "task_statuses_label_present" CHECK ("task_statuses"."system_key" is not null or "task_statuses"."name" is not null)
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"area_id" uuid,
	"parent_task_id" uuid,
	"status_id" uuid NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"is_urgent" boolean,
	"is_important" boolean,
	"start_date" date,
	"due_date" date,
	"due_time" time,
	"estimated_minutes" integer,
	"sort_key" text COLLATE "C" NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("tasks"."title")) > 0),
	CONSTRAINT "tasks_priority_range" CHECK ("tasks"."priority" between 0 and 4),
	CONSTRAINT "tasks_estimate_positive" CHECK ("tasks"."estimated_minutes" is null or "tasks"."estimated_minutes" > 0),
	CONSTRAINT "tasks_due_time_needs_date" CHECK ("tasks"."due_time" is null or "tasks"."due_date" is not null),
	CONSTRAINT "tasks_not_own_parent" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id")
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_statuses" ADD CONSTRAINT "task_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_task_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."task_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_user_id_sort_idx" ON "areas" USING btree ("user_id","sort_key");--> statement-breakpoint
CREATE UNIQUE INDEX "areas_user_system_key_uq" ON "areas" USING btree ("user_id","system_key") WHERE "areas"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_uq" ON "tags" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_statuses_user_id_idx" ON "task_statuses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_statuses_user_system_key_uq" ON "task_statuses" USING btree ("user_id","system_key") WHERE "task_statuses"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "task_tags_tag_id_idx" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tasks_user_active_idx" ON "tasks" USING btree ("user_id","sort_key") WHERE "tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "tasks_user_due_date_idx" ON "tasks" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_status_id_idx" ON "tasks" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "tasks_area_id_idx" ON "tasks" USING btree ("area_id");