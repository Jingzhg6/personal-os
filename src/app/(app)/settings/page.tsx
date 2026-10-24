import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LanguageSettings } from "@/modules/settings/ui";
import { getServerApi } from "@/server/trpc/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";
import { ThemeSelector } from "@/shell/theme-toggle";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const settings = await (await getServerApi()).settings.get();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />

      <Card>
        <CardHeader>
          <CardTitle>{t("language.title")}</CardTitle>
          <CardDescription>{t("language.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageSettings current={settings.locale} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("theme.title")}</CardTitle>
          <CardDescription>{t("theme.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSelector />
        </CardContent>
      </Card>
    </div>
  );
}
