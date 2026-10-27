import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DashboardView } from "@/modules/dashboard/ui";
import { requireUser } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("dashboard") };
}

/** The authenticated home: the personal RPG dashboard. */
export default async function Page() {
  const [t, user] = await Promise.all([getTranslations("nav.items"), requireUser()]);
  return <DashboardView title={t("dashboard")} userName={user.name} />;
}
