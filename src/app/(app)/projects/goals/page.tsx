import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ComingSoon } from "@/shell/coming-soon";
import { findNavItem } from "@/shell/navigation";

// Static route so this placeholder is not captured by /projects/[id].
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav.items");
  return { title: t("goals") };
}

export default function Page() {
  return <ComingSoon item={findNavItem("/projects/goals")!} />;
}
