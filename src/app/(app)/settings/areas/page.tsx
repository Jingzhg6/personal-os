import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AreaSettings } from "@/modules/areas/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("areas.settings");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("areas.settings");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AreaSettings />
      </CardContent>
    </Card>
  );
}
