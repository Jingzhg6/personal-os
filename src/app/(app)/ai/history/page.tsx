import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AiHistoryView } from "@/modules/ai/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.history");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("ai.history");
  return <AiHistoryView title={t("title")} />;
}
