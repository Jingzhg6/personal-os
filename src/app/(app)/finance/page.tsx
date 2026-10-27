import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FinanceOverviewView } from "@/modules/finance/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("financeOverview") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return <FinanceOverviewView title={t("financeOverview")} />;
}
