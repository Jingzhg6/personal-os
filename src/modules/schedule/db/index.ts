import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { tasks } from "@/modules/tasks/db";
import { users } from "@/shared/auth/schema";
import { primaryId, timestamps } from "@/shared/db/columns";

/**
 * When a task is planned to be worked on (architecture §5.4, V2 Schedule Planner). A task can have
 * any number of blocks; a block never copies the task, it points at it. Deleting a block leaves
 * the task alone; purging a task removes its blocks (cascade); a task in the Trash keeps its
 * blocks hidden until it is restored.
 */
export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    /** Whole days (week/month planning) rather than a time of day. */
    allDay: boolean("all_day").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("schedule_blocks_user_start_idx").on(t.userId, t.startAt),
    index("schedule_blocks_task_idx").on(t.taskId),
    check("schedule_blocks_end_after_start", sql`${t.endAt} > ${t.startAt}`),
  ],
);
