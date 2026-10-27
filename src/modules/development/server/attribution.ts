import { and, eq, inArray } from "drizzle-orm";

import { getTaskGrowth } from "@/modules/character/server";
import { taskDevelopmentContributions } from "@/modules/tasks/db";
import { todayIn } from "@/modules/tasks/domain";
import { getTask } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { developmentGoalAllocations, developmentGoals, developmentGoalTasks } from "../db";
import {
  defaultAllocation,
  overAllocated,
  type Allocation,
  type GoalStatus,
  type SetTaskAllocationInput,
  type TaskAttributionView,
} from "../domain";

/*
 * Goal attribution (ADR 0018): which share of a linked task's Growth XP counts for which goal.
 * Only shares are stored; the XP stays in the character module's credits. Every write is checked
 * here (ownership, links, ≤ 100 % per attribute) and again by the database (FK to the goal ↔ task
 * link, CHECK on the share, trigger on the total).
 */

/** Attributes a task can allocate: its current contributions and any it earned Growth XP in. */
export async function taskAttributeIds(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<string[]> {
  const today = todayIn("UTC"); // only the lifetime figure matters here
  const [contributions, growth] = await Promise.all([
    db
      .select({ attributeId: taskDevelopmentContributions.attributeId })
      .from(taskDevelopmentContributions)
      .where(eq(taskDevelopmentContributions.taskId, taskId)),
    getTaskGrowth(db, userId, [taskId], { from: today, timeZone: "UTC" }),
  ]);
  return [
    ...new Set([...contributions.map((c) => c.attributeId), ...growth.map((g) => g.attributeId)]),
  ];
}

/** Goals (any status) the task is linked to, owned by the user. */
async function linkedGoals(db: DbExecutor, userId: string, taskId: string) {
  return db
    .select({
      id: developmentGoals.id,
      title: developmentGoals.title,
      status: developmentGoals.status,
    })
    .from(developmentGoalTasks)
    .innerJoin(developmentGoals, eq(developmentGoals.id, developmentGoalTasks.goalId))
    .where(and(eq(developmentGoalTasks.taskId, taskId), eq(developmentGoals.userId, userId)))
    .orderBy(developmentGoals.createdAt);
}

export async function listAllocations(db: DbExecutor, taskIds: string[]): Promise<Allocation[]> {
  if (taskIds.length === 0) return [];
  return db
    .select({
      goalId: developmentGoalAllocations.goalId,
      taskId: developmentGoalAllocations.taskId,
      attributeId: developmentGoalAllocations.attributeId,
      share: developmentGoalAllocations.share,
    })
    .from(developmentGoalAllocations)
    .where(inArray(developmentGoalAllocations.taskId, taskIds));
}

/**
 * Applies the default allocation right after `goal` was linked to `taskId` (ADR 0018): 100 % of
 * the task's growth in the goal's attributes if this is its only goal, nothing otherwise.
 */
export async function applyDefaultAllocation(
  db: DbExecutor,
  userId: string,
  goal: { id: string; attributes: readonly { attributeId: string }[] },
  taskId: string,
): Promise<void> {
  const goals = await linkedGoals(db, userId, taskId);
  const shares = defaultAllocation(
    goal,
    await taskAttributeIds(db, userId, taskId),
    goals.filter((g) => g.id !== goal.id).length,
  );
  if (shares.length === 0) return;
  await db
    .insert(developmentGoalAllocations)
    .values(shares.map((s) => ({ ...s, taskId })))
    .onConflictDoNothing();
}

/** Everything the allocation editor shows for one task. */
export async function getTaskAttribution(
  db: DbExecutor,
  userId: string,
  taskId: string,
): Promise<TaskAttributionView> {
  const task = await getTask(db, userId, taskId);
  const today = todayIn("UTC");
  const [goals, growth, allocations] = await Promise.all([
    linkedGoals(db, userId, taskId),
    // Only the lifetime figure is used here.
    getTaskGrowth(db, userId, [taskId], { from: today, timeZone: "UTC" }),
    listAllocations(db, [taskId]),
  ]);
  const weightOf = new Map(task.contributions.map((c) => [c.attributeId, c.weight]));
  const xpOf = new Map(growth.map((g) => [g.attributeId, g.lifetimeXp]));
  const ids = [...new Set([...weightOf.keys(), ...xpOf.keys()])];
  return {
    taskId,
    taskTitle: task.title,
    attributes: ids
      .map((attributeId) => ({
        attributeId,
        weight: weightOf.get(attributeId) ?? null,
        lifetimeXp: xpOf.get(attributeId) ?? 0,
      }))
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || b.lifetimeXp - a.lifetimeXp),
    goals: goals.map((g) => ({ ...g, status: g.status as GoalStatus })),
    allocations: allocations.filter((a) => goals.some((g) => g.id === a.goalId)),
  };
}

/**
 * Replaces the task's allocation over its non-archived goals. Shares of archived goals are kept
 * (and still count towards the 100 %); 0 means "not attributed".
 */
export function setTaskAllocation(
  db: DbExecutor,
  userId: string,
  input: SetTaskAllocationInput,
): Promise<TaskAttributionView> {
  return db.transaction(async (tx) => {
    await getTask(tx, userId, input.taskId);
    const goals = await linkedGoals(tx, userId, input.taskId);
    const statusOf = new Map(goals.map((g) => [g.id, g.status]));
    const allowed = new Set(await taskAttributeIds(tx, userId, input.taskId));
    for (const a of input.allocations) {
      const status = statusOf.get(a.goalId);
      if (!status) throw new DomainError("not_found", "goal.not_found");
      if (status === "archived") throw new DomainError("invalid", "goal.archived");
      if (!allowed.has(a.attributeId)) throw new DomainError("not_found", "attribute.not_found");
    }
    const keys = new Set(input.allocations.map((a) => `${a.goalId}:${a.attributeId}`));
    if (keys.size !== input.allocations.length) {
      throw new DomainError("invalid", "allocation.duplicate");
    }
    const editable = goals.filter((g) => g.status !== "archived").map((g) => g.id);
    const kept = (await listAllocations(tx, [input.taskId])).filter(
      (a) => statusOf.get(a.goalId) === "archived",
    );
    const next = input.allocations.filter((a) => a.share > 0);
    if (overAllocated([...kept, ...next]).length > 0) {
      throw new DomainError("invalid", "allocation.over_limit");
    }
    if (editable.length > 0) {
      await tx
        .delete(developmentGoalAllocations)
        .where(
          and(
            eq(developmentGoalAllocations.taskId, input.taskId),
            inArray(developmentGoalAllocations.goalId, editable),
          ),
        );
    }
    if (next.length > 0) {
      await tx
        .insert(developmentGoalAllocations)
        .values(next.map((a) => ({ ...a, taskId: input.taskId })));
    }
    return getTaskAttribution(tx, userId, input.taskId);
  });
}
