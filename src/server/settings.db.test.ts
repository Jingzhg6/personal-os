import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { weekStart } from "@/modules/dashboard/domain";
import { taskRecurrences, tasks } from "@/modules/tasks/db";
import { todayIn } from "@/modules/tasks/domain";
import { generateNextInstance, listInstances } from "@/modules/tasks/server";
import { users } from "@/shared/auth/schema";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * Settings through the real routers: the profile name, the time zone and the week start, each
 * scoped to the caller, and how other modules read them — a changed zone moves "today" for
 * dashboards, but recurring series and schedule rules keep the zone they were created in.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);

async function setup(timeZone = "UTC") {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone });
  return { user, api };
}

const nameOf = async (id: string) =>
  (await db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0]!.name;

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("profile", () => {
  it("renames only the caller, trimmed", async () => {
    const a = await setup();
    const b = await setup();
    const before = await nameOf(b.user.id);
    expect(await a.api.settings.updateProfile({ name: "  小明  " })).toEqual({ name: "小明" });
    expect(await nameOf(a.user.id)).toBe("小明");
    expect(await nameOf(b.user.id)).toBe(before);
  });

  it("rejects an empty or overlong name and anonymous callers", async () => {
    const { api, user } = await setup();
    const before = await nameOf(user.id);
    await expect(api.settings.updateProfile({ name: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(api.settings.updateProfile({ name: "x".repeat(101) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await nameOf(user.id)).toBe(before);
    const anonymous = caller({ db, bus, userId: null, resHeaders: null });
    await expect(anonymous.settings.updateProfile({ name: "黑客" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("time zone and week start", () => {
  it("are stored per user and validated", async () => {
    const a = await setup("Asia/Shanghai");
    const b = await setup("Europe/Paris");
    await a.api.settings.update({ weekStartsOn: 0 });
    expect(await a.api.settings.get()).toMatchObject({
      timeZone: "Asia/Shanghai",
      weekStartsOn: 0,
    });
    expect(await b.api.settings.get()).toMatchObject({ timeZone: "Europe/Paris", weekStartsOn: 1 });
    await expect(a.api.settings.update({ timeZone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(a.api.settings.update({ weekStartsOn: 7 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await a.api.settings.get()).timeZone).toBe("Asia/Shanghai");
  });

  it("drive the dashboard's 本周 (local today, chosen first weekday)", async () => {
    // Kiritimati is UTC+14: its "today" is often a day ahead of UTC.
    const { api } = await setup("Pacific/Kiritimati");
    for (const weekStartsOn of [1, 0, 6]) {
      await api.settings.update({ weekStartsOn });
      const overview = await api.dashboard.overview();
      expect(overview.today).toBe(todayIn("Pacific/Kiritimati"));
      expect(overview.week.from).toBe(weekStart(overview.today, weekStartsOn));
    }
  });
});

describe("changing the time zone later", () => {
  it("keeps an existing recurring series in its own zone; new series take the new one", async () => {
    const { api, user } = await setup("Asia/Shanghai");
    const first = await api.tasks.create({ title: "冥想", dueDate: "2026-10-20" });
    const recurrence = await api.tasks.recurrence.set({
      taskId: first.id,
      rule: { frequency: "daily", interval: 1 },
      mode: "fixed",
    });

    await api.settings.update({ timeZone: "America/Los_Angeles" });
    expect((await api.tasks.recurrence.get({ taskId: first.id }))!.timeZone).toBe("Asia/Shanghai");

    // 2026-11-04 17:00 UTC: 09:00 on the 4th in Los Angeles, already the 5th in Shanghai.
    const now = new Date("2026-11-04T17:00:00Z");
    const completed = (await api.tasks.statuses.list()).find((s) => s.category === "completed")!;
    await db
      .update(tasks)
      .set({ completedAt: now, statusId: completed.id })
      .where(eq(tasks.id, first.id));
    await generateNextInstance({ db, bus }, user.id, first.id, now);
    const [, next] = await listInstances(db, user.id, recurrence.id);
    expect(next!.dueDate).toBe("2026-11-05");
    const [row] = await db
      .select()
      .from(taskRecurrences)
      .where(eq(taskRecurrences.id, recurrence.id));
    expect(row!.timezone).toBe("Asia/Shanghai");

    const other = await api.tasks.create({
      title: "散步",
      dueDate: todayIn("America/Los_Angeles"),
    });
    await api.tasks.recurrence.set({
      taskId: other.id,
      rule: { frequency: "daily", interval: 1 },
      mode: "fixed",
    });
    expect((await api.tasks.recurrence.get({ taskId: other.id }))!.timeZone).toBe(
      "America/Los_Angeles",
    );
  });

  it("keeps a schedule rule in the zone it was created in, also when it is edited", async () => {
    const { api } = await setup("Europe/Paris");
    const config = {
      name: "每天提醒",
      trigger: { type: "schedule" as const, schedule: { kind: "daily" as const, time: "09:00" } },
      actions: [{ type: "notify" as const, title: "记录" }],
    };
    const created = await api.automation.rules.create(config);
    expect(created.timeZone).toBe("Europe/Paris");
    await api.settings.update({ timeZone: "Asia/Tokyo" });
    // The editor sends the rule's own zone back (rule-builder `fixedZone`).
    const edited = await api.automation.rules.update({
      id: created.id,
      config: { ...config, name: "每天提醒（改）", timeZone: created.timeZone },
    });
    expect(edited.timeZone).toBe("Europe/Paris");
  });
});
