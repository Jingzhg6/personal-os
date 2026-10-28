import { z } from "zod";

import { defaultLocale, type Locale } from "@/shared/i18n/config";

export interface UserSettings {
  /** Always zh-CN: the column is kept, the UI has one language. */
  locale: Locale;
  /** IANA timezone, e.g. "Asia/Shanghai". Null until known (detected from the browser). */
  timeZone: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
}

export const defaultUserSettings: UserSettings = {
  locale: defaultLocale,
  timeZone: null,
  weekStartsOn: 1,
};

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const updateUserSettingsInput = z
  .object({
    timeZone: z.string().refine(isValidTimeZone, { message: "Invalid IANA timezone" }),
    weekStartsOn: z.number().int().min(0).max(6),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsInput>;

/** The display name shown in the shell (Better Auth `users.name`). */
export const NAME_MAX_LENGTH = 100;

export const updateProfileInput = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInput>;

/** ISO weekday: 1 = Monday … 7 = Sunday (the numbering of recurrence and schedule rules). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The seven ISO weekdays in display order for a week that starts on `weekStartsOn` (0 = Sunday). */
export function weekdayOrder(weekStartsOn: number): IsoWeekday[] {
  const first = weekStartsOn === 0 ? 7 : weekStartsOn;
  return Array.from({ length: 7 }, (_, i) => (((first - 1 + i) % 7) + 1) as IsoWeekday);
}
