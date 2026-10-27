"use client";

import { CheckCircle2, FolderKanban, Flag, Undo2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { ColorDot } from "@/shared/ui/color";

import type { DevelopmentAttribute, XpEntry, XpSourceType } from "../domain";
import { sourceHref, useAttributeLabel } from "./use-character";

const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

const sourceIcons: Record<XpSourceType, typeof CheckCircle2> = {
  task: CheckCircle2,
  project: FolderKanban,
  milestone: Flag,
};

/** One ledger line: what happened, to which source, which attribute, how much and when. */
export function XpEntryRow({
  entry,
  attributes,
}: {
  entry: XpEntry;
  attributes: ReadonlyMap<string, DevelopmentAttribute>;
}) {
  const t = useTranslations("character");
  const format = useFormatter();
  const attributeLabel = useAttributeLabel();
  const reversal = entry.kind === "reversal";
  const Icon = reversal ? Undo2 : sourceIcons[entry.sourceType];
  const title = entry.sourceTitle || t("history.untitled");
  const href = sourceHref(entry.sourceType, entry.sourceId);
  const reason = t(`reasons.${entry.sourceEventType}` as "reasons.task.completed");

  return (
    <li
      data-testid="xp-entry"
      data-kind={entry.kind}
      className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-surface-muted/60"
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          reversal
            ? "bg-red-500/10 text-red-600 dark:text-red-300"
            : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="shrink-0 text-muted-foreground">{reason}</span>
          {href ? (
            <Link
              href={href}
              className="min-w-0 truncate font-medium hover:underline"
              aria-label={t("history.openSource", { title })}
            >
              {title}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-medium">{title}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{t(`sources.${entry.sourceType}`)}</span>
          {entry.credits.length === 0 ? (
            <span>{t("history.overallOnly")}</span>
          ) : (
            entry.credits.map((credit) => {
              const attribute = attributes.get(credit.attributeId);
              return attribute ? (
                <span
                  key={credit.attributeId}
                  data-testid="xp-credit"
                  className="inline-flex items-center gap-1"
                >
                  <ColorDot color={attribute.color} />
                  {attribute.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                  {attributeLabel(attribute)}
                  <span className="tabular-nums">
                    {credit.amount > 0 ? `+${credit.amount}` : credit.amount}
                  </span>
                </span>
              ) : null;
            })
          )}
          <time dateTime={entry.createdAt.toISOString()} className="tabular-nums">
            {format.dateTime(entry.createdAt, DATE_TIME)}
          </time>
          {entry.reversed ? (
            <span className="rounded bg-surface-muted px-1.5 py-0.5">{t("history.reversed")}</span>
          ) : null}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          reversal ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300",
          entry.reversed && "text-muted-foreground line-through",
        )}
      >
        {reversal ? `${entry.amount}` : `+${entry.amount}`}
      </span>
    </li>
  );
}
