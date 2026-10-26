import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { areas } from "@/modules/areas/db";
import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

import type { RichTextDoc } from "../domain/rich-text";

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const taskStatuses = pgTable(
  "task_statuses",
  {
    id: primaryId(),
    userId: userId(),
    systemKey: text("system_key"),
    name: text("name"),
    category: text("category").notNull(),
    color: text("color").notNull(),
    sortKey: sortKey(),
    ...timestamps(),
  },
  (t) => [
    index("task_statuses_user_id_idx").on(t.userId),
    uniqueIndex("task_statuses_user_system_key_uq")
      .on(t.userId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
    check(
      "task_statuses_category_valid",
      sql`${t.category} in ('backlog', 'unstarted', 'started', 'completed', 'cancelled')`,
    ),
    check("task_statuses_label_present", sql`${t.systemKey} is not null or ${t.name} is not null`),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: primaryId(),
    userId: userId(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("tags_user_name_uq").on(t.userId, sql`lower(${t.name})`)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: primaryId(),
    userId: userId(),
    title: text("title").notNull(),
    description: jsonb("description").$type<RichTextDoc>(),
    /** Plain text of `description`, maintained by the service for search. */
    descriptionText: text("description_text"),
    areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    statusId: uuid("status_id")
      .notNull()
      .references(() => taskStatuses.id, { onDelete: "restrict" }),
    priority: smallint("priority").notNull().default(0),
    isUrgent: boolean("is_urgent"),
    isImportant: boolean("is_important"),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: time("due_time"),
    estimatedMinutes: integer("estimated_minutes"),
    sortKey: sortKey(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("tasks_user_active_idx")
      .on(t.userId, t.sortKey)
      .where(sql`${t.deletedAt} is null`),
    index("tasks_user_due_date_idx").on(t.userId, t.dueDate),
    index("tasks_parent_task_id_idx").on(t.parentTaskId),
    index("tasks_status_id_idx").on(t.statusId),
    index("tasks_area_id_idx").on(t.areaId),
    index("tasks_user_deleted_idx")
      .on(t.userId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    // Substring search (works for Chinese, which has no word boundaries) via pg_trgm.
    index("tasks_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("tasks_description_text_trgm_idx").using("gin", t.descriptionText.op("gin_trgm_ops")),
    check("tasks_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("tasks_priority_range", sql`${t.priority} between 0 and 4`),
    check(
      "tasks_estimate_positive",
      sql`${t.estimatedMinutes} is null or ${t.estimatedMinutes} > 0`,
    ),
    check("tasks_due_time_needs_date", sql`${t.dueTime} is null or ${t.dueDate} is not null`),
    check("tasks_not_own_parent", sql`${t.parentTaskId} is null or ${t.parentTaskId} <> ${t.id}`),
  ],
);

/** Area scope of the task views behind navigation items (工作, 业务, …). */
export const taskViews = pgTable(
  "task_views",
  {
    userId: userId(),
    viewKey: text("view_key").notNull(),
    areaIds: uuid("area_ids").array().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.viewKey] })],
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_tag_id_idx").on(t.tagId)],
);
