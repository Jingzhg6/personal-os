"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";

const tabs = [
  { id: "general", href: "/settings" },
  { id: "areas", href: "/settings/areas" },
  { id: "statuses", href: "/settings/statuses" },
  { id: "tags", href: "/settings/tags" },
] as const;

export function SettingsTabs() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("sections")}
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${tab.id}`)}
          </Link>
        );
      })}
    </nav>
  );
}
