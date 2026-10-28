import { eq } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { users } from "@/shared/auth/schema";
import { isLocale } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";

import { userSettings } from "../db";
import {
  defaultUserSettings,
  type UpdateProfileInput,
  type UpdateUserSettingsInput,
  type UserSettings,
} from "../domain";

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

/** Renames the signed-in user. Only their own row; the session reads the name from it. */
export async function updateProfile(
  db: DbExecutor,
  userId: string,
  input: UpdateProfileInput,
): Promise<{ name: string }> {
  const [row] = await db
    .update(users)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ name: users.name });
  if (!row) throw new DomainError("not_found", "settings.user_not_found");
  return row;
}
