import { getRequestConfig } from "next-intl/server";

import { getUserSettings } from "@/modules/settings/server";
import { getDb } from "@/shared/db/client";
import { defaultLocale, defaultTimeZone } from "@/shared/i18n/config";
import { formats } from "@/shared/i18n/formats";
import { sourceMessages } from "@/shared/i18n/messages";

import { getSession } from "../session";

/** The UI is zh-CN only; the signed-in user's timezone still comes from their settings. */
export default getRequestConfig(async () => {
  const session = await getSession();
  const settings = session ? await getUserSettings(getDb(), session.user.id) : null;
  return {
    locale: defaultLocale,
    messages: sourceMessages,
    timeZone: settings?.timeZone ?? defaultTimeZone,
    formats,
  };
});
