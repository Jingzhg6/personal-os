import { z } from "zod";

import { isTimeZone, type Schedule } from "./schedule";

export * from "./schedule";

/*
 * Automation rules (M10, ADR 0020): Trigger → Conditions → Actions, all typed data validated by
 * these schemas. Nothing in a rule is ever executed as code: conditions are a closed set compared
 * with captured facts, actions a closed set mapped to other modules' services.
 */

/* ---------------------------------------------------------------- limits */

export const LIMITS = {
  /** Actions per rule (and per execution). */
  actions: 5,
  conditions: 5,
  /** Enabled rules per user. */
  enabledRules: 50,
  /** Executions per rule per rolling hour; more are recorded as skipped (rate_limited). */
  executionsPerHour: 60,
  /** Automation-caused events may trigger other rules down to this depth (0 = a person's action). */
  chainDepth: 2,
  /** Manual retries of one execution. */
  retries: 3,
  /** Events processed per drain (the rest wait for the next one). */
  eventsPerDrain: 50,
  /** Schedules processed per worker tick. */
  schedulesPerTick: 100,
  /** Per-execution statement timeout. */
  statementTimeoutMs: 10_000,
} as const;

/* ---------------------------------------------------------------- triggers */

export const eventTriggerTypes = [
  "task.completed",
  "task.status_changed",
  "project.completed",
  "goal.status_changed",
  "finance.snapshot_saved",
] as const;
export type EventTriggerType = (typeof eventTriggerTypes)[number];

export const triggerTypes = [...eventTriggerTypes, "schedule"] as const;
export type TriggerType = (typeof triggerTypes)[number];

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("once"), date: isoDate, time: hhmm }),
  z.strictObject({ kind: z.literal("daily"), time: hhmm }),
  z.strictObject({
    kind: z.literal("weekly"),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, "Duplicate weekday"),
    time: hhmm,
  }),
  z.strictObject({
    kind: z.literal("monthly"),
    day: z.number().int().min(1).max(31),
    time: hhmm,
  }),
]) satisfies z.ZodType<Schedule>;

export const triggerSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("task.completed") }),
  z.strictObject({ type: z.literal("task.status_changed") }),
  z.strictObject({ type: z.literal("project.completed") }),
  z.strictObject({ type: z.literal("goal.status_changed") }),
  z.strictObject({ type: z.literal("finance.snapshot_saved") }),
  z.strictObject({ type: z.literal("schedule"), schedule: scheduleSchema }),
]);
export type Trigger = { type: EventTriggerType } | { type: "schedule"; schedule: Schedule };

export const isScheduleTrigger = (
  trigger: Trigger,
): trigger is Extract<Trigger, { type: "schedule" }> => trigger.type === "schedule";

/* ---------------------------------------------------------------- facts */

/**
 * What a rule may know about its trigger: captured when the event happened (same transaction),
 * so conditions are evaluated on the state at that moment. No balances, no secrets.
 */
export interface TaskFacts {
  kind: "task";
  taskId: string;
  title: string;
  priority: number;
  areaId: string | null;
  projectId: string | null;
  statusId: string;
}
export interface ProjectFacts {
  kind: "project";
  projectId: string;
  name: string;
  priority: number;
  areaId: string | null;
}
export interface GoalFacts {
  kind: "goal";
  goalId: string;
  title: string;
  fromStatus: string;
  toStatus: string;
}
export interface FinanceFacts {
  kind: "finance";
  valuationDate: string;
  entryCount: number;
  unconvertedCount: number;
  corrected: boolean;
}
export interface ScheduleFacts {
  kind: "schedule";
  /** ISO instant of the occurrence. */
  scheduledFor: string;
  /** Local date of the occurrence in the rule's time zone. */
  localDate: string;
}
export type Facts = TaskFacts | ProjectFacts | GoalFacts | FinanceFacts | ScheduleFacts;

export const factsKindOf: Record<TriggerType, Facts["kind"]> = {
  "task.completed": "task",
  "task.status_changed": "task",
  "project.completed": "project",
  "goal.status_changed": "goal",
  "finance.snapshot_saved": "finance",
  schedule: "schedule",
};

/* ---------------------------------------------------------------- conditions */

export const goalStatusValues = ["active", "paused", "completed", "archived"] as const;

export const conditionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("task_priority"), priority: z.number().int().min(0).max(4) }),
  z.strictObject({ type: z.literal("task_area"), areaId: z.uuid() }),
  z.strictObject({ type: z.literal("task_project"), projectId: z.uuid() }),
  z.strictObject({ type: z.literal("task_status"), statusId: z.uuid() }),
  z.strictObject({ type: z.literal("project_priority"), priority: z.number().int().min(0).max(4) }),
  z.strictObject({ type: z.literal("project_area"), areaId: z.uuid() }),
  z.strictObject({ type: z.literal("goal_status"), status: z.enum(goalStatusValues) }),
  z.strictObject({ type: z.literal("finance_all_valued") }),
]);
export type Condition = z.infer<typeof conditionSchema>;
export type ConditionType = Condition["type"];
export const conditionTypes = conditionSchema.options.map(
  (o) => o.shape.type.value,
) as ConditionType[];

const conditionFacts: Record<ConditionType, Facts["kind"]> = {
  task_priority: "task",
  task_area: "task",
  task_project: "task",
  task_status: "task",
  project_priority: "project",
  project_area: "project",
  goal_status: "goal",
  finance_all_valued: "finance",
};

export function conditionsFor(trigger: TriggerType): ConditionType[] {
  return conditionTypes.filter((type) => conditionFacts[type] === factsKindOf[trigger]);
}

export interface ConditionResult {
  type: ConditionType;
  matched: boolean;
}

/** Evaluates one condition against captured facts. A condition for other facts never matches. */
export function evaluateCondition(condition: Condition, facts: Facts): boolean {
  switch (condition.type) {
    case "task_priority":
      return facts.kind === "task" && facts.priority === condition.priority;
    case "task_area":
      return facts.kind === "task" && facts.areaId === condition.areaId;
    case "task_project":
      return facts.kind === "task" && facts.projectId === condition.projectId;
    case "task_status":
      return facts.kind === "task" && facts.statusId === condition.statusId;
    case "project_priority":
      return facts.kind === "project" && facts.priority === condition.priority;
    case "project_area":
      return facts.kind === "project" && facts.areaId === condition.areaId;
    case "goal_status":
      return facts.kind === "goal" && facts.toStatus === condition.status;
    case "finance_all_valued":
      return facts.kind === "finance" && facts.unconvertedCount === 0;
  }
}

/** All conditions must match (AND); no conditions always match. */
export function evaluateConditions(conditions: readonly Condition[], facts: Facts) {
  const results: ConditionResult[] = conditions.map((condition) => ({
    type: condition.type,
    matched: evaluateCondition(condition, facts),
  }));
  return { matched: results.every((r) => r.matched), results };
}

/* ---------------------------------------------------------------- actions */

const templateText = (max: number) => z.string().trim().min(1).max(max);

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create_task"),
    title: templateText(200),
    description: z.string().trim().max(2000).nullable().default(null),
    areaId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    priority: z.number().int().min(0).max(4).default(0),
    /** Due date = the trigger's local date + this many days (null = no due date). */
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
  }),
  z.strictObject({
    type: z.literal("create_follow_up_task"),
    title: templateText(200),
    description: z.string().trim().max(2000).nullable().default(null),
    priority: z.number().int().min(0).max(4).default(0),
    dueInDays: z.number().int().min(0).max(365).nullable().default(null),
  }),
  z.strictObject({
    type: z.literal("notify"),
    title: templateText(120),
    body: z.string().trim().max(500).nullable().default(null),
  }),
  z.strictObject({
    type: z.literal("set_task_priority"),
    priority: z.number().int().min(0).max(4),
  }),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];
export const actionTypes = actionSchema.options.map((o) => o.shape.type.value) as ActionType[];

/** Follow-ups go where the trigger lives; only task and project triggers have such a place. */
export function actionsFor(trigger: TriggerType): ActionType[] {
  const kind = factsKindOf[trigger];
  return actionTypes.filter((type) => {
    if (type === "set_task_priority") return kind === "task";
    if (type === "create_follow_up_task") return kind === "task" || kind === "project";
    return true;
  });
}

/* ---------------------------------------------------------------- rules */

const ruleFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(LIMITS.conditions).default([]),
  actions: z.array(actionSchema).min(1).max(LIMITS.actions),
  /** IANA zone for schedules and relative due dates (default: the user's settings). */
  timeZone: z.string().refine(isTimeZone, "Unknown time zone").nullable().default(null),
};

/** Conditions and actions must fit the trigger. */
function fitsTrigger(rule: { trigger: Trigger; conditions: Condition[]; actions: Action[] }) {
  const conditions = conditionsFor(rule.trigger.type);
  const actions = actionsFor(rule.trigger.type);
  return (
    rule.conditions.every((c) => conditions.includes(c.type)) &&
    rule.actions.every((a) => actions.includes(a.type))
  );
}

export const ruleConfigSchema = z
  .strictObject(ruleFields)
  .refine(fitsTrigger, { message: "Condition or action not available for this trigger" });
export type RuleConfig = z.infer<typeof ruleConfigSchema>;
export type RuleConfigInput = z.input<typeof ruleConfigSchema>;

export const createRuleInput = ruleConfigSchema;
export const updateRuleInput = z.object({ id: z.uuid(), config: ruleConfigSchema });
export const idInput = z.object({ id: z.uuid() });
export const setEnabledInput = z.object({ id: z.uuid(), enabled: z.boolean() });
export const historyInput = z.object({
  id: z.uuid(),
  limit: z.number().int().min(1).max(100).default(30),
});

/**
 * Reads persisted configuration defensively: stored JSON is data, not trusted code. An invalid or
 * unknown shape (e.g. written by a newer version) is reported, never executed.
 */
export function parseStoredRule(stored: {
  name: string;
  description: string | null;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  timeZone: string | null;
}): { ok: true; config: RuleConfig } | { ok: false } {
  // Only the configuration fields: a stored row carries ids and timestamps too.
  const parsed = ruleConfigSchema.safeParse({
    name: stored.name,
    description: stored.description,
    trigger: stored.trigger,
    conditions: stored.conditions,
    actions: stored.actions,
    timeZone: stored.timeZone,
  });
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false };
}

/* ---------------------------------------------------------------- templates */

/** The only placeholders a template may use; anything else is left as typed. */
export const templateTokens = ["{task}", "{project}", "{goal}", "{date}"] as const;

export function renderTemplate(template: string, facts: Facts, localDate: string): string {
  const values: Record<(typeof templateTokens)[number], string> = {
    "{task}": facts.kind === "task" ? facts.title : "",
    "{project}": facts.kind === "project" ? facts.name : "",
    "{goal}": facts.kind === "goal" ? facts.title : "",
    // A finance batch is about its valuation date; anything else about the trigger's local day.
    "{date}": facts.kind === "finance" ? facts.valuationDate : localDate,
  };
  return template.replace(
    /\{(task|project|goal|date)\}/g,
    (token) => values[token as keyof typeof values],
  );
}

/* ---------------------------------------------------------------- idempotency */

/**
 * The logical identity of a trigger occurrence for one rule. One execution per rule and key
 * (unique index), so redelivery, double processing and concurrent workers cannot run a rule twice
 * for the same occurrence.
 *
 * - A task or project completing fires a rule once per task / project, even if it is reopened
 *   and completed again (a follow-up is created once).
 * - Status changes fire per change (the event id).
 * - A finance batch fires once per valuation date (corrections do not re-fire).
 * - A schedule fires once per occurrence instant.
 */
export function triggerKey(
  trigger: TriggerType,
  input: { eventId?: string; facts: Facts },
): string {
  const { facts } = input;
  switch (trigger) {
    case "task.completed":
      return `task.completed:${(facts as TaskFacts).taskId}`;
    case "project.completed":
      return `project.completed:${(facts as ProjectFacts).projectId}`;
    case "finance.snapshot_saved":
      return `finance.snapshot_saved:${(facts as FinanceFacts).valuationDate}`;
    case "schedule":
      return `schedule:${(facts as ScheduleFacts).scheduledFor}`;
    case "task.status_changed":
    case "goal.status_changed":
      return `${trigger}:${input.eventId}`;
  }
}

/* ---------------------------------------------------------------- executions */

export const executionStatuses = ["running", "succeeded", "failed", "partial", "skipped"] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export const skipReasons = [
  "conditions_not_met",
  "loop",
  "depth",
  "rate_limited",
  "misfired",
  "invalid_config",
] as const;
export type SkipReason = (typeof skipReasons)[number];

export type ActionOutcome = "succeeded" | "failed" | "not_run";

export interface ActionResult {
  index: number;
  type: ActionType;
  outcome: ActionOutcome;
  /** Created / changed entity (task or notification id). */
  entityId?: string;
  /** Error classification: a domain code (permanent) or "transient". */
  errorCode?: string;
}

/**
 * Failure classes. A business-rule refusal (deleted project, invalid area, …) is permanent: the
 * same action would fail again, so retrying is pointless until the rule is fixed. Anything else
 * (timeouts, lost connections) is transient and may be retried.
 */
export function classifyError(error: unknown): { code: string; retryable: boolean } {
  const domainCode = (error as { code?: unknown; kind?: unknown } | null)?.code;
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (typeof domainCode === "string" && typeof kind === "string") {
    return { code: domainCode, retryable: false };
  }
  return { code: "automation.transient", retryable: true };
}

/** Overall status from per-action outcomes. */
export function executionStatusOf(results: readonly ActionResult[]): ExecutionStatus {
  const ok = results.filter((r) => r.outcome === "succeeded").length;
  if (ok === results.length) return "succeeded";
  return ok === 0 ? "failed" : "partial";
}

/* ---------------------------------------------------------------- read models */

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  /** Null when the stored configuration is invalid (shown, never executed). */
  config: RuleConfig | null;
  triggerType: string;
  timeZone: string | null;
  nextRunAt: Date | null;
  lastTriggeredAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastExecution: { status: ExecutionStatus; at: Date; skipReason: SkipReason | null } | null;
}

export interface AutomationExecution {
  id: string;
  ruleId: string;
  triggerKey: string;
  triggerType: string;
  /** What triggered it, in a few words: a task / project / goal title, a date. */
  subject: string | null;
  status: ExecutionStatus;
  skipReason: SkipReason | null;
  conditionResults: ConditionResult[];
  actionResults: ActionResult[];
  errorCode: string | null;
  retryable: boolean;
  attempts: number;
  duplicates: number;
  depth: number;
  missedOccurrences: number;
  scheduledFor: Date | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface AutomationNotification {
  id: string;
  ruleId: string | null;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface AutomationHealth {
  /** Events are processed right after each change in the app; pending ones are retried. */
  events: { pending: number; oldestPendingAt: Date | null; lastProcessedAt: Date | null };
  /** The scheduler needs an external worker calling the tick endpoint. */
  scheduler: {
    configured: boolean;
    lastTickAt: Date | null;
    operational: boolean;
    scheduledRules: number;
    dueRules: number;
  };
  recentFailures: {
    executionId: string;
    ruleId: string;
    ruleName: string;
    errorCode: string | null;
    at: Date;
  }[];
  lastSuccessAt: Date | null;
}

/** A worker heartbeat older than this means the scheduler is not running. */
export const WORKER_STALE_MS = 5 * 60_000;

/** A short, human label of the facts (no balances: a finance batch is shown by its date). */
export function factsSubject(facts: Facts): string | null {
  switch (facts.kind) {
    case "task":
      return facts.title;
    case "project":
      return facts.name;
    case "goal":
      return facts.title;
    case "finance":
      return facts.valuationDate;
    case "schedule":
      return facts.localDate;
    default:
      return null;
  }
}

/** Message key of a trigger type (message keys cannot contain dots). */
export function triggerKeyOf(type: string) {
  return type.replace(".", "_") as
    | "task_completed"
    | "task_status_changed"
    | "project_completed"
    | "goal_status_changed"
    | "finance_snapshot_saved"
    | "schedule";
}
