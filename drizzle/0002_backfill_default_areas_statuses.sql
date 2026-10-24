-- One-time backfill for accounts created before M1. New accounts are seeded by the
-- `user.registered` event handlers (areas.seedDefaults, tasks.seedDefaultStatuses).
-- Values mirror `defaultAreas` / `defaultStatuses` in the module domains.
INSERT INTO "areas" ("id", "user_id", "system_key", "color", "icon", "sort_key")
SELECT gen_random_uuid(), u."id", d.system_key, d.color, d.icon, d.sort_key
FROM "users" u
CROSS JOIN (VALUES
  ('personal', 'pink', 'heart', 'a0'),
  ('learning', 'blue', 'graduation-cap', 'a1'),
  ('health', 'green', 'dumbbell', 'a2'),
  ('work', 'indigo', 'briefcase', 'a3'),
  ('business', 'amber', 'trending-up', 'a4'),
  ('admin', 'gray', 'clipboard', 'a5')
) AS d(system_key, color, icon, sort_key)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "task_statuses" ("id", "user_id", "system_key", "category", "color", "sort_key")
SELECT gen_random_uuid(), u."id", d.system_key, d.category, d.color, d.sort_key
FROM "users" u
CROSS JOIN (VALUES
  ('backlog', 'backlog', 'gray', 'a0'),
  ('todo', 'unstarted', 'blue', 'a1'),
  ('in_progress', 'started', 'amber', 'a2'),
  ('done', 'completed', 'green', 'a3'),
  ('cancelled', 'cancelled', 'gray', 'a4')
) AS d(system_key, category, color, sort_key)
ON CONFLICT DO NOTHING;
