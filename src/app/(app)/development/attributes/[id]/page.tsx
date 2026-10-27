import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { AttributeDetailView } from "@/modules/development/ui";

interface Props {
  params: Promise<{ id: string }>;
}

const attributeId = z.uuid();

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("development") };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!attributeId.safeParse(id).success) notFound();
  return <AttributeDetailView id={id} />;
}
