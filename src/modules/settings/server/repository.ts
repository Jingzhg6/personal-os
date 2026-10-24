import { eq } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { isLocale } from "@/shared/i18n/config";

import { userSettings } from "../db";
import { defaultUserSettings, type UpdateUserSettingsInput, type UserSettings } from "../domain";

function toDomain(row: typeof userSettings.$inferSelect): UserSettings {
  return {
    locale: isLocale(row.locale) ? row.locale : defaultUserSettings.locale,
    timeZone: row.timeZone,
    weekStartsOn: row.weekStartsOn,
  };
}

/** Returns the stored settings, or the defaults when none exist yet. */
export async function getUserSettings(db: DbExecutor, userId: string): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row ? toDomain(row) : defaultUserSettings;
}

/** Creates the default settings row if missing. Idempotent. */
export async function ensureUserSettings(db: DbExecutor, userId: string): Promise<void> {
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
}

export async function updateUserSettings(
  db: DbExecutor,
  userId: string,
  patch: UpdateUserSettingsInput,
): Promise<UserSettings> {
  const [row] = await db
    .insert(userSettings)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userSettings.userId, set: patch })
    .returning();
  return toDomain(row!);
}
