import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("environment", () => {
  it("accepts a complete configuration; an empty worker secret means not configured", () => {
    expect(envSchema.parse(valid).AUTOMATION_WORKER_SECRET).toBeUndefined();
    expect(
      envSchema.parse({ ...valid, AUTOMATION_WORKER_SECRET: "" }).AUTOMATION_WORKER_SECRET,
    ).toBeUndefined();
    expect(envSchema.parse({ ...valid, AUTOMATION_WORKER_SECRET: "b".repeat(32) })).toMatchObject({
      AUTOMATION_WORKER_SECRET: "b".repeat(32),
      AUTH_ALLOW_SIGNUP: true,
    });
  });

  it("refuses the example placeholders and short secrets", () => {
    const placeholder = "change-me-to-a-random-value-of-at-least-32-characters";
    expect(envSchema.safeParse({ ...valid, BETTER_AUTH_SECRET: placeholder }).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, AUTOMATION_WORKER_SECRET: placeholder }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ ...valid, BETTER_AUTH_SECRET: "short" }).success).toBe(false);
    expect(envSchema.safeParse({ ...valid, AUTOMATION_WORKER_SECRET: "short" }).success).toBe(
      false,
    );
  });
});
