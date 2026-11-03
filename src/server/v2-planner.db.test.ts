import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * V2 (ADR 0028) through the real routers: investments in the asset totals (cost and value kept
 * apart, unvalued ones at cost, nothing counted twice), the dashboard panel order, and schedule
 * blocks as views of a task (deleting a block keeps the task; purging the task removes them).
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);

async function setup() {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone: "UTC" });
  return { user, api };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("investments", () => {
  it("are added to assets and net worth once, at value or else at cost", async () => {
    const { api } = await setup();
    await api.finance.setBaseCurrency({ baseCurrency: "EUR" });
    const etf = await api.finance.investments.create({
      name: "ETF",
      kind: "etf",
      costAmount: "1000.00",
      purchaseDate: "2026-01-10",
      quantity: "12.5",
      currentValue: "1200.50",
    });
    await api.finance.investments.create({
      name: "基金",
      kind: "fund",
      costAmount: "300",
      purchaseDate: "2026-02-01",
    });
    const overview = await api.finance.overview();
    expect(overview.investments).toEqual({
      count: 2,
      cost: "1300.00",
      value: "1500.50",
      unvalued: 1,
      otherCurrency: 0,
    });
    expect(overview.assets).toBe("1500.50");
    expect(overview.netWorth).toBe("1500.50");

    // The edit form sends every field back as it was loaded.
    const [loaded] = await api.finance.investments.list();
    await api.finance.investments.update({
      id: etf.id,
      patch: {
        name: loaded!.name,
        kind: loaded!.kind,
        costAmount: loaded!.costAmount,
        purchaseDate: loaded!.purchaseDate,
        quantity: loaded!.quantity,
        currentValue: "1180.5",
        notes: null,
      },
    });
    expect(loaded!.quantity).toBe("12.5");
    await api.finance.investments.update({ id: etf.id, patch: { currentValue: null } });
    expect((await api.finance.overview()).assets).toBe("1300.00");
    await api.finance.investments.delete({ id: etf.id });
    expect((await api.finance.investments.list()).map((i) => i.name)).toEqual(["基金"]);
  });

  it("reject bad amounts and other users", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      a.api.finance.investments.create({
        name: "x",
        kind: "stock",
        costAmount: "-1",
        purchaseDate: "2026-01-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const mine = await a.api.finance.investments.create({
      name: "x",
      kind: "stock",
      costAmount: "1",
      purchaseDate: "2026-01-01",
    });
    expect(await b.api.finance.investments.list()).toEqual([]);
    await expect(b.api.finance.investments.delete({ id: mine.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("dashboard panel order", () => {
  it("is saved per user and reset with null", async () => {
    const a = await setup();
    const b = await setup();
    await a.api.settings.update({ dashboardPanels: ["week", "character", "xp"] });
    expect((await a.api.settings.get()).dashboardPanels).toEqual(["week", "character", "xp"]);
    expect((await b.api.settings.get()).dashboardPanels).toBeNull();
    await a.api.settings.update({ dashboardPanels: null });
    expect((await a.api.settings.get()).dashboardPanels).toBeNull();
  });
});

describe("schedule blocks", () => {
  it("are views of a task: many per task, deleting one keeps the task, purge removes all", async () => {
    const { api } = await setup();
    const task = await api.tasks.create({ title: "写报告" });
    const range = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
    const one = await api.schedule.create({
      taskId: task.id,
      startAt: new Date("2026-11-03T09:00:00Z"),
      endAt: new Date("2026-11-03T10:00:00Z"),
    });
    await api.schedule.create({
      taskId: task.id,
      startAt: new Date("2026-11-04T00:00:00Z"),
      endAt: new Date("2026-11-06T00:00:00Z"),
      allDay: true,
    });
    expect(await api.schedule.list(range)).toHaveLength(2);
    await api.tasks.update({ id: task.id, patch: { title: "写年报" } });
    expect((await api.schedule.list(range)).map((b) => b.task.title)).toEqual(["写年报", "写年报"]);

    await api.schedule.delete({ id: one.id });
    expect(await api.schedule.list(range)).toHaveLength(1);
    expect((await api.tasks.byId({ id: task.id })).title).toBe("写年报");

    await api.tasks.delete({ id: task.id });
    expect(await api.schedule.list(range)).toHaveLength(0);
    await api.tasks.trash.restore({ id: task.id });
    expect(await api.schedule.list(range)).toHaveLength(1);
    await api.tasks.delete({ id: task.id });
    await api.tasks.trash.purge({ id: task.id });
    await api.tasks.trash.restore({ id: task.id }).catch(() => null);
    expect(await api.schedule.list(range)).toHaveLength(0);
  });

  it("reject an end before the start", async () => {
    const { api } = await setup();
    const task = await api.tasks.create({ title: "x" });
    await expect(
      api.schedule.create({
        taskId: task.id,
        startAt: new Date("2026-11-03T10:00:00Z"),
        endAt: new Date("2026-11-03T09:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
