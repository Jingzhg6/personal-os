import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NotificationsView } from "@/modules/automation/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automation.notifications");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("automation.notifications");
  return <NotificationsView title={t("title")} />;
}
