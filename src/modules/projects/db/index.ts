import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { areas } from "@/modules/areas/db";
import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

import type { Project } from "../domain";

export const projects = pgTable(
  "projects",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: jsonb("description").$type<NonNullable<Project["description"]>>(),
    areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    priority: smallint("priority").notNull().default(0),
    color: text("color").notNull().default("indigo"),
    startDate: date("start_date", { mode: "string" }),
    targetDate: date("target_date", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [
    index("projects_user_sort_idx").on(t.userId, t.sortKey),
    check(
      "projects_status_valid",
      sql`${t.status} in ('planned', 'active', 'paused', 'completed', 'cancelled')`,
    ),
    check("projects_priority_range", sql`${t.priority} between 0 and 4`),
    check("projects_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "projects_dates_ordered",
      sql`${t.startDate} is null or ${t.targetDate} is null or ${t.startDate} <= ${t.targetDate}`,
    ),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [
    index("milestones_project_idx").on(t.projectId),
    check("milestones_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);
