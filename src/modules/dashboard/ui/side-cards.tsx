"use client";

import { ArrowRight, CalendarDays, Compass, Gift, Lock, Shield, Trophy, Zap } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";

import { useAttributeLabel } from "@/modules/character/ui";
import { firstEarlyClaimLevel } from "@/modules/rewards/domain";
import { useLevelRewardLabel } from "@/modules/rewards/ui";
import { cn } from "@/shared/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";
import { ProgressBar } from "@/shared/ui/progress-bar";

import { FOCUS_WINDOW_DAYS, type AttributeGrowth, type DashboardOverview } from "../domain";

const DAY = { month: "long", day: "numeric", timeZone: "UTC" } as const;
const SIGNED = { signDisplay: "exceptZero" } as const;

function SectionCard({
  icon,
  title,
  action,
  children,
  className,
  testId,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)} data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function useAttributeOf(data: DashboardOverview) {
  return useMemo(
    () => new Map(data.attributes.map((attribute) => [attribute.id, attribute])),
    [data.attributes],
  );
}

function AttributeName({ data, growth }: { data: DashboardOverview; growth: AttributeGrowth }) {
  const label = useAttributeLabel();
  const attribute = useAttributeOf(data).get(growth.attributeId);
  if (!attribute) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ColorDot color={attribute.color} />
      {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
      <span className="truncate font-medium">{label(attribute)}</span>
    </span>
  );
}

/** 当前成长重点: a deterministic rule over the last 30 days, stated on the card. */
export function GrowthFocusCard({ data }: { data: DashboardOverview }) {
  const t = useTranslations("dashboard.focus");
  const format = useFormatter();
  const { fastest, slowest } = data.focus;
  const chosen = data.chosenFocusAttributeIds;
  const rows = [
    { key: "fastest" as const, growth: fastest },
    { key: "slowest" as const, growth: slowest },
  ].filter((row) => row.growth !== null);

  return (
    <SectionCard
      icon={<Compass className="size-4" aria-hidden />}
      title={t("title")}
      testId="growth-focus"
      action={<CardLink href="/development">{t("plan")}</CardLink>}
    >
      {chosen.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="chosen-focus">
          <span className="text-xs text-muted-foreground">{t("chosen")}</span>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {chosen.map((attributeId) => (
              <li key={attributeId}>
                <AttributeName data={data} growth={{ attributeId, growthXp: 0 }} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty", { days: FOCUS_WINDOW_DAYS })}</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {rows.map(({ key, growth }) => (
            <div
              key={key}
              className="flex flex-col gap-1 rounded-md bg-surface-muted/60 px-3 py-2.5"
              data-testid={`focus-${key}`}
            >
              <dt className="text-xs text-muted-foreground">{t(key)}</dt>
              <dd className="flex items-center justify-between gap-2 text-sm">
                <AttributeName data={data} growth={growth!} />
                <span className="shrink-0 tabular-nums">
                  {t("value", { xp: format.number(growth!.growthXp), days: FOCUS_WINDOW_DAYS })}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-auto text-xs text-muted-foreground">
        {t("rule", { days: FOCUS_WINDOW_DAYS })}
      </p>
    </SectionCard>
  );
}

/** 本周: this week (user's timezone and week start), read from the ledger. */
export function WeekCard({ data }: { data: DashboardOverview }) {
  const t = useTranslations("dashboard.week");
  const format = useFormatter();
  const { week } = data;
  const stats = [
    { key: "completedTasks" as const, value: format.number(week.completedTasks) },
    { key: "active" as const, value: format.number(week.activeXp, SIGNED) },
    { key: "growth" as const, value: format.number(week.growthXp, SIGNED) },
    { key: "level" as const, value: format.number(week.levelXp, SIGNED) },
  ];
  return (
    <SectionCard
      icon={<CalendarDays className="size-4" aria-hidden />}
      title={t("title")}
      action={
        <span className="text-xs text-muted-foreground">
          {t("since", { date: format.dateTime(new Date(`${week.from}T00:00:00Z`), DAY) })}
        </span>
      }
      testId="week-summary"
    >
      <dl className="grid grid-cols-2 gap-3">
        {stats.map(({ key, value }) => (
          <div key={key} className="rounded-md bg-surface-muted/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(key)}</dt>
            <dd className="text-lg font-semibold" data-testid={`week-${key}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs text-muted-foreground">{t("top")}</h3>
        {week.top.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("topEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="week-top">
            {week.top.map((growth) => (
              <li
                key={growth.attributeId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <AttributeName data={data} growth={growth} />
                <span className="shrink-0 font-medium tabular-nums">
                  {format.number(growth.growthXp, SIGNED)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/** The next level reward; claiming happens on the rewards page (one claim flow). */
export function LevelRewardCard({ data }: { data: DashboardOverview }) {
  const t = useTranslations("dashboard.levelReward");
  const format = useFormatter();
  const label = useLevelRewardLabel();
  const next = data.nextLevelReward;
  const href = "/rewards?tab=level";

  return (
    <SectionCard
      icon={<Trophy className="size-4" aria-hidden />}
      title={t("title")}
      action={data.levelRewardCount > 0 ? <CardLink href={href}>{t("viewAll")}</CardLink> : null}
      testId="next-level-reward"
    >
      {!next ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3">
          <p className="text-sm text-muted-foreground" data-testid="level-reward-empty">
            {data.levelRewardCount > 0 ? t("allClaimed") : t("empty")}
          </p>
          <CardLink href={href}>{t("setup")}</CardLink>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-2xl">
              {next.reward.emoji ?? <Gift className="size-6 text-muted-foreground" aria-hidden />}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {t("target", { level: next.reward.level })}
                </span>
                <span className="truncate font-semibold" data-testid="level-reward-name">
                  {label(next.reward)}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t("current", { level: data.level.level })}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              value={next.ratio}
              label={t("progressLabel", { level: next.reward.level })}
              tone={next.reward.state === "claimable" ? "success" : "primary"}
            />
            <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
              <span>
                {t("progress", {
                  current: format.number(
                    Math.min(data.totals.lifetimeLevelXp, next.requiredLevelXp),
                  ),
                  required: format.number(next.requiredLevelXp),
                })}
              </span>
              {next.missingLevelXp > 0 ? (
                <span>{t("missing", { xp: format.number(next.missingLevelXp) })}</span>
              ) : null}
            </div>
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
            data-testid="level-reward-state"
            data-state={next.reward.state}
          >
            {next.reward.state === "claimable" ? (
              <>
                <span className="text-sm font-medium text-success">{t("claimable")}</span>
                <ActionLink href={href} primary>
                  {t("claim")}
                </ActionLink>
              </>
            ) : next.reward.state === "early" ? (
              <>
                <span className="text-sm">
                  {t("early", {
                    xp: format.number(next.reward.earlyClaimCost ?? next.missingLevelXp),
                  })}
                </span>
                <ActionLink href={href}>{t("earlyAction")}</ActionLink>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <Lock className="size-3.5" aria-hidden />
                {t("locked", { level: firstEarlyClaimLevel(next.reward.level) })}
              </span>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
          : "border border-border hover:bg-surface-muted",
      )}
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** A preview of the reward store; prices come from the rewards module, redeeming happens there. */
export function RewardStoreCard({
  data,
  className,
}: {
  data: DashboardOverview;
  className?: string;
}) {
  const t = useTranslations("dashboard.store");
  const format = useFormatter();
  return (
    <SectionCard
      icon={<Gift className="size-4" aria-hidden />}
      title={t("title")}
      className={className}
      testId="reward-store-preview"
    >
      {data.rewardPreview.length === 0 ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-2">
          <p className="text-sm font-medium" data-testid="store-empty">
            {t("empty")}
          </p>
          <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          <CardLink href="/rewards">{t("create")}</CardLink>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.rewardPreview.map(({ reward, affordable }) => (
            <li
              key={reward.id}
              className="flex items-center gap-3 rounded-md px-1 py-1.5"
              data-testid="store-preview-item"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-lg">
                {reward.emoji ?? <Gift className="size-4 text-muted-foreground" aria-hidden />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{reward.name}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                  {reward.payWithActive ? (
                    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                      <Zap className="size-3 text-xp" aria-hidden />
                      {t("costActive", { xp: format.number(reward.activeXpCost) })}
                    </span>
                  ) : null}
                  {reward.payWithLevel ? (
                    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                      {reward.payWithActive ? <span className="mr-1">{t("or")}</span> : null}
                      <Shield className="size-3 text-primary" aria-hidden />
                      {t("costLevel", { xp: format.number(reward.levelXpCost) })}
                    </span>
                  ) : null}
                </span>
              </div>
              {affordable ? (
                <span className="shrink-0 rounded-full bg-success/12 px-2 py-0.5 text-xs font-medium text-success">
                  {t("affordable")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {data.enabledRewardCount > 0 ? t("count", { count: data.enabledRewardCount }) : null}
        </span>
        <CardLink href="/rewards">{t("enter")}</CardLink>
      </div>
    </SectionCard>
  );
}
