import { z } from "zod";

import { actionSchema, conditionSchema, triggerSchema } from "@/modules/automation/domain";

/*
 * What a provider must return, per capability. Model output is untrusted input: it is parsed
 * with these strict schemas (unknown keys, wrong types, oversize text → malformed), and every id
 * it mentions is then checked against the ids the request actually supplied.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
/** An id as written by the model: checked against the context allow-list, never trusted. */
const ref = z.string().trim().min(1).max(64);

export const uncertaintyLevels = ["low", "medium", "high"] as const;
export const uncertainty = z.enum(uncertaintyLevels);
export type Uncertainty = (typeof uncertaintyLevels)[number];

export const reviewAreas = [
  "tasks",
  "projects",
  "goals",
  "growth",
  "finance",
  "automation",
] as const;
export type ReviewArea = (typeof reviewAreas)[number];

export const entityTypes = ["task", "project", "goal", "rule"] as const;
export type EntityType = (typeof entityTypes)[number];
export const entityRef = z.strictObject({ type: z.enum(entityTypes), id: ref });
export type EntityRef = z.infer<typeof entityRef>;

/* ---------------------------------------------------------------- A. review */

export const reviewOutput = z.strictObject({
  summary: text(600),
  /** Interpretations of the facts (labelled as such in the UI). */
  interpretations: z.array(z.strictObject({ area: z.enum(reviewAreas), text: text(400) })).max(8),
  recommendations: z
    .array(
      z.strictObject({
        area: z.enum(reviewAreas),
        action: text(200),
        reason: text(400),
        uncertainty,
        entity: entityRef.nullable(),
      }),
    )
    .max(6),
});
export type ReviewOutput = z.infer<typeof reviewOutput>;

/* ---------------------------------------------------------------- B. priorities */

export const priorityActions = [
  "do_now",
  "schedule",
  "unblock_first",
  "break_down",
  "defer",
  "review_deadline",
] as const;
export type PriorityAction = (typeof priorityActions)[number];

export const prioritiesOutput = z.strictObject({
  recommendations: z
    .array(
      z.strictObject({
        taskId: ref,
        action: z.enum(priorityActions),
        reason: text(400),
        benefit: text(300),
        uncertainty,
        nextStep: text(200).nullable(),
        /** A priority change the user may approve; null = keep. */
        suggestedPriority: z.number().int().min(0).max(4).nullable(),
      }),
    )
    .max(7),
  notes: z.array(text(300)).max(3),
});
export type PrioritiesOutput = z.infer<typeof prioritiesOutput>;

/* ---------------------------------------------------------------- C. goal plan */

const contributionOut = z.strictObject({
  attributeId: ref,
  weight: z.number().int().min(1).max(3),
});

export const goalPlanOutput = z.strictObject({
  summary: text(400),
  steps: z
    .array(z.strictObject({ title: text(120), rationale: text(300) }))
    .min(1)
    .max(6),
  tasks: z
    .array(
      z.strictObject({
        title: text(200),
        stepIndex: z.number().int().min(0).max(5),
        /** Relative to the user's today: the model never invents calendar dates. */
        dueInDays: z.number().int().min(0).max(365).nullable(),
        estimatedMinutes: z.number().int().min(5).max(2400).nullable(),
        contributions: z.array(contributionOut).max(3),
      }),
    )
    .min(1)
    .max(10),
  assumptions: z.array(text(300)).max(5),
});
export type GoalPlanOutput = z.infer<typeof goalPlanOutput>;

/* ---------------------------------------------------------------- D. contributions */

export const contributionsOutput = z.strictObject({
  explanation: text(400),
  contributions: z
    .array(
      z.strictObject({
        attributeId: ref,
        weight: z.number().int().min(1).max(3),
        reason: text(300),
      }),
    )
    .max(4),
});
export type ContributionsOutput = z.infer<typeof contributionsOutput>;

/* ---------------------------------------------------------------- E. automation draft */

export const automationDraftOutput = z.strictObject({
  supported: z.boolean(),
  explanation: text(500),
  unsupportedReasons: z.array(text(200)).max(5),
  /** Only the automation engine's own trigger, condition and action types. */
  rule: z
    .strictObject({
      name: text(80),
      description: z.string().trim().max(500).nullable(),
      trigger: triggerSchema,
      conditions: z.array(conditionSchema).max(5),
      actions: z.array(actionSchema).min(1).max(5),
    })
    .nullable(),
});
export type AutomationDraftOutput = z.infer<typeof automationDraftOutput>;

/* ---------------------------------------------------------------- question */

export const questionOutput = z.strictObject({
  answer: text(1500),
  basedOn: z.array(z.enum(reviewAreas)).max(6),
  dataGaps: z.array(text(200)).max(5),
});
export type QuestionOutput = z.infer<typeof questionOutput>;

export const outputSchemas = {
  review: reviewOutput,
  priorities: prioritiesOutput,
  goal_plan: goalPlanOutput,
  contributions: contributionsOutput,
  automation_rule: automationDraftOutput,
  question: questionOutput,
} as const;
