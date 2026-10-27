import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { AccountHistoryView } from "@/modules/finance/ui";
import { getServerApi } from "@/server/trpc/server";

interface Props {
  params: Promise<{ id: string }>;
}

const accountId = z.uuid();

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("nav.items");
  if (!accountId.safeParse(id).success) return { title: t("financeAccounts") };
  try {
    const api = await getServerApi();
    const history = await api.finance.accounts.history({ id });
    return { title: history.account.name };
  } catch {
    return { title: t("financeAccounts") };
  }
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!accountId.safeParse(id).success) notFound();
  return <AccountHistoryView id={id} />;
}
