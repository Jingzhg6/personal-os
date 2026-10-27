import { describe, expect, it } from "vitest";

import { isValidTimeZone, updateUserSettingsInput } from "./index";

describe("settings input", () => {
  it("accepts IANA timezones and no longer accepts a language", () => {
    // The language key is stripped, so a language-only update is an empty update.
    expect(updateUserSettingsInput.safeParse({ locale: "fr" } as never).success).toBe(false);
    expect(updateUserSettingsInput.parse({ locale: "fr", weekStartsOn: 1 } as never)).toEqual({
      weekStartsOn: 1,
    });
    expect(updateUserSettingsInput.parse({ timeZone: "Europe/Paris" })).toEqual({
      timeZone: "Europe/Paris",
    });
  });

  it("rejects invalid timezones and empty updates", () => {
    expect(updateUserSettingsInput.safeParse({ timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(updateUserSettingsInput.safeParse({ weekStartsOn: 7 }).success).toBe(false);
    expect(updateUserSettingsInput.safeParse({}).success).toBe(false);
  });

  it("validates timezones with Intl", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("nope")).toBe(false);
  });
});
