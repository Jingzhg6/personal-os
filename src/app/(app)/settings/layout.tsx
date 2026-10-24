import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { SettingsTabs } from "@/modules/settings/ui";
import { PageHeader } from "@/shared/ui/page-header";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("settings");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsTabs />
      {children}
    </div>
  );
}
