import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getLevelFromLevelXp, TASK_XP, xpForLevel } from "@/modules/character/domain";
import {
  applyXpEvent,
  characterRouter,
  registerCharacterEventHandlers,
} from "@/modules/character/server";
import { developmentAttributes, xpAttributeCredits, xpLedger } from "@/modules/character/db";
import { tasksRouter } from "@/modules/tasks/server";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { rewardLedger } from "../db";
import { rewardsRouter } from "./router";

const { db, close } = createTestDb();

function setup(userId: string) {
  const bus = createEventBus();
  registerCharacterEventHandlers(bus);
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    character: createCallerFactory(characterRouter)(ctx),
    rewards: createCallerFactory(rewardsRouter)(ctx),
  };
}

async function seeded() {
  const user = await createSeededUser(db);
  const api = setup(user.id);
  const attributes = await api.character.attributes.list();
  const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  return { user, api, attr };
}

/**
 * Earns XP through the real engine: synthetic task.completed events (distinct sources), each
 * worth `amount` Active XP, credited to `attributeId` when given.
 */
async function earn(userId: string, amount: number, times: number, attributeId?: string) {
  // TASK_XP: base 10 + 5 × priority (+5 important) — pick fields that give `amount`.
  const priority = (amount - TASK_XP.base) / TASK_XP.perPriority;
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new Error("amount");
  for (let i = 0; i < times; i++) {
    await applyXpEvent(db, {
      id: crypto.randomUUID(),
      type: "task.completed",
      userId,
      occurredAt: new Date(),
      payload: {
        taskId: crypto.randomUUID(),
        title: `练习 ${i}`,
        parentTaskId: null,
        contributions: attributeId ? [{ attributeId, weight: 2 }] : [],
        areaId: null,
        priority,
        isUrgent: null,
        isImportant: false,
        estimatedMinutes: null,
        completedAt: new Date(),
      },
    });
  }
}

const key = () => crypto.randomUUID();

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("XP model: Active, Growth and Level XP", () => {
  it("a task without development contributions earns Active XP only", async () => {
    const { api } = await seeded();
    const task = await api.tasks.create({ title: "回复银行邮件" });
    await api.tasks.complete({ id: task.id });
    const overview = await api.character.overview();
    expect(overview.totals).toEqual({
      lifetimeActiveXp: TASK_XP.base,
      growthXp: 0,
      legacyGrowthXp: 0,
      lifetimeLevelXp: 0,
    });
    expect(overview.level.level).toBe(1);
    expect(await api.rewards.balances()).toMatchObject({
      spendableActiveXp: TASK_XP.base,
      spendableLevelXp: 0,
      level: 1,
    });
  });

  it("a growth task earns Active, Growth and Level XP (1:1), stored on the credit", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "学习法语 30 分钟",
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    const overview = await api.character.overview();
    expect(overview.totals).toMatchObject({
      lifetimeActiveXp: 10,
      growthXp: 10,
      lifetimeLevelXp: 10,
    });
    expect(overview.attributes.find((a) => a.id === attr("french"))!.xp).toBe(10);
    const [credit] = await db
      .select()
      .from(xpAttributeCredits)
      .where(sql`${xpAttributeCredits.userId} = ${user.id}`);
    expect(credit!.levelXp).toBe(10);
    const [entry] = (await api.character.history({})).entries;
    expect(entry).toMatchObject({ amount: 10, levelXp: 10 });

    // Reopening reverses all three.
    await api.tasks.reopen({ id: task.id });
    expect((await api.character.overview()).totals).toMatchObject({
      lifetimeActiveXp: 0,
      growthXp: 0,
      lifetimeLevelXp: 0,
    });
  });

  it("derives the level from lifetime Level XP, not Active XP", async () => {
    const { user, api, attr } = await seeded();
    await earn(user.id, 30, 10); // 300 Active XP, no growth
    expect((await api.character.overview()).level.level).toBe(1);
    await earn(user.id, 30, 4, attr("reading")); // +120 Level XP
    const overview = await api.character.overview();
    expect(overview.totals).toMatchObject({ lifetimeActiveXp: 420, lifetimeLevelXp: 120 });
    expect(overview.level).toMatchObject({ level: 2, xpIntoLevel: 20, xpForNext: 108 });
    expect(overview.stage.stage.key).toBe("starter");
  });

  it("keeps M6 legacy history out of Growth and Level XP, credits recorded before M6.2 1:1", async () => {
    const { user, api, attr } = await seeded();
    const [legacy] = await db
      .insert(developmentAttributes)
      .values({
        userId: user.id,
        systemKey: "legacy.work",
        color: "indigo",
        onRadar: false,
        archivedAt: new Date(),
        sortKey: "z0",
      })
      .returning();
    const ledgerRow = (amount: number) => ({
      userId: user.id,
      kind: "grant",
      amount,
      ruleKey: "task.completion",
      sourceEventId: crypto.randomUUID(),
      sourceEventType: "task.completed",
      sourceType: "task",
      sourceId: crypto.randomUUID(),
      sourceTitle: "旧记录",
      cycle: 0,
    });
    // An M6 area-derived grant and an M6.1 development grant, both without stored level_xp.
    const [m6, m61] = await db
      .insert(xpLedger)
      .values([ledgerRow(100), ledgerRow(20)])
      .returning();
    await db.insert(xpAttributeCredits).values([
      { userId: user.id, ledgerEntryId: m6!.id, attributeId: legacy!.id, amount: 100 },
      { userId: user.id, ledgerEntryId: m61!.id, attributeId: attr("french"), amount: 20 },
    ]);

    const overview = await api.character.overview();
    expect(overview.totals).toEqual({
      lifetimeActiveXp: 120, // both were completions
      growthXp: 20,
      legacyGrowthXp: 100, // kept and auditable…
      lifetimeLevelXp: 20, // …but never counted towards the level
    });
    expect(overview.attributes.map((a) => a.id)).not.toContain(legacy!.id);
  });
});

describe("reward store", () => {
  it("creates, edits, disables and deletes rewards", async () => {
    const { api } = await seeded();
    const tea = await api.rewards.create({
      name: "奶茶",
      emoji: "🧋",
      category: "treat",
      value: 500,
    });
    expect(tea).toMatchObject({ activeXpCost: 500, levelXpCost: 100, remaining: null });

    await api.rewards.update({
      id: tea.id,
      patch: { value: 600, repeatable: true, maxRedemptions: 3, realWorldCostCents: 550 },
    });
    let [listed] = await api.rewards.list();
    expect(listed).toMatchObject({ value: 600, levelXpCost: 120, remaining: 3 });
    await expect(
      api.rewards.update({ id: tea.id, patch: { payWithActive: false, payWithLevel: false } }),
    ).rejects.toMatchObject({ message: "reward.not_payable" });
    await expect(
      api.rewards.create({ name: "x", value: 10, payWithActive: false, payWithLevel: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await api.rewards.update({ id: tea.id, patch: { enabled: false } });
    [listed] = await api.rewards.list();
    expect(listed!.enabled).toBe(false);
    await api.rewards.delete({ id: tea.id });
    expect(await api.rewards.list()).toEqual([]);
  });

  it("spends Active XP without touching lifetime Active XP", async () => {
    const { user, api } = await seeded();
    await earn(user.id, 30, 30); // 900 Active XP
    const tea = await api.rewards.create({ name: "奶茶", value: 500 });
    await api.rewards.redeem({
      rewardId: tea.id,
      payment: { strategy: "active_first" },
      idempotencyKey: key(),
    });
    expect(await api.rewards.balances()).toMatchObject({
      lifetimeActiveXp: 900,
      spendableActiveXp: 400,
    });
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(900);
  });

  it("spends Level XP without lowering the level", async () => {
    const { user, api, attr } = await seeded();
    await earn(user.id, 30, 40, attr("strength")); // 1,200 Active = Growth = Level XP
    const before = await api.rewards.balances();
    expect(before).toMatchObject({ lifetimeLevelXp: 1200, spendableLevelXp: 1200 });
    const level = getLevelFromLevelXp(1200);
    expect(before.level).toBe(level);

    const trip = await api.rewards.create({ name: "周末旅行", value: 4500, payWithActive: false });
    await api.rewards.redeem({
      rewardId: trip.id,
      payment: { strategy: "level_first" },
      idempotencyKey: key(),
    });
    expect(await api.rewards.balances()).toMatchObject({
      lifetimeLevelXp: 1200,
      spendableLevelXp: 300,
      spendableActiveXp: 1200,
      level,
    });
    expect((await api.character.overview()).level.level).toBe(level);
  });

  it("redeems with a mixed payment: 300 Active + 40 Level XP", async () => {
    const { user, api, attr } = await seeded();
    await earn(user.id, 20, 15); // 300 Active XP
    await earn(user.id, 20, 2, attr("reading")); // +40 Active, +40 Level XP
    const tea = await api.rewards.create({ name: "奶茶", value: 500 });
    const entry = await api.rewards.redeem({
      rewardId: tea.id,
      payment: { strategy: "custom", activeXp: 300, levelXp: 40 },
      idempotencyKey: key(),
    });
    expect(entry).toMatchObject({ activeXpSpent: 300, levelXpSpent: 40, purchaseValue: 500 });
    expect(await api.rewards.balances()).toMatchObject({
      lifetimeActiveXp: 340,
      spendableActiveXp: 40,
      lifetimeLevelXp: 40,
      spendableLevelXp: 0,
    });
  });

  it("refuses insufficient balances, sold-out and disabled rewards", async () => {
    const { user, api } = await seeded();
    await earn(user.id, 30, 20); // 600 Active XP
    const book = await api.rewards.create({ name: "买书", value: 700, payWithLevel: false });
    await expect(
      api.rewards.redeem({
        rewardId: book.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ message: "reward.insufficient_active" });

    const once = await api.rewards.create({ name: "一次", value: 100, repeatable: false });
    await api.rewards.redeem({
      rewardId: once.id,
      payment: { strategy: "active_first" },
      idempotencyKey: key(),
    });
    await expect(
      api.rewards.redeem({
        rewardId: once.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ message: "reward.sold_out" });

    const limited = await api.rewards.create({ name: "限量", value: 100, maxRedemptions: 2 });
    for (let i = 0; i < 2; i++) {
      await api.rewards.redeem({
        rewardId: limited.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      });
    }
    await expect(
      api.rewards.redeem({
        rewardId: limited.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ message: "reward.sold_out" });
    expect((await api.rewards.list()).find((r) => r.id === limited.id)).toMatchObject({
      redemptionCount: 2,
      remaining: 0,
    });

    const off = await api.rewards.create({ name: "停用", value: 10, enabled: false });
    await expect(
      api.rewards.redeem({
        rewardId: off.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ message: "reward.disabled" });
    expect((await api.rewards.balances()).spendableActiveXp).toBe(300);
  });

  it("is idempotent and atomic under retries and concurrent redemptions", async () => {
    const { user, api } = await seeded();
    await earn(user.id, 30, 10); // 300 Active XP
    const tea = await api.rewards.create({ name: "奶茶", value: 100 });
    const same = key();
    const payment = { strategy: "active_first" } as const;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.rewards.redeem({ rewardId: tea.id, payment, idempotencyKey: same }),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await api.rewards.balances()).spendableActiveXp).toBe(200);

    // Six distinct attempts against 200 XP: exactly two succeed, the balance never goes negative.
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        api.rewards.redeem({ rewardId: tea.id, payment, idempotencyKey: key() }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
    expect((await api.rewards.balances()).spendableActiveXp).toBe(0);
  });

  it("keeps history snapshots and rejects ledger edits", async () => {
    const { user, api } = await seeded();
    await earn(user.id, 30, 10);
    const movie = await api.rewards.create({ name: "看电影", emoji: "🎬", value: 200 });
    await api.rewards.redeem({
      rewardId: movie.id,
      payment: { strategy: "active_first" },
      idempotencyKey: key(),
    });
    await api.rewards.update({ id: movie.id, patch: { name: "看 IMAX 电影", emoji: "🍿" } });
    const [entry] = await api.rewards.history();
    expect(entry).toMatchObject({
      kind: "reward_redeemed",
      title: "看电影",
      emoji: "🎬",
      activeXpSpent: 200,
    });
    await expect(api.rewards.delete({ id: movie.id })).rejects.toMatchObject({
      message: "reward.has_history",
    });
    await expect(db.update(rewardLedger).set({ activeXpSpent: 0 })).rejects.toThrow();
    await expect(db.delete(rewardLedger)).rejects.toThrow();
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(300);
  });
});

describe("level rewards", () => {
  async function levelRewards(api: ReturnType<typeof setup>) {
    return api.rewards.levelRewards.list();
  }

  it("seeds examples and gives a reached level's reward for free, once", async () => {
    const { user, api, attr } = await seeded();
    expect((await levelRewards(api)).map((r) => [r.level, r.systemKey])).toEqual([
      [5, "bubble_tea"],
      [10, "favourite_meal"],
      [20, "weekend_trip"],
      [30, "europe_trip"],
    ]);
    // Reach level 10 with growth.
    const needed = xpForLevel(10);
    await earn(user.id, 30, Math.ceil(needed / 30), attr("cardio"));
    const before = await api.rewards.balances();
    expect(before.level).toBe(10);

    const meal = (await levelRewards(api)).find((r) => r.level === 10)!;
    expect(meal.state).toBe("claimable");
    const claim = await api.rewards.levelRewards.claim({
      levelRewardId: meal.id,
      idempotencyKey: key(),
    });
    expect(claim).toMatchObject({
      kind: "milestone_reward_claimed",
      early: false,
      activeXpSpent: 0,
      levelXpSpent: 0,
      levelAtClaim: 10,
      title: null,
      titleKey: "favourite_meal",
    });
    expect(await api.rewards.balances()).toEqual(before); // nothing spent
    await expect(
      api.rewards.levelRewards.claim({ levelRewardId: meal.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ message: "level_reward.already_claimed" });
    expect((await levelRewards(api)).find((r) => r.level === 10)!.state).toBe("claimed");
  });

  it("claims a future level's reward early with spendable Level XP, never lowering the level", async () => {
    const { user, api, attr } = await seeded();
    await earn(user.id, 30, Math.ceil(xpForLevel(17) / 30), attr("strength"));
    const before = await api.rewards.balances();
    expect(before.level).toBe(17);

    const trip = (await levelRewards(api)).find((r) => r.level === 20)!;
    const europe = (await levelRewards(api)).find((r) => r.level === 30)!;
    expect(trip.state).toBe("early");
    expect(trip.earlyClaimCost).toBe(xpForLevel(20) - before.lifetimeLevelXp);
    expect(europe.state).toBe("locked");
    await expect(
      api.rewards.levelRewards.claim({ levelRewardId: europe.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ message: "level_reward.too_far" });

    const claim = await api.rewards.levelRewards.claim({
      levelRewardId: trip.id,
      idempotencyKey: key(),
    });
    expect(claim).toMatchObject({
      early: true,
      levelXpSpent: trip.earlyClaimCost,
      activeXpSpent: 0,
    });
    const after = await api.rewards.balances();
    expect(after).toMatchObject({
      lifetimeLevelXp: before.lifetimeLevelXp,
      spendableLevelXp: before.spendableLevelXp - trip.earlyClaimCost!,
      spendableActiveXp: before.spendableActiveXp,
      level: 17,
    });

    // Reaching level 20 later does not make it claimable again.
    await earn(
      user.id,
      30,
      Math.ceil((xpForLevel(20) - before.lifetimeLevelXp) / 30),
      attr("strength"),
    );
    const reached = (await levelRewards(api)).find((r) => r.level === 20)!;
    expect(reached.state).toBe("claimed");
    await expect(
      api.rewards.levelRewards.claim({ levelRewardId: trip.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ message: "level_reward.already_claimed" });
  });

  it("refuses an early claim without enough spendable Level XP (no reward debt)", async () => {
    const { user, api, attr } = await seeded();
    await earn(user.id, 30, Math.ceil(xpForLevel(17) / 30), attr("strength"));
    const balances = await api.rewards.balances();
    // Spend almost all Level XP in the store first.
    const spend = await api.rewards.create({
      name: "大件",
      value: (balances.spendableLevelXp - 10) * 5,
      payWithActive: false,
    });
    await api.rewards.redeem({
      rewardId: spend.id,
      payment: { strategy: "level_first" },
      idempotencyKey: key(),
    });
    expect((await api.rewards.balances()).spendableLevelXp).toBe(10);

    const trip = (await levelRewards(api)).find((r) => r.level === 20)!;
    await expect(
      api.rewards.levelRewards.claim({ levelRewardId: trip.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ message: "level_reward.insufficient_level" });
    expect((await api.rewards.balances()).spendableLevelXp).toBe(10);
  });

  it("manages level rewards", async () => {
    const { api } = await seeded();
    await api.rewards.levelRewards.create({ level: 15, name: "新耳机", emoji: "🎧" });
    await expect(
      api.rewards.levelRewards.create({ level: 15, name: "重复" }),
    ).rejects.toMatchObject({ message: "level_reward.level_taken" });
    const headphones = (await levelRewards(api)).find((r) => r.level === 15)!;
    await api.rewards.levelRewards.update({
      id: headphones.id,
      patch: { level: 16, name: "降噪耳机" },
    });
    expect((await levelRewards(api)).find((r) => r.id === headphones.id)).toMatchObject({
      level: 16,
      name: "降噪耳机",
    });
    await api.rewards.levelRewards.delete({ id: headphones.id });
    expect((await levelRewards(api)).some((r) => r.id === headphones.id)).toBe(false);
  });
});

describe("ownership", () => {
  it("never shows or changes another user's rewards, balances or claims", async () => {
    const a = await seeded();
    const b = await seeded();
    await earn(a.user.id, 30, 20, a.attr("french"));
    const tea = await a.api.rewards.create({ name: "奶茶", value: 100 });
    const aLevel = (await a.api.rewards.levelRewards.list())[0]!;
    const notFound = { code: "NOT_FOUND" };

    await expect(b.api.rewards.update({ id: tea.id, patch: { value: 1 } })).rejects.toMatchObject(
      notFound,
    );
    await expect(b.api.rewards.delete({ id: tea.id })).rejects.toMatchObject(notFound);
    await expect(
      b.api.rewards.redeem({
        rewardId: tea.id,
        payment: { strategy: "active_first" },
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject(notFound);
    await expect(
      b.api.rewards.levelRewards.claim({ levelRewardId: aLevel.id, idempotencyKey: key() }),
    ).rejects.toMatchObject(notFound);
    await expect(
      b.api.rewards.levelRewards.update({ id: aLevel.id, patch: { name: "x" } }),
    ).rejects.toMatchObject(notFound);
    await expect(b.api.rewards.levelRewards.delete({ id: aLevel.id })).rejects.toMatchObject(
      notFound,
    );

    expect(await b.api.rewards.list()).toEqual([]);
    expect(await b.api.rewards.history()).toEqual([]);
    expect(await b.api.rewards.balances()).toMatchObject({
      lifetimeActiveXp: 0,
      lifetimeLevelXp: 0,
    });
    expect((await b.api.character.overview()).totals.lifetimeLevelXp).toBe(0);
    expect((await b.api.rewards.levelRewards.list()).some((r) => r.id === aLevel.id)).toBe(false);

    // A's balance is untouched by B's attempts.
    expect((await a.api.rewards.balances()).spendableActiveXp).toBe(600);
  });
});
