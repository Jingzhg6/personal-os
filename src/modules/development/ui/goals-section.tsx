"use client";

import { Archive, CalendarDays, ChevronRight, FolderKanban, Plus, Target } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ProgressBar } from "@/shared/ui/progress-bar";

import {
  countedActions,
  RECENT_WINDOW_DAYS,
  type DevelopmentGoal,
  type DevelopmentOverview,
  type GoalActionStats,
  type GoalSummary,
} from "../domain";
import { AttributeName, EmptyState, goalHref, SectionCard } from "./bits";
import { useDevelopmentActions } from "./use-development";

const DATE = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" } as const;

export function GoalsSection({
  data,
  onCreate,
}: {
  data: DevelopmentOverview;
  onCreate: () => void;
}) {
  const t = useTranslations("development.goals");
  const groups = [
    { key: "active" as const, goals: data.goals.filter((s) => s.goal.status === "active") },
    { key: "paused" as const, goals: data.goals.filter((s) => s.goal.status === "paused") },
    { key: "completed" as const, goals: data.goals.filter((s) => s.goal.status === "completed") },
  ];

  return (
    <SectionCard
      icon={<Target className="size-4" aria-hidden />}
      title={t("title")}
      testId="goals"
      action={
        data.goals.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={onCreate}>
            <Plus />
            {t("new")}
          </Button>
        ) : null
      }
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t("hint")}</p>
      {data.goals.length === 0 ? (
        <EmptyState
          testId="goals-empty"
          title={t("empty")}
          hint={t("emptyHint")}
          action={
            <Button size="sm" className="mt-1" onClick={onCreate}>
              <Plus />
              {t("new")}
            </Button>
          }
        />
      ) : (
        groups.map(({ key, goals }) =>
          goals.length === 0 ? null : (
            <section key={key} className="flex flex-col gap-3" aria-label={t(`status.${key}`)}>
              {key !== "active" ? (
                <h3 className="text-xs font-medium text-muted-foreground">{t(key)}</h3>
              ) : null}
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {goals.map((summary) => (
                  <GoalCard key={summary.goal.id} summary={summary} data={data} />
                ))}
              </ul>
            </section>
          ),
        )
      )}
      {data.archivedGoals.length > 0 ? <ArchivedGoals goals={data.archivedGoals} /> : null}
    </SectionCard>
  );
}

function GoalCard({ summary, data }: { summary: GoalSummary; data: DevelopmentOverview }) {
  const t = useTranslations("development.goals");
  const format = useFormatter();
  const { goal, actions } = summary;
  const attributeOf = useMemo(
    () =>
      new Map(
        [...data.attributes.map((s) => s.attribute), ...data.archivedAttributes].map((a) => [
          a.id,
          a,
        ]),
      ),
    [data.attributes, data.archivedAttributes],
  );

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface p-4",
        goal.status !== "active" && "bg-surface-muted/40",
      )}
      data-testid="goal-card"
      data-status={goal.status}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={goalHref(goal.id)}
          className="min-w-0 text-base leading-snug font-semibold hover:underline"
          aria-label={t("open", { title: goal.title })}
        >
          {goal.title}
        </Link>
        <PriorityBadge priority={goal.priority} />
      </div>
      {goal.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{goal.description}</p>
      ) : null}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t("title")}>
        {goal.attributes.map((link) => {
          const attribute = attributeOf.get(link.attributeId);
          return attribute ? (
            <li key={link.attributeId}>
              <AttributeName attribute={attribute} />
            </li>
          ) : null;
        })}
      </ul>
      <ActionProgress actions={actions} />
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3.5" aria-hidden />
          {goal.targetDate
            ? t("target", { date: format.dateTime(new Date(`${goal.targetDate}T00:00:00Z`), DATE) })
            : t("noTarget")}
        </span>
        <span className="tabular-nums" data-testid="goal-recent-growth">
          {t("recentGrowth", {
            days: RECENT_WINDOW_DAYS,
            xp: format.number(summary.recentGrowthXp),
          })}
        </span>
        {summary.projectCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <FolderKanban className="size-3.5" aria-hidden />
            {t("projects", { count: summary.projectCount })}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function PriorityBadge({ priority }: { priority: number }) {
  const t = useTranslations("development.goals.priority");
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
        priority === 3 && "bg-primary/12 text-primary",
        priority === 2 && "bg-surface-muted text-foreground",
        priority === 1 && "bg-surface-muted text-muted-foreground",
      )}
    >
      {t(String(priority) as "1" | "2" | "3")}
    </span>
  );
}

/** "已完成 X / Y 项行动" — counts, never an XP-derived percentage. */
export function ActionProgress({ actions }: { actions: GoalActionStats }) {
  const t = useTranslations("development.goals");
  const total = countedActions(actions);
  if (actions.linked === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="goal-actions">
        {t("noActions")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="font-medium tabular-nums" data-testid="goal-actions">
          {t("actions", { done: actions.completed, total })}
        </span>
        {actions.cancelled > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("cancelledNote", { count: actions.cancelled })}
          </span>
        ) : null}
      </div>
      <ProgressBar
        value={total > 0 ? actions.completed / total : 0}
        label={t("actionsLabel")}
        tone={total > 0 && actions.completed === total ? "success" : "primary"}
      />
    </div>
  );
}

function ArchivedGoals({ goals }: { goals: DevelopmentGoal[] }) {
  const t = useTranslations("development.goals");
  const actions = useDevelopmentActions();
  return (
    <details className="rounded-md border border-border px-3 py-2" data-testid="archived-goals">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
        <Archive className="size-4" aria-hidden />
        {t("archivedCount", { count: goals.length })}
      </summary>
      <ul className="mt-2 flex flex-col">
        {goals.map((goal) => (
          <li key={goal.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <Link href={goalHref(goal.id)} className="min-w-0 truncate hover:underline">
              {goal.title}
            </Link>
            <span className="flex shrink-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => actions.setStatus.mutate({ id: goal.id, status: "active" })}
              >
                {t("restore")}
              </Button>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
