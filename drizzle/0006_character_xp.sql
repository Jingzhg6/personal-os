CREATE TABLE "attribute_areas" (
	"area_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"system_key" text NOT NULL,
	"name" text,
	"color" text NOT NULL,
	"sort_key" text COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"rule_key" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"source_event_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_title" text,
	"attribute_id" uuid,
	"cycle" integer NOT NULL,
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_kind_shape" CHECK (("xp_ledger"."kind" = 'grant' and "xp_ledger"."amount" > 0 and "xp_ledger"."reversal_of" is null) or ("xp_ledger"."kind" = 'reversal' and "xp_ledger"."amount" < 0 and "xp_ledger"."reversal_of" is not null))
);
--> statement-breakpoint
ALTER TABLE "attribute_areas" ADD CONSTRAINT "attribute_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_areas" ADD CONSTRAINT "attribute_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_areas" ADD CONSTRAINT "attribute_areas_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_reversal_of_xp_ledger_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."xp_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attribute_areas_attribute_idx" ON "attribute_areas" USING btree ("attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_user_system_key_uq" ON "attributes" USING btree ("user_id","system_key");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_event_rule_uq" ON "xp_ledger" USING btree ("source_event_id","rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_grant_uq" ON "xp_ledger" USING btree ("user_id","rule_key","source_type","source_id","cycle") WHERE "xp_ledger"."kind" = 'grant';--> statement-breakpoint
CREATE UNIQUE INDEX "xp_ledger_reversal_uq" ON "xp_ledger" USING btree ("reversal_of") WHERE "xp_ledger"."kind" = 'reversal';--> statement-breakpoint
CREATE INDEX "xp_ledger_user_created_idx" ON "xp_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "xp_ledger_source_idx" ON "xp_ledger" USING btree ("user_id","source_type","source_id");--> statement-breakpoint
-- The XP ledger is append-only: no UPDATE, no direct DELETE. Rows only disappear through the
-- cascade when their user is deleted (fired from a foreign-key trigger, so depth > 1).
CREATE FUNCTION "xp_ledger_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'xp_ledger is append-only (% rejected)', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "xp_ledger_append_only" BEFORE UPDATE OR DELETE ON "xp_ledger"
FOR EACH ROW EXECUTE FUNCTION "xp_ledger_append_only"();
--> statement-breakpoint
-- One-time backfill for accounts created before M6. New accounts are seeded by the
-- `user.registered` handler (character.seedAttributes). Values mirror `defaultAttributes` and
-- `defaultAttributeForArea` in the character domain. No XP is backfilled: XP starts with M6.
INSERT INTO "attributes" ("id", "user_id", "system_key", "color", "sort_key")
SELECT gen_random_uuid(), u."id", d.system_key, d.color, d.sort_key
FROM "users" u
CROSS JOIN (VALUES
  ('learning', 'blue', 'a0'),
  ('work', 'indigo', 'a1'),
  ('fitness', 'green', 'a2'),
  ('business', 'amber', 'a3'),
  ('admin', 'gray', 'a4'),
  ('life', 'pink', 'a5')
) AS d(system_key, color, sort_key)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "attribute_areas" ("area_id", "user_id", "attribute_id")
SELECT ar."id", ar."user_id", at."id"
FROM "areas" ar
JOIN (VALUES
  ('learning', 'learning'),
  ('work', 'work'),
  ('health', 'fitness'),
  ('business', 'business'),
  ('admin', 'admin'),
  ('personal', 'life')
) AS m(area_key, attribute_key) ON m.area_key = ar."system_key"
JOIN "attributes" at ON at."user_id" = ar."user_id" AND at."system_key" = m.attribute_key
ON CONFLICT DO NOTHING;
