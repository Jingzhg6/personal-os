import { pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { timestamps } from "@/shared/db/columns";

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Stable locale identifier. Only "zh-CN" since M6.2 (ADR 0015); kept for a future language. */
  locale: text("locale").notNull().default("zh-CN"),
  timeZone: text("time_zone"),
  weekStartsOn: smallint("week_starts_on").notNull().default(1),
  ...timestamps(),
});
