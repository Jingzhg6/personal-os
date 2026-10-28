import { and, asc, count, eq, max } from "drizzle-orm";

import { milestones, projects } from "@/modules/projects/db";
import { userSettings } from "@/modules/settings/db";
import type { DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { defaultTimeZone } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";
import { localDate, zonedInstant } from "@/shared/lib/zoned-time";

import { taskRecurrences, tasks } from "../db";
import {
  addDaysTo,
  isClosedCategory,
  parseStoredRule,
  planNext,
  serializeRule,
  upcomingDates,
  type CreateTaskInput,
  type RecurrenceMode,
  type RecurrenceRule,
  type Task,
  type TaskRecurrence,
} from "../domain";
import { getTask } from "./repository";
import { cancelTask, createTask, type TaskDeps } from "./service";

/*
 * Recurring tasks (ADR 0023). A series is a rule; its instances are ordinary tasks, so every view
 * (list, matrix, project, Kanban, Gantt, dashboard) shows them without knowing about recurrence.
 *
 * The next instance is created when the open one is closed — completed, cancelled (= skipped) or
 * failed — inside that status change's transaction. It is created at most once per instance:
 * the series row is locked, and `(recurrence_id, recurrence_index)` is unique, so repeated or
 * concurrent closes, reopen-and-complete, or retries never produce a second successor.
 */

type RecurrenceRow = typeof taskRecurrences.$inferSelect;

async function timeZoneOf(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.timeZone ?? defaultTimeZone;
}

/** Start of the due date (or the due time) in the series' zone, for `next_due_at`. */
function dueInstant(task: { dueDate: string; dueTime: string | null }, timeZone: string) {
  return new Date(zonedInstant(task.dueDate, task.dueTime ?? "00:00", timeZone).instant);
}

async function ownedRecurrence(db: DbExecutor, userId: string, id: string, lock = false) {
  const query = db
    .select()
    .from(taskRecurrences)
    .where(and(eq(taskRecurrences.id, id), eq(taskRecurrences.userId, userId)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new DomainError("not_found", "recurrence.not_found");
  return row;
}

function storedRule(row: RecurrenceRow) {
  const parsed = parseStoredRule(row.rrule);
  // Stored rules are written by this module only; an unreadable one is reported, never run.
  if (!parsed) throw new DomainError("conflict", "recurrence.invalid_rule");
  return parsed;
}

/** Makes a top-level task with a due date the first instance of a new series. */
async function startSeries(
  db: DbExecutor,
  userId: string,
  task: Task,
  rule: RecurrenceRule,
  mode: RecurrenceMode,
) {
  const timeZone = await timeZoneOf(db, userId);
  const [series] = await db
    .insert(taskRecurrences)
    .values({
      userId,
      rrule: serializeRule(rule, task.dueDate!),
      mode,
      timezone: timeZone,
      nextDueAt: dueInstant({ dueDate: task.dueDate!, dueTime: task.dueTime }, timeZone),
    })
    .returning();
  await db
    .update(tasks)
    .set({ recurrenceId: series!.id, recurrenceIndex: 1 })
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
}

/**
 * Sets or changes the repeat rule of a task. A task without a series starts one (it becomes the
 * first instance); for an existing series the new rule applies from this instance on — instances
 * already created keep their dates.
 */
export function setRecurrence(
  deps: TaskDeps,
  userId: string,
  input: { taskId: string; rule: RecurrenceRule; mode: RecurrenceMode },
): Promise<TaskRecurrence> {
  return deps.db.transaction(async (tx) => {
    const task = await getTask(tx, userId, input.taskId);
    if (task.parentTaskId) throw new DomainError("invalid", "recurrence.subtask");
    if (!task.dueDate) throw new DomainError("invalid", "recurrence.needs_due_date");
    if (!task.recurrenceId) {
      await startSeries(tx, userId, task, input.rule, input.mode);
    } else {
      const series = await ownedRecurrence(tx, userId, task.recurrenceId, true);
      if (series.endedAt) throw new DomainError("conflict", "recurrence.ended");
      await assertLatest(tx, userId, task);
      await tx
        .update(taskRecurrences)
        .set({ rrule: serializeRule(input.rule, task.dueDate), mode: input.mode })
        .where(eq(taskRecurrences.id, series.id));
    }
    return describe(tx, userId, input.taskId);
  });
}

/** Only the newest instance edits the series (older ones are history). */
async function assertLatest(db: DbExecutor, userId: string, task: Task) {
  const [latest] = await db
    .select({ index: max(tasks.recurrenceIndex) })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.recurrenceId, task.recurrenceId!)));
  const [own] = await db
    .select({ index: tasks.recurrenceIndex })
    .from(tasks)
    .where(eq(tasks.id, task.id));
  if (latest?.index !== own?.index) throw new DomainError("conflict", "recurrence.not_latest");
}

/**
 * Skips this occurrence: the open instance is cancelled (0 自制力, never a failure) and, like any
 * closed instance, is followed by the next one.
 */
export async function skipOccurrence(deps: TaskDeps, userId: string, taskId: string) {
  const task = await getTask(deps.db, userId, taskId);
  if (!task.recurrenceId) throw new DomainError("invalid", "recurrence.none");
  if (isClosedCategory(task.statusCategory))
    throw new DomainError("invalid", "recurrence.not_open");
  await assertLatest(deps.db, userId, task);
  return cancelTask(deps, userId, taskId);
}

/** Stops the series: no further instances. The existing ones stay as they are. */
export function stopRecurrence(deps: TaskDeps, userId: string, taskId: string) {
  return deps.db.transaction(async (tx) => {
    const task = await getTask(tx, userId, taskId);
    if (!task.recurrenceId) throw new DomainError("invalid", "recurrence.none");
    const series = await ownedRecurrence(tx, userId, task.recurrenceId, true);
    if (!series.endedAt) {
      await tx
        .update(taskRecurrences)
        .set({ endedAt: new Date() })
        .where(eq(taskRecurrences.id, series.id));
    }
    return describe(tx, userId, taskId);
  });
}

/** The series of a task, as the task panel shows it (null for a one-off task). */
export async function getTaskRecurrence(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<TaskRecurrence | null> {
  const task = await getTask(db, userId, taskId);
  if (!task.recurrenceId) return null;
  return describe(db, userId, taskId);
}

async function describe(db: DbExecutor, userId: string, taskId: string): Promise<TaskRecurrence> {
  const [row] = await db
    .select({ index: tasks.recurrenceIndex, recurrenceId: tasks.recurrenceId, due: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  const series = await ownedRecurrence(db, userId, row!.recurrenceId!);
  const { rule, dtstart } = storedRule(series);
  const [stats] = await db
    .select({ n: count(), latest: max(tasks.recurrenceIndex) })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.recurrenceId, series.id)));
  return {
    id: series.id,
    rule,
    mode: series.mode as RecurrenceMode,
    timeZone: series.timezone,
    index: row!.index!,
    isLatest: stats?.latest === row!.index,
    instances: stats?.n ?? 0,
    endedAt: series.endedAt,
    upcoming:
      series.endedAt || series.mode !== "fixed" || !row!.due
        ? []
        : upcomingDates(rule, dtstart, row!.due, 3),
  };
}

/* ---------------------------------------------------------------- generation */

/** Fields the next instance takes over, its dates shifted to the new due date. */
function successorInput(source: Task, dueDate: string): CreateTaskInput {
  const startDate =
    source.startDate && source.dueDate
      ? addDaysTo(
          dueDate,
          -Math.round((Date.parse(source.dueDate) - Date.parse(source.startDate)) / 86_400_000),
        )
      : null;
  return {
    title: source.title,
    description: source.description,
    areaId: source.areaId,
    projectId: source.projectId,
    milestoneId: source.milestoneId,
    priority: source.priority,
    isUrgent: source.isUrgent,
    isImportant: source.isImportant,
    startDate,
    dueDate,
    dueTime: source.dueTime,
    estimatedMinutes: source.estimatedMinutes,
    tagIds: source.tagIds,
    contributions: source.contributions,
  };
}

/** Project and milestone references that are still usable for a new instance. */
async function liveReferences(db: DbExecutor, userId: string, source: Task) {
  let projectId = source.projectId;
  let milestoneId = source.milestoneId;
  if (projectId) {
    const [project] = await db
      .select({ status: projects.status })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
    if (!project || project.status === "completed" || project.status === "cancelled") {
      projectId = null;
      milestoneId = null;
    }
  }
  if (milestoneId) {
    const [milestone] = await db
      .select({ completedAt: milestones.completedAt })
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId), eq(milestones.userId, userId)));
    if (!milestone || milestone.completedAt) milestoneId = null;
  }
  return { projectId, milestoneId };
}

/**
 * Creates the instance that follows `taskId` when it is closed. Returns the new task id, or null
 * when nothing is due (not recurring, ended, already has a successor, deleted). Runs in the
 * caller's transaction; never fails the status change that triggered it — an instance whose
 * references are no longer usable is created without them.
 */
export async function generateNextInstance(
  deps: { db: DbExecutor; bus: EventBus },
  userId: string,
  taskId: string,
  now = new Date(),
): Promise<string | null> {
  const { db } = deps;
  const [row] = await db
    .select({
      recurrenceId: tasks.recurrenceId,
      index: tasks.recurrenceIndex,
      deletedAt: tasks.deletedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  if (!row?.recurrenceId || row.index === null || row.deletedAt) return null;

  // Serialises everything that may extend this series.
  const series = await ownedRecurrence(db, userId, row.recurrenceId, true);
  if (series.endedAt) return null;
  const [successor] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.recurrenceId, series.id), eq(tasks.recurrenceIndex, row.index + 1)));
  if (successor) return null;

  const source = await getTask(db, userId, taskId);
  if (!isClosedCategory(source.statusCategory) || !source.dueDate) return null;
  const parsed = parseStoredRule(series.rrule);
  if (!parsed) return null;
  const closedAt = source.completedAt ?? source.cancelledAt ?? source.failedAt ?? now;
  const plan = planNext({
    rule: parsed.rule,
    mode: series.mode as RecurrenceMode,
    dtstart: parsed.dtstart,
    sourceDue: source.dueDate,
    sourceIndex: row.index,
    closedOn: localDate(closedAt.getTime(), series.timezone),
    today: localDate(now.getTime(), series.timezone),
  });
  if ("end" in plan) {
    await db.update(taskRecurrences).set({ endedAt: now }).where(eq(taskRecurrences.id, series.id));
    return null;
  }

  const input = {
    ...successorInput(source, plan.dueDate),
    ...(await liveReferences(db, userId, source)),
  };
  let created: Task;
  try {
    // A savepoint: if the full copy is refused (e.g. an attribute archived since), retry bare.
    created = await db.transaction((sp) => createTask({ db: sp, bus: deps.bus }, userId, input));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    try {
      created = await db.transaction((sp) =>
        createTask({ db: sp, bus: deps.bus }, userId, {
          ...input,
          projectId: null,
          milestoneId: null,
          tagIds: [],
          contributions: [],
        }),
      );
    } catch (retryError) {
      if (!(retryError instanceof DomainError)) throw retryError;
      // The status change stands; the series simply has no new instance (logged, code only).
      console.error("recurrence.generate skipped", retryError.code);
      return null;
    }
  }
  await db
    .update(tasks)
    .set({ recurrenceId: series.id, recurrenceIndex: row.index + 1 })
    .where(eq(tasks.id, created.id));
  await db
    .update(taskRecurrences)
    .set({
      nextDueAt: dueInstant({ dueDate: plan.dueDate, dueTime: source.dueTime }, series.timezone),
    })
    .where(eq(taskRecurrences.id, series.id));
  return created.id;
}

/** All instances of a series, oldest first (tests and diagnostics). */
export async function listInstances(db: DbExecutor, userId: string, recurrenceId: string) {
  return db
    .select({
      id: tasks.id,
      index: tasks.recurrenceIndex,
      dueDate: tasks.dueDate,
      deletedAt: tasks.deletedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.recurrenceId, recurrenceId)))
    .orderBy(asc(tasks.recurrenceIndex));
}
