import { describe, expect, it } from "vitest";

import { isValidTimeZone, updateUserSettingsInput } from "./index";

describe("settings input", () => {
  it("accepts supported locales and IANA timezones", () => {
    expect(updateUserSettingsInput.parse({ locale: "fr" })).toEqual({ locale: "fr" });
    expect(updateUserSettingsInput.parse({ timeZone: "Europe/Paris" })).toEqual({
      timeZone: "Europe/Paris",
    });
  });

  it("rejects unknown locales, invalid timezones and empty updates", () => {
    expect(updateUserSettingsInput.safeParse({ locale: "de" }).success).toBe(false);
    expect(updateUserSettingsInput.safeParse({ timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(updateUserSettingsInput.safeParse({ weekStartsOn: 7 }).success).toBe(false);
    expect(updateUserSettingsInput.safeParse({}).success).toBe(false);
  });

  it("validates timezones with Intl", () => {
    expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
    expect(isValidTimeZone("nope")).toBe(false);
  });
});
