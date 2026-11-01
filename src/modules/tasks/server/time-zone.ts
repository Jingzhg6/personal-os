import { eq } from "drizzle-orm";

import { userSettings } from "@/modules/settings/db";
import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";

/** The user's time zone from settings (UTC until one is set). */
export async function timeZoneOf(db: DbExecutor, userId: string): Promise<string> {
  const [row] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.timeZone ?? defaultTimeZone;
}
