import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ExportDataCard } from "@/modules/data-export/ui";
import { getUserSettings } from "@/modules/settings/server";
import { ProfileForm, RegionalForm } from "@/modules/settings/ui";
import { getDb } from "@/shared/db/client";
import { requireUser } from "@/server/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { ThemeSelector } from "@/shell/theme-toggle";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const user = await requireUser();
  const settings = await getUserSettings(getDb(), user.id);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.title")}</CardTitle>
          <CardDescription>{t("profile.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} email={user.email} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("regional.title")}</CardTitle>
          <CardDescription>{t("regional.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RegionalForm settings={settings} />
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
      <Card>
        <CardHeader>
          <CardTitle>{t("export.title")}</CardTitle>
          <CardDescription>{t("export.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ExportDataCard />
        </CardContent>
      </Card>
    </div>
  );
}
