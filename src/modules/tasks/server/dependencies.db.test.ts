import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { tasksRouter } from "./router";

const { db, close } = createTestDb();
const TODAY = "2026-10-25";

function caller(userId: string) {
  return createCallerFactory(tasksRouter)({ db, bus: createEventBus(), userId, resHeaders: null });
}

const timelineQuery = {
  today: TODAY,
  sort: "manual" as const,
  includeSubtasks: false,
  filter: {},
};

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("task dependencies", () => {
  it("links tasks both ways and counts open blockers", async () => {
    const user = await createSeededUser(db);
    const tasks = caller(user.id);
    const design = await tasks.create({ title: "设计", dueDate: "2026-11-01" });
    const build = await tasks.create({ title: "开发", startDate: "2026-11-02" });
    const docs = await tasks.create({ title: "文档" });

    await tasks.dependencies.add({ blockingTaskId: design.id, blockedTaskId: build.id });
    await tasks.dependencies.add({ blockingTaskId: docs.id, blockedTaskId: build.id });
    // Adding the same edge again is a no-op.
    await tasks.dependencies.add({ blockingTaskId: design.id, blockedTaskId: build.id });

    const detail = await tasks.byId({ id: build.id });
    expect(detail.blockedBy.map((d) => d.title)).toEqual(["设计", "文档"]);
    expect(detail.blocking).toEqual([]);
    expect(detail.openBlockerCount).toBe(2);
    expect((await tasks.byId({ id: design.id })).blocking.map((d) => d.title)).toEqual(["开发"]);

    await tasks.complete({ id: design.id });
    expect((await tasks.byId({ id: build.id })).openBlockerCount).toBe(1);

    await tasks.dependencies.remove({ blockingTaskId: docs.id, blockedTaskId: build.id });
    const after = await tasks.byId({ id: build.id });
    expect(after.blockedBy.map((d) => d.title)).toEqual(["设计"]);
    expect(after.openBlockerCount).toBe(0);
  });

  it("rejects self-dependencies and cycles", async () => {
    const user = await createSeededUser(db);
    const tasks = caller(user.id);
    const a = await tasks.create({ title: "A" });
    const b = await tasks.create({ title: "B" });
    const c = await tasks.create({ title: "C" });

    await expect(
      tasks.dependencies.add({ blockingTaskId: a.id, blockedTaskId: a.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "dependency.self" });

    await tasks.dependencies.add({ blockingTaskId: a.id, blockedTaskId: b.id });
    await tasks.dependencies.add({ blockingTaskId: b.id, blockedTaskId: c.id });
    await expect(
      tasks.dependencies.add({ blockingTaskId: c.id, blockedTaskId: a.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "dependency.cycle" });
    await expect(
      tasks.dependencies.add({ blockingTaskId: b.id, blockedTaskId: a.id }),
    ).rejects.toMatchObject({ message: "dependency.cycle" });
  });

  it("hides dependencies on trashed tasks and drops them when purged", async () => {
    const user = await createSeededUser(db);
    const tasks = caller(user.id);
    const a = await tasks.create({ title: "A" });
    const b = await tasks.create({ title: "B" });
    await tasks.dependencies.add({ blockingTaskId: a.id, blockedTaskId: b.id });

    await tasks.delete({ id: a.id });
    const hidden = await tasks.byId({ id: b.id });
    expect(hidden.blockedBy).toEqual([]);
    expect(hidden.openBlockerCount).toBe(0);
    await expect(
      tasks.dependencies.add({ blockingTaskId: a.id, blockedTaskId: b.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await tasks.trash.restore({ id: a.id });
    expect((await tasks.byId({ id: b.id })).blockedBy.map((d) => d.title)).toEqual(["A"]);

    await tasks.delete({ id: a.id });
    await tasks.trash.purge({ id: a.id });
    expect((await tasks.byId({ id: b.id })).blockedBy).toEqual([]);
  });

  it("returns the timeline with dependencies between listed tasks only", async () => {
    const user = await createSeededUser(db);
    const tasks = caller(user.id);
    const a = await tasks.create({ title: "A", dueDate: "2026-11-01" });
    const b = await tasks.create({ title: "B", startDate: "2026-11-02", dueDate: "2026-11-05" });
    const sub = await tasks.create({ title: "子任务", parentTaskId: b.id });
    await tasks.dependencies.add({ blockingTaskId: a.id, blockedTaskId: b.id });
    await tasks.dependencies.add({ blockingTaskId: sub.id, blockedTaskId: a.id });

    const timeline = await tasks.timeline(timelineQuery);
    expect(timeline.tasks.map((t) => t.title)).toEqual(["A", "B"]);
    expect(timeline.dependencies).toEqual([{ blockingTaskId: a.id, blockedTaskId: b.id }]);
  });

  it("only links the user's own tasks", async () => {
    const owner = await createSeededUser(db);
    const other = await createSeededUser(db);
    const mine = await caller(owner.id).create({ title: "mine" });
    const theirs = await caller(other.id).create({ title: "theirs" });

    await expect(
      caller(owner.id).dependencies.add({ blockingTaskId: theirs.id, blockedTaskId: mine.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller(other.id).dependencies.remove({
      blockingTaskId: mine.id,
      blockedTaskId: theirs.id,
    });
  });
});
