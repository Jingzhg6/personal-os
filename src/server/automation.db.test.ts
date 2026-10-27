import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  automationEffects,
  automationEvents,
  automationExecutions,
  automationNotifications,
  automationRules,
  automationWorkerStatus,
} from "@/modules/automation/db";
import type { RuleConfigInput } from "@/modules/automation/domain";
import { busWithOrigin, drainEvents, tickSchedules, workerTick } from "@/modules/automation/server";
import { listAreas } from "@/modules/areas/server";
import { listAttributes } from "@/modules/character/server";
import { xpLedger } from "@/modules/character/db";
import { financeSnapshots } from "@/modules/finance/db";
import { projects } from "@/modules/projects/db";
import { tasks } from "@/modules/tasks/db";
import { completeTask, setTaskStatus } from "@/modules/tasks/server";
import { setGoalStatus } from "@/modules/development/server";
import { saveBatch } from "@/modules/finance/server";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * M10 automation, end to end through the real routers and the real event bus (XP, rewards and
 * capture handlers all registered). Events are drained explicitly unless `autoDrain` mirrors the
 * production after-mutation hook.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();

async function setup({ autoDrain = false } = {}) {
  const user = await createSeededUser(db);
  const ctx = {
    db,
    bus,
    userId: user.id,
    resHeaders: null,
    afterMutation: autoDrain
      ? async (userId: string) => {
          await drainEvents({ db, bus }, { userId });
        }
      : undefined,
  };
  const api = createCallerFactory(appRouter)(ctx);
  const drain = () => drainEvents({ db, bus }, { userId: user.id });
  return { user, api, drain };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ cause: { code } });

async function rule(api: Ctx["api"], config: RuleConfigInput, enable = true) {
  const created = await api.automation.rules.create(config);
  expect(created.enabled).toBe(false);
  return enable ? api.automation.rules.setEnabled({ id: created.id, enabled: true }) : created;
}

const followUp: RuleConfigInput = {
  name: "完成后跟进",
  trigger: { type: "task.completed" },
  actions: [{ type: "create_follow_up_task", title: "跟进：{task}", priority: 2 }],
};

const titled = async (userId: string, title: string) =>
  db
    .select({
      id: tasks.id,
      priority: tasks.priority,
      projectId: tasks.projectId,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.title, title)));

const executionsOf = (ruleId: string) =>
  db.select().from(automationExecutions).where(eq(automationExecutions.ruleId, ruleId));

const ledgerCount = async (userId: string) =>
  (await db.select({ n: count() }).from(xpLedger).where(eq(xpLedger.userId, userId)))[0]!.n;

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("rules", () => {
  it("are created disabled, validated, enabled and disabled explicitly", async () => {
    const { api } = await setup();
    const created = await rule(api, followUp, false);
    expect(created.config?.trigger.type).toBe("task.completed");
    const enabled = await api.automation.rules.setEnabled({ id: created.id, enabled: true });
    expect(enabled.enabled).toBe(true);
    const disabled = await api.automation.rules.setEnabled({ id: created.id, enabled: false });
    expect(disabled.enabled).toBe(false);
    expect(await api.automation.rules.list()).toHaveLength(1);
  });

  it("reject configuration that is not typed and allowlisted", async () => {
    const { api } = await setup();
    await expect(
      api.automation.rules.create({
        ...followUp,
        actions: [{ type: "run_sql", sql: "delete from tasks" } as never],
      }),
    ).rejects.toThrow();
    await expect(
      api.automation.rules.create({ ...followUp, trigger: { type: "task.deleted" } as never }),
    ).rejects.toThrow();
  });

  it("only reference the user's own areas, projects and statuses", async () => {
    const owner = await setup();
    const other = await setup();
    const [area] = await listAreas(db, other.user.id);
    await rejects(
      owner.api.automation.rules.create({
        ...followUp,
        conditions: [{ type: "task_area", areaId: area!.id }],
      }),
      "automation.reference_not_found",
    );
    const project = await other.api.projects.create({ name: "别人的项目" });
    await rejects(
      owner.api.automation.rules.create({
        name: "x",
        trigger: { type: "task.completed" },
        actions: [{ type: "create_task", title: "x", projectId: project.id }],
      }),
      "automation.reference_not_found",
    );
  });

  it("are invisible to and unchangeable by other users", async () => {
    const owner = await setup();
    const other = await setup();
    const created = await rule(owner.api, followUp);
    await rejects(other.api.automation.rules.byId({ id: created.id }), "automation.rule_not_found");
    await rejects(
      other.api.automation.rules.setEnabled({ id: created.id, enabled: false }),
      "automation.rule_not_found",
    );
    await rejects(
      other.api.automation.rules.update({ id: created.id, config: followUp as never }),
      "automation.rule_not_found",
    );
    await rejects(
      other.api.automation.rules.delete({ id: created.id }),
      "automation.rule_not_found",
    );
    expect(await other.api.automation.rules.list()).toEqual([]);
    expect(await other.api.automation.executions.list({ id: created.id })).toEqual([]);
  });

  it("archive (disabling) and are only deleted without history", async () => {
    const { api, drain } = await setup();
    const created = await rule(api, followUp);
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await drain();
    await rejects(api.automation.rules.delete({ id: created.id }), "automation.rule_has_history");
    const archived = await api.automation.rules.setArchived({ id: created.id, archived: true });
    expect(archived).toMatchObject({ enabled: false });
    await rejects(
      api.automation.rules.setEnabled({ id: created.id, enabled: true }),
      "automation.rule_archived",
    );
    const fresh = await rule(api, { ...followUp, name: "新规则" }, false);
    await api.automation.rules.delete({ id: fresh.id });
    expect(await api.automation.rules.list()).toHaveLength(1);
  });
});

describe("event triggers", () => {
  it("run the action through the task service after the change commits", async () => {
    const { api, user } = await setup({ autoDrain: true });
    const created = await rule(api, followUp);
    const project = await api.projects.create({ name: "季度规划" });
    const task = await api.tasks.create({ title: "写周报", projectId: project.id });
    const before = await ledgerCount(user.id);
    await api.tasks.complete({ id: task.id });

    const [follow] = await titled(user.id, "跟进：写周报");
    expect(follow).toMatchObject({ priority: 2, projectId: project.id, completedAt: null });
    // The follow-up is an ordinary, open task: listed with the others.
    const listed = await api.tasks.list({
      today: "2026-10-27",
      sort: "manual",
      includeSubtasks: false,
      filter: {},
    });
    expect(listed.map((t) => t.title)).toContain("跟进：写周报");

    const [execution] = await executionsOf(created.id);
    expect(execution).toMatchObject({ status: "succeeded", depth: 0, duplicates: 0 });
    expect(execution!.actionResults).toEqual([
      { index: 0, type: "create_follow_up_task", outcome: "succeeded", entityId: follow!.id },
    ]);
    // XP only from the completion itself, through the normal rules; nothing for the follow-up.
    const ledger = await db.select().from(xpLedger).where(eq(xpLedger.userId, user.id));
    expect(ledger.length).toBeGreaterThan(before);
    expect(ledger.every((entry) => entry.sourceId === task.id)).toBe(true);
    expect((await api.automation.rules.byId({ id: created.id })).lastExecution?.status).toBe(
      "succeeded",
    );
  });

  it("never run a disabled rule, and write nothing to the outbox without an enabled rule", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, followUp, false);
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await drain();
    expect(await titled(user.id, "跟进：写周报")).toEqual([]);
    expect(await executionsOf(created.id)).toEqual([]);
    expect(await db.select().from(automationEvents)).toEqual([]);

    // Disabled after the event was captured: still never runs.
    await api.automation.rules.setEnabled({ id: created.id, enabled: true });
    const second = await api.tasks.create({ title: "第二个任务" });
    await api.tasks.complete({ id: second.id });
    await api.automation.rules.setEnabled({ id: created.id, enabled: false });
    await drain();
    expect(await titled(user.id, "跟进：第二个任务")).toEqual([]);
  });

  it("skip the actions when the conditions do not match, and record why", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, {
      ...followUp,
      conditions: [{ type: "task_priority", priority: 4 }],
    });
    const low = await api.tasks.create({ title: "低优先级", priority: 1 });
    const high = await api.tasks.create({ title: "高优先级", priority: 4 });
    await api.tasks.complete({ id: low.id });
    await api.tasks.complete({ id: high.id });
    await drain();
    expect(await titled(user.id, "跟进：低优先级")).toEqual([]);
    expect(await titled(user.id, "跟进：高优先级")).toHaveLength(1);
    const executions = await executionsOf(created.id);
    expect(executions.map((e) => [e.status, e.skipReason]).sort()).toEqual([
      ["skipped", "conditions_not_met"],
      ["succeeded", null],
    ]);
  });

  it("do not re-run a rule when the same task is completed again", async () => {
    const { api, user } = await setup({ autoDrain: true });
    const created = await rule(api, followUp);
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });
    await api.tasks.complete({ id: task.id });
    expect(await titled(user.id, "跟进：写周报")).toHaveLength(1);
    const [execution] = await executionsOf(created.id);
    expect(execution).toMatchObject({ status: "succeeded", duplicates: 1 });
  });

  it("process a redelivered event and concurrent drains only once", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, followUp);
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    // Two drains racing for the same event.
    await Promise.all([drain(), drain(), drain()]);
    expect(await titled(user.id, "跟进：写周报")).toHaveLength(1);
    // The same event delivered again (e.g. a crash after the work, before the outbox update).
    await db.update(automationEvents).set({ status: "pending" });
    await drain();
    expect(await titled(user.id, "跟进：写周报")).toHaveLength(1);
    const executions = await executionsOf(created.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.duplicates).toBe(1);
  });

  it("do not apply edits to events from before the edit", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, followUp);
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await api.automation.rules.update({
      id: created.id,
      config: { ...followUp, actions: [{ type: "notify", title: "完成了 {task}" }] } as never,
    });
    await drain();
    expect(await titled(user.id, "跟进：写周报")).toEqual([]);
    expect(await db.select().from(automationNotifications)).toEqual([]);
  });

  it("change a task's priority only through the task service", async () => {
    const { api, user, drain } = await setup();
    await rule(api, {
      name: "开始后提高优先级",
      trigger: { type: "task.status_changed" },
      conditions: [],
      actions: [{ type: "set_task_priority", priority: 4 }],
    });
    const statuses = await api.tasks.statuses.list();
    const started = statuses.find((s) => s.category === "started")!;
    const task = await api.tasks.create({ title: "开始的任务", priority: 1 });
    await api.tasks.setStatus({ id: task.id, statusId: started.id });
    await drain();
    expect((await titled(user.id, "开始的任务"))[0]!.priority).toBe(4);
  });

  it("react to development goal status changes", async () => {
    const { api, user, drain } = await setup();
    await rule(api, {
      name: "目标完成",
      trigger: { type: "goal.status_changed" },
      conditions: [{ type: "goal_status", status: "completed" }],
      actions: [{ type: "create_task", title: "复盘目标：{goal}" }],
    });
    const [attribute] = await listAttributes(db, user.id);
    const goal = await api.development.goals.create({
      title: "法语达到 B1",
      attributes: [{ attributeId: attribute!.id, weight: 2 }],
    });
    await api.development.goals.setStatus({ id: goal.id, status: "paused" });
    await api.development.goals.setStatus({ id: goal.id, status: "completed" });
    await drain();
    expect(await titled(user.id, "复盘目标：法语达到 B1")).toHaveLength(1);
  });

  it("react to a saved finance batch without touching or copying balances", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, {
      name: "记账完成",
      trigger: { type: "finance.snapshot_saved" },
      conditions: [{ type: "finance_all_valued" }],
      actions: [{ type: "notify", title: "{date} 的余额已记录" }],
    });
    const provider = await api.finance.providers.create({ name: "BNP", providerType: "bank" });
    const account = await api.finance.accounts.create({
      providerId: provider.id,
      name: "活期",
      kind: "asset",
      accountType: "current",
      assetCategory: "bank_deposit",
      currency: "CNY",
    });
    // Without a rate: not all valued → condition fails.
    await api.finance.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: account.id, amount: "12345.67" }],
    });
    await api.finance.snapshots.saveBatch({
      valuationDate: "2026-10-02",
      entries: [{ accountId: account.id, amount: "12345.67" }],
      rates: { CNY: "0.13" },
    });
    await drain();
    const notifications = await api.automation.notifications.list();
    expect(notifications.items.map((n) => n.title)).toEqual(["2026-10-02 的余额已记录"]);
    const executions = await executionsOf(created.id);
    expect(executions.map((e) => e.skipReason).sort()).toEqual(["conditions_not_met", null]);
    // Facts hold counts only; snapshots are as saved.
    expect(JSON.stringify(executions.map((e) => e.facts))).not.toContain("12345");
    const snapshots = await db
      .select()
      .from(financeSnapshots)
      .where(eq(financeSnapshots.userId, user.id));
    expect(snapshots.map((s) => [s.amount, s.revision])).toEqual([
      ["12345.670000", 1],
      ["12345.670000", 1],
    ]);
  });
});

describe("failures and retries", () => {
  it("show a permanent failure, keep finished actions, and retry only the rest", async () => {
    const { api, user, drain } = await setup();
    const project = await api.projects.create({ name: "将被删除的项目" });
    const created = await rule(api, {
      name: "两个动作",
      trigger: { type: "task.completed" },
      actions: [
        { type: "notify", title: "完成：{task}" },
        { type: "create_task", title: "归档 {task}", projectId: project.id },
        { type: "notify", title: "不会执行" },
      ],
    });
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    await api.projects.delete({ id: project.id });
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await drain();

    const [execution] = await executionsOf(created.id);
    expect(execution).toMatchObject({
      status: "partial",
      errorCode: "project.not_found",
      retryable: false,
    });
    expect((execution!.actionResults as { outcome: string }[]).map((r) => r.outcome)).toEqual([
      "succeeded",
      "failed",
      "not_run",
    ]);
    await rejects(
      api.automation.executions.retry({ id: execution!.id }),
      "automation.not_retryable",
    );

    // The cause is fixed (the project is back) and the failure is retryable: only the missing
    // actions run, the notification is not sent twice.
    await db.insert(projects).values(row!);
    await db
      .update(automationExecutions)
      .set({ retryable: true })
      .where(eq(automationExecutions.id, execution!.id));
    await api.automation.executions.retry({ id: execution!.id });
    const [retried] = await executionsOf(created.id);
    expect(retried).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(await titled(user.id, "归档 写周报")).toHaveLength(1);
    const notifications = await api.automation.notifications.list();
    expect(notifications.items.map((n) => n.title).sort()).toEqual(["不会执行", "完成：写周报"]);
    expect(
      (
        await db
          .select()
          .from(automationEffects)
          .where(eq(automationEffects.executionId, execution!.id))
      ).length,
    ).toBe(3);
    // Nothing left to retry.
    await rejects(
      api.automation.executions.retry({ id: execution!.id }),
      "automation.not_retryable",
    );
  });

  it("refuse retries of other users' executions, of disabled rules and beyond the limit", async () => {
    const owner = await setup();
    const other = await setup();
    const project = await owner.api.projects.create({ name: "P" });
    const created = await rule(owner.api, {
      name: "失败",
      trigger: { type: "task.completed" },
      actions: [{ type: "create_task", title: "x", projectId: project.id }],
    });
    await owner.api.projects.delete({ id: project.id });
    const task = await owner.api.tasks.create({ title: "t" });
    await owner.api.tasks.complete({ id: task.id });
    await owner.drain();
    const [execution] = await executionsOf(created.id);
    await db
      .update(automationExecutions)
      .set({ retryable: true })
      .where(eq(automationExecutions.id, execution!.id));
    await rejects(
      other.api.automation.executions.retry({ id: execution!.id }),
      "automation.execution_not_found",
    );
    for (let i = 0; i < 3; i += 1) {
      await owner.api.automation.executions.retry({ id: execution!.id });
      await db
        .update(automationExecutions)
        .set({ retryable: true })
        .where(eq(automationExecutions.id, execution!.id));
    }
    await rejects(
      owner.api.automation.executions.retry({ id: execution!.id }),
      "automation.retry_limit",
    );
    await owner.api.automation.rules.setEnabled({ id: created.id, enabled: false });
    await db
      .update(automationExecutions)
      .set({ attempts: 1 })
      .where(eq(automationExecutions.id, execution!.id));
    await rejects(
      owner.api.automation.executions.retry({ id: execution!.id }),
      "automation.rule_disabled",
    );
  });

  it("record invalid stored configuration as skipped and refuse to enable it", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, followUp);
    await db
      .update(automationRules)
      .set({ actions: [{ type: "shell", command: "rm -rf /" }] })
      .where(eq(automationRules.id, created.id));
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    await drain();
    const [execution] = await executionsOf(created.id);
    expect(execution).toMatchObject({ status: "skipped", skipReason: "invalid_config" });
    expect(await titled(user.id, "跟进：写周报")).toEqual([]);
    expect((await api.automation.rules.byId({ id: created.id })).config).toBeNull();
    await api.automation.rules.setEnabled({ id: created.id, enabled: false });
    await rejects(
      api.automation.rules.setEnabled({ id: created.id, enabled: true }),
      "automation.invalid_config",
    );
  });
});

describe("loop prevention and limits", () => {
  it("never lets a rule react to its own chain, and stops deep chains", async () => {
    const { api, user, drain } = await setup();
    const a = await rule(api, { ...followUp, name: "A" });
    const b = await rule(api, {
      ...followUp,
      name: "B",
      actions: [{ type: "notify", title: "B: {task}" }],
    });
    // A completion made by rule A's actions (as the engine's chained bus would publish it).
    const task = await api.tasks.create({ title: "链式任务" });
    await db.transaction((tx) =>
      completeTask(
        { db: tx, bus: busWithOrigin(bus, { depth: 1, ruleIds: [a.id] }) },
        user.id,
        task.id,
      ),
    );
    await drain();
    const [ofA] = await executionsOf(a.id);
    const [ofB] = await executionsOf(b.id);
    expect(ofA).toMatchObject({ status: "skipped", skipReason: "loop" });
    expect(ofB).toMatchObject({ status: "succeeded", depth: 1 });
    expect(await titled(user.id, "跟进：链式任务")).toEqual([]);

    const deep = await api.tasks.create({ title: "很深的链" });
    await db.transaction((tx) =>
      completeTask(
        { db: tx, bus: busWithOrigin(bus, { depth: 3, ruleIds: [] }) },
        user.id,
        deep.id,
      ),
    );
    await drain();
    const skipped = (await db.select().from(automationExecutions)).filter(
      (e) => e.skipReason === "depth",
    );
    expect(skipped).toHaveLength(2);
  });

  it("rate-limits a rule per hour", async () => {
    const { api, drain } = await setup();
    const created = await rule(api, {
      name: "很多通知",
      trigger: { type: "task.status_changed" },
      actions: [{ type: "notify", title: "状态变化" }],
    });
    const statuses = await api.tasks.statuses.list();
    const [a, b] = statuses.filter((s) => s.category !== "completed" && s.category !== "cancelled");
    const task = await api.tasks.create({ title: "来回切换" });
    for (let i = 0; i < 31; i += 1) {
      await api.tasks.setStatus({ id: task.id, statusId: a!.id });
      await api.tasks.setStatus({ id: task.id, statusId: b!.id });
    }
    while ((await drain()).processed > 0);
    const executions = await executionsOf(created.id);
    expect(executions.filter((e) => e.status === "succeeded")).toHaveLength(60);
    expect(executions.filter((e) => e.skipReason === "rate_limited").length).toBeGreaterThan(0);
  });

  it("limit actions per rule", async () => {
    const { api } = await setup();
    await expect(
      api.automation.rules.create({
        ...followUp,
        actions: Array(6).fill({ type: "notify", title: "x" }),
      }),
    ).rejects.toThrow();
  });
});

describe("schedules", () => {
  const nine = { kind: "daily", time: "09:00" } as const;

  async function scheduled(api: Ctx["api"], schedule: object, timeZone = "Europe/Paris") {
    return rule(api, {
      name: "每天提醒",
      trigger: { type: "schedule", schedule } as never,
      timeZone,
      actions: [{ type: "notify", title: "{date} 记录余额" }],
    });
  }

  it("run each occurrence once, in the rule's time zone, even with concurrent ticks", async () => {
    const { api, user } = await setup();
    const created = await scheduled(api, nine);
    expect(created.nextRunAt).not.toBeNull();
    const due = new Date("2026-10-28T08:00:00Z"); // 09:00 in Paris (CET)
    await db
      .update(automationRules)
      .set({ nextRunAt: due })
      .where(eq(automationRules.id, created.id));

    expect(await tickSchedules({ db, bus }, { now: new Date(due.getTime() - 60_000) })).toEqual({
      executed: 0,
      missed: 0,
      failed: 0,
    });
    const now = new Date(due.getTime() + 30_000);
    await Promise.all([
      tickSchedules({ db, bus }, { now }),
      tickSchedules({ db, bus }, { now }),
      tickSchedules({ db, bus }, { userId: user.id, now }),
    ]);
    const executions = await executionsOf(created.id);
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      status: "succeeded",
      triggerKey: `schedule:${due.toISOString()}`,
    });
    expect((await api.automation.notifications.list()).items.map((n) => n.title)).toEqual([
      "2026-10-28 记录余额",
    ]);
    const [after] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, created.id));
    expect(after!.nextRunAt?.toISOString()).toBe("2026-10-29T08:00:00.000Z");
  });

  it("coalesce missed occurrences after downtime, or record them as missed beyond the grace", async () => {
    const { api } = await setup();
    const recent = await scheduled(api, nine);
    const old = await scheduled(api, { kind: "weekly", weekdays: [1], time: "09:00" });
    await db
      .update(automationRules)
      .set({ nextRunAt: new Date("2026-10-23T07:00:00Z") })
      .where(eq(automationRules.id, recent.id));
    await db
      .update(automationRules)
      .set({ nextRunAt: new Date("2026-10-19T07:00:00Z") })
      .where(eq(automationRules.id, old.id));
    // Back on 2026-10-28 at 10:00 Paris: daily ran at 09:00 an hour ago; Monday's weekly is days old.
    await tickSchedules({ db, bus }, { now: new Date("2026-10-28T09:00:00Z") });
    const [daily] = await executionsOf(recent.id);
    expect(daily).toMatchObject({
      status: "succeeded",
      missedOccurrences: 5,
      triggerKey: "schedule:2026-10-28T08:00:00.000Z",
    });
    const [weekly] = await executionsOf(old.id);
    expect(weekly).toMatchObject({
      status: "skipped",
      skipReason: "misfired",
      missedOccurrences: 2,
    });
    expect((await api.automation.notifications.list()).items).toHaveLength(1);
  });

  it("refuse to enable a one-time schedule in the past", async () => {
    const { api } = await setup();
    const created = await api.automation.rules.create({
      name: "过去",
      trigger: { type: "schedule", schedule: { kind: "once", date: "2020-01-01", time: "09:00" } },
      actions: [{ type: "notify", title: "x" }],
    });
    await rejects(
      api.automation.rules.setEnabled({ id: created.id, enabled: true }),
      "automation.schedule_in_past",
    );
  });

  it("report the worker heartbeat in the health view", async () => {
    const { api } = await setup();
    let health = await api.automation.health();
    expect(health.scheduler).toMatchObject({ lastTickAt: null, operational: false });
    await workerTick({ db, bus });
    const [status] = await db.select().from(automationWorkerStatus);
    expect(status?.lastTickAt).toBeInstanceOf(Date);
    health = await api.automation.health();
    expect(health.scheduler.lastTickAt).not.toBeNull();
    expect(health.events.pending).toBe(0);
  });
});

describe("integrity", () => {
  it("never writes XP, rewards or finance data itself", async () => {
    const { api, user, drain } = await setup();
    await rule(api, {
      name: "很多动作",
      trigger: { type: "task.completed" },
      actions: [
        { type: "create_task", title: "新任务 {task}", priority: 3 },
        { type: "create_follow_up_task", title: "跟进 {task}" },
        { type: "notify", title: "完成 {task}" },
      ],
    });
    const task = await api.tasks.create({ title: "写周报" });
    await api.tasks.complete({ id: task.id });
    const afterCompletion = await ledgerCount(user.id);
    await drain();
    expect(await ledgerCount(user.id)).toBe(afterCompletion);
    const created = await db
      .select({ completedAt: tasks.completedAt })
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), sql`${tasks.title} <> '写周报'`));
    expect(created).toHaveLength(2);
    expect(created.every((t) => t.completedAt === null)).toBe(true);
    expect(await db.select().from(financeSnapshots)).toEqual([]);
  });

  it("keeps the person's change when capture cannot run", async () => {
    const { api, user } = await setup();
    await rule(api, followUp);
    // Simulate a broken outbox: the completion must still commit.
    await db.execute(
      sql`alter table automation_events add constraint broken check (false) not valid`,
    );
    try {
      const task = await api.tasks.create({ title: "照常完成" });
      await api.tasks.complete({ id: task.id });
      const [row] = await titled(user.id, "照常完成");
      expect(row!.completedAt).not.toBeNull();
    } finally {
      await db.execute(sql`alter table automation_events drop constraint broken`);
    }
  });

  it("publishes the new events once per real change, without balances", async () => {
    const { api, user } = await setup();
    const seen: { type: string; payload: unknown }[] = [];
    const watch = createEventBus();
    for (const type of [
      "task.status_changed",
      "goal.status_changed",
      "finance.snapshot_saved",
    ] as const) {
      watch.subscribe(type, (e) => void seen.push({ type: e.type, payload: e.payload }), {
        name: `test.${type}`,
      });
    }
    const deps = { db, bus: watch };
    const statuses = await api.tasks.statuses.list();
    const started = statuses.find((s) => s.category === "started")!;
    const task = await api.tasks.create({ title: "状态" });
    await setTaskStatus(deps, user.id, { id: task.id, statusId: started.id });
    await setTaskStatus(deps, user.id, { id: task.id, statusId: started.id }); // no-op
    const [attribute] = await listAttributes(db, user.id);
    const goal = await api.development.goals.create({
      title: "目标",
      attributes: [{ attributeId: attribute!.id, weight: 1 }],
    });
    await setGoalStatus(deps, user.id, goal.id, "paused");
    await setGoalStatus(deps, user.id, goal.id, "paused"); // no-op
    const provider = await api.finance.providers.create({ name: "B", providerType: "bank" });
    const account = await api.finance.accounts.create({
      providerId: provider.id,
      name: "A",
      kind: "asset",
      accountType: "current",
      assetCategory: "bank_deposit",
      currency: "USD",
    });
    await saveBatch(deps, user.id, {
      valuationDate: "2026-10-01",
      entries: [{ accountId: account.id, amount: "777.77" }],
      rates: {},
      overwrite: false,
    });
    expect(seen.map((e) => e.type)).toEqual([
      "task.status_changed",
      "goal.status_changed",
      "finance.snapshot_saved",
    ]);
    expect(seen[2]!.payload).toEqual({
      valuationDate: "2026-10-01",
      entryCount: 1,
      unconvertedCount: 1,
      corrected: false,
    });
  });
});

/* ---------------------------------------------------------------- M10.1 audit regressions */

describe("M10.1 audit", () => {
  const within = <T>(promise: Promise<T>, ms = 10_000) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
    ]);

  it("D1: a failure before claiming an event neither blames the previous event nor loops forever", async () => {
    const { api, user } = await setup();
    await rule(api, followUp);
    for (const title of ["一", "二"]) {
      const task = await api.tasks.create({ title });
      await api.tasks.complete({ id: task.id });
    }
    let calls = 0;
    const flaky = Object.create(db) as typeof db;
    flaky.transaction = ((fn: Parameters<typeof db.transaction>[0]) =>
      calls++ === 0
        ? db.transaction(fn)
        : Promise.reject(new Error("connection lost"))) as typeof db.transaction;
    const result = await within(drainEvents({ db: flaky, bus }, { userId: user.id }));
    expect(result.processed).toBe(1);
    const events = await db.select().from(automationEvents).orderBy(automationEvents.createdAt);
    expect(events.map((e) => [e.status, e.attempts])).toEqual([
      ["processed", 1],
      ["pending", 0],
    ]);
    // The database stays down: the drain gives up instead of spinning.
    const down = Object.create(db) as typeof db;
    down.transaction = (() => Promise.reject(new Error("down"))) as typeof db.transaction;
    await expect(
      within(drainEvents({ db: down, bus }, { userId: user.id })),
    ).resolves.toMatchObject({
      processed: 0,
    });
    // Back up: the remaining event is processed once.
    await drainEvents({ db, bus }, { userId: user.id });
    expect((await titled(user.id, "跟进：二")).length).toBe(1);
  });

  it("D2: one failing scheduled rule does not block the others, and the tick still reports", async () => {
    const { api } = await setup();
    const make = (name: string) =>
      rule(api, {
        name,
        trigger: { type: "schedule", schedule: { kind: "daily", time: "09:00" } },
        timeZone: "Europe/Paris",
        actions: [{ type: "notify", title: name }],
      });
    const broken = await make("坏的");
    const good = await make("好的");
    const due = new Date("2026-10-28T08:00:00Z");
    await db
      .update(automationRules)
      .set({ nextRunAt: new Date(due.getTime() - 60_000) })
      .where(eq(automationRules.id, broken.id));
    await db.update(automationRules).set({ nextRunAt: due }).where(eq(automationRules.id, good.id));
    // A database error while processing the first rule (e.g. a constraint or a lost lock).
    await db.execute(
      sql.raw(`
      create function automation_poison() returns trigger language plpgsql as $$
      begin
        if new.rule_id = '${broken.id}' then raise exception 'poison'; end if;
        return new;
      end $$;
      create trigger automation_poison before insert on automation_executions
        for each row execute function automation_poison();
    `),
    );
    try {
      const summary = await workerTick({ db, bus }, new Date(due.getTime() + 30_000));
      expect(summary).toMatchObject({ executed: 1, failed: 1 });
    } finally {
      await db.execute(sql`drop trigger automation_poison on automation_executions`);
      await db.execute(sql`drop function automation_poison()`);
    }
    expect((await api.automation.notifications.list()).items.map((n) => n.title)).toEqual(["好的"]);
    expect((await db.select().from(automationWorkerStatus))[0]?.lastTickAt).toBeInstanceOf(Date);
    // The failed rule stays due and runs on the next tick.
    const [still] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, broken.id));
    expect(still!.nextRunAt?.toISOString()).toBe(new Date(due.getTime() - 60_000).toISOString());
    await workerTick({ db, bus }, new Date(due.getTime() + 90_000));
    expect((await api.automation.notifications.list()).items.map((n) => n.title).sort()).toEqual([
      "坏的",
      "好的",
    ]);
  });

  it("D2b: a scheduled rule with invalid stored configuration is recorded, not silently dropped", async () => {
    const { api } = await setup();
    const created = await rule(api, {
      name: "配置损坏",
      trigger: { type: "schedule", schedule: { kind: "daily", time: "09:00" } },
      timeZone: "Europe/Paris",
      actions: [{ type: "notify", title: "x" }],
    });
    const due = new Date("2026-10-28T08:00:00Z");
    await db
      .update(automationRules)
      .set({ nextRunAt: due, timeZone: "Mars/Olympus" })
      .where(eq(automationRules.id, created.id));
    await tickSchedules({ db, bus }, { now: new Date(due.getTime() + 30_000) });
    const [execution] = await executionsOf(created.id);
    expect(execution).toMatchObject({ status: "skipped", skipReason: "invalid_config" });
  });

  it("D3: an outbox failure while checking rules never undoes the person's change", async () => {
    const { api, user } = await setup();
    await rule(api, followUp);
    await db.execute(
      sql`alter table automation_rules rename column trigger_type to trigger_type_x`,
    );
    try {
      const task = await api.tasks.create({ title: "照常完成 2" });
      await api.tasks.complete({ id: task.id });
      const [row] = await titled(user.id, "照常完成 2");
      expect(row!.completedAt).not.toBeNull();
    } finally {
      await db.execute(
        sql`alter table automation_rules rename column trigger_type_x to trigger_type`,
      );
    }
  });

  it("D4 + D5: automated tasks pass the task module's input validation; such failures are permanent", async () => {
    const { api, user, drain } = await setup();
    const created = await rule(api, {
      name: "坏模板",
      trigger: { type: "task.completed" },
      actions: [{ type: "create_task", title: "{goal}" }],
    });
    const long = await rule(api, {
      name: "太长",
      trigger: { type: "task.completed" },
      actions: [{ type: "create_task", title: "{task}{task}{task}" }],
    });
    const task = await api.tasks.create({ title: "长".repeat(200) });
    await api.tasks.complete({ id: task.id });
    await drain();
    for (const id of [created.id, long.id]) {
      const [execution] = await executionsOf(id);
      expect(execution).toMatchObject({
        status: "failed",
        errorCode: "automation.invalid_task",
        retryable: false,
      });
    }
    const all = await db
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.userId, user.id));
    expect(all).toHaveLength(1);
  });

  it("D6: events that failed permanently are visible in the health view", async () => {
    const { api, user } = await setup();
    await rule(api, followUp);
    const task = await api.tasks.create({ title: "x" });
    await api.tasks.complete({ id: task.id });
    await db
      .update(automationEvents)
      .set({ status: "failed", attempts: 5 })
      .where(eq(automationEvents.userId, user.id));
    const health = await api.automation.health();
    expect(health.events).toMatchObject({ pending: 0, failed: 1 });
  });

  it("D7: a finished one-time schedule is not counted as an active schedule", async () => {
    const { api } = await setup();
    const at = new Date(Date.now() + 3_600_000);
    const once = await rule(api, {
      name: "一次",
      trigger: {
        type: "schedule",
        schedule: {
          kind: "once",
          date: at.toISOString().slice(0, 10),
          time: at.toISOString().slice(11, 16),
        },
      },
      timeZone: "UTC",
      actions: [{ type: "notify", title: "x" }],
    });
    expect((await api.automation.health()).scheduler.scheduledRules).toBe(1);
    await tickSchedules({ db, bus }, { now: new Date(at.getTime() + 60_000) });
    expect((await api.automation.rules.byId({ id: once.id })).nextRunAt).toBeNull();
    expect((await api.automation.health()).scheduler.scheduledRules).toBe(0);
  });

  it("at most once across a crash between the action and the end of processing", async () => {
    const { api, user, drain } = await setup();
    await rule(api, followUp);
    const task = await api.tasks.create({ title: "崩溃" });
    await api.tasks.complete({ id: task.id });
    // The final outbox update fails: the whole event transaction (task, effect, execution) rolls back.
    await db.execute(
      sql`alter table automation_events add constraint crash check (status <> 'processed') not valid`,
    );
    try {
      await drain();
    } finally {
      await db.execute(sql`alter table automation_events drop constraint crash`);
    }
    expect(await titled(user.id, "跟进：崩溃")).toEqual([]);
    expect(await db.select().from(automationEffects)).toEqual([]);
    expect(await db.select().from(automationExecutions)).toEqual([]);
    const [event] = await db.select().from(automationEvents);
    expect(event).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "automation.invalid_data",
    });
    await drain();
    expect(await titled(user.id, "跟进：崩溃")).toHaveLength(1);
    expect(await db.select().from(automationEffects)).toHaveLength(1);
  });
});
