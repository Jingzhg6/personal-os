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
import { developmentAttributes } from "@/modules/character/db";
import { milestones, projects } from "@/modules/projects/db";
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
      sql`${t.category} in ('backlog', 'unstarted', 'started', 'completed', 'cancelled', 'failed')`,
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

/**
 * A recurring series (ADR 0023): an RFC 5545 rule ("DTSTART;VALUE=DATE:…\nRRULE:…") and a mode.
 * Its instances are ordinary tasks pointing here; one is open at a time.
 */
export const taskRecurrences = pgTable(
  "task_recurrences",
  {
    id: primaryId(),
    userId: userId(),
    rrule: text("rrule").notNull(),
    /** fixed: by the schedule · after_completion: counted from when an instance is closed. */
    mode: text("mode").notNull(),
    /** IANA zone the local dates of the series are computed in. */
    timezone: text("timezone").notNull(),
    /** Due date of the newest instance, at the start of that local day (informational). */
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    /** Set when the series stops (by the user, or after its UNTIL / COUNT). */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("task_recurrences_user_id_idx").on(t.userId),
    check("task_recurrences_mode_valid", sql`${t.mode} in ('fixed', 'after_completion')`),
  ],
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
    /** Top-level tasks only; subtasks belong to their parent's project. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
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
    /** M10.5: set while the task is in a "failed" status. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
    /** M10.5: when the current due date was first set (null without a due date). */
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    /**
     * M10.6: true when `planned_at` was back-filled by migration 0014 (unknown real planning time).
     * Such deadlines are never treated as planned by 自制力. Cleared when a deadline is set anew.
     */
    plannedAtInferred: boolean("planned_at_inferred").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Recurring series this task is an instance of (ADR 0023). */
    // Series are never deleted on their own (only with the user, together with the tasks).
    recurrenceId: uuid("recurrence_id").references((): AnyPgColumn => taskRecurrences.id),
    /** 1-based position in the series; unique per series, so a successor exists at most once. */
    recurrenceIndex: integer("recurrence_index"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("tasks_recurrence_index_uq").on(t.recurrenceId, t.recurrenceIndex),
    check(
      "tasks_recurrence_pair",
      sql`(${t.recurrenceId} is null) = (${t.recurrenceIndex} is null)`,
    ),
    check("tasks_recurring_top_level", sql`${t.recurrenceId} is null or ${t.parentTaskId} is null`),
    index("tasks_user_active_idx")
      .on(t.userId, t.sortKey)
      .where(sql`${t.deletedAt} is null`),
    index("tasks_user_due_date_idx").on(t.userId, t.dueDate),
    index("tasks_parent_task_id_idx").on(t.parentTaskId),
    index("tasks_status_id_idx").on(t.statusId),
    index("tasks_area_id_idx").on(t.areaId),
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_milestone_id_idx").on(t.milestoneId),
    check(
      "tasks_subtasks_have_no_project",
      sql`${t.parentTaskId} is null or (${t.projectId} is null and ${t.milestoneId} is null)`,
    ),
    check(
      "tasks_milestone_needs_project",
      sql`${t.milestoneId} is null or ${t.projectId} is not null`,
    ),
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

/**
 * Finish-to-start dependencies: `blocked_task_id` should not start before `blocking_task_id`
 * finishes. Cycles are rejected by the service; the edge disappears with either task.
 */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    userId: userId(),
    blockingTaskId: uuid("blocking_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedTaskId: uuid("blocked_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockingTaskId, t.blockedTaskId] }),
    index("task_dependencies_blocked_idx").on(t.blockedTaskId),
    check("task_dependencies_not_self", sql`${t.blockingTaskId} <> ${t.blockedTaskId}`),
  ],
);

/**
 * Which development attributes a task helps grow, with a relative weight (1 少量, 2 一般,
 * 3 主要). Independent of the task's area. On completion the task's XP is split across them.
 */
export const taskDevelopmentContributions = pgTable(
  "task_development_contributions",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => developmentAttributes.id, { onDelete: "cascade" }),
    weight: smallint("weight").notNull().default(2),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.attributeId] }),
    index("task_development_contributions_attribute_idx").on(t.attributeId),
    check("task_development_contributions_weight_range", sql`${t.weight} between 1 and 3`),
  ],
);
