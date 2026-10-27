import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NewRuleView } from "@/modules/automation/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("automation.builder");
  return { title: t("newTitle") };
}

export default function Page() {
  return <NewRuleView />;
}
