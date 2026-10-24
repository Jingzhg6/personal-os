import { TRPCError } from "@trpc/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser, createUser } from "@/test/factories";

import { registerAreasEventHandlers } from "./events";
import { listAreas } from "./repository";
import { areasRouter } from "./router";

const { db, close } = createTestDb();
const callerFor = (userId: string | null) =>
  createCallerFactory(areasRouter)({ db, bus: createEventBus(), userId, resHeaders: null });

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("areas", () => {
  it("seeds the default areas when a user registers", async () => {
    const bus = createEventBus();
    registerAreasEventHandlers(bus);
    const user = await createUser(db);
    await bus.publish(
      { type: "user.registered", userId: user.id, payload: { email: user.email, name: user.name } },
      { db },
    );

    const areas = await listAreas(db, user.id);
    expect(areas.map((a) => a.systemKey)).toEqual([
      "personal",
      "learning",
      "health",
      "work",
      "business",
      "admin",
    ]);
    expect(areas.every((a) => a.name === null)).toBe(true);
  });

  it("creates, renames, recolours and resets areas", async () => {
    const user = await createSeededUser(db);
    const api = callerFor(user.id);

    const created = await api.create({ name: "法语", color: "violet", icon: "book" });
    expect((await api.list()).at(-1)?.id).toBe(created.id);

    const learning = (await api.list()).find((a) => a.systemKey === "learning")!;
    const renamed = await api.update({
      id: learning.id,
      name: "学习与成长",
      color: "teal",
      icon: "leaf",
    });
    expect(renamed).toMatchObject({
      name: "学习与成长",
      color: "teal",
      icon: "leaf",
      systemKey: "learning",
    });

    expect((await api.update({ id: learning.id, name: null })).name).toBeNull();
    await expect(api.update({ id: created.id, name: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("reorders areas one step at a time", async () => {
    const user = await createSeededUser(db);
    const api = callerFor(user.id);
    const before = await api.list();

    const after = await api.move({ id: before[2]!.id, direction: "up" });
    expect(after.map((a) => a.id)).toEqual([
      before[0]!.id,
      before[2]!.id,
      before[1]!.id,
      ...before.slice(3).map((a) => a.id),
    ]);

    const unchanged = await api.move({ id: after[0]!.id, direction: "up" });
    expect(unchanged.map((a) => a.id)).toEqual(after.map((a) => a.id));
  });

  it("deletes an area", async () => {
    const user = await createSeededUser(db);
    const api = callerFor(user.id);
    const [first] = await api.list();
    await api.delete({ id: first!.id });
    expect((await api.list()).some((a) => a.id === first!.id)).toBe(false);
  });

  it("never exposes or changes another user's areas", async () => {
    const owner = await createSeededUser(db);
    const intruder = await createSeededUser(db);
    const [area] = await callerFor(owner.id).list();
    const api = callerFor(intruder.id);

    expect((await api.list()).some((a) => a.id === area!.id)).toBe(false);
    await expect(api.update({ id: area!.id, name: "hacked" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(api.delete({ id: area!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api.move({ id: area!.id, direction: "down" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires authentication", async () => {
    await expect(callerFor(null).list()).rejects.toBeInstanceOf(TRPCError);
  });
});
