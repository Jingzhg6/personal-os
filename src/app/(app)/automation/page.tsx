import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RulesView } from "@/modules/automation/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automation.list");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("automation.list");
  return <RulesView title={t("title")} />;
}
