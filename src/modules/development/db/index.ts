import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { developmentAttributes } from "@/modules/character/db";
import { projects } from "@/modules/projects/db";
import { tasks } from "@/modules/tasks/db";
import { users } from "@/shared/auth/schema";
import { createdAt, primaryId, timestamps } from "@/shared/db/columns";

/*
 * The personal-development planning layer (M8, ADR 0017). Planning metadata only: nothing here
 * produces or changes XP. Tasks stay the actions; development attributes stay the abilities.
 */

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** One row per user: the long-term development vision (free text, user content). */
export const developmentProfiles = pgTable("development_profiles", {
  userId: userId().primaryKey(),
  vision: text("vision"),
  ...timestamps(),
});

/**
 * The attributes the user deliberately chose to focus on now, in their order. Chosen, not
 * computed: "most XP lately" is a different question (shown separately).
 */
export const developmentFocus = pgTable(
  "development_focus",
  {
    userId: userId(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => developmentAttributes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.attributeId] }),
    check("development_focus_position_nonnegative", sql`${t.position} >= 0`),
  ],
);

/**
 * A meaningful development outcome ("法语达到 B1"). Status is a stable identifier; archived goals
 * leave the page but keep their links and can be restored.
 */
export const developmentGoals = pgTable(
  "development_goals",
  {
    id: primaryId(),
    userId: userId(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    /** 1 = low, 2 = medium, 3 = high. */
    priority: smallint("priority").notNull().default(2),
    targetDate: date("target_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("development_goals_user_idx").on(t.userId, t.status),
    check("development_goals_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "development_goals_status_valid",
      sql`${t.status} in ('active', 'paused', 'completed', 'archived')`,
    ),
    check("development_goals_priority_range", sql`${t.priority} between 1 and 3`),
    check(
      "development_goals_archived_shape",
      sql`(${t.status} = 'archived') = (${t.archivedAt} is not null)`,
    ),
    check(
      "development_goals_completed_shape",
      sql`${t.status} <> 'completed' or ${t.completedAt} is not null`,
    ),
  ],
);

/** Which attributes a goal develops, with the same 1–3 weights as task contributions. */
export const developmentGoalAttributes = pgTable(
  "development_goal_attributes",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => developmentGoals.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => developmentAttributes.id, { onDelete: "cascade" }),
    weight: smallint("weight").notNull().default(2),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.goalId, t.attributeId] }),
    index("development_goal_attributes_attribute_idx").on(t.attributeId),
    check("development_goal_attributes_weight_range", sql`${t.weight} between 1 and 3`),
  ],
);

/**
 * Existing tasks that act on a goal (references, never copies). A task in the Trash is hidden
 * from the goal and comes back with a restore; purging the task removes the link.
 */
export const developmentGoalTasks = pgTable(
  "development_goal_tasks",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => developmentGoals.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.goalId, t.taskId] }),
    index("development_goal_tasks_task_idx").on(t.taskId),
  ],
);

/** Existing projects that serve a goal (references only). */
export const developmentGoalProjects = pgTable(
  "development_goal_projects",
  {
    goalId: uuid("goal_id")
      .notNull()
      .references(() => developmentGoals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.goalId, t.projectId] }),
    index("development_goal_projects_project_idx").on(t.projectId),
  ],
);
