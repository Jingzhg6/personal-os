import "server-only";

import { and, count, eq, gte, sql } from "drizzle-orm";

import { ruleConfigSchema } from "@/modules/automation/domain";
import { addDays, type Task } from "@/modules/tasks/domain";
import type { Database, DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { aiProposals, aiRequests } from "../db";
import {
  AI_LIMITS,
  outputSchemas,
  type AiCapability,
  type AiErrorCode,
  type AiProposal,
  type AiStatus,
  type AutomationDraftOutput,
  type ContributionsOutput,
  type GenerateInput,
  type GoalPlanOutput,
  type PrioritiesOutput,
  type PriorityRecommendation,
  type ProposalAnalysis,
  type ProposalItem,
  type QuestionOutput,
  type ReviewOutput,
  type SourceRef,
} from "../domain";
import {
  automationContext,
  buildReviewFacts,
  contributionsContext,
  goalPlanContext,
  prioritiesContext,
  questionContext,
  reviewContext,
  type Allowed,
} from "./context";
import { normalizeEnumCase } from "./output-schema";
import { buildPrompt, serializeData, SYSTEM_PROMPT } from "./prompts";
import type { AiProvider, Usage } from "./provider";
import { getProposal, purgeExpiredHistory } from "./proposals";

/*
 * Generation: build a bounded context from the user's own data, call the provider once, validate
 * the output strictly, check every id it mentions against the context, and store the result as a
 * proposal. Nothing is changed in any other module here.
 */

export interface AdvisorDeps {
  db: Database;
  provider: AiProvider | null;
  dailyLimit: number;
  /** Why the provider is null, when it is (shown to the user; no configuration values). */
  unavailableReason?: "off" | "missing_key" | null;
  perMinuteLimit: number;
  timeoutMs: number;
  schedulerConfigured: boolean;
  now?: () => Date;
}

/** AI failures are expected outcomes: typed codes the UI translates, never provider messages. */
function aiError(code: AiErrorCode): DomainError {
  const kind =
    code === "ai.malformed_output" || code === "ai.invalid_reference" ? "invalid" : "conflict";
  return new DomainError(kind, code);
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

async function usage(db: DbExecutor, userId: string, now: Date) {
  const [minute] = await db
    .select({ n: count() })
    .from(aiRequests)
    .where(
      and(
        eq(aiRequests.userId, userId),
        gte(aiRequests.createdAt, new Date(now.getTime() - MINUTE)),
      ),
    );
  const [day] = await db
    .select({ n: count() })
    .from(aiRequests)
    .where(
      and(eq(aiRequests.userId, userId), gte(aiRequests.createdAt, new Date(now.getTime() - DAY))),
    );
  return { minute: minute?.n ?? 0, day: day?.n ?? 0 };
}

export async function getAiStatus(deps: AdvisorDeps, userId: string): Promise<AiStatus> {
  const now = deps.now?.() ?? new Date();
  const used = await usage(deps.db, userId, now);
  return {
    available: deps.provider !== null,
    unavailableReason: deps.provider ? null : (deps.unavailableReason ?? "off"),
    provider: deps.provider?.id ?? "off",
    model: deps.provider?.model ?? null,
    simulated: deps.provider?.id === "mock",
    limits: { perMinute: deps.perMinuteLimit, daily: deps.dailyLimit, usedToday: used.day },
  };
}

/* ---------------------------------------------------------------- reference checks */

const has = (set: Set<string>, id: string) => set.has(id);

function checkReview(output: ReviewOutput, allowed: Allowed) {
  for (const r of output.recommendations) {
    if (!r.entity) continue;
    const set = {
      task: allowed.tasks,
      project: allowed.projects,
      goal: allowed.goals,
      rule: allowed.rules,
    }[r.entity.type];
    if (!has(set, r.entity.id)) throw aiError("ai.invalid_reference");
  }
}

/** Every id inside a drafted rule must be one of the user's own areas, projects or statuses. */
function checkRuleRefs(rule: NonNullable<AutomationDraftOutput["rule"]>, allowed: Allowed) {
  for (const c of rule.conditions) {
    if ("areaId" in c && !has(allowed.areas, c.areaId)) throw aiError("ai.invalid_reference");
    if ("projectId" in c && !has(allowed.projects, c.projectId))
      throw aiError("ai.invalid_reference");
    if ("statusId" in c && !has(allowed.statuses, c.statusId))
      throw aiError("ai.invalid_reference");
  }
  for (const a of rule.actions) {
    if ("areaId" in a && a.areaId && !has(allowed.areas, a.areaId))
      throw aiError("ai.invalid_reference");
    if ("projectId" in a && a.projectId && !has(allowed.projects, a.projectId)) {
      throw aiError("ai.invalid_reference");
    }
  }
}

function checkContributions(list: readonly { attributeId: string }[], allowed: Allowed) {
  // Only the user's active growth attributes were offered: 自制力, archived attributes and other
  // users' attributes are never in the allow-list.
  if (list.some((c) => !has(allowed.attributes, c.attributeId)))
    throw aiError("ai.invalid_reference");
  if (new Set(list.map((c) => c.attributeId)).size !== list.length)
    throw aiError("ai.malformed_output");
}

/* ---------------------------------------------------------------- generation */

interface Draft {
  analysis: ProposalAnalysis;
  items: ProposalItem[];
  sourceRefs: SourceRef[];
  labels: Record<string, string>;
}

const versionOf = (entity: { updatedAt: Date }) => entity.updatedAt.toISOString();

export async function generate(
  deps: AdvisorDeps,
  userId: string,
  input: GenerateInput,
): Promise<AiProposal> {
  const provider = deps.provider;
  if (!provider) throw aiError("ai.not_configured");
  const now = deps.now?.() ?? new Date();

  // Context (ownership of goalId / taskId is checked by the owning modules' reads).
  const ctx = await contextFor(deps, userId, input, now);
  const serialized = serializeData(ctx.data);
  if (serialized.length > AI_LIMITS.contextChars) throw aiError("ai.input_too_large");

  const capability: AiCapability = input.capability;
  // Check the limits and reserve this call atomically: concurrent requests of one user queue on
  // an advisory lock, so they cannot all pass the check before any of them is counted (M11.1).
  const request = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-quota:${userId}`}))`);
    const used = await usage(tx, userId, now);
    if (used.minute >= deps.perMinuteLimit || used.day >= deps.dailyLimit) {
      throw aiError("ai.quota_exceeded");
    }
    const [row] = await tx
      .insert(aiRequests)
      .values({
        userId,
        capability,
        provider: provider.id,
        status: "running",
        inputChars: serialized.length,
        createdAt: now,
      })
      .returning({ id: aiRequests.id });
    return row;
  });
  const started = Date.now();
  const finish = (values: Partial<typeof aiRequests.$inferInsert>) =>
    deps.db
      .update(aiRequests)
      .set({ ...values, durationMs: Date.now() - started })
      .where(eq(aiRequests.id, request!.id));

  // The provider enforces AI_TIMEOUT_MS itself; this backstop also aborts it if it does not.
  const abort = new AbortController();
  let spent: Usage | undefined;
  try {
    const result = await withTimeout(
      provider.generate({
        capability,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(capability, serialized),
        data: ctx.data,
        userText: userTextOf(input),
        schema: outputSchemas[capability],
        signal: abort.signal,
      }),
      deps.timeoutMs + 5_000,
      abort,
    );
    spent = result.usage;
    if (!result.ok) throw aiError(result.code);
    const parsed = outputSchemas[capability].safeParse(
      normalizeEnumCase(outputSchemas[capability], result.raw),
    );
    if (!parsed.success) throw aiError("ai.malformed_output");
    const draft = ctx.draft(parsed.data as never);
    const [row] = await deps.db
      .insert(aiProposals)
      .values({
        userId,
        capability,
        status: draft.items.length > 0 ? "proposed" : "analysis",
        provider: provider.id,
        model: provider.model,
        request: input,
        analysis: draft.analysis,
        items: draft.items,
        sourceRefs: draft.sourceRefs,
        labels: draft.labels,
        expiresAt:
          draft.items.length > 0 ? new Date(now.getTime() + AI_LIMITS.proposalTtlMs) : null,
        createdAt: now,
      })
      .returning({ id: aiProposals.id });
    await finish({
      status: "succeeded",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    await purgeExpiredHistory(deps.db, userId, now);
    return getProposal(deps.db, userId, row!.id, now);
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "ai.provider_error";
    // Failed calls may still have been billed: their usage is recorded too.
    await finish({
      status: "failed",
      errorCode: code,
      inputTokens: spent?.inputTokens ?? null,
      outputTokens: spent?.outputTokens ?? null,
    });
    if (error instanceof DomainError) throw error;
    // Unexpected: log the class only — never prompts, outputs or personal data.
    console.error("ai.generate failed", (error as Error).name);
    throw aiError("ai.provider_error");
  }
}

function userTextOf(input: GenerateInput): string | null {
  switch (input.capability) {
    case "goal_plan":
      return input.note;
    case "automation_rule":
      return input.request;
    case "question":
      return input.question;
    default:
      return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, abort: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(aiError("ai.timeout"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface CapabilityContext<T> {
  data: Record<string, unknown>;
  draft: (output: T) => Draft;
}

async function contextFor(
  deps: AdvisorDeps,
  userId: string,
  input: GenerateInput,
  now: Date,
): Promise<CapabilityContext<never>> {
  const { db } = deps;
  switch (input.capability) {
    case "review": {
      const facts = await buildReviewFacts(db, userId, {
        schedulerConfigured: deps.schedulerConfigured,
        now,
      });
      const ctx = reviewContext(facts);
      return wrap<ReviewOutput>(ctx.data, (output) => {
        checkReview(output, ctx.allowed);
        return {
          analysis: { kind: "review", facts, output, entityTitles: ctx.titles },
          items: [],
          sourceRefs: [],
          labels: {},
        };
      });
    }
    case "priorities": {
      const ctx = await prioritiesContext(db, userId, now);
      return wrap<PrioritiesOutput>(ctx.data, (output) => prioritiesDraft(output, ctx.tasks));
    }
    case "goal_plan": {
      const ctx = await goalPlanContext(db, userId, input.goalId, input.note, now);
      return wrap<GoalPlanOutput>(ctx.data, (output) => {
        for (const task of output.tasks) checkContributions(task.contributions, ctx.allowed);
        const items: ProposalItem[] = output.tasks.map((task, index) => ({
          key: `t${index}`,
          change: {
            type: "create_goal_task",
            goalId: ctx.goal.id,
            title: task.title,
            dueDate: task.dueInDays === null ? null : addDays(ctx.today, task.dueInDays),
            estimatedMinutes: task.estimatedMinutes,
            contributions: task.contributions,
          },
        }));
        return {
          analysis: {
            kind: "goal_plan",
            goalTitle: ctx.goal.title,
            summary: output.summary,
            steps: output.steps,
            taskSteps: Object.fromEntries(
              output.tasks.map((task, index) => [
                `t${index}`,
                Math.min(task.stepIndex, output.steps.length - 1),
              ]),
            ),
            assumptions: output.assumptions,
          },
          items,
          sourceRefs: [{ type: "goal", id: ctx.goal.id, version: versionOf(ctx.goal) }],
          labels: ctx.titles,
        };
      });
    }
    case "contributions": {
      const ctx = await contributionsContext(db, userId, input.taskId);
      return wrap<ContributionsOutput>(ctx.data, (output) => {
        checkContributions(output.contributions, ctx.allowed);
        const proposed = output.contributions.map((c) => ({
          attributeId: c.attributeId,
          weight: c.weight,
        }));
        return {
          analysis: {
            kind: "contributions",
            taskTitle: ctx.task.title,
            explanation: output.explanation,
            reasons: Object.fromEntries(output.contributions.map((c) => [c.attributeId, c.reason])),
            current: ctx.task.contributions,
          },
          items:
            proposed.length > 0
              ? [
                  {
                    key: "c0",
                    change: {
                      type: "set_task_contributions",
                      taskId: ctx.task.id,
                      contributions: proposed,
                    },
                  },
                ]
              : [],
          sourceRefs: [{ type: "task", id: ctx.task.id, version: versionOf(ctx.task) }],
          labels: ctx.titles,
        };
      });
    }
    case "automation_rule": {
      const ctx = await automationContext(db, userId, input.request);
      return wrap<AutomationDraftOutput>(ctx.data, (output) => {
        let items: ProposalItem[] = [];
        if (output.supported) {
          if (!output.rule) throw aiError("ai.malformed_output");
          // The automation engine's own schema decides what a valid rule is.
          const config = ruleConfigSchema.safeParse({ ...output.rule, timeZone: null });
          if (!config.success) throw aiError("ai.malformed_output");
          checkRuleRefs(output.rule, ctx.allowed);
          items = [{ key: "r0", change: { type: "create_automation_rule", config: config.data } }];
        }
        return {
          analysis: {
            kind: "automation_rule",
            request: input.request,
            supported: output.supported,
            explanation: output.explanation,
            unsupportedReasons: output.unsupportedReasons,
          },
          items,
          sourceRefs: [],
          labels: {},
        };
      });
    }
    case "question": {
      const ctx = await questionContext(db, userId, input.question, {
        schedulerConfigured: deps.schedulerConfigured,
      });
      return wrap<QuestionOutput>(ctx.data, (output) => ({
        analysis: { kind: "question", question: input.question, output },
        items: [],
        sourceRefs: [],
        labels: {},
      }));
    }
  }
}

function wrap<T>(
  data: Record<string, unknown>,
  draft: (output: T) => Draft,
): CapabilityContext<never> {
  return { data, draft: draft as (output: never) => Draft };
}

/**
 * Recommendations must name open tasks from the context. A recommendation to start a blocked task
 * now is not offered (dependencies come first); it is counted as ignored, never silently changed.
 */
function prioritiesDraft(output: PrioritiesOutput, tasks: Map<string, Task>): Draft {
  if (output.recommendations.some((r) => !tasks.has(r.taskId)))
    throw aiError("ai.invalid_reference");
  if (new Set(output.recommendations.map((r) => r.taskId)).size !== output.recommendations.length) {
    throw aiError("ai.malformed_output");
  }
  const recommendations: PriorityRecommendation[] = [];
  const items: ProposalItem[] = [];
  const refs: SourceRef[] = [];
  let ignored = 0;
  for (const r of output.recommendations) {
    const task = tasks.get(r.taskId)!;
    if (r.action === "do_now" && task.openBlockerCount > 0) {
      ignored += 1;
      continue;
    }
    const change = r.suggestedPriority !== null && r.suggestedPriority !== task.priority;
    const key = change ? `p${items.length}` : null;
    if (change) {
      items.push({
        key: key!,
        change: { type: "set_task_priority", taskId: task.id, priority: r.suggestedPriority! },
      });
      refs.push({ type: "task", id: task.id, version: versionOf(task) });
    }
    recommendations.push({
      taskId: task.id,
      taskTitle: task.title,
      action: r.action,
      reason: r.reason,
      benefit: r.benefit,
      uncertainty: r.uncertainty,
      nextStep: r.nextStep,
      currentPriority: task.priority,
      suggestedPriority: change ? r.suggestedPriority : null,
      changeKey: key,
    });
  }
  return {
    analysis: { kind: "priorities", recommendations, notes: output.notes, ignored },
    items,
    sourceRefs: refs,
    labels: {},
  };
}
