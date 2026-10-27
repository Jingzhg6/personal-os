"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { PageHeader } from "@/shared/ui/page-header";

import { triggerKeyOf, type AutomationExecution, type AutomationRule } from "../domain";
import { RuleBuilder } from "./rule-builder";
import { ExecutionBadge } from "./status-badge";
import { RuleSummary, useDateTime } from "./summary";
import { useAutomationActions, useExecutions, useHealth, useRule } from "./use-automation";

export function RuleDetailView({ id }: { id: string }) {
  const t = useTranslations("automation");
  const { data: rule, isError } = useRule(id);
  const [editing, setEditing] = useState(false);
  const actions = useAutomationActions();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-testid="automation-detail">
      <Link
        href="/automation"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("detail.back")}
      </Link>
      {isError ? (
        <Card>
          <CardContent
            className="py-10 text-center text-sm text-muted-foreground"
            data-testid="rule-not-found"
          >
            {t("detail.notFound")}
          </CardContent>
        </Card>
      ) : !rule ? null : editing && rule.config ? (
        <>
          <PageHeader title={t("builder.editTitle")} />
          <RuleBuilder
            initial={rule.config}
            pending={actions.update.isPending}
            submitLabel={t("builder.saveEdit")}
            note={t("builder.editNote")}
            onCancel={() => setEditing(false)}
            onSubmit={(config) =>
              actions.update.mutate({ id: rule.id, config }, { onSuccess: () => setEditing(false) })
            }
          />
        </>
      ) : (
        <Detail rule={rule} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

function Detail({ rule, onEdit }: { rule: AutomationRule; onEdit: () => void }) {
  const t = useTranslations("automation");
  const dateTime = useDateTime();
  const router = useRouter();
  const actions = useAutomationActions();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const { data: health } = useHealth();
  const archived = rule.archivedAt !== null;
  const awaitingWorker =
    rule.enabled &&
    rule.config?.trigger.type === "schedule" &&
    rule.nextRunAt !== null &&
    health !== undefined &&
    !health.scheduler.operational;

  return (
    <>
      <PageHeader
        title={rule.name}
        description={rule.description ?? t("detail.created", { time: dateTime(rule.createdAt) })}
        actions={
          <>
            {!archived && rule.config ? (
              <Button variant="secondary" onClick={onEdit} data-testid="rule-edit">
                <Pencil aria-hidden />
                {t("detail.edit")}
              </Button>
            ) : null}
            {archived ? (
              <Button
                variant="secondary"
                onClick={() => actions.setArchived.mutate({ id: rule.id, archived: false })}
              >
                <ArchiveRestore aria-hidden />
                {t("detail.restore")}
              </Button>
            ) : rule.lastExecution ? (
              <Button
                variant="secondary"
                onClick={() => setConfirm("archive")}
                data-testid="rule-archive"
              >
                <Archive aria-hidden />
                {t("detail.archive")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirm("delete")}
                data-testid="rule-delete"
              >
                <Trash2 aria-hidden />
                {t("detail.delete")}
              </Button>
            )}
          </>
        }
      />
      <Card data-testid="rule-state-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "size-2.5 rounded-full",
                rule.enabled ? "bg-success" : "bg-muted-foreground/50",
              )}
              aria-hidden
            />
            <span className="text-sm" data-testid="rule-enabled-note">
              {rule.enabled ? t("detail.enabledNote") : t("detail.disabledNote")}
            </span>
          </div>
          {awaitingWorker ? (
            <p
              className="w-full rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm sm:order-last"
              data-testid="rule-awaiting-worker"
            >
              {t("detail.awaitingWorker")}
            </p>
          ) : null}
          {!archived && rule.config ? (
            <Button
              variant={rule.enabled ? "secondary" : "primary"}
              disabled={actions.setEnabled.isPending}
              onClick={() => actions.setEnabled.mutate({ id: rule.id, enabled: !rule.enabled })}
              data-testid="rule-enable"
            >
              {rule.enabled ? t("detail.disable") : t("detail.enable")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3">
          {rule.config ? (
            <RuleSummary
              trigger={rule.config.trigger}
              conditions={rule.config.conditions}
              actions={rule.config.actions}
            />
          ) : (
            <p className="text-sm text-danger">{t("detail.invalidConfig")}</p>
          )}
          {rule.config?.trigger.type === "schedule" ? (
            <p className="text-xs text-muted-foreground">
              {t("schedule.timeZone", { zone: rule.timeZone ?? "" })}
              {rule.enabled && rule.nextRunAt ? (
                <> · {t("list.nextRun", { time: dateTime(rule.nextRunAt) })}</>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <History ruleId={rule.id} ruleEnabled={rule.enabled} />
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "delete"
            ? t("detail.deleteTitle", { name: rule.name })
            : t("detail.archiveTitle", { name: rule.name })
        }
        description={confirm === "delete" ? t("detail.deleteBody") : t("detail.archiveBody")}
        confirmLabel={confirm === "delete" ? t("detail.delete") : t("detail.archive")}
        tone={confirm === "delete" ? "danger" : "primary"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === "delete") {
            actions.remove.mutate({ id: rule.id }, { onSuccess: () => router.push("/automation") });
          } else {
            actions.setArchived.mutate(
              { id: rule.id, archived: true },
              { onSuccess: () => setConfirm(null) },
            );
          }
        }}
      />
    </>
  );
}

function History({ ruleId, ruleEnabled }: { ruleId: string; ruleEnabled: boolean }) {
  const t = useTranslations("automation");
  const { data } = useExecutions(ruleId);
  return (
    <Card data-testid="rule-history">
      <CardHeader>
        <CardTitle>{t("history.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!data ? null : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.map((execution) => (
              <ExecutionRow key={execution.id} execution={execution} ruleEnabled={ruleEnabled} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ExecutionRow({
  execution,
  ruleEnabled,
}: {
  execution: AutomationExecution;
  ruleEnabled: boolean;
}) {
  const t = useTranslations("automation");
  const te = useTranslations("automation.errors");
  const dateTime = useDateTime();
  const { retry } = useAutomationActions();
  const done = execution.actionResults.filter((r) => r.outcome === "succeeded").length;
  const total = execution.actionResults.length;
  const failed = execution.status === "failed" || execution.status === "partial";
  const errorText = execution.errorCode
    ? te.has(execution.errorCode as "unknown")
      ? te(execution.errorCode as "unknown")
      : te("unknown", { code: execution.errorCode })
    : null;

  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0" data-testid="execution-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ExecutionBadge status={execution.status} />
        <span className="text-sm tabular-nums">{dateTime(execution.startedAt)}</span>
        <span className="min-w-0 text-sm text-muted-foreground">
          {t(`triggers.${triggerKeyOf(execution.triggerType)}`)}
          {execution.subject ? `：${execution.subject}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {execution.skipReason ? (
          <span data-testid="execution-skip">{t(`skipReasons.${execution.skipReason}`)}</span>
        ) : null}
        {total > 0 ? <span>{t("history.actionsDone", { done, total })}</span> : null}
        {execution.duplicates > 0 ? (
          <span data-testid="execution-duplicates">
            {t("history.duplicates", { count: execution.duplicates })}
          </span>
        ) : null}
        {execution.missedOccurrences > 0 ? (
          <span>{t("history.missed", { count: execution.missedOccurrences })}</span>
        ) : null}
        {execution.attempts > 1 ? (
          <span>{t("history.attempts", { count: execution.attempts })}</span>
        ) : null}
        {execution.depth > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Link2 className="size-3" aria-hidden />
            {t("history.chained")}
          </span>
        ) : null}
      </div>
      {failed ? (
        <div
          className="flex flex-col gap-1.5 rounded-md bg-danger/8 px-3 py-2 text-sm"
          data-testid="execution-failure"
        >
          <ol className="flex flex-col gap-0.5">
            {execution.actionResults.map((r) => (
              <li key={r.index} className="flex gap-2">
                <span className="tabular-nums">{r.index + 1}.</span>
                <span>{t(`actions.types.${r.type}`)}</span>
                <span
                  className={cn(
                    r.outcome === "failed" ? "text-danger" : "text-muted-foreground",
                    r.outcome === "succeeded" && "text-success",
                  )}
                >
                  {t(`history.outcomes.${r.outcome}`)}
                </span>
              </li>
            ))}
          </ol>
          {errorText ? <span className="text-danger">{errorText}</span> : null}
          {execution.retryable && ruleEnabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id: execution.id })}
              >
                <RotateCcw aria-hidden />
                {t("history.retry")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("history.retryHint")}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t("history.notRetryable")}</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
