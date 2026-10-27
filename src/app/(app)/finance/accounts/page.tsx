import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FinanceAccountsView } from "@/modules/finance/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("financeAccounts") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return <FinanceAccountsView title={t("financeAccounts")} />;
}
