"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Gift, Settings2, Shield, Sprout, Zap } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";
import { PageHeader } from "@/shared/ui/page-header";
import { ProgressBar } from "@/shared/ui/progress-bar";

import type { CharacterOverview as Overview, DevelopmentAttribute, XpEntry } from "../domain";
import { RadarChart } from "./radar-chart";
import {
  useAttributeAmount,
  useAttributeLabel,
  useCharacterOverview,
  useDevelopmentAttributes,
} from "./use-character";
import { XpEntryRow } from "./xp-entry";

/** The character page: level, attributes (radar + list) and the latest ledger lines. */
export function CharacterOverview({ title, userName }: { title: string; userName: string }) {
  const t = useTranslations("character");
  const trpc = useTRPC();
  const { data } = useCharacterOverview();
  // Spendable balances belong to the rewards module (lifetime − spent); shown here read-only.
  const { data: balances } = useQuery({
    ...trpc.rewards.balances.queryOptions(),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: allAttributes = [] } = useDevelopmentAttributes();
  // History may credit archived attributes too: look labels up in the full list.
  const attributeMap = useMemo(() => new Map(allAttributes.map((a) => [a.id, a])), [allAttributes]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={title}
        description={t("overview.description")}
        actions={
          <Link
            href="/rewards"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            <Gift className="size-4 text-primary" aria-hidden />
            {t("overview.toRewards")}
          </Link>
        }
      />
      {data ? (
        <>
          <LevelCard userName={userName} overview={data} />

          <div className="grid gap-4 md:grid-cols-3" data-testid="xp-currencies">
            <CurrencyCard
              testId="active-xp"
              icon={<Zap className="size-4" aria-hidden />}
              title={t("currencies.active.title")}
              hint={t("currencies.active.hint")}
              lifetime={data.totals.lifetimeActiveXp}
              spendable={balances?.spendableActiveXp}
            />
            <CurrencyCard
              testId="level-xp"
              icon={<Shield className="size-4" aria-hidden />}
              title={t("currencies.level.title")}
              hint={t("currencies.level.hint")}
              lifetime={data.totals.lifetimeLevelXp}
              spendable={balances?.spendableLevelXp}
            />
            <CurrencyCard
              testId="growth-xp"
              icon={<Sprout className="size-4" aria-hidden />}
              title={t("currencies.growth.title")}
              hint={t("currencies.growth.hint")}
              lifetime={data.totals.growthXp}
              footnote={
                data.totals.legacyGrowthXp !== 0
                  ? t("currencies.growth.legacy", { xp: data.totals.legacyGrowthXp })
                  : null
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t("attributes.radar")}</CardTitle>
              </CardHeader>
              <CardContent>
                <RadarChart attributes={data.attributes.filter((a) => a.onRadar)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{t("attributes.title")}</CardTitle>
                <Link
                  href="/character/attributes"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <Settings2 className="size-4" aria-hidden />
                  {t("attributes.manage")}
                </Link>
              </CardHeader>
              <CardContent>
                <AttributeList attributes={data.attributes} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <EntriesCard
              title={t("recent.grants")}
              empty={t("recent.emptyGrants")}
              entries={data.recentGrants}
              attributes={attributeMap}
              testId="recent-grants"
            />
            <EntriesCard
              title={t("recent.reversals")}
              empty={t("recent.emptyReversals")}
              entries={data.recentReversals}
              attributes={attributeMap}
              testId="recent-reversals"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function LevelCard({ userName, overview }: { userName: string; overview: Overview }) {
  const t = useTranslations("character");
  const format = useFormatter();
  const { level, stage } = overview;
  const label = t("overview.progressLabel", {
    current: format.number(level.xpIntoLevel),
    needed: format.number(level.xpForNext),
  });
  return (
    <Card data-testid="level-card">
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Shield className="size-9" aria-hidden />
            <span className="absolute text-sm font-bold tabular-nums">{level.level}</span>
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm text-muted-foreground">{userName}</span>
            <span className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight" data-testid="character-level">
                {t("overview.level", { level: level.level })}
              </span>
              <span
                className="rounded-full bg-primary/12 px-2 py-0.5 text-sm font-medium text-primary"
                data-testid="growth-stage"
              >
                {t(`stages.${stage.stage.key}`)}
              </span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {stage.stage.endLevel
                ? t("overview.stageRange", {
                    start: stage.stage.startLevel,
                    end: stage.stage.endLevel,
                  })
                : t("overview.stageRangeOpen", { start: stage.stage.startLevel })}
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 sm:border-l sm:border-border sm:pl-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              <span className="text-muted-foreground">{t("overview.lifetimeLevelXp")}</span>{" "}
              <span className="text-lg font-semibold tabular-nums" data-testid="lifetime-level-xp">
                {format.number(level.xp)}
              </span>
              <span className="text-muted-foreground"> XP</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("overview.counts", {
                grants: overview.grantCount,
                reversals: overview.reversalCount,
              })}
            </span>
          </div>
          <ProgressBar value={level.ratio} label={label} className="h-2" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{label}</span>
            <span className="tabular-nums">
              {t("overview.toNext", {
                xp: format.number(level.xpForNext - level.xpIntoLevel),
                level: level.level + 1,
              })}
            </span>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {stage.nextStage && stage.xpToNextStage !== null
              ? t("overview.toNextStage", {
                  stage: t(`stages.${stage.nextStage.key}`),
                  xp: format.number(stage.xpToNextStage),
                })
              : t("overview.lastStage")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** Lifetime vs spendable, side by side and labelled, so neither is mistaken for the other. */
function CurrencyCard({
  testId,
  icon,
  title,
  hint,
  lifetime,
  spendable,
  footnote,
}: {
  testId: string;
  icon: ReactNode;
  title: string;
  hint: string;
  lifetime: number;
  /** Omitted for Growth XP, which is never spent. */
  spendable?: number;
  footnote?: string | null;
}) {
  const t = useTranslations("character.currencies");
  const format = useFormatter();
  return (
    <Card data-testid={testId}>
      <CardContent className="flex h-full flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              {spendable === undefined ? t("growth.total") : t("lifetime")}
            </dt>
            <dd className="text-xl font-semibold tabular-nums" data-testid={`${testId}-lifetime`}>
              {format.number(lifetime)}
            </dd>
          </div>
          {spendable === undefined ? null : (
            <div>
              <dt className="text-xs text-muted-foreground">{t("spendable")}</dt>
              <dd
                className="text-xl font-semibold text-primary tabular-nums"
                data-testid={`${testId}-spendable`}
              >
                {format.number(spendable)}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-auto text-xs text-muted-foreground">{hint}</p>
        {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
      </CardContent>
    </Card>
  );
}

function AttributeList({ attributes }: { attributes: Overview["attributes"] }) {
  const t = useTranslations("character.attributes");
  const label = useAttributeLabel();
  const amount = useAttributeAmount();
  if (attributes.length === 0) return <CardDescription>{t("empty")}</CardDescription>;
  return (
    <ul className="flex flex-col gap-4" aria-label={t("title")}>
      {attributes.map((attribute) => (
        <li key={attribute.id} data-testid="attribute-row" className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-sm">
            <ColorDot color={attribute.color} />
            {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
            <span className="min-w-0 truncate font-medium">{label(attribute)}</span>
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
              {t("level", { level: attribute.progress.level })}
            </span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {amount(attribute)}
            </span>
          </div>
          <ProgressBar
            value={attribute.progress.ratio}
            label={t("progressLabel", { name: label(attribute) })}
          />
        </li>
      ))}
    </ul>
  );
}

function EntriesCard({
  title,
  empty,
  entries,
  attributes,
  testId,
}: {
  title: string;
  empty: string;
  entries: XpEntry[];
  attributes: ReadonlyMap<string, DevelopmentAttribute>;
  testId: string;
}) {
  const t = useTranslations("character.overview");
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link
          href="/character/xp"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t("viewHistory")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="pt-3">
        {entries.length === 0 ? (
          <CardDescription>{empty}</CardDescription>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {entries.map((entry) => (
              <XpEntryRow key={entry.id} entry={entry} attributes={attributes} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
