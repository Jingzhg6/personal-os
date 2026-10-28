"use client";

import { useQuery } from "@tanstack/react-query";
import { History, Lock, ScrollText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

import {
  attributeScore,
  DISCIPLINE_POINTS,
  getLevelProgress,
  type DisciplineEntry,
  type DisciplineOutcome,
} from "../domain";

const SIGNED = { signDisplay: "exceptZero" } as const;
const DATE_TIME = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" } as const;
const RULE_ROWS: DisciplineOutcome[] = [
  "early",
  "on_time",
  "late",
  "overdue",
  "failed",
  "cancelled",
];

export function useDisciplineSummary() {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.character.discipline.summary.queryOptions({ limit: 50 }),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

/** 自制力: score, the fixed rules, the scoring history and the honest state of overdue checks. */
export function DisciplinePanel() {
  const t = useTranslations("character.discipline");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data } = useDisciplineSummary();
  const { data: health } = useQuery(trpc.automation.health.queryOptions());
  if (!data) return <div className="h-64 animate-pulse rounded-lg bg-surface-muted" aria-hidden />;
  const level = getLevelProgress(
    attributeScore({ systemKey: "discipline", xp: 0, points: data.score }),
  );

  return (
    <div className="flex flex-col gap-6" data-testid="discipline-panel">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl" aria-hidden>
              🎯
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              {t("system")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t("score")}</dt>
              <dd
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  data.score < 0 && "text-danger",
                )}
                data-testid="discipline-score"
              >
                {t("points", { points: format.number(data.score) })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("levelLabel")}</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {t("level", { level: level.level })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("scoredTasks")}</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {format.number(data.scoredTasks)}
              </dd>
            </div>
          </dl>
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              health?.scheduler.operational
                ? "border-success/50 bg-success/10"
                : "border-warning/60 bg-warning/10",
            )}
            data-testid="discipline-worker"
          >
            {health?.scheduler.operational ? t("workerOk") : t("workerMissing")}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="discipline-rules">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-primary" aria-hidden />
              {t("rulesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("outcome")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("pointsHeader")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {RULE_ROWS.map((outcome) => (
                  <tr key={outcome} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">{t(`outcomes.${outcome}`)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {format.number(DISCIPLINE_POINTS[outcome], SIGNED)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">{t("definitions")}</p>
            <p className="text-xs text-muted-foreground">{t("netRule")}</p>
          </CardContent>
        </Card>

        <Card data-testid="discipline-history">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-primary" aria-hidden />
              {t("historyTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.entries.map((entry) => (
                  <DisciplineEntryRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DisciplineEntryRow({ entry }: { entry: DisciplineEntry }) {
  const t = useTranslations("character.discipline");
  const format = useFormatter();
  return (
    <li
      className="flex items-start justify-between gap-3 py-2.5 first:pt-0"
      data-testid="discipline-entry"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{entry.taskTitle}</span>
        <span className="text-xs text-muted-foreground">
          {t(`reasons.${entry.reason}`)} · {format.dateTime(entry.createdAt, DATE_TIME)} ·{" "}
          {t("net", { points: format.number(entry.netAfter, SIGNED) })}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          entry.points > 0 ? "text-success" : "text-danger",
        )}
      >
        {format.number(entry.points, SIGNED)}
      </span>
    </li>
  );
}

/** The 自制力 result of one task, for the task panel. */
export function TaskDisciplineBadge({ taskId }: { taskId: string }) {
  const t = useTranslations("character.discipline");
  const format = useFormatter();
  const trpc = useTRPC();
  const { data } = useQuery({
    ...trpc.character.discipline.forTask.queryOptions({ taskId }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  if (!data) return null;
  const last = data.entries.at(-1);
  return (
    <div className="flex flex-col gap-1" data-testid="task-discipline">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">🎯 {t("taskLabel")}</span>
        {last ? (
          <>
            <span
              className={cn(
                "font-semibold tabular-nums",
                data.net > 0 ? "text-success" : data.net < 0 ? "text-danger" : undefined,
              )}
              data-testid="task-discipline-net"
            >
              {t("signed", { points: format.number(data.net, SIGNED) })}
            </span>
            <span className="text-muted-foreground">{t(`reasons.${last.reason}`)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t("taskNone")}</span>
        )}
      </div>
      {!last ? <span className="text-xs text-muted-foreground">{t("taskHint")}</span> : null}
    </div>
  );
}
