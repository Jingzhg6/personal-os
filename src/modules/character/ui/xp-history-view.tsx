"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

import {
  ATTRIBUTE_LEVEL_STEP,
  CHARACTER_LEVEL_STEP,
  MILESTONE_XP,
  PROJECT_XP,
  TASK_XP,
  type XpEntryKind,
} from "../domain";
import { useAttributeLabel, useDevelopmentAttributes, useXpHistory } from "./use-character";
import { XpEntryRow } from "./xp-entry";

const kinds = ["all", "grant", "reversal"] as const;

/** The full ledger, newest first, filterable by kind and attribute (state in the URL). */
export function XpHistoryView({ title }: { title: string }) {
  const t = useTranslations("character.history");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const attributeLabel = useAttributeLabel();
  const archivedLabel = useTranslations("character.attributes")("archivedSuffix");
  const kindParam = searchParams.get("kind");
  const kind: XpEntryKind | undefined =
    kindParam === "grant" || kindParam === "reversal" ? kindParam : undefined;
  const attributeId = searchParams.get("attribute") ?? undefined;

  const { data: allAttributes = [] } = useDevelopmentAttributes();
  // Archived attributes keep their history, so they stay available here.
  const attributes = useMemo(() => new Map(allAttributes.map((a) => [a.id, a])), [allAttributes]);
  const history = useXpHistory({ kind, attributeId });
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];

  const setParam = (key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={title} description={t("description")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label={t("filter")}
                className="inline-flex rounded-md border border-border p-0.5"
              >
                {kinds.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={(kind ?? "all") === key}
                    onClick={() => setParam("kind", key === "all" ? undefined : key)}
                    className={cn(
                      "rounded px-3 py-1 text-sm",
                      (kind ?? "all") === key
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`kinds.${key}`)}
                  </button>
                ))}
              </div>
              <Select
                aria-label={t("attribute")}
                value={attributeId ?? ""}
                onChange={(event) => setParam("attribute", event.target.value || undefined)}
                className="w-48"
              >
                <option value="">{t("allAttributes")}</option>
                {allAttributes.map((attribute) => (
                  <option key={attribute.id} value={attribute.id}>
                    {attribute.archivedAt
                      ? `${attributeLabel(attribute)} · ${archivedLabel}`
                      : attributeLabel(attribute)}
                  </option>
                ))}
              </Select>
            </div>

            {!history.isPending && entries.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul aria-label={t("list")} className="-mx-2 flex flex-col">
                {entries.map((entry) => (
                  <XpEntryRow key={entry.id} entry={entry} attributes={attributes} />
                ))}
              </ul>
            )}
            {history.hasNextPage ? (
              <Button
                variant="secondary"
                className="self-center"
                disabled={history.isFetchingNextPage}
                onClick={() => history.fetchNextPage()}
              >
                {t("loadMore")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <RulesCard />
      </div>
    </div>
  );
}

/** The XP rules, read from the same constants the server uses. */
function RulesCard() {
  const t = useTranslations("character.rules");
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-2 pl-4 text-sm marker:text-muted-foreground">
          <li>{t("task", { ...TASK_XP })}</li>
          <li>{t("milestone", { amount: MILESTONE_XP })}</li>
          <li>{t("project", { ...PROJECT_XP })}</li>
          <li>{t("contributions")}</li>
          <li>{t("reversal")}</li>
          <li>
            {t("levels", { step: CHARACTER_LEVEL_STEP, attributeStep: ATTRIBUTE_LEVEL_STEP })}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
