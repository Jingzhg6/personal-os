import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PlannerView } from "@/modules/schedule/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("schedule") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <PlannerView title={t("schedule")} />
    </Suspense>
  );
}
