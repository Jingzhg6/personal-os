"use client";

import { ChevronRight, Settings2, Sprout, Star } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { useAttributeLabel } from "@/modules/character/ui";

import { RECENT_WINDOW_DAYS, type AttributeSummary, type DevelopmentOverview } from "../domain";
import { AttributeName, attributeHref, EmptyState, SectionCard } from "./bits";

const DATE = { month: "short", day: "numeric" } as const;
const SIGNED = { signDisplay: "exceptZero" } as const;

/** 成长能力: every active attribute with its growth, goals and last activity. */
export function AttributesSection({ data }: { data: DevelopmentOverview }) {
  const t = useTranslations("development.attributes");
  const manage = (
    <Link
      href="/character/attributes"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
    >
      <Settings2 className="size-4" aria-hidden />
      {t("manage")}
    </Link>
  );
  return (
    <SectionCard
      icon={<Sprout className="size-4" aria-hidden />}
      title={t("title")}
      action={manage}
      testId="attributes"
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t("hint")}</p>
      {data.attributes.length === 0 ? (
        <EmptyState title={t("empty")} action={manage} testId="attributes-empty" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.attributes.map((summary) => (
            <AttributeCard key={summary.attribute.id} summary={summary} />
          ))}
        </ul>
      )}
      {data.archivedAttributes.length > 0 ? (
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground select-none">
            {t("archived", { count: data.archivedAttributes.length })}
          </summary>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {data.archivedAttributes.map((attribute) => (
              <li key={attribute.id}>
                <AttributeName
                  attribute={attribute}
                  href={attributeHref(attribute.id)}
                  className="text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </SectionCard>
  );
}

function AttributeCard({ summary }: { summary: AttributeSummary }) {
  const t = useTranslations("development.attributes");
  const format = useFormatter();
  const label = useAttributeLabel();
  const { attribute } = summary;
  return (
    <li data-testid="attribute-card">
      <Link
        href={attributeHref(attribute.id)}
        aria-label={t("open", { name: label(attribute) })}
        className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-muted/50"
      >
        <div className="flex items-center justify-between gap-2">
          <AttributeName attribute={attribute} className="text-base font-semibold" />
          <span className="flex shrink-0 items-center gap-1.5">
            {summary.focused ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary"
                data-testid="attribute-focused"
              >
                <Star className="size-3" aria-hidden />
                {t("focused")}
              </span>
            ) : null}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("lifetime")}</dt>
            <dd className="text-lg font-semibold" data-testid="attribute-lifetime">
              {t("xp", { xp: format.number(summary.lifetimeGrowthXp) })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("recent", { days: RECENT_WINDOW_DAYS })}
            </dt>
            <dd className="text-lg font-semibold text-primary" data-testid="attribute-recent">
              {format.number(summary.recentGrowthXp, SIGNED)}
            </dd>
          </div>
        </dl>
        <div className="mt-auto flex flex-col gap-0.5 text-xs text-muted-foreground">
          <span>
            {summary.activeGoalCount > 0
              ? t("goals", { count: summary.activeGoalCount })
              : t("noGoals")}
          </span>
          <span>
            {summary.lastActivityAt
              ? t("lastActivity", { date: format.dateTime(summary.lastActivityAt, DATE) })
              : t("never")}
          </span>
        </div>
      </Link>
    </li>
  );
}
