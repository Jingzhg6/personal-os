CREATE TABLE "task_development_contributions" (
	"task_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"weight" smallint DEFAULT 2 NOT NULL,
	CONSTRAINT "task_development_contributions_task_id_attribute_id_pk" PRIMARY KEY("task_id","attribute_id"),
	CONSTRAINT "task_development_contributions_weight_range" CHECK ("task_development_contributions"."weight" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "development_attributes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"system_key" text,
	"name" text,
	"icon" text,
	"color" text NOT NULL,
	"on_radar" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_attributes_label_present" CHECK ("development_attributes"."system_key" is not null or length(btrim("development_attributes"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "xp_attribute_credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_attribute_credits_amount_nonzero" CHECK ("xp_attribute_credits"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "task_development_contributions" ADD CONSTRAINT "task_development_contributions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_development_contributions" ADD CONSTRAINT "task_development_contributions_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_attributes" ADD CONSTRAINT "development_attributes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_attribute_credits" ADD CONSTRAINT "xp_attribute_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_attribute_credits" ADD CONSTRAINT "xp_attribute_credits_ledger_entry_id_xp_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."xp_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_attribute_credits" ADD CONSTRAINT "xp_attribute_credits_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_development_contributions_attribute_idx" ON "task_development_contributions" USING btree ("attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "development_attributes_user_system_key_uq" ON "development_attributes" USING btree ("user_id","system_key") WHERE "development_attributes"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "development_attributes_user_sort_idx" ON "development_attributes" USING btree ("user_id","sort_key");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_attribute_credits_entry_attribute_uq" ON "xp_attribute_credits" USING btree ("ledger_entry_id","attribute_id");--> statement-breakpoint
CREATE INDEX "xp_attribute_credits_user_attribute_idx" ON "xp_attribute_credits" USING btree ("user_id","attribute_id");--> statement-breakpoint
-- XP credits are append-only like the ledger they split.
CREATE FUNCTION "xp_attribute_credits_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'xp_attribute_credits is append-only (% rejected)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "xp_attribute_credits_append_only" BEFORE UPDATE OR DELETE ON "xp_attribute_credits"
FOR EACH ROW EXECUTE FUNCTION "xp_attribute_credits_append_only"();
--> statement-breakpoint
-- M6 compatibility: the six area-derived attributes become archived legacy development
-- attributes with the SAME ids, so every historical ledger reference stays valid. They are not
-- active development attributes (archived, off the radar); users may rename or reactivate them.
INSERT INTO "development_attributes"
  ("id", "user_id", "system_key", "name", "color", "on_radar", "archived_at", "sort_key", "created_at")
SELECT a."id", a."user_id", 'legacy.' || a."system_key", a."name", a."color", false, now(),
       'z' || a."sort_key", a."created_at"
FROM "attributes" a;
--> statement-breakpoint
-- Default examples for existing accounts (new accounts: character.seedDevelopmentAttributes).
-- Values mirror `defaultDevelopmentAttributes` in the character domain.
INSERT INTO "development_attributes" ("id", "user_id", "system_key", "icon", "color", "sort_key")
SELECT gen_random_uuid(), u."id", d.system_key, d.icon, d.color, d.sort_key
FROM "users" u
CROSS JOIN (VALUES
  ('french', '🇫🇷', 'blue', 'a0'),
  ('english', '🇬🇧', 'indigo', 'a1'),
  ('reading', '📚', 'amber', 'a2'),
  ('strength', '🏋️', 'red', 'a3'),
  ('cardio', '🚴', 'green', 'a4')
) AS d(system_key, icon, color, sort_key)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Historical attribution, materialised 1:1 from what each M6 ledger row recorded. The ledger
-- itself is not touched.
INSERT INTO "xp_attribute_credits" ("id", "user_id", "ledger_entry_id", "attribute_id", "amount", "created_at")
SELECT gen_random_uuid(), l."user_id", l."id", l."attribute_id", l."amount", l."created_at"
FROM "xp_ledger" l
WHERE l."attribute_id" IS NOT NULL;
