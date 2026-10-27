"use client";

import {
  FolderKanban,
  Gift,
  ListTodo,
  Settings,
  Shield,
  Sprout,
  Swords,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { REWARD_XP_RATES } from "@/modules/character/domain";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";
import { ProgressBar } from "@/shared/ui/progress-bar";

import type { DashboardOverview } from "../domain";
import { GrowthSection } from "./growth-section";
import { RecentActivity } from "./recent-activity";
import { GrowthFocusCard, LevelRewardCard, RewardStoreCard, WeekCard } from "./side-cards";
import { useDashboard } from "./use-dashboard";

const quickLinks: {
  key: "tasks" | "projects" | "character" | "rewards" | "settings";
  href: string;
  icon: LucideIcon;
}[] = [
  { key: "tasks", href: "/tasks", icon: ListTodo },
  { key: "projects", href: "/projects", icon: FolderKanban },
  { key: "character", href: "/character", icon: Swords },
  { key: "rewards", href: "/rewards", icon: Gift },
  { key: "settings", href: "/settings", icon: Settings },
];

/**
 * The authenticated home: a read-only view of the character. DOM order is the phone order
 * (character → XP → growth → focus → rewards → week → activity); wider screens rearrange it.
 */
export function DashboardView({ title, userName }: { title: string; userName: string }) {
  const t = useTranslations("dashboard");
  const { data } = useDashboard();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="dashboard">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          <nav aria-label={t("links.label")} className="flex flex-wrap gap-1.5">
            {quickLinks.map(({ key, href, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:bg-surface-muted"
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                {t(`links.${key}`)}
              </Link>
            ))}
          </nav>
        }
      />
      {data ? (
        <>
          <CharacterHeader userName={userName} data={data} />
          <XpCards data={data} />
          <GrowthSection data={data} />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <GrowthFocusCard data={data} />
            <LevelRewardCard data={data} />
            <RewardStoreCard data={data} className="md:col-span-2 lg:col-span-1" />
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <WeekCard data={data} />
            <RecentActivity data={data} className="lg:col-span-2" />
          </div>
        </>
      ) : (
        <DashboardSkeleton />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="h-36 animate-pulse rounded-lg bg-surface-muted" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-lg bg-surface-muted" />
    </div>
  );
}

function CharacterHeader({ userName, data }: { userName: string; data: DashboardOverview }) {
  const t = useTranslations("dashboard.header");
  const tStages = useTranslations("character.stages");
  const format = useFormatter();
  const { level, stage } = data;
  const percent = Math.floor(level.ratio * 100);

  return (
    <Card data-testid="character-header">
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
        <div className="flex items-center gap-4">
          <span className="relative flex size-20 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Shield className="size-12" strokeWidth={1.5} aria-hidden />
            <span className="absolute text-lg font-bold tabular-nums">{level.level}</span>
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm text-muted-foreground">{userName}</span>
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-3xl font-semibold tracking-tight" data-testid="dashboard-level">
                {t("level", { level: level.level })}
              </span>
              <span
                className="rounded-full bg-primary/12 px-2.5 py-0.5 text-sm font-medium text-primary"
                data-testid="dashboard-stage"
              >
                {tStages(stage.stage.key)}
              </span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {stage.stage.endLevel
                ? t("stageRange", { start: stage.stage.startLevel, end: stage.stage.endLevel })
                : t("stageRangeOpen", { start: stage.stage.startLevel })}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:border-l sm:border-border sm:pl-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-lg font-semibold tabular-nums" data-testid="dashboard-level-xp">
              {t("levelXp", {
                current: format.number(level.xpIntoLevel),
                needed: format.number(level.xpForNext),
              })}
            </span>
            <span className="text-2xl font-semibold text-primary tabular-nums">
              {t("percent", { percent })}
            </span>
          </div>
          <ProgressBar
            value={level.ratio}
            label={t("progressLabel", { level: level.level + 1 })}
            className="h-2.5"
          />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="font-medium" data-testid="dashboard-to-next">
              {t("toNext", {
                level: level.level + 1,
                xp: format.number(level.xpForNext - level.xpIntoLevel),
              })}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("lifetime", { xp: format.number(level.xp) })}
            </span>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {stage.nextStage && stage.xpToNextStage !== null
              ? t("toNextStage", {
                  stage: tStages(stage.nextStage.key),
                  xp: format.number(stage.xpToNextStage),
                })
              : t("lastStage")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Three currencies, never merged: what is spendable and what is not must be obvious. */
function XpCards({ data }: { data: DashboardOverview }) {
  const t = useTranslations("dashboard.currencies");
  const { balances, totals, week } = data;
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="dashboard-currencies">
      <CurrencyCard
        testId="dash-active"
        icon={<Zap className="size-4" aria-hidden />}
        title={t("active.title")}
        badge={t("active.badge")}
        spendableBadge
        hint={t("active.hint")}
        figures={[
          { key: "lifetime", label: t("lifetime"), value: totals.lifetimeActiveXp },
          {
            key: "spendable",
            label: t("spendable"),
            value: balances.spendableActiveXp,
            accent: true,
          },
          { key: "week", label: t("thisWeek"), value: week.activeXp, signed: true },
        ]}
      />
      <CurrencyCard
        testId="dash-growth"
        icon={<Sprout className="size-4" aria-hidden />}
        title={t("growth.title")}
        badge={t("growth.badge")}
        hint={t("growth.hint")}
        figures={[
          { key: "lifetime", label: t("lifetime"), value: totals.growthXp },
          { key: "week", label: t("thisWeek"), value: week.growthXp, signed: true },
        ]}
      />
      <CurrencyCard
        testId="dash-level"
        icon={<Shield className="size-4" aria-hidden />}
        title={t("level.title")}
        badge={t("level.badge")}
        spendableBadge
        hint={t("level.hint", { rate: REWARD_XP_RATES.level / REWARD_XP_RATES.active })}
        figures={[
          { key: "lifetime", label: t("lifetime"), value: totals.lifetimeLevelXp },
          {
            key: "spendable",
            label: t("spendable"),
            value: balances.spendableLevelXp,
            accent: true,
          },
          { key: "week", label: t("thisWeek"), value: week.levelXp, signed: true },
        ]}
      />
    </div>
  );
}

const SIGNED = { signDisplay: "exceptZero" } as const;

interface Figure {
  key: string;
  label: string;
  value: number;
  accent?: boolean;
  signed?: boolean;
}

function CurrencyCard({
  testId,
  icon,
  title,
  badge,
  spendableBadge = false,
  hint,
  figures,
}: {
  testId: string;
  icon: ReactNode;
  title: string;
  badge: string;
  spendableBadge?: boolean;
  hint: string;
  figures: Figure[];
}) {
  const format = useFormatter();
  return (
    <Card data-testid={testId}>
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-primary">{icon}</span>
            {title}
          </h2>
          <span
            className={
              spendableBadge
                ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                : "rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
            data-testid={`${testId}-badge`}
          >
            {badge}
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {figures.map((figure) => (
            <div key={figure.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              <dd
                className={
                  figure.accent
                    ? "truncate text-xl font-semibold text-primary"
                    : figure.signed
                      ? "truncate pt-1 text-sm font-medium text-muted-foreground"
                      : "truncate text-xl font-semibold"
                }
                data-testid={`${testId}-${figure.key}`}
              >
                {format.number(figure.value, figure.signed ? SIGNED : undefined)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
