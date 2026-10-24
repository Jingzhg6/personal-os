import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

export const areas = pgTable(
  "areas",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    systemKey: text("system_key"),
    name: text("name"),
    color: text("color").notNull(),
    icon: text("icon").notNull(),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [
    index("areas_user_id_sort_idx").on(t.userId, t.sortKey),
    uniqueIndex("areas_user_system_key_uq")
      .on(t.userId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    check("areas_label_present", sql`${t.systemKey} is not null or ${t.name} is not null`),
  ],
);
