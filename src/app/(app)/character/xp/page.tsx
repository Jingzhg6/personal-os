import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { XpHistoryView } from "@/modules/character/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("xp") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <XpHistoryView title={t("xp")} />
    </Suspense>
  );
}
