CREATE TABLE "task_recurrences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"rrule" text NOT NULL,
	"mode" text NOT NULL,
	"timezone" text NOT NULL,
	"next_due_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recurrences_mode_valid" CHECK ("task_recurrences"."mode" in ('fixed', 'after_completion'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "recurrence_index" integer;--> statement-breakpoint
ALTER TABLE "task_recurrences" ADD CONSTRAINT "task_recurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_recurrences_user_id_idx" ON "task_recurrences" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_id_task_recurrences_id_fk" FOREIGN KEY ("recurrence_id") REFERENCES "public"."task_recurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurrence_index_uq" ON "tasks" USING btree ("recurrence_id","recurrence_index");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_pair" CHECK (("tasks"."recurrence_id" is null) = ("tasks"."recurrence_index" is null));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_top_level" CHECK ("tasks"."recurrence_id" is null or "tasks"."parent_task_id" is null);