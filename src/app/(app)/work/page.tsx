import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TaskListView } from "@/modules/tasks/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("work") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <TaskListView title={t("work")} variant={{ kind: "scoped", view: "work" }} />
    </Suspense>
  );
}
