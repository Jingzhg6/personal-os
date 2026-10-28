import "server-only";

import {
  actionsFor,
  conditionsFor,
  LIMITS as AUTOMATION_LIMITS,
  templateTokens,
  triggerTypes,
} from "@/modules/automation/domain";
import { getHealth, listRules } from "@/modules/automation/server";
import { listAreas } from "@/modules/areas/server";
import { isActiveAttribute, isGrowthTarget } from "@/modules/character/domain";
import { getDisciplineSummary, listAttributes } from "@/modules/character/server";
import { getDevelopmentOverview, getGoalDetail } from "@/modules/development/server";
import { getFinanceOverview } from "@/modules/finance/server";
import { listProjects } from "@/modules/projects/server";
import { getUserSettings } from "@/modules/settings/server";
import { todayIn, type Task } from "@/modules/tasks/domain";
import { getTask, listStatuses, listTasks } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";

import {
  AI_LIMITS,
  factsForModel,
  isOpenCategory,
  OPEN_CATEGORIES,
  taskFacts,
  type ReviewFacts,
} from "../domain";
import { areaName, attributeName, statusName } from "./labels";

/*
 * Context builders: the only way data reaches a provider. Each reads the user's own data through
 * the owning modules' read models (always scoped by the signed-in user id), keeps only what the
 * capability needs, bounds every list, and returns the ids a valid answer may mention.
 *
 * Never included: passwords, sessions or tokens, e-mail addresses, finance amounts, balances,
 * currencies, rates and account names, XP ledgers, reward balances.
 */

export interface Allowed {
  tasks: Set<string>;
  projects: Set<string>;
  goals: Set<string>;
  rules: Set<string>;
  /** Growth attributes a contribution may target (never 自制力). */
  attributes: Set<string>;
  areas: Set<string>;
  statuses: Set<string>;
}

export interface BuiltContext {
  data: Record<string, unknown>;
  allowed: Allowed;
  /** Titles for ids, to show recommendations with names the user recognises. */
  titles: Record<string, string>;
}

const emptyAllowed = (): Allowed => ({
  tasks: new Set(),
  projects: new Set(),
  goals: new Set(),
  rules: new Set(),
  attributes: new Set(),
  areas: new Set(),
  statuses: new Set(),
});

export async function userCalendar(db: DbExecutor, userId: string, now = new Date()) {
  const settings = await getUserSettings(db, userId);
  const timeZone = settings.timeZone ?? defaultTimeZone;
  return { timeZone, today: todayIn(timeZone, now) };
}

function openTasks(db: DbExecutor, userId: string, today: string) {
  return listTasks(db, userId, {
    filter: { categories: [...OPEN_CATEGORIES] },
    sort: "manual",
    includeSubtasks: true,
    today,
  });
}

/** Active growth attributes (自制力 and archived / legacy ones excluded). */
async function growthAttributes(db: DbExecutor, userId: string) {
  const all = await listAttributes(db, userId);
  return all
    .filter((a) => isGrowthTarget(a) && isActiveAttribute(a))
    .slice(0, AI_LIMITS.contextItems.attributes)
    .map((a) => ({ id: a.id, name: attributeName(a) }));
}

/* ---------------------------------------------------------------- review facts */

/** The review's facts, computed by the app (no AI involved). */
export async function buildReviewFacts(
  db: DbExecutor,
  userId: string,
  options: { schedulerConfigured: boolean; now?: Date },
): Promise<ReviewFacts> {
  const now = options.now ?? new Date();
  const { today } = await userCalendar(db, userId, now);
  const [tasks, projects, overview, discipline, finance, rules, health] = await Promise.all([
    openTasks(db, userId, today),
    listProjects(db, userId, { today, statuses: ["active"] }),
    getDevelopmentOverview(db, userId),
    getDisciplineSummary(db, userId, 200),
    getFinanceOverview(db, userId),
    listRules(db, userId),
    getHealth(db, userId, { schedulerConfigured: options.schedulerConfigured, now }),
  ]);
  const since = now.getTime() - 30 * 24 * 60 * 60_000;
  const disciplineRecent: Record<string, number> = {};
  for (const entry of discipline.entries) {
    if (entry.createdAt.getTime() < since) continue;
    disciplineRecent[entry.outcome] = (disciplineRecent[entry.outcome] ?? 0) + 1;
  }
  const liveRules = rules.filter((r) => !r.archivedAt);
  return {
    today,
    tasks: taskFacts(tasks, today),
    projects: {
      active: projects.length,
      overdue: projects
        .filter((p) => p.targetDate !== null && p.targetDate < today)
        .map((p) => ({ id: p.id, name: p.name, targetDate: p.targetDate! })),
      milestonesOverdue: projects.flatMap((p) =>
        p.nextMilestone?.dueDate && p.nextMilestone.dueDate < today
          ? [
              {
                projectId: p.id,
                projectName: p.name,
                milestone: p.nextMilestone.name,
                dueDate: p.nextMilestone.dueDate,
              },
            ]
          : [],
      ),
      withOverdueTasks: projects.filter((p) => p.progress.overdue > 0).length,
    },
    goals: {
      active: overview.goals.filter((g) => g.goal.status === "active").length,
      paused: overview.goals.filter((g) => g.goal.status === "paused").length,
      withoutOpenTasks: overview.goals
        .filter((g) => g.goal.status === "active" && g.actions.open === 0)
        .map((g) => ({ id: g.goal.id, title: g.goal.title })),
      focus: overview.attributes.filter((a) => a.focused).map((a) => attributeName(a.attribute)),
    },
    growth: {
      attributes: overview.attributes.filter((a) => isGrowthTarget(a.attribute)).length,
      disciplineScore: discipline.score,
      disciplineRecent,
    },
    finance: {
      hasAccounts: finance.hasAccounts,
      lastValuationDate: finance.lastValuationDate,
      missing: finance.missing.map((m) => ({ accountId: m.accountId, name: m.name })),
      stale: finance.stale,
      unconverted: finance.unconverted.map((u) => ({
        accountId: u.accountId,
        name: u.name,
        currency: u.currency,
      })),
    },
    automation: {
      rules: liveRules.length,
      enabled: liveRules.filter((r) => r.enabled).length,
      disabled: liveRules.filter((r) => !r.enabled).length,
      schedulerConfigured: health.scheduler.configured,
      schedulerOperational: health.scheduler.operational,
      dueRules: health.scheduler.dueRules,
      failedEvents: health.events.failed,
      recentFailures: health.recentFailures.map((f) => ({
        ruleId: f.ruleId,
        ruleName: f.ruleName,
        errorCode: f.errorCode,
      })),
    },
  };
}

/** Review context: the facts (finance as counts only) and the entities they name. */
export function reviewContext(facts: ReviewFacts): BuiltContext {
  const allowed = emptyAllowed();
  const titles: Record<string, string> = {};
  for (const t of facts.tasks.overdueItems) {
    allowed.tasks.add(t.id);
    titles[t.id] = t.title;
  }
  for (const p of facts.projects.overdue) {
    allowed.projects.add(p.id);
    titles[p.id] = p.name;
  }
  for (const m of facts.projects.milestonesOverdue) {
    allowed.projects.add(m.projectId);
    titles[m.projectId] = m.projectName;
  }
  for (const g of facts.goals.withoutOpenTasks) {
    allowed.goals.add(g.id);
    titles[g.id] = g.title;
  }
  for (const f of facts.automation.recentFailures) {
    allowed.rules.add(f.ruleId);
    titles[f.ruleId] = f.ruleName;
  }
  return { data: { facts: factsForModel(facts) }, allowed, titles };
}

/* ---------------------------------------------------------------- priorities */

function compactTask(task: Task, projectNames: Map<string, string>, focus: Set<string>) {
  return {
    id: task.id,
    title: task.title,
    parentTitle: task.parentTitle,
    status: task.statusCategory,
    priority: task.priority,
    urgent: task.isUrgent,
    important: task.isImportant,
    startDate: task.startDate,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    estimatedMinutes: task.estimatedMinutes,
    openBlockers: task.openBlockerCount,
    project: task.projectId ? (projectNames.get(task.projectId) ?? null) : null,
    growsFocusAttribute: task.contributions.some((c) => focus.has(c.attributeId)),
  };
}

/** Open tasks first by due date and priority, so truncation keeps the most pressing ones. */
function byPressure(a: Task, b: Task) {
  const due = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
  return due !== 0 ? due : b.priority - a.priority;
}

export async function prioritiesContext(
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<BuiltContext & { tasks: Map<string, Task> }> {
  const { today } = await userCalendar(db, userId, now);
  const [tasks, projects, overview] = await Promise.all([
    openTasks(db, userId, today),
    listProjects(db, userId, { today }),
    getDevelopmentOverview(db, userId),
  ]);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const focus = new Set(overview.focusAttributeIds);
  const sorted = tasks.filter((t) => isOpenCategory(t.statusCategory)).sort(byPressure);
  const kept = sorted.slice(0, AI_LIMITS.contextItems.tasks);
  const allowed = emptyAllowed();
  const titles: Record<string, string> = {};
  for (const t of kept) {
    allowed.tasks.add(t.id);
    titles[t.id] = t.title;
  }
  return {
    data: {
      today,
      focusAttributes: overview.attributes
        .filter((a) => a.focused)
        .map((a) => attributeName(a.attribute)),
      activeGoals: overview.goals
        .filter((g) => g.goal.status === "active")
        .slice(0, AI_LIMITS.contextItems.goals)
        .map((g) => ({ title: g.goal.title, openActions: g.actions.open })),
      openTasks: kept.map((t) => compactTask(t, projectNames, focus)),
      omittedOpenTasks: sorted.length - kept.length,
    },
    allowed,
    titles,
    tasks: new Map(kept.map((t) => [t.id, t])),
  };
}

/* ---------------------------------------------------------------- goal plan */

export async function goalPlanContext(
  db: DbExecutor,
  userId: string,
  goalId: string,
  note: string | null,
  now = new Date(),
) {
  const { today } = await userCalendar(db, userId, now);
  // Throws not_found unless the goal belongs to the user.
  const detail = await getGoalDetail(db, userId, goalId);
  const attributes = await growthAttributes(db, userId);
  const allowed = emptyAllowed();
  for (const a of attributes) allowed.attributes.add(a.id);
  allowed.goals.add(goalId);
  const names = new Map(attributes.map((a) => [a.id, a.name]));
  return {
    data: {
      today,
      goal: {
        id: detail.goal.id,
        title: detail.goal.title,
        description: detail.goal.description,
        status: detail.goal.status,
        targetDate: detail.goal.targetDate,
        attributes: detail.goal.attributes
          .filter((a) => names.has(a.attributeId))
          .map((a) => ({
            attributeId: a.attributeId,
            name: names.get(a.attributeId),
            weight: a.weight,
          })),
      },
      existingTasks: detail.tasks.slice(0, AI_LIMITS.contextItems.tasks).map((t) => ({
        title: t.title,
        status: t.statusCategory,
        dueDate: t.dueDate,
      })),
      growthAttributes: attributes,
      userNote: note,
    },
    allowed,
    titles: Object.fromEntries(attributes.map((a) => [a.id, a.name])) as Record<string, string>,
    goal: detail.goal,
    today,
  };
}

/* ---------------------------------------------------------------- contributions */

export async function contributionsContext(db: DbExecutor, userId: string, taskId: string) {
  // Throws not_found unless the task belongs to the user.
  const task = await getTask(db, userId, taskId);
  const { today } = await userCalendar(db, userId);
  const [attributes, areas, projects] = await Promise.all([
    growthAttributes(db, userId),
    listAreas(db, userId),
    listProjects(db, userId, { today }),
  ]);
  const allowed = emptyAllowed();
  for (const a of attributes) allowed.attributes.add(a.id);
  allowed.tasks.add(task.id);
  const names = new Map(attributes.map((a) => [a.id, a.name]));
  const area = areas.find((a) => a.id === task.areaId);
  return {
    data: {
      task: {
        id: task.id,
        title: task.title,
        parentTitle: task.parentTitle,
        area: area ? areaName(area) : null,
        project: projects.find((p) => p.id === task.projectId)?.name ?? null,
        estimatedMinutes: task.estimatedMinutes,
        currentContributions: task.contributions
          .filter((c) => names.has(c.attributeId))
          .map((c) => ({
            attributeId: c.attributeId,
            name: names.get(c.attributeId),
            weight: c.weight,
          })),
      },
      growthAttributes: attributes,
    },
    allowed,
    titles: Object.fromEntries(attributes.map((a) => [a.id, a.name])) as Record<string, string>,
    task,
  };
}

/* ---------------------------------------------------------------- automation draft */

/** The engine's capabilities, read from its own domain definitions (nothing else is possible). */
export function automationCapabilities() {
  return {
    triggers: triggerTypes.map((type) => ({
      type,
      conditions: conditionsFor(type),
      actions: actionsFor(type),
    })),
    scheduleKinds: ["once", "daily", "weekly", "monthly"],
    templateTokens,
    limits: { conditions: AUTOMATION_LIMITS.conditions, actions: AUTOMATION_LIMITS.actions },
    notSupported: [
      "email, SMS, webhooks or any external service",
      "deleting, completing or moving tasks",
      "changing XP, 自制力, rewards or finance data",
      "running code or queries",
    ],
  };
}

export async function automationContext(db: DbExecutor, userId: string, request: string) {
  const { today } = await userCalendar(db, userId);
  const [areas, projects, statuses] = await Promise.all([
    listAreas(db, userId),
    listProjects(db, userId, { today }),
    listStatuses(db, userId),
  ]);
  const allowed = emptyAllowed();
  const live = projects.filter((p) => p.status !== "completed" && p.status !== "cancelled");
  for (const a of areas) allowed.areas.add(a.id);
  for (const p of live) allowed.projects.add(p.id);
  for (const s of statuses) allowed.statuses.add(s.id);
  return {
    data: {
      request,
      capabilities: automationCapabilities(),
      areas: areas.map((a) => ({ id: a.id, name: areaName(a) })),
      projects: live
        .slice(0, AI_LIMITS.contextItems.projects)
        .map((p) => ({ id: p.id, name: p.name })),
      statuses: statuses.map((s) => ({ id: s.id, name: statusName(s), category: s.category })),
    },
    allowed,
    titles: {} as Record<string, string>,
  };
}

/* ---------------------------------------------------------------- question */

export async function questionContext(
  db: DbExecutor,
  userId: string,
  question: string,
  options: { schedulerConfigured: boolean },
): Promise<BuiltContext> {
  const facts = await buildReviewFacts(db, userId, options);
  const priorities = await prioritiesContext(db, userId);
  const base = reviewContext(facts);
  return {
    data: {
      question,
      facts: base.data.facts,
      openTasks: (priorities.data.openTasks as unknown[]).slice(0, 30),
      activeGoals: priorities.data.activeGoals,
      focusAttributes: priorities.data.focusAttributes,
    },
    allowed: base.allowed,
    titles: base.titles,
  };
}
