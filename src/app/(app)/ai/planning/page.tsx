import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AiPlanningView } from "@/modules/ai/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.planning");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("ai.planning");
  return <AiPlanningView title={t("title")} />;
}
