import { and, asc, count, eq, gte, isNull, lte, notInArray, sql } from "drizzle-orm";

import { getUserSettings } from "@/modules/settings/server";
import type { Database, DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { defaultTimeZone } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";

import {
  automationEffects,
  automationEvents,
  automationExecutions,
  automationRules,
  automationWorkerStatus,
} from "../db";
import {
  classifyError,
  evaluateConditions,
  executionStatusOf,
  LIMITS,
  localDate,
  parseStoredRule,
  planDue,
  triggerKey,
  type Action,
  type ActionResult,
  type Condition,
  type EventTriggerType,
  type Facts,
  type Schedule,
  type SkipReason,
  type TriggerType,
} from "../domain";
import { runAction } from "./actions";
import { busWithOrigin } from "./capture";

/*
 * The execution engine (ADR 0020).
 *
 * - Events: the outbox is drained after each change (and by the worker). Each event is processed
 *   in its own transaction holding its row lock (SKIP LOCKED), so concurrent drains never process
 *   the same event; the unique (rule, trigger key) index makes a rule run once per occurrence even
 *   if the same logical occurrence is delivered again.
 * - Actions: each runs in a savepoint together with its effect record, so an action's effect and
 *   the proof that it ran commit together. A retry skips actions that already have an effect:
 *   effects are at most once, never duplicated.
 */

export interface EngineDeps {
  db: Database;
  bus: EventBus;
}

type RuleRow = typeof automationRules.$inferSelect;

interface Occurrence {
  triggerType: TriggerType;
  key: string;
  eventId: string | null;
  scheduledFor: Date | null;
  occurredAt: Date;
  facts: Facts;
  depth: number;
  chain: string[];
  missed: number;
  /** Forced skip (e.g. a misfired schedule). */
  skip?: SkipReason;
}

async function ruleTimeZone(db: DbExecutor, rule: RuleRow) {
  if (rule.timeZone) return rule.timeZone;
  const settings = await getUserSettings(db, rule.userId);
  return settings.timeZone ?? defaultTimeZone;
}

async function recentExecutions(db: DbExecutor, ruleId: string, since: Date) {
  const [row] = await db
    .select({ n: count() })
    .from(automationExecutions)
    .where(
      and(
        eq(automationExecutions.ruleId, ruleId),
        gte(automationExecutions.startedAt, since),
        sql`${automationExecutions.status} <> 'skipped'`,
      ),
    );
  return row?.n ?? 0;
}

async function setStatementTimeout(db: DbExecutor) {
  await db.execute(sql.raw(`set local statement_timeout = ${LIMITS.statementTimeoutMs}`));
}

/**
 * Runs the not-yet-done actions of an execution, in order, stopping at the first failure. An
 * action that already has an effect (an earlier attempt) is reported as succeeded and not rerun.
 */
async function runActions(
  db: DbExecutor,
  bus: EventBus,
  execution: { id: string; userId: string; ruleId: string; depth: number; chain: string[] },
  actions: readonly Action[],
  facts: Facts,
  day: string,
): Promise<{ results: ActionResult[]; errorCode: string | null; retryable: boolean }> {
  const done = new Map(
    (
      await db
        .select({ index: automationEffects.actionIndex, entityId: automationEffects.entityId })
        .from(automationEffects)
        .where(eq(automationEffects.executionId, execution.id))
    ).map((row) => [row.index, row.entityId]),
  );
  const origin = { depth: execution.depth + 1, ruleIds: [...execution.chain, execution.ruleId] };
  const chained = busWithOrigin(bus, origin);
  const results: ActionResult[] = [];
  let failure: { code: string; retryable: boolean } | null = null;

  for (const [index, action] of actions.slice(0, LIMITS.actions).entries()) {
    if (done.has(index)) {
      results.push({ index, type: action.type, outcome: "succeeded", entityId: done.get(index) });
      continue;
    }
    if (failure) {
      results.push({ index, type: action.type, outcome: "not_run" });
      continue;
    }
    try {
      const effect = await db.transaction(async (sp) => {
        const result = await runAction(
          {
            db: sp,
            bus: chained,
            userId: execution.userId,
            ruleId: execution.ruleId,
            facts,
            localDate: day,
          },
          action,
        );
        await sp.insert(automationEffects).values({
          executionId: execution.id,
          actionIndex: index,
          userId: execution.userId,
          ...result,
        });
        return result;
      });
      results.push({ index, type: action.type, outcome: "succeeded", entityId: effect.entityId });
    } catch (error) {
      failure = classifyError(error);
      results.push({ index, type: action.type, outcome: "failed", errorCode: failure.code });
    }
  }
  return { results, errorCode: failure?.code ?? null, retryable: failure?.retryable ?? false };
}

/**
 * One rule, one occurrence. Records exactly one execution per (rule, trigger key); a repeated
 * occurrence only increments `duplicates`.
 */
export async function executeRule(
  db: DbExecutor,
  bus: EventBus,
  rule: RuleRow,
  occurrence: Occurrence,
  now = new Date(),
): Promise<string | null> {
  const parsed = parseStoredRule(rule);
  let skip: SkipReason | null = occurrence.skip ?? null;
  if (!skip && !parsed.ok) skip = "invalid_config";
  if (!skip && occurrence.chain.includes(rule.id)) skip = "loop";
  if (!skip && occurrence.depth > LIMITS.chainDepth) skip = "depth";
  if (
    !skip &&
    (await recentExecutions(db, rule.id, new Date(now.getTime() - 3_600_000))) >=
      LIMITS.executionsPerHour
  ) {
    skip = "rate_limited";
  }

  const snapshot = parsed.ok
    ? { conditions: parsed.config.conditions, actions: parsed.config.actions }
    : { conditions: [], actions: [] };
  const [inserted] = await db
    .insert(automationExecutions)
    .values({
      userId: rule.userId,
      ruleId: rule.id,
      triggerType: occurrence.triggerType,
      triggerKey: occurrence.key,
      eventId: occurrence.eventId,
      scheduledFor: occurrence.scheduledFor,
      facts: occurrence.facts,
      ruleSnapshot: snapshot,
      depth: occurrence.depth,
      chainRuleIds: occurrence.chain,
      status: skip ? "skipped" : "running",
      skipReason: skip,
      missedOccurrences: occurrence.missed,
      startedAt: now,
      completedAt: skip ? now : null,
    })
    .onConflictDoNothing({ target: [automationExecutions.ruleId, automationExecutions.triggerKey] })
    .returning({ id: automationExecutions.id });

  if (!inserted) {
    // The same occurrence again (redelivery, a re-completed task): visible, never re-run.
    await db
      .update(automationExecutions)
      .set({ duplicates: sql`${automationExecutions.duplicates} + 1` })
      .where(
        and(
          eq(automationExecutions.ruleId, rule.id),
          eq(automationExecutions.triggerKey, occurrence.key),
        ),
      );
    return null;
  }
  if (skip || !parsed.ok) return inserted.id;

  const { matched, results: conditionResults } = evaluateConditions(
    parsed.config.conditions,
    occurrence.facts,
  );
  if (!matched) {
    await db
      .update(automationExecutions)
      .set({
        status: "skipped",
        skipReason: "conditions_not_met",
        conditionResults,
        completedAt: now,
      })
      .where(eq(automationExecutions.id, inserted.id));
    return inserted.id;
  }

  const zone = await ruleTimeZone(db, rule);
  const day =
    occurrence.facts.kind === "schedule"
      ? occurrence.facts.localDate
      : localDate(occurrence.occurredAt.getTime(), zone);
  const outcome = await runActions(
    db,
    bus,
    {
      id: inserted.id,
      userId: rule.userId,
      ruleId: rule.id,
      depth: occurrence.depth,
      chain: occurrence.chain,
    },
    parsed.config.actions,
    occurrence.facts,
    day,
  );
  await db
    .update(automationExecutions)
    .set({
      status: executionStatusOf(outcome.results),
      conditionResults,
      actionResults: outcome.results,
      errorCode: outcome.errorCode,
      retryable: outcome.retryable,
      completedAt: new Date(),
    })
    .where(eq(automationExecutions.id, inserted.id));
  await db
    .update(automationRules)
    .set({ lastTriggeredAt: now })
    .where(eq(automationRules.id, rule.id));
  return inserted.id;
}

/* ---------------------------------------------------------------- events */

type EventRow = typeof automationEvents.$inferSelect;

async function processEvent(db: DbExecutor, bus: EventBus, event: EventRow) {
  const type = event.eventType as EventTriggerType;
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.userId, event.userId),
        eq(automationRules.triggerType, type),
        eq(automationRules.enabled, true),
        isNull(automationRules.archivedAt),
        // Rules enabled (or edited) after the event never see it: no retroactive runs.
        lte(automationRules.enabledAt, event.occurredAt),
      ),
    )
    .orderBy(asc(automationRules.createdAt));
  const facts = event.facts as Facts;
  for (const rule of rules) {
    await executeRule(db, bus, rule, {
      triggerType: type,
      key: triggerKey(type, { eventId: event.id, facts }),
      eventId: event.id,
      scheduledFor: null,
      occurredAt: event.occurredAt,
      facts,
      depth: event.depth,
      chain: event.chainRuleIds as string[],
      missed: 0,
    });
  }
}

/** Events that keep failing (an engine error, not an action failure) stop being retried. */
const MAX_EVENT_ATTEMPTS = 5;

/**
 * Processes pending outbox events (of one user, or everyone for the worker), oldest first, each
 * in its own transaction. Bounded per call; anything left waits for the next drain.
 */
export async function drainEvents(
  deps: EngineDeps,
  filter: { userId?: string } = {},
): Promise<{ processed: number; failed: number }> {
  const attempted: string[] = [];
  let processed = 0;
  let failed = 0;
  while (attempted.length < LIMITS.eventsPerDrain) {
    let eventId: string | null = null;
    // The event this iteration claimed (null until the claim succeeded).
    let claimed: string | null = null;
    try {
      eventId = await deps.db.transaction(async (tx) => {
        const [event] = await tx
          .select()
          .from(automationEvents)
          .where(
            and(
              eq(automationEvents.status, "pending"),
              filter.userId ? eq(automationEvents.userId, filter.userId) : undefined,
              attempted.length ? notInArray(automationEvents.id, attempted) : undefined,
            ),
          )
          .orderBy(asc(automationEvents.createdAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!event) return null;
        attempted.push(event.id);
        claimed = event.id;
        await setStatementTimeout(tx);
        await processEvent(tx, deps.bus, event);
        await tx
          .update(automationEvents)
          .set({ status: "processed", processedAt: new Date(), attempts: event.attempts + 1 })
          .where(eq(automationEvents.id, event.id));
        return event.id;
      });
    } catch (error) {
      failed += 1;
      // Nothing claimed: the database itself is failing. Stop; the next drain tries again.
      if (claimed === null) break;
      const { code } = classifyError(error);
      console.error(`automation.drain: event failed (${code})`);
      try {
        await deps.db
          .update(automationEvents)
          .set({
            attempts: sql`${automationEvents.attempts} + 1`,
            lastError: code,
            status: sql`case when ${automationEvents.attempts} + 1 >= ${MAX_EVENT_ATTEMPTS} then 'failed' else 'pending' end`,
          })
          .where(and(eq(automationEvents.id, claimed), eq(automationEvents.status, "pending")));
      } catch {
        break;
      }
      continue;
    }
    if (eventId === null) break;
    processed += 1;
  }
  return { processed, failed };
}

/* ---------------------------------------------------------------- schedules */

/**
 * Runs due scheduled rules (of one user, or everyone for the worker). Each rule is processed in
 * its own transaction holding its row lock; the misfire policy (`planDue`) coalesces missed
 * occurrences into one run when within the grace period, or one skipped record otherwise.
 */
export async function tickSchedules(
  deps: EngineDeps,
  options: { userId?: string; now?: Date } = {},
): Promise<{ executed: number; missed: number; failed: number }> {
  const now = options.now ?? new Date();
  let executed = 0;
  let missed = 0;
  let failed = 0;
  // Rules tried in this tick: a rule that fails stays due, but cannot block the others.
  const attempted: string[] = [];
  for (let i = 0; i < LIMITS.schedulesPerTick; i += 1) {
    let claimed: string | null = null;
    let handled: boolean;
    try {
      handled = await deps.db.transaction(async (tx) => {
        const [rule] = await tx
          .select()
          .from(automationRules)
          .where(
            and(
              eq(automationRules.triggerType, "schedule"),
              eq(automationRules.enabled, true),
              lte(automationRules.nextRunAt, now),
              options.userId ? eq(automationRules.userId, options.userId) : undefined,
              attempted.length ? notInArray(automationRules.id, attempted) : undefined,
            ),
          )
          .orderBy(asc(automationRules.nextRunAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!rule) return false;
        attempted.push(rule.id);
        claimed = rule.id;
        await setStatementTimeout(tx);
        const parsed = parseStoredRule(rule);
        if (!parsed.ok || parsed.config.trigger.type !== "schedule") {
          // Recorded as skipped (invalid_config) so it is visible, then taken off the schedule.
          const at = rule.nextRunAt!;
          const facts: Facts = {
            kind: "schedule",
            scheduledFor: at.toISOString(),
            localDate: at.toISOString().slice(0, 10),
          };
          await executeRule(
            tx,
            deps.bus,
            rule,
            {
              triggerType: "schedule",
              key: triggerKey("schedule", { facts }),
              eventId: null,
              scheduledFor: at,
              occurredAt: at,
              facts,
              depth: 0,
              chain: [],
              missed: 0,
              skip: "invalid_config",
            },
            now,
          );
          await tx
            .update(automationRules)
            .set({ nextRunAt: null })
            .where(eq(automationRules.id, rule.id));
          missed += 1;
          return true;
        }
        const zone = await ruleTimeZone(tx, rule);
        const schedule: Schedule = parsed.config.trigger.schedule;
        const plan = planDue(schedule, zone, rule.nextRunAt!.getTime(), now.getTime());
        const at = new Date(plan.run ?? plan.latest);
        const facts: Facts = {
          kind: "schedule",
          scheduledFor: at.toISOString(),
          localDate: localDate(at.getTime(), zone),
        };
        await executeRule(
          tx,
          deps.bus,
          rule,
          {
            triggerType: "schedule",
            key: triggerKey("schedule", { facts }),
            eventId: null,
            scheduledFor: at,
            occurredAt: at,
            facts,
            depth: 0,
            chain: [],
            missed: plan.skipped,
            skip: plan.run === null ? "misfired" : undefined,
          },
          now,
        );
        if (plan.run === null) missed += 1;
        else executed += 1;
        await tx
          .update(automationRules)
          .set({ nextRunAt: plan.next === null ? null : new Date(plan.next) })
          .where(eq(automationRules.id, rule.id));
        return true;
      });
    } catch (error) {
      failed += 1;
      console.error(
        `automation.schedule: rule ${claimed ?? "?"} failed (${classifyError(error).code})`,
      );
      // Nothing claimed: the database itself is failing; stop this tick.
      if (claimed === null) break;
      continue;
    }
    if (!handled) break;
  }
  return { executed, missed, failed };
}

/** The worker's tick: schedules of everyone, then pending events, then a heartbeat. */
export async function workerTick(deps: EngineDeps, now = new Date()) {
  const schedules = await tickSchedules(deps, { now });
  const events = await drainEvents(deps);
  const summary = {
    executed: schedules.executed,
    missed: schedules.missed,
    failed: schedules.failed,
    events: events.processed,
    failedEvents: events.failed,
  };
  await deps.db
    .insert(automationWorkerStatus)
    .values({ id: "worker", lastTickAt: now, lastTickSummary: summary })
    .onConflictDoUpdate({
      target: automationWorkerStatus.id,
      set: { lastTickAt: now, lastTickSummary: summary },
    });
  return summary;
}

/* ---------------------------------------------------------------- retry */

/**
 * Retries a failed or partial execution: same execution (same idempotency key), same rule
 * snapshot, only the actions without an effect. Only for retryable failures of an enabled rule,
 * at most LIMITS.retries times.
 */
export function retryExecution(deps: EngineDeps, userId: string, executionId: string) {
  return deps.db.transaction(async (tx) => {
    const [execution] = await tx
      .select()
      .from(automationExecutions)
      .where(and(eq(automationExecutions.id, executionId), eq(automationExecutions.userId, userId)))
      .for("update");
    if (!execution) throw new DomainError("not_found", "automation.execution_not_found");
    if (!["failed", "partial"].includes(execution.status) || !execution.retryable) {
      throw new DomainError("invalid", "automation.not_retryable");
    }
    if (execution.attempts > LIMITS.retries)
      throw new DomainError("invalid", "automation.retry_limit");
    const [rule] = await tx
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, execution.ruleId), eq(automationRules.userId, userId)));
    if (!rule?.enabled) throw new DomainError("invalid", "automation.rule_disabled");

    await setStatementTimeout(tx);
    const snapshot = execution.ruleSnapshot as { conditions: Condition[]; actions: Action[] };
    const facts = execution.facts as Facts;
    const zone = await ruleTimeZone(tx, rule);
    const day =
      facts.kind === "schedule" ? facts.localDate : localDate(execution.startedAt.getTime(), zone);
    const outcome = await runActions(
      tx,
      deps.bus,
      {
        id: execution.id,
        userId,
        ruleId: rule.id,
        depth: execution.depth,
        chain: execution.chainRuleIds as string[],
      },
      snapshot.actions,
      facts,
      day,
    );
    await tx
      .update(automationExecutions)
      .set({
        status: executionStatusOf(outcome.results),
        actionResults: outcome.results,
        errorCode: outcome.errorCode,
        retryable: outcome.retryable,
        attempts: execution.attempts + 1,
        completedAt: new Date(),
      })
      .where(eq(automationExecutions.id, execution.id));
    return { status: executionStatusOf(outcome.results) };
  });
}
