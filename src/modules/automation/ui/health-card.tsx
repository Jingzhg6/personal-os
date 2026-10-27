"use client";

import { Activity, CircleAlert, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { useToast } from "@/shared/ui/toast";

import { useDateTime } from "./summary";
import { useAutomationActions, useHealth } from "./use-automation";

/** Honest runtime status: event processing, the scheduler worker, failures, a manual path. */
export function HealthCard() {
  const t = useTranslations("automation.health");
  const te = useTranslations("automation.errors");
  const dateTime = useDateTime();
  const toast = useToast();
  const { data } = useHealth();
  const { runDue } = useAutomationActions();
  if (!data) return null;

  const scheduler = data.scheduler;
  const schedulerText = !scheduler.configured
    ? t("schedulerNotConfigured")
    : scheduler.lastTickAt === null
      ? t("schedulerNever")
      : scheduler.operational
        ? t("schedulerOk", { time: dateTime(scheduler.lastTickAt) })
        : t("schedulerStale", { time: dateTime(scheduler.lastTickAt) });

  return (
    <Card data-testid="automation-health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Row
          ok={data.events.pending === 0 && data.events.failed === 0}
          label={t("events")}
          value={[
            data.events.pending === 0 && data.events.failed === 0 ? t("eventsOk") : null,
            data.events.pending > 0 ? t("eventsPending", { count: data.events.pending }) : null,
            data.events.failed > 0 ? t("eventsFailed", { count: data.events.failed }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          detail={
            data.events.lastProcessedAt
              ? t("lastProcessed", { time: dateTime(data.events.lastProcessedAt) })
              : null
          }
          testId="health-events"
        />
        <Row
          ok={scheduler.operational}
          label={t("scheduler")}
          value={schedulerText}
          detail={t("scheduledRules", { count: scheduler.scheduledRules, due: scheduler.dueRules })}
          testId="health-scheduler"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={runDue.isPending}
            onClick={() =>
              runDue.mutate(undefined, {
                onSuccess: (r) =>
                  toast.show(t("ranDue", { executed: r.executed, events: r.events })),
              })
            }
            data-testid="health-run-due"
          >
            <RefreshCw aria-hidden />
            {t("runDue")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("runDueHint")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">{t("failures")}</span>
          {data.recentFailures.length === 0 ? (
            <span className="text-muted-foreground">{t("noFailures")}</span>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="health-failures">
              {data.recentFailures.map((f) => (
                <li key={f.executionId} className="flex flex-wrap items-center gap-x-2">
                  <CircleAlert className="size-3.5 text-danger" aria-hidden />
                  <Link href={`/automation/${f.ruleId}`} className="font-medium hover:underline">
                    {f.ruleName}
                  </Link>
                  <span className="text-muted-foreground">
                    {dateTime(f.at)} ·{" "}
                    {f.errorCode && te.has(f.errorCode as "unknown")
                      ? te(f.errorCode as "unknown")
                      : te("unknown", { code: f.errorCode ?? "" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.lastSuccessAt ? (
            <span className="text-xs text-muted-foreground">
              {t("lastSuccess", { time: dateTime(data.lastSuccessAt) })}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  ok,
  label,
  value,
  detail,
  testId,
}: {
  ok: boolean;
  label: string;
  value: string;
  detail: string | null;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2" data-testid={testId} data-ok={ok}>
      <span
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-warning")}
        aria-hidden
      />
      <div className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span>{value}</span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  );
}
