import { z } from "zod";

import { ruleConfigSchema, type RuleConfig } from "@/modules/automation/domain";

import { AI_LIMITS, type AiCapability } from "./limits";
import type {
  AutomationDraftOutput,
  ContributionsOutput,
  GoalPlanOutput,
  PriorityAction,
  QuestionOutput,
  ReviewArea,
  ReviewOutput,
  Uncertainty,
} from "./outputs";
import type { ReviewFacts } from "./review";

/*
 * Typed proposals. A proposal records what the model suggested (analysis), the exact operations
 * an approval would run (changes), and the versions of the entities it was based on (source
 * refs). Approving runs the changes through the owning modules' services; nothing else does.
 */

export const proposalStatuses = [
  /** Analysis only (review, answer): nothing to approve. */
  "analysis",
  /** Waiting for the user's decision. */
  "proposed",
  "applied",
  "failed",
  /** A source entity changed after the proposal was made: regenerate or review. */
  "stale",
  "expired",
  "discarded",
] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

/** Only statuses a decision can still change. */
export const isOpenProposal = (status: ProposalStatus) => status === "proposed";

const isoDate = z.iso.date();
const contribution = z.strictObject({
  attributeId: z.uuid(),
  weight: z.number().int().min(1).max(3),
});
const contributions = z
  .array(contribution)
  .max(8)
  .refine((list) => new Set(list.map((c) => c.attributeId)).size === list.length, {
    message: "Duplicate attribute",
  });

/**
 * The allow-list of operations an approval can execute. Each maps to one existing service call
 * (tasks.updateTask, development.createGoalTask, automation.createRule); there is no generic
 * "call a method" or SQL path, and nothing here can reach XP, 自制力, rewards or finance.
 */
export const proposalChange = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("set_task_priority"),
    taskId: z.uuid(),
    priority: z.number().int().min(0).max(4),
  }),
  z.strictObject({
    type: z.literal("create_goal_task"),
    goalId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    dueDate: isoDate.nullable(),
    estimatedMinutes: z.number().int().min(1).max(10080).nullable(),
    contributions,
  }),
  z.strictObject({
    type: z.literal("set_task_contributions"),
    taskId: z.uuid(),
    contributions,
  }),
  z.strictObject({
    type: z.literal("create_automation_rule"),
    config: ruleConfigSchema,
  }),
]);
export type ProposalChange = z.infer<typeof proposalChange>;
export type ProposalChangeType = ProposalChange["type"];

/** One change in a proposal, addressable by a stable key. */
export interface ProposalItem {
  key: string;
  change: ProposalChange;
}

/** The target an edited change must keep: edits may change values, never what is changed. */
export function changeTarget(change: ProposalChange): string {
  switch (change.type) {
    case "set_task_priority":
    case "set_task_contributions":
      return `${change.type}:${change.taskId}`;
    case "create_goal_task":
      return `${change.type}:${change.goalId}`;
    case "create_automation_rule":
      return change.type;
  }
}

/** An entity a proposal depends on, with the version it saw (its `updatedAt`). */
export interface SourceRef {
  type: "task" | "goal";
  id: string;
  version: string;
}

/** Stale when any source entity is gone or was changed after the proposal was made. */
export function staleRefs(
  refs: readonly SourceRef[],
  current: ReadonlyMap<string, string>,
): SourceRef[] {
  return refs.filter((ref) => current.get(`${ref.type}:${ref.id}`) !== ref.version);
}

/* ---------------------------------------------------------------- stored analysis */

export interface PriorityRecommendation {
  taskId: string;
  taskTitle: string;
  action: PriorityAction;
  reason: string;
  benefit: string;
  uncertainty: Uncertainty;
  nextStep: string | null;
  currentPriority: number;
  suggestedPriority: number | null;
  /** Key of the approvable change, when the recommendation includes one. */
  changeKey: string | null;
}

export interface GoalPlanStep {
  title: string;
  rationale: string;
}

/** What a proposal shows besides its changes. Stored as data; rendered as plain text. */
export type ProposalAnalysis =
  | {
      kind: "review";
      facts: ReviewFacts;
      output: ReviewOutput;
      entityTitles: Record<string, string>;
    }
  | {
      kind: "priorities";
      recommendations: PriorityRecommendation[];
      notes: string[];
      ignored: number;
    }
  | {
      kind: "goal_plan";
      goalTitle: string;
      summary: GoalPlanOutput["summary"];
      steps: GoalPlanStep[];
      taskSteps: Record<string, number>;
      assumptions: string[];
    }
  | {
      kind: "contributions";
      taskTitle: string;
      explanation: ContributionsOutput["explanation"];
      reasons: Record<string, string>;
      current: { attributeId: string; weight: number }[];
    }
  | {
      kind: "automation_rule";
      request: string;
      supported: boolean;
      explanation: AutomationDraftOutput["explanation"];
      unsupportedReasons: string[];
    }
  | { kind: "question"; question: string; output: QuestionOutput };

export interface ApplyResultItem {
  key: string;
  type: ProposalChangeType;
  /** The created or changed entity. */
  entityId: string;
}

export interface ApplyResult {
  items: ApplyResultItem[];
  /** Selected keys; the rest were not run. */
  skipped: string[];
}

export interface AiProposal {
  id: string;
  capability: AiCapability;
  status: ProposalStatus;
  /** The request it answered (used to regenerate a stale or expired proposal). */
  request: GenerateInput;
  provider: string;
  model: string;
  analysis: ProposalAnalysis;
  items: ProposalItem[];
  sourceRefs: SourceRef[];
  /** Attribute names for contributions, so the UI can label ids it may not otherwise know. */
  labels: Record<string, string>;
  expiresAt: Date | null;
  decidedAt: Date | null;
  applyResult: ApplyResult | null;
  errorCode: string | null;
  createdAt: Date;
}

/* ---------------------------------------------------------------- API inputs */

const userText = z.string().trim().min(1).max(AI_LIMITS.userTextChars);

export const generateInput = z.discriminatedUnion("capability", [
  z.strictObject({ capability: z.literal("review") }),
  z.strictObject({ capability: z.literal("priorities") }),
  z.strictObject({
    capability: z.literal("goal_plan"),
    goalId: z.uuid(),
    note: userText.nullable(),
  }),
  z.strictObject({ capability: z.literal("contributions"), taskId: z.uuid() }),
  z.strictObject({ capability: z.literal("automation_rule"), request: userText }),
  z.strictObject({ capability: z.literal("question"), question: userText }),
]);
export type GenerateInput = z.infer<typeof generateInput>;

/**
 * Approving is explicit (`confirm: true`) and lists the approved items, possibly edited. Each must
 * match a stored item's key and target; values are re-validated with the same schemas.
 */
export const applyProposalInput = z.strictObject({
  id: z.uuid(),
  confirm: z.literal(true),
  items: z
    .array(z.strictObject({ key: z.string().min(1).max(20), change: proposalChange }))
    .min(1)
    .max(AI_LIMITS.changesPerProposal),
});
export type ApplyProposalInput = z.infer<typeof applyProposalInput>;

export const proposalIdInput = z.strictObject({ id: z.uuid() });
export const historyInput = z.strictObject({
  limit: z.number().int().min(1).max(100).default(50),
});

/** Review areas shown together on the review page, in order. */
export const reviewAreaOrder: readonly ReviewArea[] = [
  "tasks",
  "projects",
  "goals",
  "growth",
  "finance",
  "automation",
];

export type { RuleConfig };
