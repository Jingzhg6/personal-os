"use client";

import { Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { RECENT_WINDOW_DAYS, type DevelopmentOverview } from "../domain";
import { EmptyState, goalHref, SectionCard } from "./bits";

/**
 * Secondary on purpose: which plans moved recently and which did not. The page stays about
 * development; planning detail lives on each goal.
 */
export function PlansOverview({ data }: { data: DevelopmentOverview }) {
  const t = useTranslations("development.plans");
  const active = data.plans.filter((p) => p.plan.status === "active");
  const groups = [
    { key: "withActivity" as const, plans: active.filter((p) => p.recentCompleted > 0) },
    { key: "withoutActivity" as const, plans: active.filter((p) => p.recentCompleted === 0) },
  ];
  return (
    <SectionCard
      icon={<MapIcon className="size-4" aria-hidden />}
      title={t("overviewTitle")}
      testId="plans-overview"
      action={
        active.length > 0 ? (
          <span className="text-xs text-muted-foreground" data-testid="active-plan-count">
            {t("activeCount", { count: active.length })}
          </span>
        ) : null
      }
    >
      <p className="-mt-2 text-xs text-muted-foreground">
        {t("overviewHint", { days: RECENT_WINDOW_DAYS })}
      </p>
      {active.length === 0 ? (
        <EmptyState title={t("overviewEmpty")} testId="plans-overview-empty" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(({ key, plans }) => (
            <section key={key} className="flex flex-col gap-2" data-testid={`plans-${key}`}>
              <h3 className="text-xs font-medium text-muted-foreground">{t(key)}</h3>
              {plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {plans.map((p) => (
                    <li
                      key={p.plan.id}
                      className="flex flex-col rounded-md bg-surface-muted/60 px-3 py-2"
                    >
                      <Link
                        href={goalHref(p.goalId)}
                        className="text-sm font-medium hover:underline"
                      >
                        {p.plan.title}
                      </Link>
                      <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                        <span>{t("of", { goal: p.goalTitle })}</span>
                        <span className="tabular-nums">
                          {t("recentShort", { days: RECENT_WINDOW_DAYS, count: p.recentCompleted })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
