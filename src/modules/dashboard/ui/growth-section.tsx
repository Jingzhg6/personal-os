"use client";

import { Settings2, Sprout } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { RadarChart, useAttributeLabel } from "@/modules/character/ui";
import { cn } from "@/shared/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";
import { ProgressBar } from "@/shared/ui/progress-bar";

import {
  dashboardPeriods,
  defaultDashboardPeriod,
  type DashboardOverview,
  type DashboardPeriod,
} from "../domain";
import { GrowthTrendChart } from "./growth-trend-chart";
import { useDashboardGrowth } from "./use-dashboard";

/** 我的成长能力: lifetime shape (radar) beside recent movement (ranking + trend). */
export function GrowthSection({ data }: { data: DashboardOverview }) {
  const t = useTranslations("dashboard.growth");
  const [period, setPeriod] = useState<DashboardPeriod>(defaultDashboardPeriod);
  const active = useMemo(() => {
    const ids = new Set(data.activeAttributeIds);
    return data.attributes.filter((attribute) => ids.has(attribute.id));
  }, [data.attributes, data.activeAttributeIds]);
  const radar = active.filter((attribute) => attribute.onRadar);

  return (
    <Card data-testid="growth-section">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sprout className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <Link
          href="/character/attributes"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <Settings2 className="size-4" aria-hidden />
          {t("manage")}
        </Link>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 py-10 text-center"
            data-testid="no-attributes"
          >
            <p className="font-medium">{t("noAttributes")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("noAttributesHint")}</p>
            <Link
              href="/character/attributes"
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              {t("setup")}
            </Link>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <section aria-labelledby="radar-title" className="flex flex-col gap-2">
              <h3 id="radar-title" className="text-sm font-medium text-muted-foreground">
                {t("radar")}
              </h3>
              {data.totals.growthXp === 0 ? (
                <p
                  className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border px-6 text-center text-sm text-muted-foreground"
                  data-testid="radar-empty"
                >
                  {t("radarEmpty")}
                </p>
              ) : (
                <RadarChart attributes={radar} />
              )}
            </section>
            <RecentGrowth period={period} onPeriod={setPeriod} data={data} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentGrowth({
  period,
  onPeriod,
  data,
}: {
  period: DashboardPeriod;
  onPeriod: (period: DashboardPeriod) => void;
  data: DashboardOverview;
}) {
  const t = useTranslations("dashboard.growth");
  const format = useFormatter();
  const label = useAttributeLabel();
  const { data: growth } = useDashboardGrowth(period);
  const attributeOf = useMemo(
    () => new Map(data.attributes.map((attribute) => [attribute.id, attribute])),
    [data.attributes],
  );
  const periodName = t(`periodNames.${period}`);
  const top = growth?.ranking[0]?.growthXp ?? 0;

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-labelledby="ranking-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ranking-title" className="text-sm font-medium">
          {t("ranking")}
          <span className="ml-1.5 font-normal text-muted-foreground">
            {t("rankingPeriod", { period: periodName })}
          </span>
        </h3>
        <div
          role="radiogroup"
          aria-label={t("periodLabel")}
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {dashboardPeriods.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => onPeriod(value)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                period === value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`periods.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {!growth ? (
        <div className="h-64 animate-pulse rounded-md bg-surface-muted" />
      ) : (
        <>
          {growth.ranking.length === 0 ? (
            <div
              className="rounded-md bg-surface-muted/60 px-4 py-5 text-center"
              data-testid="ranking-empty"
            >
              <p className="text-sm font-medium">{t("rankingEmpty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("rankingEmptyHint")}</p>
            </div>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="growth-ranking">
              {growth.ranking.map((row) => {
                const attribute = attributeOf.get(row.attributeId);
                if (!attribute) return null;
                const name = label(attribute);
                return (
                  <li
                    key={row.attributeId}
                    className="flex flex-col gap-1.5"
                    data-testid="ranking-row"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <ColorDot color={attribute.color} />
                      {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                      <span className="min-w-0 truncate font-medium">{name}</span>
                      <span className="ml-auto shrink-0 font-semibold tabular-nums">
                        {t("xp", { xp: format.number(row.growthXp) })}
                      </span>
                    </div>
                    <ProgressBar
                      value={top > 0 ? row.growthXp / top : 0}
                      label={t("rankingLabel", {
                        name,
                        period: periodName,
                        xp: row.growthXp,
                      })}
                    />
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium">{t("trend")}</h3>
              {growth.points.some((p) => p.growthXp !== 0 || p.activeXp !== 0) ? (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  data-testid="growth-summary"
                >
                  {t("summary", {
                    growth: format.number(growth.growthXp),
                    level: format.number(growth.levelXp),
                    active: format.number(growth.activeXp),
                  })}
                </span>
              ) : null}
            </div>
            <GrowthTrendChart growth={growth} periodName={periodName} />
          </div>
        </>
      )}
    </section>
  );
}
