import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAreas } from "@/modules/areas/server";
import { getUserSettings } from "@/modules/settings/server";
import { listStatuses } from "@/modules/tasks/server";
import { users } from "@/shared/auth/schema";
import { createTestDb, resetDb } from "@/test/db";

import { createAuth } from "./auth";
import { createAppEventBus } from "./event-bus";

const { db, close } = createTestDb();

function makeAuth(allowSignUp = true) {
  return createAuth({
    db,
    bus: createAppEventBus(),
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: "http://localhost:3000",
    allowSignUp,
  });
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("authentication", () => {
  it("signs up a user with a UUIDv7 id and provisions settings, areas and statuses via the event bus", async () => {
    const auth = makeAuth();
    const result = await auth.api.signUpEmail({
      body: { email: "jin@example.test", password: "correct-horse", name: "Jin" },
    });

    expect(result.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    const [row] = await db.select().from(users).where(eq(users.email, "jin@example.test"));
    expect(row?.name).toBe("Jin");
    expect(await getUserSettings(db, result.user.id)).toMatchObject({ locale: "zh-CN" });
    expect(await listAreas(db, result.user.id)).toHaveLength(6);
    expect(await listStatuses(db, result.user.id)).toHaveLength(5);
  });

  it("signs in with the right password and rejects the wrong one", async () => {
    const auth = makeAuth();
    await auth.api.signUpEmail({
      body: { email: "jin@example.test", password: "correct-horse", name: "Jin" },
    });

    const ok = await auth.api.signInEmail({
      body: { email: "jin@example.test", password: "correct-horse" },
    });
    expect(ok.token).toBeTruthy();

    await expect(
      auth.api.signInEmail({ body: { email: "jin@example.test", password: "wrong-password" } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });

  it("can close sign-up", async () => {
    const auth = makeAuth(false);
    await expect(
      auth.api.signUpEmail({
        body: { email: "x@example.test", password: "correct-horse", name: "X" },
      }),
    ).rejects.toBeTruthy();
  });
});
