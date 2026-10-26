import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectsListView } from "@/modules/projects/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("allProjects") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <ProjectsListView title={t("allProjects")} />
    </Suspense>
  );
}
