import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SnapshotView } from "@/modules/finance/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.snapshot");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("finance.snapshot");
  return (
    <Suspense>
      <SnapshotView title={t("title")} />
    </Suspense>
  );
}
