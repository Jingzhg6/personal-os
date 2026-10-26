import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TaskListView } from "@/modules/tasks/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("personal") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <TaskListView title={t("personal")} variant={{ kind: "scoped", view: "personal" }} />
    </Suspense>
  );
}
