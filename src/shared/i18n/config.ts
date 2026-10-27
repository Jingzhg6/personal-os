/**
 * The UI is Simplified Chinese only. The next-intl infrastructure stays (every user-facing string
 * is a key in messages/zh-CN, enforced by lint), but there is one locale and no language switch.
 */
export const locales = ["zh-CN"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-CN";

/** Used until the user's own timezone is known. */
export const defaultTimeZone = "UTC";

/** Translation namespaces. One JSON file per namespace in /messages/zh-CN. */
export const namespaces = [
  "common",
  "nav",
  "shell",
  "auth",
  "settings",
  "errors",
  "editor",
  "areas",
  "tasks",
  "projects",
  "character",
  "rewards",
] as const;

export type Namespace = (typeof namespaces)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
