import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { projectsRouter } from "@/modules/projects/server";
import { tasksRouter } from "@/modules/tasks/server";
import { users } from "@/shared/auth/schema";
import { createEventBus } from "@/shared/events/bus";
import type { DomainEvent } from "@/shared/events/types";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { developmentAttributes, xpAttributeCredits, xpLedger } from "../db";
import { MILESTONE_XP, PROJECT_XP, TASK_XP, xpEventTypes } from "../domain";
import { registerCharacterEventHandlers } from "./events";
import { characterRouter } from "./router";
import { applyXpEvent } from "./xp";

const { db, close } = createTestDb();

/** Routers wired to a bus with the real XP handlers; `events` records what was published. */
function setup(userId: string, options: { failAfterXp?: () => boolean } = {}) {
  const bus = createEventBus();
  registerCharacterEventHandlers(bus);
  const events: DomainEvent[] = [];
  for (const type of xpEventTypes) {
    bus.subscribe(
      type,
      (event) => {
        events.push(event);
        if (options.failAfterXp?.()) throw new Error("downstream handler failed");
      },
      { name: "test.recorder" },
    );
  }
  const ctx = { db, bus, userId, resHeaders: null };
  return {
    tasks: createCallerFactory(tasksRouter)(ctx),
    projects: createCallerFactory(projectsRouter)(ctx),
    character: createCallerFactory(characterRouter)(ctx),
    events,
  };
}

const ledger = (userId: string) =>
  db
    .select()
    .from(xpLedger)
    .where(sql`${xpLedger.userId} = ${userId}`)
    .orderBy(xpLedger.createdAt, xpLedger.id);

const credits = (userId: string) =>
  db
    .select()
    .from(xpAttributeCredits)
    .where(sql`${xpAttributeCredits.userId} = ${userId}`)
    .orderBy(xpAttributeCredits.createdAt, xpAttributeCredits.id);

async function seeded() {
  const user = await createSeededUser(db);
  const api = setup(user.id);
  const areas = await listAreas(db, user.id);
  const area = (key: string) => areas.find((a) => a.systemKey === key)!.id;
  const attributes = await api.character.attributes.list();
  const attr = (key: string) => attributes.find((a) => a.systemKey === key)!.id;
  return { user, api, area, attr };
}

/** XP per attribute id from the overview (active attributes). */
async function attributeXp(api: ReturnType<typeof setup>) {
  const overview = await api.character.overview();
  return Object.fromEntries(overview.attributes.map((a) => [a.id, a.xp]));
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("development attributes", () => {
  it("seeds editable examples, unrelated to the areas", async () => {
    const { api } = await seeded();
    const attributes = await api.character.attributes.list();
    expect(attributes.map((a) => [a.systemKey, a.name, a.onRadar, a.archivedAt])).toEqual([
      ["french", null, true, null],
      ["english", null, true, null],
      ["reading", null, true, null],
      ["strength", null, true, null],
      ["cardio", null, true, null],
      ["discipline", null, true, null],
    ]);
  });

  it("creates, renames, reorders, archives and deletes attributes", async () => {
    const { api, attr } = await seeded();
    const sql = await api.character.attributes.create({ name: "SQL", icon: "🗄️", color: "teal" });
    expect(sql).toMatchObject({ name: "SQL", icon: "🗄️", color: "teal", xp: 0, onRadar: true });
    const order = async () => (await api.character.attributes.list()).map((a) => a.id);
    expect((await order()).at(-1)).toBe(sql.id);

    await api.character.attributes.move({ id: sql.id, direction: "up" });
    expect((await order()).at(-2)).toBe(sql.id);
    await api.character.attributes.move({ id: attr("french"), direction: "up" }); // already first
    expect((await order())[0]).toBe(attr("french"));

    await api.character.attributes.update({ id: attr("french"), patch: { name: "French" } });
    await api.character.attributes.update({ id: sql.id, patch: { onRadar: false } });
    await api.character.attributes.update({ id: attr("english"), patch: { archived: true } });
    const list = await api.character.attributes.list();
    expect(list.find((a) => a.id === attr("french"))).toMatchObject({
      systemKey: "french",
      name: "French",
    });
    expect(list.find((a) => a.id === sql.id)!.onRadar).toBe(false);
    expect(list.find((a) => a.id === attr("english"))!.archivedAt).not.toBeNull();
    // Active attributes only on the overview.
    expect((await api.character.overview()).attributes.map((a) => a.id)).not.toContain(
      attr("english"),
    );

    // Unused attributes can be deleted; ones with XP only archived.
    await api.character.attributes.delete({ id: sql.id });
    expect((await order()).includes(sql.id)).toBe(false);
    const task = await api.tasks.create({
      title: "背单词",
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    await expect(api.character.attributes.delete({ id: attr("french") })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "attribute.has_xp",
    });
  });
});

describe("task development contributions", () => {
  it("keeps area and contributions independent", async () => {
    const { api, area, attr } = await seeded();
    const task = await api.tasks.create({
      title: "用法语读 30 页书",
      areaId: area("learning"),
      contributions: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 2 },
      ],
    });
    expect(task.areaId).toBe(area("learning"));
    expect(task.contributions).toEqual([
      { attributeId: attr("french"), weight: 3 },
      { attributeId: attr("reading"), weight: 2 },
    ]);

    // Changing the area does not touch the contributions, and the other way round.
    await api.tasks.update({ id: task.id, patch: { areaId: area("personal") } });
    expect((await api.tasks.byId({ id: task.id })).contributions).toHaveLength(2);
    await api.tasks.update({ id: task.id, patch: { contributions: [] } });
    expect(await api.tasks.byId({ id: task.id })).toMatchObject({
      areaId: area("personal"),
      contributions: [],
    });
  });

  it("validates attribute ownership, archived attributes and duplicates", async () => {
    const { api, attr } = await seeded();
    const other = await seeded();
    await expect(
      api.tasks.create({
        title: "x",
        contributions: [{ attributeId: other.attr("french"), weight: 2 }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "attribute.not_found" });
    await expect(
      api.tasks.create({
        title: "x",
        contributions: [
          { attributeId: attr("french"), weight: 2 },
          { attributeId: attr("french"), weight: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const task = await api.tasks.create({
      title: "有氧",
      contributions: [{ attributeId: attr("cardio"), weight: 2 }],
    });
    await api.character.attributes.update({ id: attr("cardio"), patch: { archived: true } });
    await expect(
      api.tasks.update({
        id: task.id,
        patch: { contributions: [{ attributeId: attr("cardio"), weight: 3 }] },
      }),
    ).resolves.toBeTruthy(); // already on the task: may stay
    await expect(
      api.tasks.create({ title: "y", contributions: [{ attributeId: attr("cardio"), weight: 2 }] }),
    ).rejects.toMatchObject({ message: "attribute.archived" });
  });
});

describe("overall XP vs attribute XP", () => {
  it("earns overall XP only for a task without contributions", async () => {
    const { user, api, area } = await seeded();
    const task = await api.tasks.create({ title: "回复银行邮件", areaId: area("admin") });
    await api.tasks.complete({ id: task.id });

    const overview = await api.character.overview();
    expect(overview.totals.lifetimeActiveXp).toBe(TASK_XP.base);
    expect(overview.totals.growthXp).toBe(0);
    expect(overview.attributes.every((a) => a.xp === 0)).toBe(true);
    expect(await credits(user.id)).toHaveLength(0);
  });

  it("credits one attribute with the whole amount", async () => {
    const { api, area, attr } = await seeded();
    const task = await api.tasks.create({
      title: "骑自行车 45 分钟",
      areaId: area("health"),
      priority: 2,
      contributions: [{ attributeId: attr("cardio"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    const amount = TASK_XP.base + 2 * TASK_XP.perPriority;
    expect((await attributeXp(api))[attr("cardio")]).toBe(amount);
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(amount);
  });

  it("splits — never duplicates — the overall XP across several attributes", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "用法语读 30 页书",
      priority: 2, // 10 + 2 × 5 = 20 XP
      contributions: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 2 },
      ],
    });
    await api.tasks.complete({ id: task.id });

    const overview = await api.character.overview();
    expect(overview.totals.lifetimeActiveXp).toBe(20); // not 20 + 12 + 8
    expect(overview.totals.growthXp).toBe(20);
    const xp = await attributeXp(api);
    expect([xp[attr("french")], xp[attr("reading")]]).toEqual([12, 8]);
    expect(await ledger(user.id)).toHaveLength(1);

    const [entry] = (await api.character.history({})).entries;
    expect(entry!.amount).toBe(20);
    expect(entry!.credits.map(({ attributeId, amount }) => ({ attributeId, amount }))).toEqual([
      { attributeId: attr("french"), amount: 12 },
      { attributeId: attr("reading"), amount: 8 },
    ]);
  });

  it("counts user-created attributes (no system key) in lifetime Growth XP", async () => {
    // Regression: the legacy test was NULL for attributes without a system key, which dropped
    // their growth from the Growth XP total while Level XP still counted it.
    const { api } = await seeded();
    const python = await api.character.attributes.create({ name: "Python", color: "teal" });
    const task = await api.tasks.create({
      title: "用 Python 写周报脚本",
      contributions: [{ attributeId: python.id, weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });

    const { totals } = await api.character.overview();
    expect(totals).toMatchObject({ growthXp: TASK_XP.base, lifetimeLevelXp: TASK_XP.base });
    expect(totals.legacyGrowthXp).toBe(0);
  });

  it("accumulates attribute XP separately over several tasks", async () => {
    const { api, attr } = await seeded();
    const make = (title: string, contributions: { attributeId: string; weight: number }[]) =>
      api.tasks.create({ title, contributions });
    for (const task of [
      await make("法语口语", [{ attributeId: attr("french"), weight: 2 }]),
      await make("英语听力", [{ attributeId: attr("english"), weight: 2 }]),
      await make("法语阅读", [
        { attributeId: attr("french"), weight: 1 },
        { attributeId: attr("reading"), weight: 1 },
      ]),
      await make("整理房间", []),
    ]) {
      await api.tasks.complete({ id: task.id });
    }
    const xp = await attributeXp(api);
    expect(xp[attr("french")]).toBe(15);
    expect(xp[attr("english")]).toBe(10);
    expect(xp[attr("reading")]).toBe(5);
    const overview = await api.character.overview();
    expect(overview.totals.lifetimeActiveXp).toBe(40);
    expect(overview.totals.growthXp).toBe(30);

    const french = await api.character.history({ attributeId: attr("french") });
    expect(french.entries.map((e) => e.sourceTitle)).toEqual(["法语阅读", "法语口语"]);
  });
});

describe("reversals and idempotency", () => {
  it("reverses exactly the original contributions, even after they changed", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "法语写作",
      priority: 2,
      contributions: [
        { attributeId: attr("french"), weight: 3 },
        { attributeId: attr("reading"), weight: 2 },
      ],
    });
    await api.tasks.complete({ id: task.id });
    // Contributions edited after completion: the reversal still undoes 12 + 8.
    await api.tasks.update({
      id: task.id,
      patch: { contributions: [{ attributeId: attr("english"), weight: 2 }] },
    });
    await api.tasks.reopen({ id: task.id });

    const xp = await attributeXp(api);
    expect([xp[attr("french")], xp[attr("reading")], xp[attr("english")]]).toEqual([0, 0, 0]);
    const rows = await credits(user.id);
    expect(rows.map((r) => r.amount)).toEqual([12, 8, -12, -8]);

    // Completing again uses the current contributions.
    await api.tasks.complete({ id: task.id });
    expect((await attributeXp(api))[attr("english")]).toBe(20);
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(20);
  });

  it("treats completed → cancelled as a reversal of overall and attribute XP", async () => {
    const { api, attr } = await seeded();
    const statuses = await api.tasks.statuses.list();
    const cancelled = statuses.find((s) => s.systemKey === "cancelled")!;
    const task = await api.tasks.create({
      title: "力量训练",
      contributions: [{ attributeId: attr("strength"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    await api.tasks.setStatus({ id: task.id, statusId: cancelled.id });
    const overview = await api.character.overview();
    expect([overview.totals.lifetimeActiveXp, overview.totals.growthXp]).toEqual([0, 0]);
  });

  it("is idempotent under duplicate event delivery, credits included", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "一次",
      contributions: [
        { attributeId: attr("french"), weight: 1 },
        { attributeId: attr("reading"), weight: 1 },
      ],
    });
    await api.tasks.complete({ id: task.id });
    const event = api.events.find((e) => e.type === "task.completed")!;

    await applyXpEvent(db, event);
    await applyXpEvent(db, event);
    await Promise.all(Array.from({ length: 5 }, () => applyXpEvent(db, event)));
    await applyXpEvent(db, { ...event, id: crypto.randomUUID() });
    expect(await ledger(user.id)).toHaveLength(1);
    expect(await credits(user.id)).toHaveLength(2);

    await api.tasks.reopen({ id: task.id });
    const reopened = api.events.find((e) => e.type === "task.reopened")!;
    await applyXpEvent(db, reopened);
    await applyXpEvent(db, { ...reopened, id: crypto.randomUUID() });
    expect((await ledger(user.id)).map((r) => r.kind)).toEqual(["grant", "reversal"]);
    expect(await credits(user.id)).toHaveLength(4);
    expect((await api.character.overview()).totals.growthXp).toBe(0);
  });

  it("grants once when a failed attempt is retried", async () => {
    const user = await createSeededUser(db);
    let fail = true;
    const api = setup(user.id, { failAfterXp: () => fail });
    const [french] = await api.character.attributes.list();
    const task = await api.tasks.create({
      title: "重试",
      contributions: [{ attributeId: french!.id, weight: 2 }],
    });
    await expect(api.tasks.complete({ id: task.id })).rejects.toThrow();
    expect(await ledger(user.id)).toHaveLength(0);
    expect(await credits(user.id)).toHaveLength(0);
    fail = false;
    await api.tasks.complete({ id: task.id });
    await api.tasks.complete({ id: task.id });
    expect(await ledger(user.id)).toHaveLength(1);
    expect(await credits(user.id)).toHaveLength(1);
  });

  it("keeps XP when a completed task is deleted, restored or purged", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "保留经验",
      contributions: [{ attributeId: attr("reading"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });
    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.restore({ id: task.id });
    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.purge({ id: task.id });

    expect(await ledger(user.id)).toHaveLength(1);
    expect(await credits(user.id)).toHaveLength(1);
    expect((await attributeXp(api))[attr("reading")]).toBe(TASK_XP.base);
    expect((await api.character.history({})).entries[0]).toMatchObject({
      sourceTitle: "保留经验",
      credits: [{ attributeId: attr("reading"), amount: TASK_XP.base }],
    });
  });
});

describe("history and the radar source", () => {
  it("keeps history through renames and archiving; the overview shows active attributes", async () => {
    const { api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "英语播客",
      contributions: [{ attributeId: attr("english"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });

    await api.character.attributes.update({ id: attr("english"), patch: { name: "English" } });
    await api.character.attributes.update({ id: attr("english"), patch: { archived: true } });

    const [entry] = (await api.character.history({})).entries;
    expect(entry!.credits.map(({ attributeId, amount }) => ({ attributeId, amount }))).toEqual([
      { attributeId: attr("english"), amount: TASK_XP.base },
    ]);
    const english = (await api.character.attributes.list()).find((a) => a.id === attr("english"))!;
    expect(english).toMatchObject({ name: "English", xp: TASK_XP.base });
    expect(english.archivedAt).not.toBeNull();

    const overview = await api.character.overview();
    expect(overview.attributes.map((a) => a.systemKey)).toEqual([
      "french",
      "reading",
      "strength",
      "cardio",
      "discipline",
    ]);
    // Archived XP still counts towards development XP and the overall total.
    expect([overview.totals.lifetimeActiveXp, overview.totals.growthXp]).toEqual([
      TASK_XP.base,
      TASK_XP.base,
    ]);

    // Reactivating brings it back with its XP.
    await api.character.attributes.update({ id: attr("english"), patch: { archived: false } });
    expect(
      (await api.character.overview()).attributes.find((a) => a.id === attr("english"))!.xp,
    ).toBe(TASK_XP.base);
  });

  it("exposes radar inclusion as attribute data, not as stored chart data", async () => {
    const { api, attr } = await seeded();
    await api.character.attributes.update({ id: attr("strength"), patch: { onRadar: false } });
    const overview = await api.character.overview();
    expect(overview.attributes.filter((a) => a.onRadar).map((a) => a.systemKey)).toEqual([
      "french",
      "english",
      "reading",
      "cardio",
      "discipline",
    ]);
    // Nothing else exists for the radar: no table, no stored values.
    const tables = await db.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' and tablename like '%radar%'`,
    );
    expect(tables.rows).toEqual([]);
  });
});

describe("M6 compatibility", () => {
  it("reverses a legacy (area-derived) M6 grant through its migrated credit", async () => {
    const { user, api } = await seeded();
    // State as left by migrations 0007/0008: an archived legacy attribute, an M6 grant that
    // recorded it, and the credit materialised from that record.
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
    const task = await api.tasks.create({ title: "M6 时完成的任务" });
    const [grant] = await db
      .insert(xpLedger)
      .values({
        userId: user.id,
        kind: "grant",
        amount: 10,
        ruleKey: "task.completion",
        sourceEventId: crypto.randomUUID(),
        sourceEventType: "task.completed",
        sourceType: "task",
        sourceId: task.id,
        sourceTitle: "M6 时完成的任务",
        attributeId: legacy!.id,
        cycle: 0,
      })
      .returning();
    await db.insert(xpAttributeCredits).values({
      userId: user.id,
      ledgerEntryId: grant!.id,
      attributeId: legacy!.id,
      amount: 10,
    });
    const statuses = await api.tasks.statuses.list();
    // Bring the task to "completed" (already granted in M6: no second grant), then reopen.
    await api.tasks.setStatus({
      id: task.id,
      statusId: statuses.find((st) => st.systemKey === "done")!.id,
    });
    expect(await ledger(user.id)).toHaveLength(1);
    expect((await api.character.attributes.list()).find((a) => a.id === legacy!.id)!.xp).toBe(10);

    await api.tasks.reopen({ id: task.id });
    const rows = await ledger(user.id);
    expect(rows.map((r) => [r.kind, r.amount, r.attributeId])).toEqual([
      ["grant", 10, legacy!.id],
      ["reversal", -10, legacy!.id],
    ]);
    expect((await api.character.attributes.list()).find((a) => a.id === legacy!.id)!.xp).toBe(0);
    expect(
      (await api.character.history({})).entries[0]!.credits.map(({ attributeId, amount }) => ({
        attributeId,
        amount,
      })),
    ).toEqual([{ attributeId: legacy!.id, amount: -10 }]);
  });
});

describe("projects and milestones", () => {
  it("grant and reverse overall XP only, whatever the project's area", async () => {
    const { user, api, area } = await seeded();
    const project = await api.projects.create({ name: "官网", areaId: area("work"), priority: 2 });
    const milestone = await api.projects.milestones.create({ projectId: project.id, name: "M" });
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: true });
    await api.projects.update({ id: project.id, patch: { status: "completed" } });
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(
      MILESTONE_XP + PROJECT_XP.base + 2 * PROJECT_XP.perPriority,
    );
    await api.projects.milestones.setCompleted({ id: milestone.id, completed: false });
    await api.projects.update({ id: project.id, patch: { status: "active" } });
    expect((await api.character.overview()).totals.lifetimeActiveXp).toBe(0);
    expect(await credits(user.id)).toHaveLength(0);
  });
});

describe("ledger integrity and ownership", () => {
  it("rejects updates and direct deletes of ledger and credits, but follows the user", async () => {
    const { user, api, attr } = await seeded();
    const task = await api.tasks.create({
      title: "账本",
      contributions: [{ attributeId: attr("french"), weight: 2 }],
    });
    await api.tasks.complete({ id: task.id });

    await expect(db.update(xpLedger).set({ amount: 999 })).rejects.toThrow();
    await expect(db.delete(xpLedger)).rejects.toThrow();
    await expect(db.update(xpAttributeCredits).set({ amount: 999 })).rejects.toThrow();
    await expect(db.delete(xpAttributeCredits)).rejects.toThrow();

    await db.delete(users).where(sql`${users.id} = ${user.id}`);
    expect(await ledger(user.id)).toHaveLength(0);
    expect(await credits(user.id)).toHaveLength(0);
  });

  it("never shows or changes another user's attributes or XP", async () => {
    const a = await seeded();
    const b = await seeded();
    const task = await a.api.tasks.create({
      title: "A 的任务",
      contributions: [{ attributeId: a.attr("french"), weight: 2 }],
    });
    await a.api.tasks.complete({ id: task.id });
    const notFound = { code: "NOT_FOUND" };
    const french = a.attr("french");

    await expect(
      b.api.character.attributes.update({ id: french, patch: { name: "x" } }),
    ).rejects.toMatchObject(notFound);
    await expect(
      b.api.character.attributes.update({ id: french, patch: { archived: true } }),
    ).rejects.toMatchObject(notFound);
    await expect(
      b.api.character.attributes.move({ id: french, direction: "down" }),
    ).rejects.toMatchObject(notFound);
    await expect(b.api.character.attributes.delete({ id: french })).rejects.toMatchObject(notFound);
    expect((await b.api.character.attributes.list()).some((x) => x.id === french)).toBe(false);
    expect((await b.api.character.history({ attributeId: french })).entries).toEqual([]);
    expect((await b.api.character.overview()).totals.lifetimeActiveXp).toBe(0);

    const list = await a.api.character.attributes.list();
    expect(list.find((x) => x.id === french)).toMatchObject({ name: null, xp: TASK_XP.base });
  });
});
