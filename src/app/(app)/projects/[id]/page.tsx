import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { ProjectDetailView } from "@/modules/projects/ui";
import { getServerApi } from "@/server/trpc/server";

interface Props {
  params: Promise<{ id: string }>;
}

const projectId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("nav.items");
  if (!projectId.safeParse(id).success) return { title: t("allProjects") };
  try {
    const api = await getServerApi();
    const project = await api.projects.byId({ id, today: new Date().toISOString().slice(0, 10) });
    return { title: project.name };
  } catch {
    return { title: t("allProjects") };
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!projectId.safeParse(id).success) notFound();
  return (
    <Suspense>
      <ProjectDetailView id={id} />
    </Suspense>
  );
}
