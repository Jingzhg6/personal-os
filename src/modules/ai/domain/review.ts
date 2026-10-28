/*
 * The review's facts are computed by the app from its own read models — never by the model.
 * The model only adds interpretations and recommendations on top, labelled as such.
 */

export const OPEN_CATEGORIES = ["backlog", "unstarted", "started"] as const;
export const isOpenCategory = (category: string) =>
  (OPEN_CATEGORIES as readonly string[]).includes(category);

export interface ReviewTaskFacts {
  open: number;
  overdue: number;
  dueToday: number;
  /** Open tasks waiting for an open blocker. */
  blocked: number;
  /** Open, urgent and important. */
  urgentImportant: number;
  overdueItems: { id: string; title: string; dueDate: string }[];
}

export interface ReviewProjectFacts {
  active: number;
  /** Active projects past their target date. */
  overdue: { id: string; name: string; targetDate: string }[];
  /** Active projects whose next milestone is past due. */
  milestonesOverdue: {
    projectId: string;
    projectName: string;
    milestone: string;
    dueDate: string;
  }[];
  /** Active projects with overdue open tasks. */
  withOverdueTasks: number;
}

export interface ReviewGoalFacts {
  active: number;
  paused: number;
  /** Active goals without any open linked task. */
  withoutOpenTasks: { id: string; title: string }[];
  /** Names of the focus attributes. */
  focus: string[];
}

export interface ReviewGrowthFacts {
  /** Active growth attributes (自制力 excluded). */
  attributes: number;
  disciplineScore: number;
  /** 自制力 ledger entries of the last 30 days, by outcome. */
  disciplineRecent: Record<string, number>;
}

export interface ReviewFinanceFacts {
  hasAccounts: boolean;
  lastValuationDate: string | null;
  /** Accounts without any valuation: unknown, never zero. */
  missing: { accountId: string; name: string }[];
  stale: { accountId: string; name: string; valuationDate: string }[];
  unconverted: { accountId: string; name: string; currency: string }[];
}

export interface ReviewAutomationFacts {
  rules: number;
  enabled: number;
  disabled: number;
  schedulerConfigured: boolean;
  schedulerOperational: boolean;
  /** Enabled schedules due but not yet run (waiting for the worker). */
  dueRules: number;
  failedEvents: number;
  recentFailures: { ruleId: string; ruleName: string; errorCode: string | null }[];
}

export interface ReviewFacts {
  today: string;
  tasks: ReviewTaskFacts;
  projects: ReviewProjectFacts;
  goals: ReviewGoalFacts;
  growth: ReviewGrowthFacts;
  finance: ReviewFinanceFacts;
  automation: ReviewAutomationFacts;
}

export interface FactTask {
  id: string;
  title: string;
  statusCategory: string;
  dueDate: string | null;
  openBlockerCount: number;
  isUrgent: boolean | null;
  isImportant: boolean | null;
}

const OVERDUE_ITEMS = 5;

export function taskFacts(tasks: readonly FactTask[], today: string): ReviewTaskFacts {
  const open = tasks.filter((t) => isOpenCategory(t.statusCategory));
  const overdue = open
    .filter((t) => t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  return {
    open: open.length,
    overdue: overdue.length,
    dueToday: open.filter((t) => t.dueDate === today).length,
    blocked: open.filter((t) => t.openBlockerCount > 0).length,
    urgentImportant: open.filter((t) => t.isUrgent && t.isImportant).length,
    overdueItems: overdue
      .slice(0, OVERDUE_ITEMS)
      .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate! })),
  };
}

/**
 * The facts as sent to a provider: finance is reduced to counts and a date — no account names,
 * amounts, balances, currencies or rates ever leave the app.
 */
export function factsForModel(facts: ReviewFacts) {
  return {
    ...facts,
    finance: {
      hasAccounts: facts.finance.hasAccounts,
      lastValuationDate: facts.finance.lastValuationDate,
      accountsWithoutValuation: facts.finance.missing.length,
      staleValuations: facts.finance.stale.length,
      valuationsWithoutExchangeRate: facts.finance.unconverted.length,
    },
  };
}
