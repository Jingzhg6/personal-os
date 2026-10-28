import { describe, expect, it } from "vitest";

import { countRecords, exportFileName, findSensitiveKeys } from "./index";

describe("sensitive-key guard", () => {
  it("finds credential-like keys at any depth, and ignores ordinary keys", () => {
    expect(
      findSensitiveKeys({
        user: { id: "u", email: "a@b.c" },
        data: { tasks: [{ id: "t", sourceKey: "x", idempotencyKey: "k", triggerKey: "y" }] },
      }),
    ).toEqual([]);
    expect(
      findSensitiveKeys({
        accounts: [{ password: "h", accessToken: "a" }],
        nested: { deep: [{ refresh_token: "r", apiKey: "k", clientSecret: "s" }] },
      }),
    ).toEqual([
      "$.accounts[0].password",
      "$.accounts[0].accessToken",
      "$.nested.deep[0].refresh_token",
      "$.nested.deep[0].apiKey",
      "$.nested.deep[0].clientSecret",
    ]);
    // Values are not inspected (user content may mention any word); dates are leaves.
    expect(findSensitiveKeys({ title: "change password", at: new Date(0) })).toEqual([]);
  });
});

describe("file name and totals", () => {
  it("dates the file in the user's zone, UTC when unknown", () => {
    const at = new Date("2026-10-28T20:00:00Z"); // already the 29th in Shanghai
    expect(exportFileName(at, "Asia/Shanghai")).toBe("personal-os-export-2026-10-29.json");
    expect(exportFileName(at, "America/Los_Angeles")).toBe("personal-os-export-2026-10-28.json");
    expect(exportFileName(at, null)).toBe("personal-os-export-2026-10-28.json");
  });

  it("adds up the rows", () => {
    expect(countRecords({ "tasks.tasks": 3, "areas.areas": 4, "finance.settings": 0 })).toBe(7);
    expect(countRecords({})).toBe(0);
  });
});
