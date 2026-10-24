import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ComingSoon } from "@/shell/coming-soon";
import { findNavItem } from "@/shell/navigation";

/*
 * Placeholder for every navigation item that has no dedicated page yet.
 * When a module ships a view, it gets a real route (e.g. app/(app)/tasks/page.tsx),
 * which takes precedence over this catch-all automatically.
 */

interface Props {
  params: Promise<{ slug: string[] }>;
}

async function resolveItem(params: Props["params"]) {
  const { slug } = await params;
  return findNavItem(`/${slug.join("/")}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await resolveItem(params);
  if (!item) return {};
  const t = await getTranslations("nav.items");
  return { title: t(item.id) };
}

export default async function PlannedModulePage({ params }: Props) {
  const item = await resolveItem(params);
  if (!item) notFound();
  return <ComingSoon item={item} />;
}
