export const locales = ["zh-CN", "en", "fr"] as const;

export type Locale = (typeof locales)[number];

/** Source language: every key must exist here first. */
export const defaultLocale: Locale = "zh-CN";

/** Cookie remembering the language for signed-out pages (login, register). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Used until the user's own timezone is known. */
export const defaultTimeZone = "UTC";

/**
 * Language names are written in their own language (endonyms), so they are
 * intentionally not translated.
 */
export const localeEndonyms: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
  fr: "Français",
};

/**
 * zh-CN is maintained with every feature. Other locales are structurally supported and
 * fall back to zh-CN for any missing key until they are fully translated.
 */
export const localeStatus: Record<Locale, "complete" | "partial"> = {
  "zh-CN": "complete",
  en: "partial",
  fr: "partial",
};

/** Translation namespaces. One JSON file per namespace per locale in /messages. */
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
] as const;

export type Namespace = (typeof namespaces)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
