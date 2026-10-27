import { and, eq } from "drizzle-orm";

import { getTask } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import type { DomainEvent, EventContext, EventOrigin } from "@/shared/events/types";

import { automationEvents, automationRules } from "../db";
import type { EventTriggerType, Facts } from "../domain";

/*
 * Capture: subscribers that copy automatable events into the outbox, inside the publisher's
 * transaction (the event exists if and only if the change committed). Nothing runs here; rules
 * are executed after commit by the engine. Only written when the user has an enabled rule for
 * the event type, so the outbox stays empty for everyone else.
 */

async function hasEnabledRule(db: DbExecutor, userId: string, type: EventTriggerType) {
  const [row] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.userId, userId),
        eq(automationRules.triggerType, type),
        eq(automationRules.enabled, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Wraps a bus so events published by an automation's actions carry its chain (loop guard). */
export function busWithOrigin(bus: EventBus, origin: EventOrigin): EventBus {
  return {
    subscribe: bus.subscribe,
    publish: (input, ctx) => bus.publish(input, { ...ctx, origin }),
  };
}

async function capture(
  type: EventTriggerType,
  event: DomainEvent,
  ctx: EventContext,
  facts: (db: DbExecutor) => Promise<Facts | null>,
) {
  try {
    // A savepoint: a failure here (even in the rule lookup) must never undo the person's change.
    await ctx.db.transaction(async (sp) => {
      if (!(await hasEnabledRule(sp, event.userId, type))) return;
      const captured = await facts(sp);
      if (!captured) return;
      await sp
        .insert(automationEvents)
        .values({
          id: event.id,
          userId: event.userId,
          eventType: type,
          facts: captured,
          occurredAt: event.occurredAt,
          depth: ctx.origin?.depth ?? 0,
          chainRuleIds: ctx.origin?.ruleIds ?? [],
        })
        .onConflictDoNothing();
    });
  } catch (error) {
    // Logged without payload (it may contain personal data).
    console.error(`automation.capture failed for ${type}`, (error as Error).name);
  }
}

async function taskFacts(db: DbExecutor, userId: string, taskId: string): Promise<Facts> {
  const task = await getTask(db, userId, taskId);
  return {
    kind: "task",
    taskId: task.id,
    title: task.title,
    priority: task.priority,
    areaId: task.areaId,
    projectId: task.projectId,
    statusId: task.statusId,
  };
}

export function registerAutomationEventHandlers(bus: EventBus): void {
  bus.subscribe(
    "task.completed",
    (event, ctx) =>
      capture("task.completed", event, ctx, (db) =>
        taskFacts(db, event.userId, event.payload.taskId),
      ),
    { name: "automation.capture" },
  );
  bus.subscribe(
    "task.status_changed",
    (event, ctx) =>
      capture("task.status_changed", event, ctx, (db) =>
        taskFacts(db, event.userId, event.payload.taskId),
      ),
    { name: "automation.capture" },
  );
  bus.subscribe(
    "project.completed",
    (event, ctx) =>
      capture("project.completed", event, ctx, async () => ({
        kind: "project",
        projectId: event.payload.projectId,
        name: event.payload.name,
        priority: event.payload.priority,
        areaId: event.payload.areaId,
      })),
    { name: "automation.capture" },
  );
  bus.subscribe(
    "goal.status_changed",
    (event, ctx) =>
      capture("goal.status_changed", event, ctx, async () => ({
        kind: "goal",
        goalId: event.payload.goalId,
        title: event.payload.title,
        fromStatus: event.payload.fromStatus,
        toStatus: event.payload.toStatus,
      })),
    { name: "automation.capture" },
  );
  bus.subscribe(
    "finance.snapshot_saved",
    (event, ctx) =>
      capture("finance.snapshot_saved", event, ctx, async () => ({
        kind: "finance",
        valuationDate: event.payload.valuationDate,
        entryCount: event.payload.entryCount,
        unconvertedCount: event.payload.unconvertedCount,
        corrected: event.payload.corrected,
      })),
    { name: "automation.capture" },
  );
}
