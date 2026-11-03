import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm";

import { milestones, projects } from "@/modules/projects/db";
import type { DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";
import { localDate, zonedInstant } from "@/shared/lib/zoned-time";

import { taskRecurrences, tasks } from "../db";
import {
  addDaysTo,
  calendarDatesToCreate,
  isClosedCategory,
  occurrenceOnOrAfter,
  parseStoredRule,
  planNext,
  RECURRENCE_HORIZON_DAYS,
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
import { timeZoneOf } from "./time-zone";

/*
 * Recurring tasks (ADR 0023; V2: ADR 0028). A series is the template — a rule and a mode — and its
 * instances are ordinary tasks, so every view (list, matrix, project, Kanban, Gantt, schedule,
 * dashboard) shows them without knowing about recurrence. Each instance has its own date, status,
 * time and XP; closing one never changes another.
 *
 * - **Calendar series** (`fixed`): instances are created for every occurrence up to
 *   RECURRENCE_HORIZON_DAYS ahead ("top-up"), whatever happened to earlier ones. Top-ups run when a
 *   series is set or resumed, when an instance is closed, on every worker tick and when the task
 *   views load; each one locks the series row and starts after the newest existing instance, so
 *   repeated or concurrent top-ups never create a date twice.
 * - **Completion series** (`after_completion`): one open instance; the next is created when it is
 *   closed (completed, cancelled = skipped, or failed), counted from the day it was closed, inside
 *   that status change's transaction, at most once (`(recurrence_id, recurrence_index)` is unique).
 *
 * Changing, pausing or stopping a series never touches history: only future instances that were
 * never started or planned (no schedule block, no links, no subtasks) are replaced or removed.
 */

type RecurrenceRow = typeof taskRecurrences.$inferSelect;
type Deps = { db: DbExecutor; bus: EventBus };

/** Start of the due date (or the due time) in the series' zone, for `next_due_at`. */
function dueInstant(task: { dueDate: string; dueTime: string | null }, timeZone: string) {
  return new Date(zonedInstant(task.dueDate, task.dueTime ?? "00:00", timeZone).instant);
}

const todayIn = (series: Pick<RecurrenceRow, "timezone">, now: Date) =>
  localDate(now.getTime(), series.timezone);

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

/** Index and date of the newest instance (Trash included, so a deleted date is not re-created). */
async function seriesStats(db: DbExecutor, seriesId: string) {
  const [row] = await db
    .select({
      lastIndex: max(tasks.recurrenceIndex),
      lastDue: max(tasks.dueDate),
      instances: count(),
    })
    .from(tasks)
    .where(eq(tasks.recurrenceId, seriesId));
  return { lastIndex: row?.lastIndex ?? 0, lastDue: row?.lastDue ?? null, n: row?.instances ?? 0 };
}

/** The newest instance not in the Trash: the template the next instances copy. */
async function templateOf(db: DbExecutor, userId: string, seriesId: string): Promise<Task | null> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.recurrenceId, seriesId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .orderBy(sql`${tasks.recurrenceIndex} desc`)
    .limit(1);
  return row ? getTask(db, userId, row.id) : null;
}

/**
 * Removes future instances that nothing depends on yet: open and not started, due after `today`,
 * not in the Trash, with no schedule block, subtask, dependency, goal or plan link. They were only
 * pre-created copies; everything else (history, started or planned work) stays.
 */
async function removeUntouchedFuture(
  db: DbExecutor,
  userId: string,
  seriesId: string,
  today: string,
  keepTaskId: string | null,
): Promise<number> {
  const result = await db.execute(sql`
    delete from tasks t
    using task_statuses s
    where t.status_id = s.id
      and t.user_id = ${userId}
      and t.recurrence_id = ${seriesId}
      and t.deleted_at is null
      and t.due_date > ${today}::date
      and s.category in ('backlog', 'unstarted')
      and (${keepTaskId}::uuid is null or t.id <> ${keepTaskId}::uuid)
      and not exists (select 1 from schedule_blocks b where b.task_id = t.id)
      and not exists (select 1 from tasks c where c.parent_task_id = t.id)
      and not exists (
        select 1 from task_dependencies d where d.blocking_task_id = t.id or d.blocked_task_id = t.id
      )
      and not exists (select 1 from development_goal_tasks g where g.task_id = t.id)
      and not exists (select 1 from development_plan_tasks p where p.task_id = t.id)
  `);
  return result.rowCount ?? 0;
}

/* ---------------------------------------------------------------- instances */

/** Fields an instance takes over from the template, on its own date. */
function instanceInput(template: Task, dueDate: string, mode: RecurrenceMode): CreateTaskInput {
  // Calendar instances are single days; completion instances keep the template's lead time.
  const startDate =
    mode === "fixed"
      ? dueDate
      : template.startDate && template.dueDate
        ? addDaysTo(
            dueDate,
            -Math.round(
              (Date.parse(template.dueDate) - Date.parse(template.startDate)) / 86_400_000,
            ),
          )
        : null;
  return {
    title: template.title,
    description: template.description,
    areaId: template.areaId,
    projectId: template.projectId,
    milestoneId: template.milestoneId,
    priority: template.priority,
    isUrgent: template.isUrgent,
    isImportant: template.isImportant,
    startDate,
    dueDate,
    dueTime: template.dueTime,
    estimatedMinutes: template.estimatedMinutes,
    tagIds: template.tagIds,
    contributions: template.contributions,
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
 * Creates one instance at position `index` on `dueDate`. If the full copy is refused (for example
 * an attribute archived since), it retries bare; if that is refused too, nothing is created (the
 * caller's change stands). Runs inside the caller's transaction, each attempt in a savepoint.
 */
async function createInstance(
  deps: Deps,
  userId: string,
  series: RecurrenceRow,
  template: Task,
  dueDate: string,
  index: number,
): Promise<string | null> {
  const { db } = deps;
  const input = {
    ...instanceInput(template, dueDate, series.mode as RecurrenceMode),
    ...(await liveReferences(db, userId, template)),
  };
  let created: Task;
  try {
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
      console.error("recurrence.instance skipped", retryError.code);
      return null;
    }
  }
  await db
    .update(tasks)
    .set({ recurrenceId: series.id, recurrenceIndex: index })
    .where(eq(tasks.id, created.id));
  await db
    .update(taskRecurrences)
    .set({ nextDueAt: dueInstant({ dueDate, dueTime: template.dueTime }, series.timezone) })
    .where(eq(taskRecurrences.id, series.id));
  return created.id;
}

/**
 * Creates the missing instances of a calendar series up to the horizon (locks the series). Returns
 * how many were created. Ended, paused and completion series are left alone.
 */
async function topUpLocked(deps: Deps, userId: string, seriesId: string, now: Date) {
  const series = await ownedRecurrence(deps.db, userId, seriesId, true);
  if (series.mode !== "fixed" || series.endedAt || series.pausedAt) return 0;
  const parsed = parseStoredRule(series.rrule);
  if (!parsed) return 0;
  const template = await templateOf(deps.db, userId, series.id);
  if (!template) return 0;
  const stats = await seriesStats(deps.db, series.id);
  const today = todayIn(series, now);
  const plan = calendarDatesToCreate({
    rule: parsed.rule,
    dtstart: parsed.dtstart,
    after: stats.lastDue,
    lastIndex: stats.lastIndex,
    today,
    horizon: addDaysTo(today, RECURRENCE_HORIZON_DAYS),
  });
  let created = 0;
  for (const [i, date] of plan.dates.entries()) {
    if (await createInstance(deps, userId, series, template, date, stats.lastIndex + i + 1)) {
      created += 1;
    }
  }
  if (plan.ended) {
    await deps.db
      .update(taskRecurrences)
      .set({ endedAt: now })
      .where(eq(taskRecurrences.id, series.id));
  }
  return created;
}

/** Tops up one calendar series in its own transaction. */
export function topUpSeries(deps: TaskDeps, userId: string, seriesId: string, now = new Date()) {
  return deps.db.transaction((tx) => topUpLocked({ db: tx, bus: deps.bus }, userId, seriesId, now));
}

/** Active calendar series, for one user or for everyone. */
async function activeCalendarSeries(db: DbExecutor, userId?: string) {
  return db
    .select({ id: taskRecurrences.id, userId: taskRecurrences.userId })
    .from(taskRecurrences)
    .where(
      and(
        eq(taskRecurrences.mode, "fixed"),
        isNull(taskRecurrences.endedAt),
        isNull(taskRecurrences.pausedAt),
        userId ? eq(taskRecurrences.userId, userId) : undefined,
      ),
    );
}

/**
 * Keeps every active calendar series of a user filled up to the horizon (called when the task
 * views load). Idempotent: an up-to-date series creates nothing.
 */
export async function refreshRecurrences(deps: TaskDeps, userId: string, now = new Date()) {
  let created = 0;
  for (const series of await activeCalendarSeries(deps.db, userId)) {
    created += await topUpSeries(deps, userId, series.id, now);
  }
  return { created };
}

/** The worker tick: every user's calendar series (one transaction per series). */
export async function topUpAllRecurrences(deps: TaskDeps, now = new Date()) {
  let created = 0;
  for (const series of await activeCalendarSeries(deps.db)) {
    try {
      created += await topUpSeries(deps, series.userId, series.id, now);
    } catch (error) {
      // One broken series never stops the others.
      console.error("recurrence.topUp failed", (error as Error).name);
    }
  }
  return { created };
}

/* ---------------------------------------------------------------- setting a rule */

/**
 * Sets or changes the repeat rule of a task.
 *
 * A task without a series starts one: it becomes the first instance, moved to the first
 * occurrence on or after `startDate` (a single day). For an existing series the rule, mode and
 * start date change; with `applyTo: "future"`, future instances that were never started or
 * planned are replaced by ones following the new rule (this task is kept). History never changes.
 */
export function setRecurrence(
  deps: TaskDeps,
  userId: string,
  input: {
    taskId: string;
    rule: RecurrenceRule;
    mode: RecurrenceMode;
    startDate: string;
    applyTo?: "future" | "new";
  },
  now = new Date(),
): Promise<TaskRecurrence> {
  return deps.db.transaction(async (tx) => {
    const ctx = { db: tx, bus: deps.bus };
    const task = await getTask(tx, userId, input.taskId);
    if (task.parentTaskId) throw new DomainError("invalid", "recurrence.subtask");
    const rrule = serializeRule(input.rule, input.startDate);

    if (!task.recurrenceId) {
      const first =
        input.mode === "fixed"
          ? occurrenceOnOrAfter(input.rule, input.startDate, input.startDate)
          : input.startDate;
      if (!first) throw new DomainError("invalid", "recurrence.no_occurrence");
      const timeZone = await timeZoneOf(tx, userId);
      const [series] = await tx
        .insert(taskRecurrences)
        .values({
          userId,
          rrule,
          mode: input.mode,
          timezone: timeZone,
          nextDueAt: dueInstant({ dueDate: first, dueTime: task.dueTime }, timeZone),
        })
        .returning();
      // The task becomes the first instance, on its own day.
      await tx
        .update(tasks)
        .set({
          recurrenceId: series!.id,
          recurrenceIndex: 1,
          startDate: first,
          dueDate: first,
          ...(task.dueDate ? {} : { plannedAt: now, plannedAtInferred: false }),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
      await topUpLocked(ctx, userId, series!.id, now);
      return describe(tx, userId, input.taskId, now);
    }

    const series = await ownedRecurrence(tx, userId, task.recurrenceId, true);
    if (series.endedAt) throw new DomainError("conflict", "recurrence.ended");
    if (series.mode === "after_completion") await assertLatest(tx, userId, task);
    const today = todayIn(series, now);
    if (input.applyTo !== "new") {
      await removeUntouchedFuture(tx, userId, series.id, today, task.id);
    }
    if (input.mode === "after_completion") {
      // A completion series has one open instance at a time.
      const open = await openInstanceCount(tx, series.id);
      if (open > 1) throw new DomainError("conflict", "recurrence.too_many_open");
    }
    await tx
      .update(taskRecurrences)
      .set({ rrule, mode: input.mode })
      .where(eq(taskRecurrences.id, series.id));
    await topUpLocked(ctx, userId, series.id, now);
    return describe(tx, userId, input.taskId, now);
  });
}

async function openInstanceCount(db: DbExecutor, seriesId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from tasks t join task_statuses s on s.id = t.status_id
    where t.recurrence_id = ${seriesId} and t.deleted_at is null
      and s.category in ('backlog', 'unstarted', 'started')
  `);
  return result.rows[0]?.n ?? 0;
}

/** In a completion series only the newest instance edits the series (older ones are history). */
async function assertLatest(db: DbExecutor, userId: string, task: Task) {
  const stats = await seriesStats(db, task.recurrenceId!);
  const [own] = await db
    .select({ index: tasks.recurrenceIndex })
    .from(tasks)
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
  if (stats.lastIndex !== own?.index) throw new DomainError("conflict", "recurrence.not_latest");
}

/**
 * Skips this occurrence: the open instance is cancelled (0 自制力, never a failure). Other
 * instances are untouched; a completion series then creates its next instance.
 */
export async function skipOccurrence(deps: TaskDeps, userId: string, taskId: string) {
  const task = await getTask(deps.db, userId, taskId);
  if (!task.recurrenceId) throw new DomainError("invalid", "recurrence.none");
  if (isClosedCategory(task.statusCategory))
    throw new DomainError("invalid", "recurrence.not_open");
  const series = await ownedRecurrence(deps.db, userId, task.recurrenceId);
  if (series.mode === "after_completion") await assertLatest(deps.db, userId, task);
  return cancelTask(deps, userId, taskId);
}

/**
 * Pauses the series: nothing new is created until it is resumed. A calendar series also removes
 * its future instances that were never started or planned (resuming re-creates them from today).
 */
export function pauseRecurrence(deps: TaskDeps, userId: string, taskId: string, now = new Date()) {
  return deps.db.transaction(async (tx) => {
    const series = await seriesOfTask(tx, userId, taskId);
    if (series.endedAt) throw new DomainError("conflict", "recurrence.ended");
    if (!series.pausedAt) {
      await tx
        .update(taskRecurrences)
        .set({ pausedAt: now })
        .where(eq(taskRecurrences.id, series.id));
      if (series.mode === "fixed") {
        await removeUntouchedFuture(tx, userId, series.id, todayIn(series, now), taskId);
      }
    }
    return describe(tx, userId, taskId, now);
  });
}

/**
 * Resumes a paused series. A calendar series is filled again from today; a completion series
 * whose instances are all closed gets a new one due today.
 */
export function resumeRecurrence(deps: TaskDeps, userId: string, taskId: string, now = new Date()) {
  return deps.db.transaction(async (tx) => {
    const ctx = { db: tx, bus: deps.bus };
    const series = await seriesOfTask(tx, userId, taskId);
    if (series.endedAt) throw new DomainError("conflict", "recurrence.ended");
    if (series.pausedAt) {
      await tx
        .update(taskRecurrences)
        .set({ pausedAt: null })
        .where(eq(taskRecurrences.id, series.id));
      const resumed = { ...series, pausedAt: null };
      if (series.mode === "fixed") {
        await topUpLocked(ctx, userId, series.id, now);
      } else if ((await openInstanceCount(tx, series.id)) === 0) {
        const template = await templateOf(tx, userId, series.id);
        const stats = await seriesStats(tx, series.id);
        if (template) {
          await createInstance(
            ctx,
            userId,
            resumed,
            template,
            todayIn(series, now),
            stats.lastIndex + 1,
          );
        }
      }
    }
    return describe(tx, userId, taskId, now);
  });
}

/**
 * Stops the series for good: no further instances. Existing instances stay, except a calendar
 * series' future instances that were never started or planned.
 */
export function stopRecurrence(deps: TaskDeps, userId: string, taskId: string, now = new Date()) {
  return deps.db.transaction(async (tx) => {
    const series = await seriesOfTask(tx, userId, taskId);
    if (!series.endedAt) {
      await tx
        .update(taskRecurrences)
        .set({ endedAt: now })
        .where(eq(taskRecurrences.id, series.id));
      if (series.mode === "fixed") {
        await removeUntouchedFuture(tx, userId, series.id, todayIn(series, now), taskId);
      }
    }
    return describe(tx, userId, taskId, now);
  });
}

async function seriesOfTask(db: DbExecutor, userId: string, taskId: string) {
  const task = await getTask(db, userId, taskId);
  if (!task.recurrenceId) throw new DomainError("invalid", "recurrence.none");
  return ownedRecurrence(db, userId, task.recurrenceId, true);
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

async function describe(
  db: DbExecutor,
  userId: string,
  taskId: string,
  now = new Date(),
): Promise<TaskRecurrence> {
  const [row] = await db
    .select({ index: tasks.recurrenceIndex, recurrenceId: tasks.recurrenceId, due: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  const series = await ownedRecurrence(db, userId, row!.recurrenceId!);
  const { rule, dtstart } = storedRule(series);
  const stats = await seriesStats(db, series.id);
  const anchor = row!.due && row!.due > todayIn(series, now) ? row!.due : todayIn(series, now);
  return {
    id: series.id,
    rule,
    mode: series.mode as RecurrenceMode,
    timeZone: series.timezone,
    index: row!.index!,
    isLatest: stats.lastIndex === row!.index,
    instances: stats.n,
    openInstances: await openInstanceCount(db, series.id),
    startDate: dtstart,
    endedAt: series.endedAt,
    pausedAt: series.pausedAt,
    upcoming:
      series.endedAt || series.pausedAt || series.mode !== "fixed"
        ? []
        : upcomingDates(rule, dtstart, anchor, 3),
  };
}

/* ---------------------------------------------------------------- closing an instance */

/**
 * Runs when an instance is closed, in that status change's transaction. A completion series gets
 * its next instance (counted from the closing day); a calendar series is topped up. Returns the
 * new task id of a completion series, or null. Never fails the status change.
 */
export async function generateNextInstance(
  deps: Deps,
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
  if (series.endedAt || series.pausedAt) return null;
  if (series.mode === "fixed") {
    await topUpLocked(deps, userId, series.id, now);
    return null;
  }
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
    mode: "after_completion",
    dtstart: parsed.dtstart,
    sourceDue: source.dueDate,
    sourceIndex: row.index,
    closedOn: localDate(closedAt.getTime(), series.timezone),
    today: todayIn(series, now),
  });
  if ("end" in plan) {
    await db.update(taskRecurrences).set({ endedAt: now }).where(eq(taskRecurrences.id, series.id));
    return null;
  }
  return createInstance(deps, userId, series, source, plan.dueDate, row.index + 1);
}

/** All instances of a series, oldest first (tests and diagnostics). */
export async function listInstances(db: DbExecutor, userId: string, recurrenceId: string) {
  return db
    .select({
      id: tasks.id,
      index: tasks.recurrenceIndex,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      deletedAt: tasks.deletedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.recurrenceId, recurrenceId)))
    .orderBy(asc(tasks.recurrenceIndex));
}
