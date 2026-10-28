import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { EXPORT_FORMAT, EXPORT_VERSION, exportExclusions } from "@/modules/data-export/domain";
import { exportUserData } from "@/modules/data-export/server";
import { tasks } from "@/modules/tasks/db";
import { todayIn } from "@/modules/tasks/domain";
import { accounts, sessions, verifications } from "@/shared/auth/schema";
import { newId } from "@/shared/lib/id";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser, createUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * The personal data export (ADR 0025) over data made through the real routers: every table is
 * exported or deliberately excluded, every row of the user is there and no row of anyone else,
 * credentials never appear, and money, rates, nulls and history are written as stored.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);

/** Database table → export key. Together with the exclusions this must cover the schema. */
const exported: Record<string, string> = {
  user_settings: "settings.settings",
  areas: "areas.areas",
  task_statuses: "tasks.statuses",
  tags: "tasks.tags",
  task_recurrences: "tasks.recurrences",
  tasks: "tasks.tasks",
  task_tags: "tasks.taskTags",
  task_dependencies: "tasks.dependencies",
  task_development_contributions: "tasks.developmentContributions",
  task_views: "tasks.views",
  projects: "projects.projects",
  milestones: "projects.milestones",
  development_attributes: "character.attributes",
  xp_ledger: "character.xpLedger",
  xp_attribute_credits: "character.xpAttributeCredits",
  discipline_ledger: "character.disciplineLedger",
  development_profiles: "development.profile",
  development_focus: "development.focus",
  development_goals: "development.goals",
  development_goal_attributes: "development.goalAttributes",
  development_goal_tasks: "development.goalTasks",
  development_goal_projects: "development.goalProjects",
  development_goal_allocations: "development.goalAllocations",
  development_plans: "development.plans",
  development_plan_tasks: "development.planTasks",
  rewards: "rewards.rewards",
  level_rewards: "rewards.levelRewards",
  reward_ledger: "rewards.ledger",
  finance_settings: "finance.settings",
  finance_providers: "finance.providers",
  finance_accounts: "finance.accounts",
  finance_snapshots: "finance.snapshots",
  finance_fx_defaults: "finance.fxDefaults",
  automation_rules: "automation.rules",
  automation_executions: "automation.executions",
  automation_effects: "automation.effects",
  automation_notifications: "automation.notifications",
};
const excludedTables: Record<keyof typeof exportExclusions, string> = {
  accounts: "accounts",
  sessions: "sessions",
  verifications: "verifications",
  automationEvents: "automation_events",
  automationWorkerStatus: "automation_worker_status",
};
/** Link tables without user_id, owned through a parent row. */
const ownedThrough: Record<string, string> = {
  task_tags: "join tasks t on t.id = x.task_id where t.user_id = $1",
  task_development_contributions: "join tasks t on t.id = x.task_id where t.user_id = $1",
  development_goal_attributes: "join development_goals g on g.id = x.goal_id where g.user_id = $1",
  development_goal_tasks: "join development_goals g on g.id = x.goal_id where g.user_id = $1",
  development_goal_projects: "join development_goals g on g.id = x.goal_id where g.user_id = $1",
  development_goal_allocations: "join development_goals g on g.id = x.goal_id where g.user_id = $1",
  development_plan_tasks: "join development_plans p on p.id = x.plan_id where p.user_id = $1",
};

async function rowsOf(table: string, userId: string): Promise<number> {
  const where = ownedThrough[table] ?? "where x.user_id = $1";
  const query = `select count(*)::int as n from ${table} x ${where.replace("$1", `'${userId}'`)}`;
  const result = await db.execute(sql.raw(query));
  return (result.rows[0] as { n: number }).n;
}

async function setup(name: string) {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone: "Asia/Shanghai" });
  return { user, api, name };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** A little of everything, made the way the app makes it. */
async function seed({ api, name }: Ctx) {
  const today = todayIn("Asia/Shanghai");
  const [french] = (await api.character.attributes.list()).filter((a) => a.systemKey);
  const tag = await api.tasks.tags.create({ name: `${name}-标签` });
  const project = await api.projects.create({ name: `${name}-项目` });
  const milestone = await api.projects.milestones.create({
    projectId: project.id,
    name: `${name}-里程碑`,
    dueDate: today,
  });
  const task = await api.tasks.create({
    title: `${name}-任务`,
    projectId: project.id,
    milestoneId: milestone.id,
    dueDate: today,
    dueTime: "18:30",
    priority: 3,
    tagIds: [tag.id],
    contributions: [{ attributeId: french!.id, weight: 2 }],
  });
  const blocker = await api.tasks.create({ title: `${name}-前置` });
  await api.tasks.dependencies.add({ blockingTaskId: blocker.id, blockedTaskId: task.id });
  await api.tasks.create({ title: `${name}-子任务`, parentTaskId: task.id });
  const repeat = await api.tasks.create({ title: `${name}-重复`, dueDate: today });
  await api.tasks.recurrence.set({
    taskId: repeat.id,
    rule: { frequency: "daily", interval: 1 },
    mode: "fixed",
  });
  await api.tasks.recurrence.skip({ taskId: repeat.id });

  const goal = await api.development.goals.create({
    title: `${name}-目标`,
    attributes: [{ attributeId: french!.id, weight: 3 }],
  });
  await api.development.goals.linkTask({ goalId: goal.id, taskId: task.id });
  await api.development.setFocus({ attributeIds: [french!.id] });
  await api.development.updateVision({ vision: `${name}-愿景` });
  await api.development.goals.linkProject({ goalId: goal.id, projectId: project.id });
  const plan = await api.development.plans.create({ goalId: goal.id, title: `${name}-计划` });
  await api.development.plans.linkTask({ planId: plan.id, taskId: task.id });

  const rule = await api.automation.rules.create({
    name: `${name}-规则`,
    trigger: { type: "task.completed" },
    actions: [{ type: "notify", title: "完成了 {task}" }],
  });
  await api.automation.rules.setEnabled({ id: rule.id, enabled: true });

  // Planned two hours ago, so completing it is scored for 自制力 (ADR 0021: planned ≥ 1 h ahead).
  await db
    .update(tasks)
    .set({ plannedAt: new Date(Date.now() - 2 * 3_600_000) })
    .where(eq(tasks.id, task.id));
  await api.tasks.complete({ id: blocker.id });
  await api.tasks.complete({ id: task.id }); // XP, attribute credits, automation
  const { drainEvents } = await import("@/modules/automation/server");
  await drainEvents({ db, bus }, {});

  await api.development.attribution.set({
    taskId: task.id,
    allocations: [{ goalId: goal.id, attributeId: french!.id, share: 100 }],
  });

  const reward = await api.rewards.create({ name: `${name}-奶茶`, value: 1 });
  await api.rewards.redeem({
    rewardId: reward.id,
    payment: { strategy: "active_first" },
    idempotencyKey: randomUUID(),
  });

  await api.finance.setBaseCurrency({ baseCurrency: "EUR" });
  const bank = await api.finance.providers.create({ name: `${name}-银行`, providerType: "bank" });
  const eur = await api.finance.accounts.create({
    providerId: bank.id,
    name: "活期 EUR",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "EUR",
  });
  const cny = await api.finance.accounts.create({
    providerId: bank.id,
    name: "活期 CNY",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "CNY",
  });
  // An older valuation with a rate, a later one without (missing FX), then a correction.
  await api.finance.snapshots.saveBatch({
    valuationDate: "2026-09-30",
    entries: [
      { accountId: eur.id, amount: "1500.00" },
      { accountId: cny.id, amount: "10000.00" },
    ],
    rates: { CNY: "0.1282" },
  });
  await api.finance.snapshots.saveBatch({
    valuationDate: "2026-10-15",
    entries: [{ accountId: cny.id, amount: "0.00" }],
  });
  await api.finance.snapshots.saveBatch({
    valuationDate: "2026-09-30",
    entries: [{ accountId: eur.id, amount: "1499.99" }],
    rates: { CNY: "0.1282" },
    overwrite: true,
  });
  return { task, project, goal, rule, cny, eur };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("data export", () => {
  it("covers every table: exported or deliberately excluded", () => {
    // This branch's schema as its migrations define it (the latest drizzle snapshot), so a new
    // table fails here until it is exported or excluded on purpose.
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: { idx: number }[];
    };
    const last = String(journal.entries.at(-1)!.idx).padStart(4, "0");
    const snapshot = JSON.parse(readFileSync(`drizzle/meta/${last}_snapshot.json`, "utf8")) as {
      tables: Record<string, { name: string; schema: string }>;
    };
    const tables = Object.values(snapshot.tables)
      .map((t) => t.name)
      .sort();
    const known = [...Object.keys(exported), ...Object.values(excludedTables), "users"].sort();
    expect(tables).toEqual(known);
  });

  it("exports every row of the user, parses as JSON and keeps ids, history and nulls", async () => {
    const a = await setup("甲");
    const ids = await seed(a);
    const now = new Date("2026-10-28T20:00:00Z");
    const document = await exportUserData(db, a.user.id, now);
    const parsed = JSON.parse(JSON.stringify(document));

    expect(parsed).toMatchObject({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      generatedAt: "2026-10-28T20:00:00.000Z",
      timeZone: "Asia/Shanghai",
      user: { id: a.user.id, email: a.user.email },
    });
    expect(Object.keys(parsed.excluded)).toEqual(Object.keys(exportExclusions));

    // Counts match the database table by table, and the arrays match the counts.
    for (const [table, key] of Object.entries(exported)) {
      const [section, name] = key.split(".") as [string, string];
      const value = parsed.data[section][name];
      const length = Array.isArray(value) ? value.length : value ? 1 : 0;
      expect(length, key).toBe(await rowsOf(table, a.user.id));
      expect(parsed.counts[key], key).toBe(length);
    }
    // The seed reaches every section (nothing is silently empty).
    for (const key of Object.values(exported)) {
      if (key === "tasks.views") continue; // only written when a view is customised
      expect(parsed.counts[key], key).toBeGreaterThan(0);
    }

    const task = parsed.data.tasks.tasks.find((t: { id: string }) => t.id === ids.task.id);
    expect(task).toMatchObject({
      projectId: ids.project.id,
      dueTime: "18:30:00",
      statusId: expect.any(String),
      completedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
      deletedAt: null,
      startDate: null,
    });
    expect(parsed.data.development.goalTasks).toEqual([
      expect.objectContaining({ goalId: ids.goal.id, taskId: ids.task.id }),
    ]);
    // Skipped recurrence instance kept as history, next one open.
    const series = parsed.data.tasks.tasks.filter((t: { recurrenceId: string | null }) =>
      Boolean(t.recurrenceId),
    );
    expect(series.map((t: { recurrenceIndex: number }) => t.recurrenceIndex)).toEqual([1, 2]);
    expect(series[0].cancelledAt).not.toBeNull();

    // Money and rates are the stored decimal strings (no rounding); a missing rate stays null
    // (never 1 or 0), and a balance of zero stays "0.000000".
    const snapshots = parsed.data.finance.snapshots as Record<string, unknown>[];
    expect(snapshots.find((s) => s.accountId === ids.eur.id)).toMatchObject({
      valuationDate: "2026-09-30",
      amount: "1499.990000",
      revision: 2,
      currencyCode: "EUR",
    });
    expect(
      snapshots.filter((s) => s.accountId === ids.cny.id).map((s) => [s.valuationDate, s.amount]),
    ).toEqual([
      ["2026-09-30", "10000.000000"],
      ["2026-10-15", "0.000000"],
    ]);
    const withRate = snapshots.find((s) => s.accountId === ids.cny.id)!;
    expect(withRate).toMatchObject({
      fxRate: "0.1282000000",
      fxSource: "manual",
    });
    const missing = snapshots.find(
      (s) => s.accountId === ids.cny.id && s.valuationDate === "2026-10-15",
    )!;
    expect(missing.fxRate).toBeNull();
    expect(missing.baseAmount).toBeNull();
    expect(parsed.data.finance.settings).toMatchObject({ baseCurrency: "EUR" });

    // XP history and the reward purchase are there with their links.
    expect(
      parsed.data.character.xpLedger.some((e: { sourceId: string }) => e.sourceId === ids.task.id),
    ).toBe(true);
    expect(parsed.data.rewards.ledger[0]).toMatchObject({ kind: expect.any(String) });
    expect(parsed.data.automation.executions[0]).toMatchObject({ ruleId: ids.rule.id });
  });

  it("contains nothing of another user and no credentials", async () => {
    const a = await setup("甲");
    const b = await setup("乙");
    await seed(a);
    const bIds = await seed(b);
    const secrets = {
      password: `$argon2id$v=19$m=65536$${randomUUID()}`,
      sessionToken: `tok_${randomUUID()}`,
      accessToken: `acc_${randomUUID()}`,
      verification: `ver_${randomUUID()}`,
    };
    await db.insert(accounts).values({
      id: newId(),
      userId: a.user.id,
      accountId: a.user.id,
      providerId: "credential",
      password: secrets.password,
      accessToken: secrets.accessToken,
    });
    await db.insert(sessions).values({
      id: newId(),
      userId: a.user.id,
      token: secrets.sessionToken,
      expiresAt: new Date(Date.now() + 86_400_000),
      ipAddress: "203.0.113.7",
      userAgent: "test-agent",
    });
    await db.insert(verifications).values({
      id: newId(),
      identifier: a.user.email,
      value: secrets.verification,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const text = JSON.stringify(await exportUserData(db, a.user.id));
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toMatch(/"(password|token|accessToken|refreshToken|idToken)"/);

    // Nothing of B: not its id, e-mail, names or any of its record ids.
    expect(text).not.toContain(b.user.id);
    expect(text).not.toContain(b.user.email);
    expect(text).not.toContain("乙-");
    for (const record of Object.values(bIds)) expect(text).not.toContain(record.id);
    // ...while A's own export of B's data is B's alone.
    const bText = JSON.stringify(await exportUserData(db, b.user.id));
    expect(bText).not.toContain(a.user.id);
    expect(bText).not.toContain("甲-");
  });

  it("exports an empty account as empty sections, not zeros or fabricated rows", async () => {
    const user = await createUser(db); // not even the registration seed
    const document = JSON.parse(JSON.stringify(await exportUserData(db, user.id)));
    expect(document.timeZone).toBeNull();
    expect(document.data.settings.settings).toBeNull();
    expect(document.data.finance.settings).toBeNull();
    expect(document.data.development.profile).toBeNull();
    expect(document.data.tasks.tasks).toEqual([]);
    expect(document.data.finance.snapshots).toEqual([]);
    expect(Object.values(document.counts).every((n) => n === 0)).toBe(true);
  });

  it("refuses an unknown user", async () => {
    await expect(exportUserData(db, randomUUID())).rejects.toMatchObject({
      code: "export.user_not_found",
    });
  });
});
