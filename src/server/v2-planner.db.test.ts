import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * V2 (ADR 0028) through the real routers: the dashboard panel order, and schedule
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
