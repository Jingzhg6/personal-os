import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import "@/shared/auth/events";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createUser } from "@/test/factories";

import { userSettings } from "../db";
import { defaultUserSettings } from "../domain";
import { registerSettingsEventHandlers } from "./events";
import { ensureUserSettings, getUserSettings, updateUserSettings } from "./repository";
import { settingsRouter } from "./router";

const { db, close } = createTestDb();
const createCaller = createCallerFactory(settingsRouter);

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("settings repository", () => {
  it("returns defaults when the user has no settings row", async () => {
    const user = await createUser(db);
    expect(await getUserSettings(db, user.id)).toEqual(defaultUserSettings);
  });

  it("upserts partial updates", async () => {
    const user = await createUser(db);
    await updateUserSettings(db, user.id, { locale: "fr" });
    const updated = await updateUserSettings(db, user.id, { timeZone: "Europe/Paris" });
    expect(updated).toEqual({ locale: "fr", timeZone: "Europe/Paris", weekStartsOn: 1 });
  });

  it("ensureUserSettings is idempotent and never overwrites existing values", async () => {
    const user = await createUser(db);
    await updateUserSettings(db, user.id, { locale: "en" });
    await ensureUserSettings(db, user.id);
    await ensureUserSettings(db, user.id);
    expect((await getUserSettings(db, user.id)).locale).toBe("en");
  });

  it("isolates users from each other", async () => {
    const a = await createUser(db);
    const b = await createUser(db);
    await updateUserSettings(db, a.id, { locale: "fr" });
    expect((await getUserSettings(db, b.id)).locale).toBe("zh-CN");
  });
});

describe("settings event handlers", () => {
  it("provisions default settings when a user registers", async () => {
    const bus = createEventBus();
    registerSettingsEventHandlers(bus);
    const user = await createUser(db);

    await bus.publish(
      { type: "user.registered", userId: user.id, payload: { email: user.email, name: user.name } },
      { db },
    );

    const rows = await db.select().from(userSettings).where(eq(userSettings.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.locale).toBe("zh-CN");
  });

  it("joins the publisher's transaction (rolled back together)", async () => {
    const bus = createEventBus();
    registerSettingsEventHandlers(bus);
    const user = await createUser(db);

    await expect(
      db.transaction(async (tx) => {
        await bus.publish(
          {
            type: "user.registered",
            userId: user.id,
            payload: { email: user.email, name: user.name },
          },
          { db: tx },
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await db.select().from(userSettings)).toHaveLength(0);
  });
});

describe("settings router", () => {
  it("rejects anonymous callers", async () => {
    const caller = createCaller({ db, userId: null, resHeaders: null });
    await expect(caller.get()).rejects.toBeInstanceOf(TRPCError);
  });

  it("updates the locale and sets the locale cookie", async () => {
    const user = await createUser(db);
    const resHeaders = new Headers();
    const caller = createCaller({ db, userId: user.id, resHeaders });

    const settings = await caller.update({ locale: "en" });

    expect(settings.locale).toBe("en");
    expect(resHeaders.get("set-cookie")).toContain("NEXT_LOCALE=en");
    expect((await caller.get()).locale).toBe("en");
  });

  it("validates input", async () => {
    const user = await createUser(db);
    const caller = createCaller({ db, userId: user.id, resHeaders: null });
    // @ts-expect-error: unsupported locale
    await expect(caller.update({ locale: "de" })).rejects.toBeInstanceOf(TRPCError);
  });
});
