import type { DomainEventMap, DomainEventType } from "@/shared/events/types";

import type { Contribution } from "./attributes";

/*
 * Event → XP rules, defined once. Each rule turns one domain event into at most one XP grant and
 * names the events that reverse it. A new module joins by declaring its events and adding a rule
 * here; the ledger, levels and the character page need no change.
 *
 * Reversals never recompute an amount: they negate the grant they cancel.
 */

export const xpSourceTypes = ["task", "project", "milestone"] as const;
export type XpSourceType = (typeof xpSourceTypes)[number];

export interface XpGrant {
  sourceType: XpSourceType;
  sourceId: string;
  /** Overall XP of the completion. */
  amount: number;
  /**
   * Development attributes the completed item grows. The amount is split across them; with none,
   * the completion earns overall XP only. Areas play no part here.
   */
  contributions: readonly Contribution[];
  /** Title / name at the time (shown in the history). */
  title: string;
}

interface RuleDefinition<G extends DomainEventType, R extends DomainEventType> {
  /** Stable identifier stored in the ledger. */
  key: string;
  sourceType: XpSourceType;
  grantOn: G;
  grant: (payload: DomainEventMap[G]) => XpGrant;
  reverseOn: R;
  /** The source whose grant a reversal event cancels. */
  reversedSource: (payload: DomainEventMap[R]) => string;
}

export interface XpRule {
  key: string;
  sourceType: XpSourceType;
  grantOn: DomainEventType;
  grant: (payload: unknown) => XpGrant;
  reverseOn: DomainEventType;
  reversedSource: (payload: unknown) => string;
}

const defineRule = <G extends DomainEventType, R extends DomainEventType>(
  rule: RuleDefinition<G, R>,
) => rule as unknown as XpRule;

export const TASK_XP = { base: 10, perPriority: 5, important: 5, subtask: 5 } as const;
export const PROJECT_XP = { base: 100, perPriority: 25 } as const;
export const MILESTONE_XP = 30;

export const xpRules: readonly XpRule[] = [
  defineRule({
    key: "task.completion",
    sourceType: "task",
    grantOn: "task.completed",
    grant: (p) => ({
      sourceType: "task",
      sourceId: p.taskId,
      amount: p.parentTaskId
        ? TASK_XP.subtask
        : TASK_XP.base + p.priority * TASK_XP.perPriority + (p.isImportant ? TASK_XP.important : 0),
      contributions: p.contributions,
      title: p.title,
    }),
    reverseOn: "task.reopened",
    reversedSource: (p) => p.taskId,
  }),
  defineRule({
    key: "project.completion",
    sourceType: "project",
    grantOn: "project.completed",
    grant: (p) => ({
      sourceType: "project",
      sourceId: p.projectId,
      amount: PROJECT_XP.base + p.priority * PROJECT_XP.perPriority,
      contributions: [],
      title: p.name,
    }),
    reverseOn: "project.reopened",
    reversedSource: (p) => p.projectId,
  }),
  defineRule({
    key: "milestone.completion",
    sourceType: "milestone",
    grantOn: "milestone.completed",
    grant: (p) => ({
      sourceType: "milestone",
      sourceId: p.milestoneId,
      amount: MILESTONE_XP,
      contributions: [],
      title: p.name,
    }),
    reverseOn: "milestone.reopened",
    reversedSource: (p) => p.milestoneId,
  }),
];

/** Every event type the XP engine listens to. */
export const xpEventTypes: DomainEventType[] = [
  ...new Set(xpRules.flatMap((rule) => [rule.grantOn, rule.reverseOn])),
];
