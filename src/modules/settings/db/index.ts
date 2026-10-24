import { pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { timestamps } from "@/shared/db/columns";

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Stable locale identifier ("zh-CN" | "en" | "fr"). UI language only, never content. */
  locale: text("locale").notNull().default("zh-CN"),
  timeZone: text("time_zone"),
  weekStartsOn: smallint("week_starts_on").notNull().default(1),
  ...timestamps(),
});
