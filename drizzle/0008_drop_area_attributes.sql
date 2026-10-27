-- M6.1: areas no longer decide which attribute XP credits. The old area → attribute mapping and
-- the area-derived attribute table go away; their rows were copied (same ids) into
-- development_attributes as archived legacy attributes by 0007, so history stays intact.
ALTER TABLE "xp_ledger" DROP CONSTRAINT "xp_ledger_attribute_id_attributes_id_fk";--> statement-breakpoint
DROP TABLE "attribute_areas";--> statement-breakpoint
DROP TABLE "attributes";--> statement-breakpoint
ALTER TABLE "xp_ledger" ADD CONSTRAINT "xp_ledger_attribute_id_development_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."development_attributes"("id") ON DELETE restrict ON UPDATE no action;
