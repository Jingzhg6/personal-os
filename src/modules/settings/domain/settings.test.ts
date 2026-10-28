import { describe, expect, it } from "vitest";

import {
  isValidTimeZone,
  NAME_MAX_LENGTH,
  updateProfileInput,
  updateUserSettingsInput,
  weekdayOrder,
} from "./index";

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

describe("profile input", () => {
  it("trims the name and rejects empty or overlong names", () => {
    expect(updateProfileInput.parse({ name: "  小明 " })).toEqual({ name: "小明" });
    expect(updateProfileInput.safeParse({ name: "   " }).success).toBe(false);
    expect(updateProfileInput.safeParse({ name: "a".repeat(NAME_MAX_LENGTH + 1) }).success).toBe(
      false,
    );
  });
});

describe("weekday order", () => {
  it("starts on the configured day and lists every ISO weekday once", () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdayOrder(0)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(6)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });
});
