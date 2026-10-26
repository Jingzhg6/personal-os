import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { KanbanBoard } from "@/modules/tasks/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("kanban") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <KanbanBoard title={t("kanban")} />
    </Suspense>
  );
}
