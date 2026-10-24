import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TaskListView } from "@/modules/tasks/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("allTasks") };
}

export default function TasksPage() {
  return (
    <Suspense>
      <TaskListView />
    </Suspense>
  );
}
