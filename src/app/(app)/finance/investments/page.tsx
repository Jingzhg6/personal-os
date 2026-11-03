import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { InvestmentsView } from "@/modules/finance/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("financeInvestments") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return <InvestmentsView title={t("financeInvestments")} />;
}
