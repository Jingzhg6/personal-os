import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { TagSettings } from "@/modules/tasks/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks.settings.tags");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("tasks.settings.tags");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <TagSettings />
      </CardContent>
    </Card>
  );
}
