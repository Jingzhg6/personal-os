"use client";

import {
  ChevronLeft,
  History,
  ListTodo,
  PieChart,
  Settings2,
  Star,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { useAttributeLabel, XpEntryRow, XpTrendChart } from "@/modules/character/ui";
import { StatusIcon } from "@/modules/tasks/ui";
import { Card, CardContent } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";
import { ProgressBar } from "@/shared/ui/progress-bar";

import { ATTRIBUTE_TREND_DAYS, RECENT_WINDOW_DAYS, type AttributeDetail } from "../domain";
import { EmptyState, goalHref, SectionCard } from "./bits";
import { useAttributeDetail, useGoalStatusLabel } from "./use-development";

const SIGNED = { signDisplay: "exceptZero" } as const;

/** "How am I developing this ability?" — all figures from the existing XP ledger and tasks. */
export function AttributeDetailView({ id }: { id: string }) {
  const t = useTranslations("development.attributeDetail");
  const { data, isError } = useAttributeDetail(id);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="attribute-detail">
      <Link
        href="/development"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      {isError ? (
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      ) : data ? (
        <>
          <Identity detail={data} />
          <SectionCard
            icon={<TrendingUp className="size-4" aria-hidden />}
            title={t("trend", { days: ATTRIBUTE_TREND_DAYS })}
            testId="attribute-trend"
          >
            <XpTrendChart
              points={data.trend.points}
              bucket={data.trend.bucket}
              periodName={t("trend", { days: ATTRIBUTE_TREND_DAYS })}
              showActive={false}
            />
          </SectionCard>
          <div className="grid gap-6 lg:grid-cols-2">
            <GoalsCard detail={data} />
            <OpenTasksCard detail={data} />
            <EntriesCard detail={data} />
            <SourcesCard detail={data} />
          </div>
        </>
      ) : (
        <div className="h-64 animate-pulse rounded-lg bg-surface-muted" aria-hidden />
      )}
    </div>
  );
}

function Identity({ detail }: { detail: AttributeDetail }) {
  const t = useTranslations("development.attributeDetail");
  const format = useFormatter();
  const label = useAttributeLabel();
  const { attribute } = detail;
  const { progress } = attribute;
  return (
    <Card data-testid="attribute-identity">
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-3xl">
            {attribute.icon ?? <ColorDot color={attribute.color} />}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              <ColorDot color={attribute.color} />
              <span data-testid="attribute-name">{label(attribute)}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium">
                {t("level", { level: progress.level })}
              </span>
              {detail.focused ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 font-medium text-primary">
                  <Star className="size-3" aria-hidden />
                  {t("focused")}
                </span>
              ) : null}
              {attribute.archivedAt ? (
                <span
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-muted-foreground"
                  data-testid="attribute-archived-badge"
                >
                  {t("archived")}
                </span>
              ) : null}
              <Link
                href="/character/attributes"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="size-3.5" aria-hidden />
                {t("manage")}
              </Link>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:border-l sm:border-border sm:pl-8">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("lifetime")}</dt>
              <dd className="text-2xl font-semibold" data-testid="attribute-detail-lifetime">
                {format.number(detail.lifetimeGrowthXp)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("recent", { days: RECENT_WINDOW_DAYS })}
              </dt>
              <dd
                className="text-2xl font-semibold text-primary"
                data-testid="attribute-detail-recent"
              >
                {format.number(detail.recentGrowthXp, SIGNED)}
              </dd>
            </div>
          </dl>
          <ProgressBar
            value={progress.ratio}
            label={t("levelProgress", {
              level: progress.level + 1,
              xp: progress.xpForNext - progress.xpIntoLevel,
            })}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("levelProgress", {
              level: progress.level + 1,
              xp: format.number(progress.xpForNext - progress.xpIntoLevel),
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalsCard({ detail }: { detail: AttributeDetail }) {
  const t = useTranslations("development.attributeDetail");
  const tf = useTranslations("development.form.weights");
  const statusLabel = useGoalStatusLabel();
  return (
    <SectionCard
      icon={<Target className="size-4" aria-hidden />}
      title={t("goals")}
      testId="attribute-goals"
    >
      {detail.goals.length === 0 ? (
        <EmptyState title={t("noGoals")} />
      ) : (
        <ul className="flex flex-col">
          {detail.goals.map((goal) => {
            const weight = goal.attributes.find(
              (a) => a.attributeId === detail.attribute.id,
            )!.weight;
            return (
              <li key={goal.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <Link
                  href={goalHref(goal.id)}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {goal.title}
                </Link>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("weight", { weight: tf(String(weight) as "1" | "2" | "3") })}</span>
                  <span className="rounded bg-surface-muted px-1.5 py-0.5">
                    {statusLabel(goal.status)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function OpenTasksCard({ detail }: { detail: AttributeDetail }) {
  const t = useTranslations("development.attributeDetail");
  return (
    <SectionCard
      icon={<ListTodo className="size-4" aria-hidden />}
      title={t("openTasks")}
      testId="attribute-open-tasks"
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t("openTasksHint")}</p>
      {detail.openTasks.length === 0 ? (
        <EmptyState title={t("noOpenTasks")} />
      ) : (
        <ul className="flex flex-col">
          {detail.openTasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 py-1.5 text-sm">
              <StatusIcon category={task.statusCategory} />
              <Link href={`/tasks?task=${task.id}`} className="min-w-0 truncate hover:underline">
                {task.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function EntriesCard({ detail }: { detail: AttributeDetail }) {
  const t = useTranslations("development.attributeDetail");
  const attributes = useMemo(
    () => new Map(detail.allAttributes.map((a) => [a.id, a])),
    [detail.allAttributes],
  );
  return (
    <SectionCard
      icon={<History className="size-4" aria-hidden />}
      title={t("entries")}
      testId="attribute-entries"
    >
      {detail.recentEntries.length === 0 ? (
        <EmptyState title={t("noEntries")} />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {detail.recentEntries.map((entry) => (
            <XpEntryRow key={entry.id} entry={entry} attributes={attributes} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SourcesCard({ detail }: { detail: AttributeDetail }) {
  const t = useTranslations("development.attributeDetail");
  const format = useFormatter();
  const top = detail.sources[0]?.growthXp ?? 0;
  return (
    <SectionCard
      icon={<PieChart className="size-4" aria-hidden />}
      title={t("sources")}
      testId="attribute-sources"
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t("sourcesHint")}</p>
      {detail.sources.length === 0 ? (
        <EmptyState title={t("noSources")} />
      ) : (
        <ol className="flex flex-col gap-3">
          {detail.sources.map((source) => {
            const title = source.title || t("untitled");
            return (
              <li key={`${source.sourceType}:${source.sourceId}`} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{title}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {format.number(source.growthXp, SIGNED)}
                  </span>
                </div>
                <ProgressBar value={top ? source.growthXp / top : 0} label={title} />
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
