import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";

import { taskStatuses, tasks } from "@/modules/tasks/db";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { scheduleBlocks } from "../db";
import type { CreateBlockInput, ScheduleBlock, UpdateBlockInput } from "../domain";

/*
 * Schedule blocks (V2). Every query is scoped to the user; a block can only point at the user's own
 * task that is not in the Trash. Blocks of a task in the Trash are hidden (they come back on
 * restore) and removed with it when it is purged (foreign key cascade).
 */

const selection = {
  id: scheduleBlocks.id,
  taskId: scheduleBlocks.taskId,
  startAt: scheduleBlocks.startAt,
  endAt: scheduleBlocks.endAt,
  allDay: scheduleBlocks.allDay,
  title: tasks.title,
  statusCategory: taskStatuses.category,
  priority: tasks.priority,
  isUrgent: tasks.isUrgent,
  isImportant: tasks.isImportant,
  recurrenceId: tasks.recurrenceId,
  dueDate: tasks.dueDate,
};

type Row = { [K in keyof typeof selection]: unknown };

function toBlock(row: Row): ScheduleBlock {
  const r = row as {
    id: string;
    taskId: string;
    startAt: Date;
    endAt: Date;
    allDay: boolean;
    title: string;
    statusCategory: string;
    priority: number;
    isUrgent: boolean | null;
    isImportant: boolean | null;
    recurrenceId: string | null;
    dueDate: string | null;
  };
  return {
    id: r.id,
    taskId: r.taskId,
    startAt: r.startAt,
    endAt: r.endAt,
    allDay: r.allDay,
    task: {
      title: r.title,
      statusCategory: r.statusCategory,
      priority: r.priority,
      isUrgent: r.isUrgent,
      isImportant: r.isImportant,
      recurrenceId: r.recurrenceId,
      dueDate: r.dueDate,
    },
  };
}

function query(db: DbExecutor, userId: string) {
  return db
    .select(selection)
    .from(scheduleBlocks)
    .innerJoin(tasks, eq(tasks.id, scheduleBlocks.taskId))
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .where(and(eq(scheduleBlocks.userId, userId), isNull(tasks.deletedAt)))
    .$dynamic();
}

/** Blocks overlapping [from, to), earliest first. */
export async function listBlocks(
  db: DbExecutor,
  userId: string,
  range: { from: Date; to: Date },
): Promise<ScheduleBlock[]> {
  const rows = await query(db, userId)
    .where(
      and(
        eq(scheduleBlocks.userId, userId),
        isNull(tasks.deletedAt),
        lt(scheduleBlocks.startAt, range.to),
        gt(scheduleBlocks.endAt, range.from),
      ),
    )
    .orderBy(asc(scheduleBlocks.startAt), asc(scheduleBlocks.id));
  return rows.map(toBlock);
}

/** Blocks of one task (any date), for the task's own views. */
export async function listTaskBlocks(db: DbExecutor, userId: string, taskId: string) {
  const rows = await query(db, userId)
    .where(and(eq(scheduleBlocks.userId, userId), eq(scheduleBlocks.taskId, taskId)))
    .orderBy(asc(scheduleBlocks.startAt));
  return rows.map(toBlock);
}

async function getBlock(db: DbExecutor, userId: string, id: string): Promise<ScheduleBlock> {
  const [row] = await query(db, userId).where(
    and(eq(scheduleBlocks.userId, userId), isNull(tasks.deletedAt), eq(scheduleBlocks.id, id)),
  );
  if (!row) throw new DomainError("not_found", "schedule.not_found");
  return toBlock(row);
}

/** Plans a task: a new block pointing at it (the task itself is not copied or changed). */
export async function createBlock(
  db: DbExecutor,
  userId: string,
  input: CreateBlockInput,
): Promise<ScheduleBlock> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)));
  if (!task) throw new DomainError("not_found", "task.not_found");
  const [row] = await db
    .insert(scheduleBlocks)
    .values({
      userId,
      taskId: input.taskId,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay,
    })
    .returning({ id: scheduleBlocks.id });
  return getBlock(db, userId, row!.id);
}

/** Moves or resizes a block (drag, stretch, or the edit form). */
export async function updateBlock(
  db: DbExecutor,
  userId: string,
  input: UpdateBlockInput,
): Promise<ScheduleBlock> {
  const updated = await db
    .update(scheduleBlocks)
    .set({ startAt: input.startAt, endAt: input.endAt, allDay: input.allDay })
    .where(and(eq(scheduleBlocks.id, input.id), eq(scheduleBlocks.userId, userId)))
    .returning({ id: scheduleBlocks.id });
  if (updated.length === 0) throw new DomainError("not_found", "schedule.not_found");
  return getBlock(db, userId, input.id);
}

/** Removes a block; the task stays as it is. */
export async function deleteBlock(db: DbExecutor, userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(scheduleBlocks)
    .where(and(eq(scheduleBlocks.id, id), eq(scheduleBlocks.userId, userId)))
    .returning({ id: scheduleBlocks.id });
  if (deleted.length === 0) throw new DomainError("not_found", "schedule.not_found");
}
