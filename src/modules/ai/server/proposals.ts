import "server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { createRule } from "@/modules/automation/server";
import { createGoalTask, listGoals } from "@/modules/development/server";
import { getTasksByIds, updateTask } from "@/modules/tasks/server";
import type { Database, DbExecutor } from "@/shared/db/types";
import type { EventBus } from "@/shared/events/bus";
import { DomainError } from "@/shared/lib/errors";

import { aiProposals, aiRequests } from "../db";
import {
  AI_LIMITS,
  changeTarget,
  staleRefs,
  type AiCapability,
  type AiProposal,
  type ApplyProposalInput,
  type ApplyResult,
  type ApplyResultItem,
  type GenerateInput,
  type ProposalAnalysis,
  type ProposalChange,
  type ProposalItem,
  type ProposalStatus,
  type SourceRef,
} from "../domain";

/*
 * Proposal storage and the approval flow. Applying is the only place an AI proposal turns into
 * changes, and it does so exclusively through the owning modules' services:
 *
 *   set_task_priority / set_task_contributions → tasks.updateTask
 *   create_goal_task                           → development.createGoalTask (→ tasks.createTask)
 *   create_automation_rule                     → automation.createRule (always saved disabled)
 *
 * Those services enforce their own rules (ownership, 自制力 is not a contribution target, rule
 * validation). Nothing here can reach XP, 自制力 ledgers, rewards, finance or auth.
 */

type Row = typeof aiProposals.$inferSelect;

function toProposal(row: Row, now: Date): AiProposal {
  const expired =
    row.status === "proposed" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
  return {
    id: row.id,
    capability: row.capability as AiCapability,
    status: expired ? "expired" : (row.status as ProposalStatus),
    request: row.request as GenerateInput,
    provider: row.provider,
    model: row.model,
    analysis: row.analysis as ProposalAnalysis,
    items: row.items as ProposalItem[],
    sourceRefs: row.sourceRefs as SourceRef[],
    labels: row.labels as Record<string, string>,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    applyResult: (row.applyResult as ApplyResult | null) ?? null,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
  };
}

const notFound = () => new DomainError("not_found", "ai.proposal_not_found");

export async function getProposal(
  db: DbExecutor,
  userId: string,
  id: string,
  now = new Date(),
): Promise<AiProposal> {
  const [row] = await db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, id), eq(aiProposals.userId, userId)));
  if (!row) throw notFound();
  return toProposal(row, now);
}

export async function listProposals(
  db: DbExecutor,
  userId: string,
  limit: number,
  now = new Date(),
): Promise<AiProposal[]> {
  const rows = await db
    .select()
    .from(aiProposals)
    .where(eq(aiProposals.userId, userId))
    .orderBy(desc(aiProposals.createdAt), desc(aiProposals.id))
    .limit(limit);
  return rows.map((row) => toProposal(row, now));
}

/** Rejects a proposal that can no longer be decided. */
export function discardProposal(db: Database, userId: string, id: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const row = await lockProposal(tx, userId, id);
    const current = toProposal(row, now);
    if (current.status !== "proposed") throw new DomainError("invalid", "ai.proposal_closed");
    await tx
      .update(aiProposals)
      .set({ status: "discarded", decidedAt: now })
      .where(eq(aiProposals.id, id));
    return getProposal(tx, userId, id, now);
  });
}

/** Deletes a record from the history. Applied changes stay: they are ordinary data now. */
export async function deleteProposal(db: DbExecutor, userId: string, id: string) {
  const deleted = await db
    .delete(aiProposals)
    .where(and(eq(aiProposals.id, id), eq(aiProposals.userId, userId)))
    .returning({ id: aiProposals.id });
  if (deleted.length === 0) throw notFound();
}

/** Deletes the whole AI history (proposals, analyses and call metadata) of the user. */
export async function clearHistory(db: Database, userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(aiProposals).where(eq(aiProposals.userId, userId));
    await tx.delete(aiRequests).where(eq(aiRequests.userId, userId));
  });
}

/** Retention: records older than AI_LIMITS.retentionDays are removed. */
export async function purgeExpiredHistory(db: DbExecutor, userId: string, now: Date) {
  const cutoff = new Date(now.getTime() - AI_LIMITS.retentionDays * 24 * 60 * 60_000);
  await db
    .delete(aiProposals)
    .where(and(eq(aiProposals.userId, userId), lt(aiProposals.createdAt, cutoff)));
  await db
    .delete(aiRequests)
    .where(and(eq(aiRequests.userId, userId), lt(aiRequests.createdAt, cutoff)));
}

async function lockProposal(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, id), eq(aiProposals.userId, userId)))
    .for("update");
  if (!row) throw notFound();
  return row;
}

/** Current versions of the source entities, read through their owners (scoped to the user). */
async function currentVersions(db: DbExecutor, userId: string, refs: readonly SourceRef[]) {
  const versions = new Map<string, string>();
  const taskIds = refs.filter((r) => r.type === "task").map((r) => r.id);
  const goalIds = refs.filter((r) => r.type === "goal").map((r) => r.id);
  if (taskIds.length > 0) {
    for (const task of await getTasksByIds(db, userId, taskIds)) {
      versions.set(`task:${task.id}`, task.updatedAt.toISOString());
    }
  }
  if (goalIds.length > 0) {
    for (const goal of await listGoals(db, userId, { ids: goalIds })) {
      versions.set(`goal:${goal.id}`, goal.updatedAt.toISOString());
    }
  }
  return versions;
}

/** Runs one approved change through its owning service; returns the affected entity id. */
async function execute(
  deps: { db: DbExecutor; bus: EventBus },
  userId: string,
  change: ProposalChange,
): Promise<string> {
  switch (change.type) {
    case "set_task_priority": {
      const task = await updateTask(deps, userId, {
        id: change.taskId,
        patch: { priority: change.priority },
      });
      return task.id;
    }
    case "set_task_contributions": {
      const task = await updateTask(deps, userId, {
        id: change.taskId,
        patch: { contributions: change.contributions },
      });
      return task.id;
    }
    case "create_goal_task": {
      const task = await createGoalTask(deps, userId, {
        goalId: change.goalId,
        useGoalAttributes: false,
        task: {
          title: change.title,
          dueDate: change.dueDate,
          estimatedMinutes: change.estimatedMinutes,
          contributions: change.contributions,
        },
      });
      return task.id;
    }
    case "create_automation_rule": {
      const rule = await createRule(deps.db, userId, change.config);
      return rule.id;
    }
  }
}

type Outcome = { kind: "done"; proposal: AiProposal } | { kind: "rejected"; code: string };

/**
 * Approval. One transaction holding the proposal's row lock:
 *
 *  1. the proposal must belong to the user and still be `proposed` (an already applied proposal
 *     returns its stored result — a repeated or concurrent approval never runs changes twice);
 *  2. not expired, and no source entity changed since (else it is marked stale / expired);
 *  3. every approved item must match a stored item's key and target (edits change values, never
 *     what is changed) and passes the same strict schema;
 *  4. the changes run through the owning services inside a savepoint: all or nothing. A refusal
 *     (domain error) rolls them back and records the proposal as failed with the error code.
 */
export async function applyProposal(
  deps: { db: Database; bus: EventBus },
  userId: string,
  input: ApplyProposalInput,
  now = new Date(),
): Promise<AiProposal> {
  const outcome: Outcome = await deps.db.transaction(async (tx) => {
    const row = await lockProposal(tx, userId, input.id);
    const current = toProposal(row, now);
    if (current.status === "applied") return { kind: "done", proposal: current };
    if (current.status === "expired") {
      await tx.update(aiProposals).set({ status: "expired" }).where(eq(aiProposals.id, row.id));
      return { kind: "rejected", code: "ai.proposal_expired" };
    }
    if (current.status === "stale") return { kind: "rejected", code: "ai.proposal_stale" };
    if (current.status !== "proposed") return { kind: "rejected", code: "ai.proposal_closed" };

    const versions = await currentVersions(tx, userId, current.sourceRefs);
    if (staleRefs(current.sourceRefs, versions).length > 0) {
      await tx
        .update(aiProposals)
        .set({ status: "stale", decidedAt: now })
        .where(eq(aiProposals.id, row.id));
      return { kind: "rejected", code: "ai.proposal_stale" };
    }

    const stored = new Map(current.items.map((item) => [item.key, item]));
    const keys = new Set<string>();
    for (const item of input.items) {
      const original = stored.get(item.key);
      if (!original || keys.has(item.key)) throw new DomainError("invalid", "ai.change_mismatch");
      if (changeTarget(original.change) !== changeTarget(item.change)) {
        throw new DomainError("invalid", "ai.change_mismatch");
      }
      keys.add(item.key);
    }

    try {
      const applied = await tx.transaction(async (savepoint) => {
        const results: ApplyResultItem[] = [];
        for (const item of input.items) {
          const entityId = await execute({ db: savepoint, bus: deps.bus }, userId, item.change);
          results.push({ key: item.key, type: item.change.type, entityId });
        }
        return results;
      });
      const result: ApplyResult = {
        items: applied,
        skipped: current.items.map((i) => i.key).filter((key) => !keys.has(key)),
      };
      await tx
        .update(aiProposals)
        .set({
          status: "applied",
          decidedAt: now,
          applyResult: result,
          // What was actually approved (including the user's edits) replaces the suggestion.
          items: current.items.map((i) => input.items.find((a) => a.key === i.key) ?? i),
        })
        .where(eq(aiProposals.id, row.id));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      await tx
        .update(aiProposals)
        .set({ status: "failed", decidedAt: now, errorCode: error.code })
        .where(eq(aiProposals.id, row.id));
    }
    return { kind: "done", proposal: await getProposal(tx, userId, row.id, now) };
  });
  if (outcome.kind === "rejected") throw new DomainError("conflict", outcome.code);
  return outcome.proposal;
}

/**
 * Marks open proposals whose source entities changed since as stale, so the history shows it
 * before anyone tries to approve them (approval re-checks anyway).
 */
export async function markStaleProposals(db: DbExecutor, userId: string, now: Date) {
  const rows = await db
    .select({ id: aiProposals.id, sourceRefs: aiProposals.sourceRefs })
    .from(aiProposals)
    .where(and(eq(aiProposals.userId, userId), eq(aiProposals.status, "proposed")));
  const refs = rows.flatMap((r) => r.sourceRefs as SourceRef[]);
  if (refs.length === 0) return;
  const versions = await currentVersions(db, userId, refs);
  const stale = rows
    .filter((r) => staleRefs(r.sourceRefs as SourceRef[], versions).length > 0)
    .map((r) => r.id);
  if (stale.length === 0) return;
  await db
    .update(aiProposals)
    .set({ status: "stale", decidedAt: now })
    .where(and(eq(aiProposals.userId, userId), inArray(aiProposals.id, stale)));
}

/** Marks a user's overdue open proposals as expired (for history views and counts). */
export async function expireProposals(db: DbExecutor, userId: string, now: Date) {
  await db
    .update(aiProposals)
    .set({ status: "expired" })
    .where(
      and(
        eq(aiProposals.userId, userId),
        eq(aiProposals.status, "proposed"),
        lt(aiProposals.expiresAt, now),
      ),
    );
}

export async function countByStatus(db: DbExecutor, userId: string, statuses: ProposalStatus[]) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiProposals)
    .where(and(eq(aiProposals.userId, userId), inArray(aiProposals.status, statuses)));
  return row?.n ?? 0;
}
