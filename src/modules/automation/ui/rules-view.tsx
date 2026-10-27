"use client";

import { Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";
import { buttonVariants } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

import type { AutomationRule } from "../domain";
import { HealthCard } from "./health-card";
import { ExecutionBadge } from "./status-badge";
import { useDateTime, useRuleSummary } from "./summary";
import { useAutomationActions, useHealth, useRules } from "./use-automation";

export function RulesView({ title }: { title: string }) {
  const t = useTranslations("automation.list");
  const { data: rules } = useRules();
  const [showArchived, setShowArchived] = useState(false);
  const active = rules?.filter((r) => !r.archivedAt) ?? [];
  const archived = rules?.filter((r) => r.archivedAt) ?? [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-testid="automation-rules">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          rules && rules.length > 0 ? (
            <Link href="/automation/new" className={buttonVariants()} data-testid="rule-new">
              <Plus aria-hidden />
              {t("new")}
            </Link>
          ) : null
        }
      />
      {rules && rules.length === 0 ? (
        <Card data-testid="automation-empty">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Workflow className="size-6" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">{t("empty.title")}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{t("empty.hint")}</p>
            <Link href="/automation/new" className={buttonVariants()} data-testid="rule-new">
              <Plus aria-hidden />
              {t("empty.action")}
            </Link>
          </CardContent>
        </Card>
      ) : null}
      {active.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {active.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </ul>
      ) : null}
      {archived.length > 0 ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="w-fit text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {t("showArchived", { count: archived.length })}
          </button>
          {showArchived ? (
            <ul className="flex flex-col gap-3">
              {archived.map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <HealthCard />
    </div>
  );
}

function RuleRow({ rule }: { rule: AutomationRule }) {
  const t = useTranslations("automation.list");
  const ts = useTranslations("automation.summary");
  const summary = useRuleSummary();
  const dateTime = useDateTime();
  const { setEnabled } = useAutomationActions();
  const { data: health } = useHealth();
  const archived = rule.archivedAt !== null;
  const scheduled = rule.enabled && rule.config?.trigger.type === "schedule";

  return (
    <li>
      <Card data-testid="rule-row" data-rule={rule.name}>
        <CardContent className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Link
              href={`/automation/${rule.id}`}
              className="truncate font-semibold hover:underline"
              aria-label={t("open", { name: rule.name })}
            >
              {rule.name}
            </Link>
            {rule.config ? (
              <p className="text-sm text-muted-foreground">
                {summary.trigger(rule.config.trigger)} →{" "}
                {rule.config.actions.map(summary.action).join(ts("separator"))}
              </p>
            ) : (
              <p className="text-sm text-danger">{t("invalid")}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {rule.lastExecution ? (
                <>
                  <ExecutionBadge status={rule.lastExecution.status} />
                  <span>{t("lastRun", { time: dateTime(rule.lastExecution.at) })}</span>
                </>
              ) : (
                <span>{t("neverRun")}</span>
              )}
              {rule.enabled && rule.nextRunAt ? (
                <span>· {t("nextRun", { time: dateTime(rule.nextRunAt) })}</span>
              ) : null}
              {scheduled && !rule.nextRunAt ? <span>· {t("scheduleFinished")}</span> : null}
            </div>
            {scheduled && rule.nextRunAt && health && !health.scheduler.operational ? (
              <span
                className="w-fit rounded-full bg-warning/20 px-2 py-0.5 text-xs text-foreground"
                data-testid="rule-awaiting-worker"
              >
                {t("awaitingWorker")}
              </span>
            ) : null}
          </div>
          {archived ? (
            <span className="text-sm text-muted-foreground">{t("archived")}</span>
          ) : (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              <span
                className={cn(rule.enabled ? "text-success" : "text-muted-foreground")}
                data-testid="rule-state"
              >
                {rule.enabled ? t("enabled") : t("disabled")}
              </span>
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={rule.enabled}
                disabled={setEnabled.isPending || !rule.config}
                aria-label={t("toggle", { name: rule.name })}
                onChange={(event) =>
                  setEnabled.mutate({ id: rule.id, enabled: event.target.checked })
                }
                data-testid="rule-toggle"
              />
              <span
                aria-hidden
                className="relative h-5 w-9 rounded-full bg-surface-muted ring-1 ring-border transition-colors peer-checked:bg-success peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
              />
            </label>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
