import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { GanttChart } from "@/modules/tasks/ui";

// Static route, so it is not captured by /projects/[id].
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("gantt") };
}

export default async function Page() {
  const t = await getTranslations("nav.items");
  return (
    <Suspense>
      <GanttChart title={t("gantt")} />
    </Suspense>
  );
}
