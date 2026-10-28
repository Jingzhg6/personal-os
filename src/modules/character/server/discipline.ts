import { and, asc, desc, eq, sql } from "drizzle-orm";

import { userSettings } from "@/modules/settings/db";
import { tasks, taskStatuses } from "@/modules/tasks/db";
import type { Database, DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";

import { developmentAttributes, disciplineLedger } from "../db";
import {
  adjustmentFor,
  DISCIPLINE_KEY,
  DISCIPLINE_POINTS,
  disciplineOutcome,
  isMissedOutcome,
  reasonFor,
  type DisciplineCategory,
  type DisciplineEntry,
  type DisciplineOutcome,
  type DisciplineReason,
  type DisciplineSummary,
  type TaskDiscipline,
} from "../domain";
import { ensureDisciplineAttribute } from "./attributes";

/*
 * 自制力 scoring (M10.5, ADR 0021). The only writer of `discipline_ledger`. Scoring runs inside
 * the transaction of the status change that causes it (event handler) or of one overdue-sweep
 * step; it reads the task through the tasks module's tables, never accepts points from outside,
 * and appends at most one entry per change.
 */

type EntryRow = typeof disciplineLedger.$inferSelect;

function toEntry(row: EntryRow): DisciplineEntry {
  return {
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    reason: row.reason as DisciplineReason,
    outcome: row.outcome as DisciplineOutcome,
    points: row.points,
    netAfter: row.netAfter,
    createdAt: row.createdAt,
  };
}

async function timeZoneOf(db: DbExecutor, userId: string) {
  const [row] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.timeZone ?? defaultTimeZone;
}

/**
 * Brings one task's 自制力 net to the outcome its current state deserves. Idempotent: a repeated
 * call (redelivered event, overlapping sweep) finds nothing to change. Serialised per task by an
 * advisory lock; the unique (task, seq) index is the database-level backstop.
 */
export function reconcileTaskDiscipline(
  db: DbExecutor,
  input: { userId: string; taskId: string; sourceKey: string; now?: Date },
): Promise<DisciplineEntry | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`discipline:${input.taskId}`}))`);
    const [task] = await tx
      .select({
        title: tasks.title,
        category: taskStatuses.category,
        dueDate: tasks.dueDate,
        dueTime: tasks.dueTime,
        plannedAt: tasks.plannedAt,
        plannedAtInferred: tasks.plannedAtInferred,
        completedAt: tasks.completedAt,
        failedAt: tasks.failedAt,
        deletedAt: tasks.deletedAt,
      })
      .from(tasks)
      .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)));
    // Purged tasks keep their history; tasks in the Trash are not scored (nor unscored).
    if (!task || task.deletedAt) return null;
    // M10.6: a back-filled planning time is not evidence of planning. Such tasks are outside
    // 自制力 — not scored, and entries they may already have are left exactly as they are.
    if (task.plannedAtInferred) return null;

    const history = await tx
      .select({
        seq: disciplineLedger.seq,
        outcome: disciplineLedger.outcome,
        points: disciplineLedger.points,
      })
      .from(disciplineLedger)
      .where(
        and(eq(disciplineLedger.taskId, input.taskId), eq(disciplineLedger.userId, input.userId)),
      )
      .orderBy(asc(disciplineLedger.seq));
    const net = history.reduce((sum, e) => sum + e.points, 0);
    const last = history.at(-1);
    const missed = history.some((e) => isMissedOutcome(e.outcome as DisciplineOutcome));
    // An overdue penalty once recorded survives a cancellation (M10.6).
    const penalised = history.some((e) => e.outcome === "overdue");

    const timeZone = await timeZoneOf(tx, input.userId);
    const target = disciplineOutcome(
      {
        category: task.category as DisciplineCategory,
        dueDate: task.dueDate,
        dueTime: task.dueTime ? task.dueTime.slice(0, 5) : null,
        plannedAt: task.plannedAt,
        completedAt: task.completedAt,
        failedAt: task.failedAt,
      },
      { now: (input.now ?? new Date()).getTime(), timeZone, missed, penalised },
    );
    const adjustment = adjustmentFor(
      { net, outcome: (last?.outcome as DisciplineOutcome | undefined) ?? null },
      target,
    );
    if (!adjustment) return null;

    const attributeId = await ensureDisciplineAttribute(tx, input.userId);
    const [row] = await tx
      .insert(disciplineLedger)
      .values({
        userId: input.userId,
        attributeId,
        taskId: input.taskId,
        taskTitle: task.title,
        seq: (last?.seq ?? 0) + 1,
        reason: reasonFor(target, task.category as DisciplineCategory),
        outcome: target,
        points: adjustment.points,
        netAfter: DISCIPLINE_POINTS[target],
        sourceKey: input.sourceKey,
        createdAt: input.now,
      })
      .returning();
    return toEntry(row!);
  });
}

/** Open, planned tasks past their deadline (in each user's time zone) never marked overdue. */
const overdueCandidates = (now: Date, userId?: string) => sql`
  with open_tasks as (
    select t.id, t.user_id, t.planned_at,
      ((t.due_date + coalesce(t.due_time, time '00:00')
        + case when t.due_time is null then interval '1 day' else interval '0' end)::timestamp
       at time zone coalesce(us.time_zone, ${defaultTimeZone})) as deadline
    from ${tasks} t
    join ${taskStatuses} s on s.id = t.status_id
    left join ${userSettings} us on us.user_id = t.user_id
    where t.deleted_at is null
      and s.category in ('backlog', 'unstarted', 'started')
      and t.due_date is not null
      and t.planned_at is not null
      and not t.planned_at_inferred
      ${userId ? sql`and t.user_id = ${userId}` : sql``}
  )
  select o.id as task_id, o.user_id
  from open_tasks o
  where o.deadline <= ${now.toISOString()}::timestamptz
    and o.planned_at + interval '1 hour' <= o.deadline
    and not exists (
      select 1 from ${disciplineLedger} d where d.task_id = o.id and d.outcome = 'overdue'
    )
  order by o.deadline
  limit 500
`;

/**
 * The overdue sweep, run by the automation worker's tick (and 立即检查 for one user). Each task is
 * reconciled in its own transaction: overlapping sweeps serialise on the task lock and the second
 * finds nothing to do. After downtime a task is penalised once, at the first sweep after its
 * deadline (unless it was completed or closed in between — then that outcome is scored instead).
 */
export async function sweepOverdueDiscipline(
  db: Database,
  options: { userId?: string; now?: Date } = {},
): Promise<{ penalised: number; failed: number }> {
  const now = options.now ?? new Date();
  const result = await db.execute<{ task_id: string; user_id: string }>(
    overdueCandidates(now, options.userId),
  );
  let penalised = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      const entry = await reconcileTaskDiscipline(db, {
        userId: row.user_id,
        taskId: row.task_id,
        sourceKey: `overdue:${row.task_id}`,
        now,
      });
      if (entry?.outcome === "overdue") penalised += 1;
    } catch (error) {
      failed += 1;
      console.error("discipline.sweep failed", (error as Error).name);
    }
  }
  return { penalised, failed };
}

/* ---------------------------------------------------------------- read side */

export async function getDisciplineSummary(
  db: DbExecutor,
  userId: string,
  limit: number,
): Promise<DisciplineSummary> {
  const [attribute] = await db
    .select({ id: developmentAttributes.id, onRadar: developmentAttributes.onRadar })
    .from(developmentAttributes)
    .where(
      and(
        eq(developmentAttributes.userId, userId),
        eq(developmentAttributes.systemKey, DISCIPLINE_KEY),
      ),
    );
  const [totals] = await db
    .select({
      score: sql<number>`coalesce(sum(${disciplineLedger.points}), 0)::int`,
      tasks: sql<number>`count(distinct ${disciplineLedger.taskId})::int`,
    })
    .from(disciplineLedger)
    .where(eq(disciplineLedger.userId, userId));
  const rows = await db
    .select()
    .from(disciplineLedger)
    .where(eq(disciplineLedger.userId, userId))
    .orderBy(desc(disciplineLedger.createdAt), desc(disciplineLedger.seq))
    .limit(limit);
  return {
    attributeId: attribute?.id ?? "",
    score: totals?.score ?? 0,
    onRadar: attribute?.onRadar ?? true,
    scoredTasks: totals?.tasks ?? 0,
    entries: rows.map(toEntry),
  };
}

export async function getTaskDiscipline(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<TaskDiscipline> {
  const rows = await db
    .select()
    .from(disciplineLedger)
    .where(and(eq(disciplineLedger.userId, userId), eq(disciplineLedger.taskId, taskId)))
    .orderBy(asc(disciplineLedger.seq));
  return {
    net: rows.reduce((sum, r) => sum + r.points, 0),
    outcome: (rows.at(-1)?.outcome as DisciplineOutcome | undefined) ?? null,
    entries: rows.map(toEntry),
  };
}
