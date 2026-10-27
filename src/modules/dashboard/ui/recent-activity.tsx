"use client";

import { ArrowRight, CheckCircle2, History, Undo2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useMemo } from "react";

import type { XpEntry } from "@/modules/character/domain";
import { useAttributeLabel } from "@/modules/character/ui";
import { addDays, todayIn } from "@/modules/tasks/domain";
import { cn } from "@/shared/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

import type { DashboardOverview } from "../domain";

const TIME = { timeStyle: "short" } as const;
const DAY = { month: "long", day: "numeric", weekday: "short", timeZone: "UTC" } as const;
const SIGNED = { signDisplay: "exceptZero" } as const;

/**
 * 最近活动: the newest XP ledger lines (each one a completion or its reversal), grouped by the
 * user's local day. The completed task stays the source; nothing here is a separate record.
 */
export function RecentActivity({
  data,
  className,
}: {
  data: DashboardOverview;
  className?: string;
}) {
  const t = useTranslations("dashboard.activity");
  const format = useFormatter();
  const timeZone = useTimeZone() ?? "UTC";
  const attributeOf = useMemo(
    () => new Map(data.attributes.map((attribute) => [attribute.id, attribute])),
    [data.attributes],
  );

  const groups = useMemo(() => {
    const byDay = new Map<string, XpEntry[]>();
    for (const entry of data.recentActivity) {
      const day = todayIn(timeZone, entry.createdAt);
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    }
    return [...byDay];
  }, [data.recentActivity, timeZone]);

  const dayLabel = (day: string) => {
    if (day === data.today) return t("today");
    if (day === addDays(data.today, -1)) return t("yesterday");
    return format.dateTime(new Date(`${day}T00:00:00Z`), DAY);
  };

  return (
    <Card className={cn("flex flex-col", className)} data-testid="recent-activity">
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <Link
          href="/character/xp"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("viewAll")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="activity-empty">
            {t("empty")}
          </p>
        ) : (
          groups.map(([day, entries]) => (
            <section key={day} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{dayLabel(day)}</h3>
              <ul className="flex flex-col">
                {entries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} attributeOf={attributeOf} />
                ))}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  entry,
  attributeOf,
}: {
  entry: XpEntry;
  attributeOf: ReadonlyMap<string, DashboardOverview["attributes"][number]>;
}) {
  const t = useTranslations("dashboard.activity");
  const format = useFormatter();
  const label = useAttributeLabel();
  const reversal = entry.kind === "reversal";
  const growth = entry.credits.reduce((sum, credit) => sum + credit.amount, 0);
  const main = attributeOf.get(entry.credits[0]?.attributeId ?? "");
  const Icon = reversal ? Undo2 : CheckCircle2;

  return (
    <li
      className="flex items-start gap-3 rounded-md px-1 py-2"
      data-testid="activity-entry"
      data-kind={entry.kind}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-base",
          reversal
            ? "bg-red-500/10 text-red-600 dark:text-red-300"
            : "bg-surface-muted text-muted-foreground",
        )}
      >
        {!reversal && main?.icon ? (
          <span aria-hidden>{main.icon}</span>
        ) : (
          <Icon className="size-4" aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">
            {reversal ? t("reversed") : t("completed")}
          </span>
          <span className={cn("min-w-0 truncate font-medium", entry.reversed && "line-through")}>
            {entry.sourceTitle || t("untitled")}
          </span>
          <time
            dateTime={entry.createdAt.toISOString()}
            className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {format.dateTime(entry.createdAt, TIME)}
          </time>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
          <Chip tone="active" testId="activity-active">
            {t("active", { xp: format.number(entry.amount, SIGNED) })}
          </Chip>
          {growth !== 0 ? (
            <Chip tone="growth" testId="activity-growth">
              {t("growth", { xp: format.number(growth, SIGNED) })}
            </Chip>
          ) : null}
          {entry.levelXp !== 0 ? (
            <Chip tone="level" testId="activity-level">
              {t("level", { xp: format.number(entry.levelXp, SIGNED) })}
            </Chip>
          ) : null}
          {entry.credits.length > 0 ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {entry.credits
                .map((credit) => {
                  const attribute = attributeOf.get(credit.attributeId);
                  return attribute
                    ? `${label(attribute)} ${format.number(credit.amount, SIGNED)}`
                    : null;
                })
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
          {entry.reversed ? (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-muted-foreground">
              {t("cancelled")}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Chip({
  tone,
  testId,
  children,
}: {
  tone: "active" | "growth" | "level";
  testId: string;
  children: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "rounded px-1.5 py-0.5 font-medium",
        tone === "active" && "bg-xp/15 text-amber-800 dark:text-amber-200",
        tone === "growth" && "bg-success/12 text-emerald-800 dark:text-emerald-200",
        tone === "level" && "bg-primary/10 text-primary",
      )}
    >
      {children}
    </span>
  );
}
