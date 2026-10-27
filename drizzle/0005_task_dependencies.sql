CREATE TABLE "task_dependencies" (
	"user_id" uuid NOT NULL,
	"blocking_task_id" uuid NOT NULL,
	"blocked_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_blocking_task_id_blocked_task_id_pk" PRIMARY KEY("blocking_task_id","blocked_task_id"),
	CONSTRAINT "task_dependencies_not_self" CHECK ("task_dependencies"."blocking_task_id" <> "task_dependencies"."blocked_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocking_task_id_tasks_id_fk" FOREIGN KEY ("blocking_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_task_id_tasks_id_fk" FOREIGN KEY ("blocked_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_idx" ON "task_dependencies" USING btree ("blocked_task_id");