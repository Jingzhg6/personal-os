import { z } from "zod";

import { defaultLocale, locales, type Locale } from "@/shared/i18n/config";

export interface UserSettings {
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
    locale: z.enum(locales),
    timeZone: z.string().refine(isValidTimeZone, { message: "Invalid IANA timezone" }),
    weekStartsOn: z.number().int().min(0).max(6),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsInput>;
