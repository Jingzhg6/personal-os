import { and, asc, eq, inArray } from "drizzle-orm";

import type { TaskDeps } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyForMove } from "@/shared/lib/order";

import { developmentGoals, developmentPlans, developmentPlanTasks } from "../db";
import {
  goalStatusChange,
  type CreatePlanInput,
  type CreatePlanTaskInput,
  type DevelopmentPlan,
  type PlanStatus,
  type UpdatePlanInput,
} from "../domain";
import { createGoalTask, linkTask } from "./goals";

/*
 * Growth plans: ways of reaching a goal ("建立每日法语输入习惯"). A plan is not a task — it groups
 * existing tasks, which stay independent (completing a plan completes nothing). A plan's task is
 * always linked to the plan's goal too: the database's composite keys enforce it, and linking a task
 * to a plan links it to the goal first (with the usual default allocation).
 */

type PlanRow = typeof developmentPlans.$inferSelect;

function toPlan(row: PlanRow): DevelopmentPlan {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    description: row.description,
    status: row.status as PlanStatus,
    sortKey: row.sortKey,
    completedAt: row.completedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}

/** The user's plans of the given goals (all statuses), in order. */
export async function listPlans(
  db: DbExecutor,
  userId: string,
  goalIds: string[],
): Promise<DevelopmentPlan[]> {
  if (goalIds.length === 0) return [];
  const rows = await db
    .select()
    .from(developmentPlans)
    .where(and(eq(developmentPlans.userId, userId), inArray(developmentPlans.goalId, goalIds)))
    .orderBy(asc(developmentPlans.sortKey), asc(developmentPlans.id));
  return rows.map(toPlan);
}

/** plan id → linked task ids, in link order. */
export async function planTaskIds(db: DbExecutor, planIds: string[]) {
  const map = new Map<string, string[]>();
  if (planIds.length === 0) return map;
  const rows = await db
    .select({ planId: developmentPlanTasks.planId, taskId: developmentPlanTasks.taskId })
    .from(developmentPlanTasks)
    .where(inArray(developmentPlanTasks.planId, planIds))
    .orderBy(asc(developmentPlanTasks.createdAt));
  for (const row of rows) map.set(row.planId, [...(map.get(row.planId) ?? []), row.taskId]);
  return map;
}

async function getOwnedPlan(db: DbExecutor, userId: string, id: string, lock = false) {
  const select = db
    .select()
    .from(developmentPlans)
    .where(and(eq(developmentPlans.id, id), eq(developmentPlans.userId, userId)));
  const [row] = lock ? await select.for("update") : await select;
  if (!row) throw new DomainError("not_found", "plan.not_found");
  return row;
}

async function assertGoalAcceptsPlans(db: DbExecutor, userId: string, goalId: string) {
  const [goal] = await db
    .select({ status: developmentGoals.status })
    .from(developmentGoals)
    .where(and(eq(developmentGoals.id, goalId), eq(developmentGoals.userId, userId)));
  if (!goal) throw new DomainError("not_found", "goal.not_found");
  if (goal.status === "archived") throw new DomainError("invalid", "goal.archived");
}

export function createPlan(
  db: DbExecutor,
  userId: string,
  input: CreatePlanInput,
): Promise<DevelopmentPlan> {
  return db.transaction(async (tx) => {
    await assertGoalAcceptsPlans(tx, userId, input.goalId);
    const siblings = await listPlans(tx, userId, [input.goalId]);
    const [row] = await tx
      .insert(developmentPlans)
      .values({
        userId,
        goalId: input.goalId,
        title: input.title,
        description: input.description || null,
        sortKey: keyAfter(siblings.at(-1)?.sortKey ?? null),
      })
      .returning();
    return toPlan(row!);
  });
}

export async function updatePlan(
  db: DbExecutor,
  userId: string,
  { id, patch }: UpdatePlanInput,
): Promise<DevelopmentPlan> {
  await getOwnedPlan(db, userId, id);
  const [row] = await db
    .update(developmentPlans)
    .set({
      ...patch,
      ...(patch.description !== undefined ? { description: patch.description || null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(developmentPlans.id, id), eq(developmentPlans.userId, userId)))
    .returning();
  return toPlan(row!);
}

/** Same transitions as goals; restoring a plan of an archived goal is refused. */
export function setPlanStatus(
  db: DbExecutor,
  userId: string,
  id: string,
  status: PlanStatus,
): Promise<DevelopmentPlan> {
  return db.transaction(async (tx) => {
    const row = await getOwnedPlan(tx, userId, id, true);
    if (row.status === "archived" && status !== "archived") {
      await assertGoalAcceptsPlans(tx, userId, row.goalId);
    }
    const change = goalStatusChange(
      { status: row.status as PlanStatus, completedAt: row.completedAt },
      status,
      new Date(),
    );
    const [updated] = await tx
      .update(developmentPlans)
      .set({ ...change, updatedAt: new Date() })
      .where(and(eq(developmentPlans.id, id), eq(developmentPlans.userId, userId)))
      .returning();
    return toPlan(updated!);
  });
}

export async function movePlan(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const row = await getOwnedPlan(db, userId, id);
  const siblings = await listPlans(db, userId, [row.goalId]);
  const key = keyForMove(
    siblings.map((p) => p.sortKey),
    siblings.findIndex((p) => p.id === id),
    direction,
  );
  if (key) {
    await db
      .update(developmentPlans)
      .set({ sortKey: key })
      .where(and(eq(developmentPlans.id, id), eq(developmentPlans.userId, userId)));
  }
}

/** Permanent; its task links go with it. Tasks, goal links and allocations stay. */
export async function deletePlan(db: DbExecutor, userId: string, id: string): Promise<void> {
  await getOwnedPlan(db, userId, id);
  await db
    .delete(developmentPlans)
    .where(and(eq(developmentPlans.id, id), eq(developmentPlans.userId, userId)));
}

async function assertPlanAcceptsTasks(db: DbExecutor, userId: string, planId: string) {
  const plan = await getOwnedPlan(db, userId, planId);
  if (plan.status === "archived") throw new DomainError("invalid", "plan.archived");
  return plan;
}

/** Links an existing task to a plan — and to the plan's goal, if it is not yet. */
export function linkPlanTask(db: DbExecutor, userId: string, planId: string, taskId: string) {
  return db.transaction(async (tx) => {
    const plan = await assertPlanAcceptsTasks(tx, userId, planId);
    await linkTask(tx, userId, plan.goalId, taskId);
    await tx
      .insert(developmentPlanTasks)
      .values({ planId, goalId: plan.goalId, taskId })
      .onConflictDoNothing();
  });
}

/** Removes the task from the plan only; it stays linked to the goal. */
export async function unlinkPlanTask(
  db: DbExecutor,
  userId: string,
  planId: string,
  taskId: string,
) {
  await getOwnedPlan(db, userId, planId);
  await db
    .delete(developmentPlanTasks)
    .where(and(eq(developmentPlanTasks.planId, planId), eq(developmentPlanTasks.taskId, taskId)));
}

/** An ordinary task, created through the goal (link + default allocation) and put in the plan. */
export function createPlanTask(deps: TaskDeps, userId: string, input: CreatePlanTaskInput) {
  return deps.db.transaction(async (tx) => {
    const plan = await assertPlanAcceptsTasks(tx, userId, input.planId);
    const task = await createGoalTask({ db: tx, bus: deps.bus }, userId, {
      goalId: plan.goalId,
      task: input.task,
      useGoalAttributes: input.useGoalAttributes,
    });
    await tx
      .insert(developmentPlanTasks)
      .values({ planId: plan.id, goalId: plan.goalId, taskId: task.id });
    return task;
  });
}
