import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { TASK_XP, xpForLevel } from "@/modules/character/domain";
import {
  applyXpEvent,
  characterRouter,
  getXpActivity,
  registerCharacterEventHandlers,
} from "@/modules/character/server";
import { rewardsRouter } from "@/modules/rewards/server";
import { settingsRouter } from "@/modules/settings/server";
import { tasksRouter } from "@/modules/tasks/server";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { dashboardRouter } from "./router";

const { db, close } = createTestDb();

function setup(userId: string) {
  const bus = createEventBus();
  registerCharacterEventHandlers(bus);
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    character: createCallerFactory(characterRouter)(ctx),
    rewards: createCallerFactory(rewardsRouter)(ctx),
    settings: createCallerFactory(settingsRouter)(ctx),
    dashboard: createCallerFactory(dashboardRouter)(ctx),
  };
}

async function seeded() {
  const user = await createSeededUser(db);
  const api = setup(user.id);
  const attributes = await api.character.attributes.list();
  const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  return { user, api, attr };
}

/** One synthetic completion at `at`, worth 10 Active XP, credited by weight. */
async function earnAt(
  userId: string,
  at: Date,
  contributions: { attributeId: string; weight: number }[] = [],
) {
  await applyXpEvent(db, {
    id: crypto.randomUUID(),
    type: "task.completed",
    userId,
    occurredAt: at,
    payload: {
      taskId: crypto.randomUUID(),
      title: "练习",
      parentTaskId: null,
      contributions,
      areaId: null,
      priority: 0,
      isUrgent: null,
      isImportant: false,
      estimatedMinutes: null,
      completedAt: at,
    },
  });
}

async function counts() {
  const result = await db.execute<{ xp: number; credits: number; spent: number; tasks: number }>(
    sql`select (select count(*) from xp_ledger)::int as xp,
               (select count(*) from xp_attribute_credits)::int as credits,
               (select count(*) from reward_ledger)::int as spent,
               (select count(*) from tasks)::int as tasks`,
  );
  return result.rows[0];
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("dashboard read model", () => {
  it("a fresh user gets a complete, empty dashboard", async () => {
    const { api } = await seeded();
    const overview = await api.dashboard.overview();
    expect(overview.level).toMatchObject({ level: 1, xp: 0, xpIntoLevel: 0 });
    expect(overview.stage.stage.key).toBe("starter");
    expect(overview.totals).toMatchObject({ lifetimeActiveXp: 0, growthXp: 0, lifetimeLevelXp: 0 });
    expect(overview.week).toMatchObject({ completedTasks: 0, activeXp: 0, growthXp: 0, top: [] });
    expect(overview.focus).toEqual({ fastest: null, slowest: null });
    expect(overview.recentActivity).toEqual([]);
    expect(overview.activeAttributeIds).toHaveLength(5);
    // Seeded level rewards: Lv 5 is the next one, claimable early from Lv 1 (stage 启程者 ends at 5).
    expect(overview.nextLevelReward?.reward).toMatchObject({ level: 5, state: "early" });
    expect(overview.nextLevelReward?.missingLevelXp).toBe(xpForLevel(5));
    expect(overview.levelRewardCount).toBe(4);
    expect(overview.rewardPreview).toEqual([]);

    const growth = await api.dashboard.growth({ period: "30d" });
    expect(growth.points).toHaveLength(30);
    expect(growth.points.every((p) => p.growthXp === 0)).toBe(true);
    expect(growth.ranking).toEqual([]);
    const all = await api.dashboard.growth({ period: "all" });
    expect(all.points).toHaveLength(1);
    expect(all.from).toBe(all.to);
  });

  it("an ordinary task shows Active XP and activity, but no Growth or Level XP", async () => {
    const { api } = await seeded();
    const task = await api.tasks.create({ title: "回复银行邮件" });
    await api.tasks.complete({ id: task.id });

    const overview = await api.dashboard.overview();
    expect(overview.week).toMatchObject({
      completedTasks: 1,
      activeXp: TASK_XP.base,
      growthXp: 0,
      levelXp: 0,
      top: [],
    });
    expect(overview.recentActivity).toHaveLength(1);
    expect(overview.recentActivity[0]).toMatchObject({
      sourceTitle: "回复银行邮件",
      amount: TASK_XP.base,
      levelXp: 0,
      credits: [],
    });
    expect(overview.level.level).toBe(1);
    expect(overview.focus.fastest).toBeNull();
  });

  it("a growth task split over two attributes shows up in totals, ranking, focus and trend", async () => {
    const { api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "法语阅读",
      priority: 2,
      contributions: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
    await api.tasks.complete({ id: task.id });
    const xp = TASK_XP.base + 2 * TASK_XP.perPriority; // 20 → 法语 15, 阅读 5

    const overview = await api.dashboard.overview();
    expect(overview.week).toMatchObject({ activeXp: xp, growthXp: xp, levelXp: xp });
    expect(overview.week.top).toEqual([
      { attributeId: attr("french"), growthXp: 15 },
      { attributeId: attr("reading"), growthXp: 5 },
    ]);
    expect(overview.focus).toEqual({
      fastest: { attributeId: attr("french"), growthXp: 15 },
      slowest: { attributeId: attr("english"), growthXp: 0 },
    });
    expect(overview.attributes.find((a) => a.id === attr("french"))?.xp).toBe(15);
    expect(overview.balances).toMatchObject({ lifetimeLevelXp: xp, spendableLevelXp: xp });

    const growth = await api.dashboard.growth({ period: "7d" });
    expect(growth.points).toHaveLength(7);
    expect(growth.points.at(-1)).toMatchObject({ activeXp: xp, growthXp: xp, levelXp: xp });
    expect(growth.ranking.map((r) => r.growthXp)).toEqual([15, 5]);
    expect(growth).toMatchObject({ activeXp: xp, growthXp: xp, levelXp: xp });
  });

  it("reopening nets the week and the trend back to zero", async () => {
    const { api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "跑步",
      contributions: [{ attributeId: attr("cardio"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    await api.tasks.reopen({ id: task.id });

    const overview = await api.dashboard.overview();
    expect(overview.week).toMatchObject({ completedTasks: 0, activeXp: 0, growthXp: 0, top: [] });
    expect(overview.recentActivity.map((e) => e.kind)).toEqual(["reversal", "grant"]);
    const growth = await api.dashboard.growth({ period: "7d" });
    expect(growth.points.at(-1)).toMatchObject({ activeXp: 0, growthXp: 0 });
  });

  it("spending lowers spendable Level XP only; level and lifetime stay", async () => {
    const { user, api, attr } = await seeded();
    for (let i = 0; i < 12; i++) {
      await earnAt(user.id, new Date(), [{ attributeId: attr("french"), weight: 1 }]);
    }
    const before = await api.dashboard.overview();
    const reward = await api.rewards.create({ name: "奶茶", value: 100, payWithActive: false });
    await api.rewards.create({ name: "停用的", value: 1, enabled: false });
    expect((await api.dashboard.overview()).rewardPreview).toEqual([
      expect.objectContaining({
        affordable: true,
        reward: expect.objectContaining({ id: reward.id, levelXpCost: 20 }),
      }),
    ]);

    await api.rewards.redeem({
      rewardId: reward.id,
      payment: { strategy: "level_first" },
      idempotencyKey: crypto.randomUUID(),
    });
    const after = await api.dashboard.overview();
    expect(after.balances.spendableLevelXp).toBe(before.balances.spendableLevelXp - 20);
    expect(after.balances.lifetimeLevelXp).toBe(before.balances.lifetimeLevelXp);
    expect(after.level).toEqual(before.level);
    expect(after.enabledRewardCount).toBe(1);
  });

  it("reflects a reached and a claimed level reward", async () => {
    const { user, api, attr } = await seeded();
    // 46 × 10 Level XP = 460 ≥ xpForLevel(5) = 451.
    for (let i = 0; i < 46; i++) {
      await earnAt(user.id, new Date(), [{ attributeId: attr("strength"), weight: 1 }]);
    }
    const reached = await api.dashboard.overview();
    expect(reached.level.level).toBe(5);
    expect(reached.nextLevelReward?.reward).toMatchObject({ level: 5, state: "claimable" });

    await api.rewards.levelRewards.claim({
      levelRewardId: reached.nextLevelReward!.reward.id,
      idempotencyKey: crypto.randomUUID(),
    });
    const claimed = await api.dashboard.overview();
    expect(claimed.nextLevelReward?.reward).toMatchObject({ level: 10, state: "early" });
  });

  it("buckets by the user's local day and week (timezone-safe)", async () => {
    const { user, api, attr } = await seeded();
    await api.settings.update({ timeZone: "Asia/Shanghai" });
    const french = [{ attributeId: attr("french"), weight: 1 }];
    // 23:30 UTC on 1 Jan is 07:30 on 2 Jan in Shanghai; 15:50 UTC on 1 Jan is 23:50 on 1 Jan.
    await earnAt(user.id, new Date("2026-01-01T23:30:00Z"), french);
    await earnAt(user.id, new Date("2026-01-01T15:50:00Z"), french);
    await earnAt(user.id, new Date("2026-01-01T16:10:00Z"));

    const all = await getXpActivity(db, user.id, { from: null, timeZone: "Asia/Shanghai" });
    expect(all.days).toEqual([
      { date: "2026-01-01", activeXp: 10, growthXp: 10, levelXp: 10 },
      { date: "2026-01-02", activeXp: 20, growthXp: 10, levelXp: 10 },
    ]);
    // From local 2 Jan 00:00 (= 1 Jan 16:00 UTC): the 15:50 UTC entry is the day before.
    const fromSecond = await getXpActivity(db, user.id, {
      from: "2026-01-02",
      timeZone: "Asia/Shanghai",
    });
    expect(fromSecond).toMatchObject({ activeXp: 20, growthXp: 10 });
    const utc = await getXpActivity(db, user.id, { from: "2026-01-02", timeZone: "UTC" });
    expect(utc.activeXp).toBe(0);

    const allTime = await api.dashboard.growth({ period: "all" });
    expect(allTime.from).toBe("2026-01-01");
    expect(allTime.points.reduce((sum, p) => sum + p.growthXp, 0)).toBe(20);
  });

  it("only shows the signed-in user's data", async () => {
    const { user, api, attr } = await seeded();
    const other = await seeded();
    await earnAt(user.id, new Date(), [{ attributeId: attr("french"), weight: 1 }]);
    await api.rewards.create({ name: "私人奖励", value: 10 });

    const theirs = await other.api.dashboard.overview();
    expect(theirs.totals.lifetimeActiveXp).toBe(0);
    expect(theirs.recentActivity).toEqual([]);
    expect(theirs.rewardPreview).toEqual([]);
    expect(theirs.attributes.some((a) => a.id === attr("french"))).toBe(false);
    expect((await other.api.dashboard.growth({ period: "all" })).growthXp).toBe(0);
  });

  it("is read-only: reading it writes nothing", async () => {
    const { user, api, attr } = await seeded();
    await earnAt(user.id, new Date(), [{ attributeId: attr("french"), weight: 1 }]);
    const before = await counts();
    await api.dashboard.overview();
    for (const period of ["7d", "30d", "90d", "all"] as const)
      await api.dashboard.growth({ period });
    expect(await counts()).toEqual(before);
  });
});
