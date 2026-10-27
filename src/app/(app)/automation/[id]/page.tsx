import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { RuleDetailView } from "@/modules/automation/ui";
import { getServerApi } from "@/server/trpc/server";

interface Props {
  params: Promise<{ id: string }>;
}

const ruleId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("automation.list");
  if (!ruleId.safeParse(id).success) return { title: t("title") };
  try {
    const api = await getServerApi();
    const rule = await api.automation.rules.byId({ id });
    return { title: rule.name };
  } catch {
    return { title: t("title") };
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!ruleId.safeParse(id).success) notFound();
  return <RuleDetailView id={id} />;
}
