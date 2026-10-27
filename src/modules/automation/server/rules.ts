import { and, count, desc, eq, inArray } from "drizzle-orm";

import { areaBelongsToUser } from "@/modules/areas/server";
import { projects } from "@/modules/projects/db";
import { getUserSettings } from "@/modules/settings/server";
import { listStatuses } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";

import { automationExecutions, automationRules } from "../db";
import {
  LIMITS,
  nextOccurrence,
  parseStoredRule,
  type AutomationRule,
  type ExecutionStatus,
  type RuleConfig,
  type SkipReason,
} from "../domain";

/*
 * Rule lifecycle: create (always disabled) → validate → enable / disable → edit → archive /
 * restore → delete (only without history). Every query is scoped by user id; referenced areas,
 * projects and statuses must be the user's own.
 */

type RuleRow = typeof automationRules.$inferSelect;

async function getOwnedRule(db: DbExecutor, userId: string, id: string, lock = false) {
  const query = db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new DomainError("not_found", "automation.rule_not_found");
  return row;
}

/** Ids in a rule must be the user's own (checked again by the services when actions run). */
async function assertReferencesOwned(db: DbExecutor, userId: string, config: RuleConfig) {
  const areaIds = new Set<string>();
  const projectIds = new Set<string>();
  const statusIds = new Set<string>();
  for (const c of config.conditions) {
    if (c.type === "task_area" || c.type === "project_area") areaIds.add(c.areaId);
    if (c.type === "task_project") projectIds.add(c.projectId);
    if (c.type === "task_status") statusIds.add(c.statusId);
  }
  for (const a of config.actions) {
    if (a.type === "create_task") {
      if (a.areaId) areaIds.add(a.areaId);
      if (a.projectId) projectIds.add(a.projectId);
    }
  }
  for (const id of areaIds) {
    if (!(await areaBelongsToUser(db, userId, id))) {
      throw new DomainError("not_found", "automation.reference_not_found");
    }
  }
  if (projectIds.size) {
    const found = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), inArray(projects.id, [...projectIds])));
    if (found.length !== projectIds.size) {
      throw new DomainError("not_found", "automation.reference_not_found");
    }
  }
  if (statusIds.size) {
    const own = new Set((await listStatuses(db, userId)).map((s) => s.id));
    if ([...statusIds].some((id) => !own.has(id))) {
      throw new DomainError("not_found", "automation.reference_not_found");
    }
  }
}

/** Schedules get a fixed zone (the user's at creation) so their DST behaviour never shifts. */
async function zoneFor(db: DbExecutor, userId: string, config: RuleConfig) {
  if (config.timeZone) return config.timeZone;
  const settings = await getUserSettings(db, userId);
  return settings.timeZone ?? defaultTimeZone;
}

function nextRun(config: RuleConfig, zone: string, now: Date): Date | null {
  if (config.trigger.type !== "schedule") return null;
  const next = nextOccurrence(config.trigger.schedule, zone, now.getTime());
  return next === null ? null : new Date(next);
}

function toRule(
  row: RuleRow,
  last: { status: string; startedAt: Date; skipReason: string | null } | undefined,
): AutomationRule {
  const parsed = parseStoredRule(row);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    config: parsed.ok ? parsed.config : null,
    triggerType: row.triggerType,
    timeZone: row.timeZone,
    nextRunAt: row.nextRunAt,
    lastTriggeredAt: row.lastTriggeredAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastExecution: last
      ? {
          status: last.status as ExecutionStatus,
          at: last.startedAt,
          skipReason: last.skipReason as SkipReason | null,
        }
      : null,
  };
}

async function lastExecutions(db: DbExecutor, userId: string, ruleIds: string[]) {
  if (!ruleIds.length) return new Map();
  const rows = await db
    .selectDistinctOn([automationExecutions.ruleId], {
      ruleId: automationExecutions.ruleId,
      status: automationExecutions.status,
      startedAt: automationExecutions.startedAt,
      skipReason: automationExecutions.skipReason,
    })
    .from(automationExecutions)
    .where(
      and(eq(automationExecutions.userId, userId), inArray(automationExecutions.ruleId, ruleIds)),
    )
    .orderBy(automationExecutions.ruleId, desc(automationExecutions.startedAt));
  return new Map(rows.map((r) => [r.ruleId, r]));
}

export async function listRules(db: DbExecutor, userId: string): Promise<AutomationRule[]> {
  const rows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.userId, userId))
    .orderBy(desc(automationRules.createdAt));
  const last = await lastExecutions(
    db,
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toRule(row, last.get(row.id)));
}

export async function getRule(db: DbExecutor, userId: string, id: string) {
  const row = await getOwnedRule(db, userId, id);
  const last = await lastExecutions(db, userId, [id]);
  return toRule(row, last.get(id));
}

function configValues(config: RuleConfig, zone: string | null) {
  return {
    name: config.name,
    description: config.description,
    triggerType: config.trigger.type,
    trigger: config.trigger,
    conditions: config.conditions,
    actions: config.actions,
    timeZone: zone,
  };
}

/** New rules are saved disabled. */
export function createRule(db: DbExecutor, userId: string, config: RuleConfig) {
  return db.transaction(async (tx) => {
    await assertReferencesOwned(tx, userId, config);
    const zone =
      config.trigger.type === "schedule" ? await zoneFor(tx, userId, config) : config.timeZone;
    const [row] = await tx
      .insert(automationRules)
      .values({ userId, enabled: false, ...configValues(config, zone) })
      .returning();
    return toRule(row!, undefined);
  });
}

/**
 * Edits apply from now on: an enabled rule's `enabledAt` moves to now, so events from before the
 * edit are never processed with the new configuration.
 */
export function updateRule(db: DbExecutor, userId: string, id: string, config: RuleConfig) {
  return db.transaction(async (tx) => {
    const row = await getOwnedRule(tx, userId, id, true);
    if (row.archivedAt) throw new DomainError("invalid", "automation.rule_archived");
    await assertReferencesOwned(tx, userId, config);
    const zone =
      config.trigger.type === "schedule" ? await zoneFor(tx, userId, config) : config.timeZone;
    const now = new Date();
    let nextRunAt: Date | null = null;
    if (row.enabled) {
      nextRunAt = nextRun(config, zone ?? defaultTimeZone, now);
      if (config.trigger.type === "schedule" && nextRunAt === null) {
        throw new DomainError("invalid", "automation.schedule_in_past");
      }
    }
    const [updated] = await tx
      .update(automationRules)
      .set({
        ...configValues(config, zone),
        nextRunAt,
        enabledAt: row.enabled ? now : row.enabledAt,
        updatedAt: now,
      })
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)))
      .returning();
    return getRule(tx, userId, updated!.id);
  });
}

/** Enabling is always explicit; it validates the stored configuration and the references again. */
export function setRuleEnabled(db: DbExecutor, userId: string, id: string, enabled: boolean) {
  return db.transaction(async (tx) => {
    const row = await getOwnedRule(tx, userId, id, true);
    if (!enabled) {
      await tx
        .update(automationRules)
        .set({ enabled: false, nextRunAt: null })
        .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)));
      return getRule(tx, userId, id);
    }
    if (row.enabled) return getRule(tx, userId, id);
    if (row.archivedAt) throw new DomainError("invalid", "automation.rule_archived");
    const parsed = parseStoredRule(row);
    if (!parsed.ok) throw new DomainError("invalid", "automation.invalid_config");
    await assertReferencesOwned(tx, userId, parsed.config);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(automationRules)
      .where(and(eq(automationRules.userId, userId), eq(automationRules.enabled, true)));
    if (n >= LIMITS.enabledRules) throw new DomainError("conflict", "automation.too_many_rules");
    const now = new Date();
    const nextRunAt = nextRun(parsed.config, row.timeZone ?? defaultTimeZone, now);
    if (parsed.config.trigger.type === "schedule" && nextRunAt === null) {
      throw new DomainError("invalid", "automation.schedule_in_past");
    }
    await tx
      .update(automationRules)
      .set({ enabled: true, enabledAt: now, nextRunAt })
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)));
    return getRule(tx, userId, id);
  });
}

export function setRuleArchived(db: DbExecutor, userId: string, id: string, archived: boolean) {
  return db.transaction(async (tx) => {
    await getOwnedRule(tx, userId, id, true);
    await tx
      .update(automationRules)
      .set(
        archived
          ? { archivedAt: new Date(), enabled: false, nextRunAt: null }
          : { archivedAt: null },
      )
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)));
    return getRule(tx, userId, id);
  });
}

/** Only a rule that never ran can be deleted; otherwise archive it (history is kept). */
export function deleteRule(db: DbExecutor, userId: string, id: string) {
  return db.transaction(async (tx) => {
    await getOwnedRule(tx, userId, id, true);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(automationExecutions)
      .where(eq(automationExecutions.ruleId, id));
    if (n > 0) throw new DomainError("conflict", "automation.rule_has_history");
    await tx
      .delete(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.userId, userId)));
  });
}
