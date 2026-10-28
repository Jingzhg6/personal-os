import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AiHomeView } from "@/modules/ai/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.home");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("ai.home");
  return <AiHomeView title={t("title")} />;
}
