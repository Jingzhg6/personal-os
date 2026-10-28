import { asc, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { areas } from "@/modules/areas/db";
import {
  automationEffects,
  automationExecutions,
  automationNotifications,
  automationRules,
} from "@/modules/automation/db";
import {
  developmentAttributes,
  disciplineLedger,
  xpAttributeCredits,
  xpLedger,
} from "@/modules/character/db";
import {
  developmentFocus,
  developmentGoalAllocations,
  developmentGoalAttributes,
  developmentGoalProjects,
  developmentGoals,
  developmentGoalTasks,
  developmentPlans,
  developmentPlanTasks,
  developmentProfiles,
} from "@/modules/development/db";
import {
  financeAccounts,
  financeFxDefaults,
  financeProviders,
  financeSettings,
  financeSnapshots,
} from "@/modules/finance/db";
import { milestones, projects } from "@/modules/projects/db";
import { levelRewards, rewardLedger, rewards } from "@/modules/rewards/db";
import { userSettings } from "@/modules/settings/db";
import {
  taskDependencies,
  taskDevelopmentContributions,
  taskRecurrences,
  tags,
  taskStatuses,
  tasks,
  taskTags,
  taskViews,
} from "@/modules/tasks/db";
import { users } from "@/shared/auth/schema";
import type { Database, DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportConventions,
  exportExclusions,
  findSensitiveKeys,
  type ExportDocument,
  type ExportRow,
} from "../domain";

type OwnedTable = PgTable & { userId: PgColumn };

/** Readers for one user's rows; every query is filtered on that user's id. */
function reader(db: DbExecutor, userId: string) {
  const sorted = (order: PgColumn[]) => order.map((c) => asc(c));
  return {
    /** Every row of a table that carries `user_id`, in a stable order. */
    owned: (table: OwnedTable, order: PgColumn[]) =>
      db
        .select()
        .from(table as PgTable)
        .where(eq(table.userId, userId))
        .orderBy(...sorted(order)) as Promise<ExportRow[]>,
    /** Rows of a link table without `user_id`, owned through its parent row. */
    through: (table: PgTable, join: SQL, parent: OwnedTable, order: PgColumn[]) =>
      db
        .select(getTableColumns(table))
        .from(table)
        .innerJoin(parent as PgTable, join)
        .where(eq(parent.userId, userId))
        .orderBy(...sorted(order)) as Promise<ExportRow[]>,
    /** The user's one-row-per-user table, or null when it was never created. */
    single: async (table: OwnedTable) => {
      const [row] = (await db
        .select()
        .from(table as PgTable)
        .where(eq(table.userId, userId))) as ExportRow[];
      return row ?? null;
    },
  };
}

async function collect(db: DbExecutor, id: string) {
  const { owned, through, single } = reader(db, id);
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      image: users.image,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!user) throw new DomainError("not_found", "export.user_not_found");

  const data: ExportDocument["data"] = {
    settings: { settings: await single(userSettings) },
    areas: { areas: await owned(areas, [areas.sortKey, areas.id]) },
    tasks: {
      statuses: await owned(taskStatuses, [taskStatuses.sortKey, taskStatuses.id]),
      tags: await owned(tags, [tags.createdAt, tags.id]),
      recurrences: await owned(taskRecurrences, [taskRecurrences.createdAt, taskRecurrences.id]),
      tasks: await owned(tasks, [tasks.createdAt, tasks.id]),
      taskTags: await through(taskTags, eq(taskTags.taskId, tasks.id), tasks, [
        taskTags.taskId,
        taskTags.tagId,
      ]),
      dependencies: await owned(taskDependencies, [
        taskDependencies.createdAt,
        taskDependencies.blockingTaskId,
        taskDependencies.blockedTaskId,
      ]),
      developmentContributions: await through(
        taskDevelopmentContributions,
        eq(taskDevelopmentContributions.taskId, tasks.id),
        tasks,
        [taskDevelopmentContributions.taskId, taskDevelopmentContributions.attributeId],
      ),
      views: await owned(taskViews, [taskViews.viewKey]),
    },
    projects: {
      projects: await owned(projects, [projects.createdAt, projects.id]),
      milestones: await owned(milestones, [milestones.createdAt, milestones.id]),
    },
    character: {
      attributes: await owned(developmentAttributes, [
        developmentAttributes.sortKey,
        developmentAttributes.id,
      ]),
      xpLedger: await owned(xpLedger, [xpLedger.createdAt, xpLedger.id]),
      xpAttributeCredits: await owned(xpAttributeCredits, [
        xpAttributeCredits.createdAt,
        xpAttributeCredits.id,
      ]),
      disciplineLedger: await owned(disciplineLedger, [
        disciplineLedger.createdAt,
        disciplineLedger.id,
      ]),
    },
    development: {
      profile: await single(developmentProfiles),
      focus: await owned(developmentFocus, [developmentFocus.position]),
      goals: await owned(developmentGoals, [developmentGoals.createdAt, developmentGoals.id]),
      goalAttributes: await through(
        developmentGoalAttributes,
        eq(developmentGoalAttributes.goalId, developmentGoals.id),
        developmentGoals,
        [developmentGoalAttributes.goalId, developmentGoalAttributes.attributeId],
      ),
      goalTasks: await through(
        developmentGoalTasks,
        eq(developmentGoalTasks.goalId, developmentGoals.id),
        developmentGoals,
        [developmentGoalTasks.goalId, developmentGoalTasks.taskId],
      ),
      goalProjects: await through(
        developmentGoalProjects,
        eq(developmentGoalProjects.goalId, developmentGoals.id),
        developmentGoals,
        [developmentGoalProjects.goalId, developmentGoalProjects.projectId],
      ),
      goalAllocations: await through(
        developmentGoalAllocations,
        eq(developmentGoalAllocations.goalId, developmentGoals.id),
        developmentGoals,
        [
          developmentGoalAllocations.goalId,
          developmentGoalAllocations.taskId,
          developmentGoalAllocations.attributeId,
        ],
      ),
      plans: await owned(developmentPlans, [developmentPlans.createdAt, developmentPlans.id]),
      planTasks: await through(
        developmentPlanTasks,
        eq(developmentPlanTasks.planId, developmentPlans.id),
        developmentPlans,
        [developmentPlanTasks.planId, developmentPlanTasks.taskId],
      ),
    },
    rewards: {
      rewards: await owned(rewards, [rewards.createdAt, rewards.id]),
      levelRewards: await owned(levelRewards, [levelRewards.level, levelRewards.id]),
      ledger: await owned(rewardLedger, [rewardLedger.createdAt, rewardLedger.id]),
    },
    finance: {
      settings: await single(financeSettings),
      providers: await owned(financeProviders, [financeProviders.sortKey, financeProviders.id]),
      accounts: await owned(financeAccounts, [financeAccounts.sortKey, financeAccounts.id]),
      snapshots: await owned(financeSnapshots, [
        financeSnapshots.valuationDate,
        financeSnapshots.accountId,
        financeSnapshots.id,
      ]),
      fxDefaults: await owned(financeFxDefaults, [financeFxDefaults.currencyCode]),
    },
    automation: {
      rules: await owned(automationRules, [automationRules.createdAt, automationRules.id]),
      executions: await owned(automationExecutions, [
        automationExecutions.startedAt,
        automationExecutions.id,
      ]),
      effects: await owned(automationEffects, [
        automationEffects.createdAt,
        automationEffects.executionId,
        automationEffects.actionIndex,
      ]),
      notifications: await owned(automationNotifications, [
        automationNotifications.createdAt,
        automationNotifications.id,
      ]),
    },
  };
  return { user: user as ExportRow, data };
}

/**
 * Everything the user owns, read in one read-only, repeatable-read transaction so the file is a
 * consistent snapshot (ADR 0025). Scoped to `userId` only; credentials are never selected, and
 * the result is checked for credential-like keys before it is returned.
 */
export async function exportUserData(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<ExportDocument> {
  const { user, data } = await db.transaction((tx) => collect(tx, userId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });

  const counts: Record<string, number> = {};
  for (const [section, tables] of Object.entries(data)) {
    for (const [name, rows] of Object.entries(tables)) {
      counts[`${section}.${name}`] = Array.isArray(rows) ? rows.length : rows ? 1 : 0;
    }
  }
  const settings = data.settings!.settings as { timeZone?: string | null } | null;
  const document: ExportDocument = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generatedAt: now.toISOString(),
    timeZone: settings?.timeZone ?? null,
    conventions: exportConventions,
    excluded: exportExclusions,
    counts,
    user,
    data,
  };
  const leaks = findSensitiveKeys(document);
  if (leaks.length > 0) throw new Error(`export: credential-like fields ${leaks.join(", ")}`);
  return document;
}
