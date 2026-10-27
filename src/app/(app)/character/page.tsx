import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CharacterOverview } from "@/modules/character/ui";
import { requireUser } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("character") };
}

export default async function Page() {
  const [t, user] = await Promise.all([getTranslations("nav.items"), requireUser()]);
  return <CharacterOverview title={t("character")} userName={user.name} />;
}
