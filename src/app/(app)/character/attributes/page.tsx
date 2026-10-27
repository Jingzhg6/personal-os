import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AttributeSettings } from "@/modules/character/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("character.settings");
  return { title: t("title") };
}

export default function Page() {
  return <AttributeSettings />;
}
