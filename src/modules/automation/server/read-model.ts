import { and, asc, count, desc, eq, isNotNull, isNull, lte, max, min, sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";

import {
  automationEvents,
  automationExecutions,
  automationNotifications,
  automationRules,
  automationWorkerStatus,
} from "../db";
import {
  factsSubject,
  WORKER_STALE_MS,
  type Facts,
  type ActionResult,
  type AutomationExecution,
  type AutomationHealth,
  type AutomationNotification,
  type ConditionResult,
  type ExecutionStatus,
  type SkipReason,
} from "../domain";

type ExecutionRow = typeof automationExecutions.$inferSelect;

function toExecution(row: ExecutionRow): AutomationExecution {
  return {
    id: row.id,
    ruleId: row.ruleId,
    triggerKey: row.triggerKey,
    triggerType: row.triggerType,
    subject: factsSubject(row.facts as Facts),
    status: row.status as ExecutionStatus,
    skipReason: row.skipReason as SkipReason | null,
    conditionResults: row.conditionResults as ConditionResult[],
    actionResults: row.actionResults as ActionResult[],
    errorCode: row.errorCode,
    retryable: row.retryable,
    attempts: row.attempts,
    duplicates: row.duplicates,
    depth: row.depth,
    missedOccurrences: row.missedOccurrences,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export async function listExecutions(
  db: DbExecutor,
  userId: string,
  ruleId: string,
  limit: number,
): Promise<AutomationExecution[]> {
  const rows = await db
    .select()
    .from(automationExecutions)
    .where(and(eq(automationExecutions.userId, userId), eq(automationExecutions.ruleId, ruleId)))
    .orderBy(desc(automationExecutions.startedAt))
    .limit(limit);
  return rows.map(toExecution);
}

export async function listNotifications(
  db: DbExecutor,
  userId: string,
): Promise<{ items: AutomationNotification[]; unread: number }> {
  const items = await db
    .select({
      id: automationNotifications.id,
      ruleId: automationNotifications.ruleId,
      title: automationNotifications.title,
      body: automationNotifications.body,
      readAt: automationNotifications.readAt,
      createdAt: automationNotifications.createdAt,
    })
    .from(automationNotifications)
    .where(eq(automationNotifications.userId, userId))
    .orderBy(desc(automationNotifications.createdAt))
    .limit(100);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(automationNotifications)
    .where(and(eq(automationNotifications.userId, userId), isNull(automationNotifications.readAt)));
  return { items, unread: n };
}

export async function markNotificationsRead(db: DbExecutor, userId: string, id: string | null) {
  await db
    .update(automationNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(automationNotifications.userId, userId),
        isNull(automationNotifications.readAt),
        id ? eq(automationNotifications.id, id) : undefined,
      ),
    );
}

export async function getHealth(
  db: DbExecutor,
  userId: string,
  options: { schedulerConfigured: boolean; now?: Date },
): Promise<AutomationHealth> {
  const now = options.now ?? new Date();
  const [pending] = await db
    .select({ n: count(), oldest: min(automationEvents.createdAt) })
    .from(automationEvents)
    .where(and(eq(automationEvents.userId, userId), eq(automationEvents.status, "pending")));
  const [processed] = await db
    .select({ last: max(automationEvents.processedAt) })
    .from(automationEvents)
    .where(and(eq(automationEvents.userId, userId), isNotNull(automationEvents.processedAt)));
  const [worker] = await db
    .select()
    .from(automationWorkerStatus)
    .where(eq(automationWorkerStatus.id, "worker"));
  const scheduleFilter = and(
    eq(automationRules.userId, userId),
    eq(automationRules.triggerType, "schedule"),
    eq(automationRules.enabled, true),
  );
  const [scheduled] = await db.select({ n: count() }).from(automationRules).where(scheduleFilter);
  const [due] = await db
    .select({ n: count() })
    .from(automationRules)
    .where(and(scheduleFilter, lte(automationRules.nextRunAt, now)));
  const failures = await db
    .select({
      executionId: automationExecutions.id,
      ruleId: automationExecutions.ruleId,
      ruleName: automationRules.name,
      errorCode: automationExecutions.errorCode,
      at: automationExecutions.startedAt,
    })
    .from(automationExecutions)
    .innerJoin(automationRules, eq(automationRules.id, automationExecutions.ruleId))
    .where(
      and(
        eq(automationExecutions.userId, userId),
        sql`${automationExecutions.status} in ('failed', 'partial')`,
      ),
    )
    .orderBy(desc(automationExecutions.startedAt))
    .limit(5);
  const [success] = await db
    .select({ at: max(automationExecutions.completedAt) })
    .from(automationExecutions)
    .where(
      and(eq(automationExecutions.userId, userId), eq(automationExecutions.status, "succeeded")),
    );
  const lastTickAt = worker?.lastTickAt ?? null;
  return {
    events: {
      pending: pending?.n ?? 0,
      oldestPendingAt: pending?.oldest ?? null,
      lastProcessedAt: processed?.last ?? null,
    },
    scheduler: {
      configured: options.schedulerConfigured,
      lastTickAt,
      operational:
        options.schedulerConfigured &&
        lastTickAt !== null &&
        now.getTime() - lastTickAt.getTime() <= WORKER_STALE_MS,
      scheduledRules: scheduled?.n ?? 0,
      dueRules: due?.n ?? 0,
    },
    recentFailures: failures,
    lastSuccessAt: success?.at ?? null,
  };
}

/** Oldest first, for tests and diagnostics. */
export async function listPendingEvents(db: DbExecutor, userId: string) {
  return db
    .select({ id: automationEvents.id, eventType: automationEvents.eventType })
    .from(automationEvents)
    .where(and(eq(automationEvents.userId, userId), eq(automationEvents.status, "pending")))
    .orderBy(asc(automationEvents.createdAt));
}
