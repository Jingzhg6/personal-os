"use client";

import { ArrowRight, Settings2, Shield } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useAreaLabel, useAreas } from "@/modules/areas/ui";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { ColorDot } from "@/shared/ui/color";
import { Dialog } from "@/shared/ui/dialog";
import { PageHeader } from "@/shared/ui/page-header";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import type { Attribute, AttributeValue, XpEntry } from "../domain";
import { RadarChart } from "./radar-chart";
import { useAttributeLabel, useCharacterOverview, useSetAttributeArea } from "./use-character";
import { XpEntryRow } from "./xp-entry";

/** The character page: level, attributes (radar + list) and the latest ledger lines. */
export function CharacterOverview({ title, userName }: { title: string; userName: string }) {
  const t = useTranslations("character");
  const { data } = useCharacterOverview();
  const [editing, setEditing] = useState(false);
  const attributeMap = useMemo(
    () => new Map((data?.attributes ?? []).map((a) => [a.id, a])),
    [data],
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={title} description={t("overview.description")} />
      {data ? (
        <>
          <LevelCard
            userName={userName}
            progress={data.progress}
            grants={data.grantCount}
            reversals={data.reversalCount}
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t("attributes.radar")}</CardTitle>
              </CardHeader>
              <CardContent>
                <RadarChart attributes={data.attributes} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{t("attributes.title")}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Settings2 />
                  {t("attributes.edit")}
                </Button>
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

          {editing ? (
            <AttributeAreasDialog attributes={data.attributes} onClose={() => setEditing(false)} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function LevelCard({
  userName,
  progress,
  grants,
  reversals,
}: {
  userName: string;
  progress: AttributeValue["progress"];
  grants: number;
  reversals: number;
}) {
  const t = useTranslations("character.overview");
  const label = t("progressLabel", { current: progress.xpIntoLevel, needed: progress.xpForNext });
  return (
    <Card data-testid="level-card">
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Shield className="size-9" aria-hidden />
            <span className="absolute text-sm font-bold tabular-nums">{progress.level}</span>
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-muted-foreground">{userName}</span>
            <span className="text-2xl font-semibold tracking-tight">
              {t("level", { level: progress.level })}
            </span>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 sm:border-l sm:border-border sm:pl-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              <span className="text-muted-foreground">{t("totalXp")}</span>{" "}
              <span className="text-lg font-semibold tabular-nums" data-testid="total-xp">
                {progress.xp}
              </span>
              <span className="text-muted-foreground"> XP</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("counts", { grants, reversals })}
            </span>
          </div>
          <ProgressBar value={progress.ratio} label={label} className="h-2" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{label}</span>
            <span className="tabular-nums">
              {t("toNext", {
                xp: progress.xpForNext - progress.xpIntoLevel,
                level: progress.level + 1,
              })}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AttributeList({ attributes }: { attributes: AttributeValue[] }) {
  const t = useTranslations("character.attributes");
  const label = useAttributeLabel();
  const areaLabel = useAreaLabel();
  const { data: areas = [] } = useAreas();
  return (
    <ul className="flex flex-col gap-4" aria-label={t("title")}>
      {attributes.map((attribute) => {
        const linked = areas.filter((area) => attribute.areaIds.includes(area.id));
        return (
          <li key={attribute.id} data-testid="attribute-row" className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <ColorDot color={attribute.color} />
              <span className="font-medium">{label(attribute)}</span>
              <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
                {t("level", { level: attribute.progress.level })}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {t("xp", { xp: attribute.xp })}
              </span>
            </div>
            <ProgressBar
              value={attribute.progress.ratio}
              label={t("progressLabel", { name: label(attribute) })}
            />
            <span className="truncate text-xs text-muted-foreground">
              {linked.length > 0
                ? t("areas", { areas: linked.map(areaLabel).join("、") })
                : t("noAreas")}
            </span>
          </li>
        );
      })}
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
  attributes: ReadonlyMap<string, Attribute>;
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

function AttributeAreasDialog({
  attributes,
  onClose,
}: {
  attributes: Attribute[];
  onClose: () => void;
}) {
  const t = useTranslations("character.attributes");
  const label = useAttributeLabel();
  const areaLabel = useAreaLabel();
  const toast = useToast();
  const { data: areas = [] } = useAreas();
  const setArea = useSetAttributeArea();
  const linkedTo = (areaId: string) => attributes.find((a) => a.areaIds.includes(areaId))?.id ?? "";

  return (
    <Dialog open title={t("editTitle")} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{t("editDescription")}</p>
      <ul className="flex flex-col gap-3">
        {areas.map((area) => (
          <li key={area.id} className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <ColorDot color={area.color} />
              <span className="truncate">{areaLabel(area)}</span>
            </span>
            <Select
              aria-label={t("areaLabel", { area: areaLabel(area) })}
              value={linkedTo(area.id)}
              className="w-40"
              onChange={(event) =>
                setArea.mutate(
                  { areaId: area.id, attributeId: event.target.value || null },
                  { onSuccess: () => toast.show(t("saved")) },
                )
              }
            >
              <option value="">{t("none")}</option>
              {attributes.map((attribute) => (
                <option key={attribute.id} value={attribute.id}>
                  {label(attribute)}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
