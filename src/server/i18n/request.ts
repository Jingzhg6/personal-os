import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { getUserSettings } from "@/modules/settings/server";
import { getDb } from "@/shared/db/client";
import { defaultLocale, defaultTimeZone, isLocale, LOCALE_COOKIE } from "@/shared/i18n/config";
import { formats } from "@/shared/i18n/formats";
import { loadMessages } from "@/shared/i18n/messages";

import { getSession } from "../session";

/**
 * Resolves the UI language per request without locale-prefixed URLs:
 * signed-in user's setting → NEXT_LOCALE cookie → zh-CN.
 */
export default getRequestConfig(async () => {
  const session = await getSession();
  const settings = session ? await getUserSettings(getDb(), session.user.id) : null;
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;

  const locale = settings?.locale ?? (isLocale(cookieLocale) ? cookieLocale : defaultLocale);

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: settings?.timeZone ?? defaultTimeZone,
    formats,
  };
});
