import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { GoalDetailView } from "@/modules/development/ui";
import { getServerApi } from "@/server/trpc/server";

interface Props {
  params: Promise<{ id: string }>;
}

const goalId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("nav.items");
  if (!goalId.safeParse(id).success) return { title: t("development") };
  try {
    const api = await getServerApi();
    const detail = await api.development.goals.detail({ id });
    return { title: detail.goal.title };
  } catch {
    return { title: t("development") };
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!goalId.safeParse(id).success) notFound();
  return (
    <Suspense>
      <GoalDetailView id={id} />
    </Suspense>
  );
}
