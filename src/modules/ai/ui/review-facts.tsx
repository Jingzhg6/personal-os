"use client";

import { Database } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

import type { DisciplineOutcome } from "@/modules/character/domain";

import type { ReviewFacts } from "../domain";

/** The review's facts, computed by the app — shown with or without AI. */
export function ReviewFactsCard({ facts }: { facts: ReviewFacts }) {
  const t = useTranslations("ai.facts");
  const outcomes = Object.entries(facts.growth.disciplineRecent);
  return (
    <Card data-testid="ai-facts">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("hint", { date: facts.today })}</p>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <Section title={t("tasks.title")} testId="facts-tasks">
          <Stat label={t("tasks.open")} value={facts.tasks.open} />
          <Stat
            label={t("tasks.overdue")}
            value={facts.tasks.overdue}
            warn={facts.tasks.overdue > 0}
          />
          <Stat label={t("tasks.dueToday")} value={facts.tasks.dueToday} />
          <Stat label={t("tasks.blocked")} value={facts.tasks.blocked} />
          <Stat label={t("tasks.urgentImportant")} value={facts.tasks.urgentImportant} />
          {facts.tasks.overdueItems.length > 0 ? (
            <List>
              {facts.tasks.overdueItems.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <Link
                    href={`/tasks?task=${item.id}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{item.dueDate}</span>
                </li>
              ))}
            </List>
          ) : null}
        </Section>

        <Section title={t("projects.title")} testId="facts-projects">
          <Stat label={t("projects.active")} value={facts.projects.active} />
          <Stat
            label={t("projects.overdue")}
            value={facts.projects.overdue.length}
            warn={facts.projects.overdue.length > 0}
          />
          <Stat
            label={t("projects.milestonesOverdue")}
            value={facts.projects.milestonesOverdue.length}
            warn={facts.projects.milestonesOverdue.length > 0}
          />
          <Stat label={t("projects.withOverdueTasks")} value={facts.projects.withOverdueTasks} />
          {facts.projects.milestonesOverdue.length > 0 ? (
            <List>
              {facts.projects.milestonesOverdue.map((m) => (
                <li key={m.projectId} className="flex justify-between gap-2">
                  <Link
                    href={`/projects/${m.projectId}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {t("projects.milestoneLine", {
                      project: m.projectName,
                      milestone: m.milestone,
                    })}
                  </Link>
                  <span className="shrink-0 text-muted-foreground">{m.dueDate}</span>
                </li>
              ))}
            </List>
          ) : null}
        </Section>

        <Section title={t("goals.title")} testId="facts-goals">
          <Stat label={t("goals.active")} value={facts.goals.active} />
          <Stat label={t("goals.paused")} value={facts.goals.paused} />
          <Stat
            label={t("goals.withoutOpenTasks")}
            value={facts.goals.withoutOpenTasks.length}
            warn={facts.goals.withoutOpenTasks.length > 0}
          />
          <p className="text-muted-foreground">
            {facts.goals.focus.length > 0
              ? t("goals.focus", { names: facts.goals.focus.join("、") })
              : t("goals.noFocus")}
          </p>
        </Section>

        <Section title={t("growth.title")} testId="facts-growth">
          <Stat label={t("growth.attributes")} value={facts.growth.attributes} />
          <Stat
            label={t("growth.discipline")}
            value={t("growth.points", { points: facts.growth.disciplineScore })}
          />
          <p className="text-muted-foreground">
            {outcomes.length > 0
              ? t("growth.recent", {
                  list: outcomes
                    .map(([outcome, n]) =>
                      t("growth.outcome", {
                        outcome: t(`growth.outcomes.${outcome as DisciplineOutcome}`),
                        count: n,
                      }),
                    )
                    .join("、"),
                })
              : t("growth.noRecent")}
          </p>
        </Section>

        <Section title={t("finance.title")} testId="facts-finance">
          {!facts.finance.hasAccounts ? (
            <p className="text-muted-foreground">{t("finance.noAccounts")}</p>
          ) : (
            <>
              <Stat
                label={t("finance.lastValuation")}
                value={facts.finance.lastValuationDate ?? t("finance.never")}
              />
              <Stat
                label={t("finance.missing")}
                value={facts.finance.missing.length}
                warn={facts.finance.missing.length > 0}
              />
              <Stat
                label={t("finance.stale")}
                value={facts.finance.stale.length}
                warn={facts.finance.stale.length > 0}
              />
              <Stat label={t("finance.unconverted")} value={facts.finance.unconverted.length} />
              {facts.finance.missing.length > 0 ? (
                <List>
                  {facts.finance.missing.map((m) => (
                    <li
                      key={m.accountId}
                      className="flex justify-between gap-2"
                      data-testid="facts-missing"
                    >
                      <span className="min-w-0 truncate">{m.name}</span>
                      {/* Unknown, never zero. */}
                      <span className="shrink-0 text-muted-foreground">
                        {t("finance.notRecorded")}
                      </span>
                    </li>
                  ))}
                </List>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("finance.note")}</p>
            </>
          )}
        </Section>

        <Section title={t("automation.title")} testId="facts-automation">
          <Stat
            label={t("automation.rules")}
            value={t("automation.ruleCounts", {
              enabled: facts.automation.enabled,
              disabled: facts.automation.disabled,
            })}
          />
          <Stat
            label={t("automation.scheduler")}
            value={
              !facts.automation.schedulerConfigured
                ? t("automation.notConfigured")
                : facts.automation.schedulerOperational
                  ? t("automation.running")
                  : t("automation.notRunning")
            }
            warn={!facts.automation.schedulerOperational && facts.automation.dueRules > 0}
          />
          <Stat
            label={t("automation.dueRules")}
            value={facts.automation.dueRules}
            warn={facts.automation.dueRules > 0}
          />
          <Stat
            label={t("automation.failures")}
            value={facts.automation.recentFailures.length + facts.automation.failedEvents}
            warn={facts.automation.recentFailures.length + facts.automation.failedEvents > 0}
          />
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border p-3 text-sm"
      data-testid={testId}
    >
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", warn && "text-danger")}>{value}</span>
    </div>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-1 flex flex-col gap-1 border-t border-border pt-2 text-xs">{children}</ul>
  );
}
