import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AiReviewView } from "@/modules/ai/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai.review");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("ai.review");
  return <AiReviewView title={t("title")} />;
}
