import { Construction } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";

import type { NavItem } from "./navigation";

/** Placeholder for views reserved in the navigation but not yet implemented. */
export function ComingSoon({ item }: { item: NavItem }) {
  const t = useTranslations();
  const Icon = item.icon;
  const label = t(`nav.items.${item.id}`);
  const when = [
    t("common.phase", { phase: item.phase }),
    item.milestone ? t("common.milestone", { milestone: item.milestone }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-6 sm:pt-12">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
      </div>

      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">
              <Construction className="size-3" />
              {t("shell.comingSoon.badge")}
            </Badge>
            <Badge variant="outline">{when}</Badge>
          </div>
          <h2 className="text-lg font-semibold">
            {t("shell.comingSoon.title", { module: label })}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("shell.comingSoon.description", { phase: when })}
          </p>
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            {t("shell.comingSoon.principle")}
          </p>
        </div>
      </Card>
    </div>
  );
}
