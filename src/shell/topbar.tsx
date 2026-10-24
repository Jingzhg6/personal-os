"use client";

import { ChevronRight, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/shared/ui/button";

import { findActiveNavItem, findNavSection } from "./navigation";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const t = useTranslations();
  const pathname = usePathname();
  const item = findActiveNavItem(pathname);
  const section = item ? findNavSection(item) : null;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-10">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={onOpenNavigation}
        aria-label={t("shell.openNavigation")}
      >
        <Menu />
      </Button>

      <nav aria-label={t("shell.breadcrumb")} className="flex min-w-0 items-center gap-1.5 text-sm">
        {section ? (
          <>
            <span className="truncate text-muted-foreground">
              {t(`nav.sections.${section.id}`)}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          </>
        ) : null}
        {item ? (
          <span className="truncate font-medium text-foreground">{t(`nav.items.${item.id}`)}</span>
        ) : null}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
