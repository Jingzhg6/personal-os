"use client";

import { Bot, Check, CircleAlert, Clock, FlaskConical, RefreshCw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useDateTime, useRuleSummary } from "@/modules/automation/ui";
import { usePriorityLabel } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type {
  AiProposal,
  ProposalAnalysis,
  ProposalChange,
  ProposalItem,
  ProposalStatus,
} from "../domain";
import { useGenerate, useProposalActions } from "./use-ai";

const statusTone: Record<ProposalStatus, string> = {
  analysis: "bg-primary/10 text-primary",
  proposed: "bg-warning/20 text-foreground",
  applied: "bg-success/15 text-success",
  failed: "bg-danger/10 text-danger",
  stale: "bg-surface-muted text-muted-foreground",
  expired: "bg-surface-muted text-muted-foreground",
  discarded: "bg-surface-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: ProposalStatus }) {
  const t = useTranslations("ai.proposal.status");
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        statusTone[status],
      )}
      data-testid="ai-proposal-status"
    >
      {t(status)}
    </span>
  );
}

/** Human-readable one-line description of a change (for the list and the confirmation). */
function useDescribeChange(proposal: AiProposal) {
  const t = useTranslations("ai.change");
  const priority = usePriorityLabel();
  const summary = useRuleSummary();
  const titleOfTask = (taskId: string) => {
    const a = proposal.analysis;
    if (a.kind === "priorities")
      return a.recommendations.find((r) => r.taskId === taskId)?.taskTitle ?? "";
    if (a.kind === "contributions") return a.taskTitle;
    return "";
  };
  const attributeList = (list: { attributeId: string; weight: number }[]) =>
    list.length === 0
      ? t("noContributions")
      : list
          .map((c) =>
            t("contribution", { name: proposal.labels[c.attributeId] ?? "?", weight: c.weight }),
          )
          .join(t("separator"));
  return (change: ProposalChange): string => {
    switch (change.type) {
      case "set_task_priority": {
        const a = proposal.analysis;
        const current =
          a.kind === "priorities"
            ? a.recommendations.find((r) => r.taskId === change.taskId)?.currentPriority
            : undefined;
        return current === undefined
          ? t("setPriority", {
              task: titleOfTask(change.taskId),
              priority: priority(change.priority),
            })
          : t("changePriority", {
              task: titleOfTask(change.taskId),
              from: priority(current),
              to: priority(change.priority),
            });
      }
      case "set_task_contributions":
        return t("setContributions", {
          task: titleOfTask(change.taskId),
          list: attributeList(change.contributions),
        });
      case "create_goal_task":
        return t("createTask", { title: change.title });
      case "create_automation_rule":
        return t("createRule", {
          name: change.config.name,
          summary: `${summary.trigger(change.config.trigger)} → ${change.config.actions
            .map(summary.action)
            .join(t("separator"))}`,
        });
    }
  };
}

export function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const t = useTranslations("ai.proposal");
  const tc = useTranslations("ai.capability");
  const dateTime = useDateTime();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const describe = useDescribeChange(proposal);
  const { approve, discard, remove } = useProposalActions();
  const regenerate = useGenerate();
  const open = proposal.status === "proposed";
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(proposal.items.map((i) => [i.key, true])),
  );
  const [edits, setEdits] = useState<Record<string, ProposalChange>>({});
  const [confirming, setConfirming] = useState(false);
  const [approveError, setApproveError] = useState<unknown>(null);
  const items: ProposalItem[] = proposal.items.map((i) => ({
    key: i.key,
    change: edits[i.key] ?? i.change,
  }));
  const chosen = items.filter((i) => selected[i.key]);
  const appliedIds = new Map(proposal.applyResult?.items.map((r) => [r.key, r.entityId]) ?? []);

  return (
    <Card
      data-testid="ai-proposal"
      data-status={proposal.status}
      data-capability={proposal.capability}
      className="overflow-hidden"
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-4 text-primary" aria-hidden />
          <span className="font-semibold">{tc(proposal.capability)}</span>
          <StatusBadge status={proposal.status} />
          {proposal.provider === "mock" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs">
              <FlaskConical className="size-3" aria-hidden />
              {t("simulated")}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground sm:ml-auto">
            {dateTime(proposal.createdAt)}
          </span>
        </div>

        <Analysis proposal={proposal} />

        {items.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label={t("changes")}>
            <h3 className="text-sm font-medium">
              {proposal.status === "applied" ? t("appliedChanges") : t("changes")}
            </h3>
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const entityId = appliedIds.get(item.key);
                return (
                  <li
                    key={item.key}
                    className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm"
                    data-testid="ai-change"
                    data-type={item.change.type}
                  >
                    <div className="flex items-start gap-2">
                      {open ? (
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={selected[item.key] ?? false}
                          onChange={(e) =>
                            setSelected((s) => ({ ...s, [item.key]: e.target.checked }))
                          }
                          aria-label={t("select", { change: describe(item.change) })}
                          data-testid="ai-change-select"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 break-words">{describe(item.change)}</span>
                      {entityId ? <EntityLink change={item.change} id={entityId} /> : null}
                      {proposal.status === "applied" && !entityId ? (
                        <span className="text-xs text-muted-foreground">{t("notApplied")}</span>
                      ) : null}
                    </div>
                    {open ? (
                      <ChangeEditor
                        proposal={proposal}
                        itemKey={item.key}
                        change={item.change}
                        onChange={(change) => setEdits((e) => ({ ...e, [item.key]: change }))}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Footer proposal={proposal} />
        {approveError ? (
          <p role="alert" className="text-sm text-danger" data-testid="ai-approve-error">
            {errorMessage(approveError)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <Button
                size="sm"
                disabled={chosen.length === 0 || approve.isPending}
                onClick={() => setConfirming(true)}
                data-testid="ai-approve"
              >
                <Check aria-hidden />
                {t("approve", { count: chosen.length })}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={discard.isPending}
                onClick={() => discard.mutate({ id: proposal.id })}
                data-testid="ai-discard"
              >
                <X aria-hidden />
                {t("discard")}
              </Button>
            </>
          ) : null}
          {proposal.status === "stale" || proposal.status === "expired" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={regenerate.isPending}
              onClick={() =>
                regenerate.mutate(proposal.request, {
                  onError: (error) => toast.show(errorMessage(error)),
                })
              }
              data-testid="ai-regenerate"
            >
              <RefreshCw aria-hidden />
              {t("regenerate")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: proposal.id })}
            aria-label={t("delete")}
            data-testid="ai-delete"
          >
            <Trash2 aria-hidden />
            <span className="hidden sm:inline">{t("delete")}</span>
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirming}
        tone="primary"
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("confirm")}
        pending={approve.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          approve.mutate(
            { id: proposal.id, confirm: true, items: chosen },
            {
              onSuccess: (result) => {
                setApproveError(null);
                toast.show(
                  result.status === "applied"
                    ? t("appliedToast", { count: result.applyResult?.items.length ?? 0 })
                    : t("failedToast"),
                );
              },
              onError: (error) => setApproveError(error),
              onSettled: () => setConfirming(false),
            },
          )
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="ai-confirm-list">
          {chosen.map((item) => (
            <li key={item.key}>{describe(item.change)}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </Card>
  );
}

function EntityLink({ change, id }: { change: ProposalChange; id: string }) {
  const t = useTranslations("ai.proposal");
  const href = change.type === "create_automation_rule" ? `/automation/${id}` : `/tasks?task=${id}`;
  return (
    <Link
      href={href}
      className="shrink-0 text-xs text-primary hover:underline"
      data-testid="ai-applied-link"
    >
      {t("open")}
    </Link>
  );
}

function Footer({ proposal }: { proposal: AiProposal }) {
  const t = useTranslations("ai.proposal");
  const dateTime = useDateTime();
  const errorMessage = useErrorMessage();
  const line = (icon: React.ReactNode, text: string, tone = "text-muted-foreground") => (
    <p className={cn("flex items-center gap-1.5 text-xs", tone)} data-testid="ai-proposal-hint">
      {icon}
      {text}
    </p>
  );
  switch (proposal.status) {
    case "proposed":
      return line(
        <Clock className="size-3.5" aria-hidden />,
        t("expires", { time: proposal.expiresAt ? dateTime(proposal.expiresAt) : "" }),
      );
    case "applied":
      return line(
        <Check className="size-3.5" aria-hidden />,
        t("appliedHint", {
          count: proposal.applyResult?.items.length ?? 0,
          time: proposal.decidedAt ? dateTime(proposal.decidedAt) : "",
        }),
        "text-success",
      );
    case "failed":
      return line(
        <CircleAlert className="size-3.5" aria-hidden />,
        t("failedHint", {
          error: errorMessage({ data: { domainCode: proposal.errorCode } }),
        }),
        "text-danger",
      );
    case "stale":
      return line(<CircleAlert className="size-3.5" aria-hidden />, t("staleHint"));
    case "expired":
      return line(<Clock className="size-3.5" aria-hidden />, t("expiredHint"));
    case "discarded":
      return line(<X className="size-3.5" aria-hidden />, t("discardedHint"));
    case "analysis":
      return line(<Bot className="size-3.5" aria-hidden />, t("analysisHint"));
  }
}

/* ---------------------------------------------------------------- analysis */

function Uncertainty({ level }: { level: "low" | "medium" | "high" }) {
  const t = useTranslations("ai.uncertainty");
  return (
    <span className="rounded-full border border-border px-1.5 py-px text-[11px] text-muted-foreground">
      {t(level)}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-muted-foreground">{children}</h3>;
}

function Analysis({ proposal }: { proposal: AiProposal }) {
  const t = useTranslations("ai.analysis");
  const ta = useTranslations("ai.areas");
  const tp = useTranslations("ai.priorityAction");
  const a: ProposalAnalysis = proposal.analysis;
  switch (a.kind) {
    case "review":
      return (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <Label>{t("summary")}</Label>
            <p data-testid="ai-summary">{a.output.summary}</p>
          </div>
          {a.output.interpretations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Label>{t("interpretations")}</Label>
              <ul className="flex flex-col gap-1">
                {a.output.interpretations.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">{ta(item.area)}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {a.output.recommendations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Label>{t("recommendations")}</Label>
              <ul className="flex flex-col gap-2">
                {a.output.recommendations.map((r, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-0.5 rounded-md bg-surface-muted/60 px-3 py-2"
                    data-testid="ai-recommendation"
                  >
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {r.action}
                      <Uncertainty level={r.uncertainty} />
                    </span>
                    <span className="text-muted-foreground">{r.reason}</span>
                    {r.entity && a.entityTitles[r.entity.id] ? (
                      <EntityRefLink
                        type={r.entity.type}
                        id={r.entity.id}
                        title={a.entityTitles[r.entity.id]!}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("factsDate", { date: a.facts.today })}</p>
        </div>
      );
    case "priorities":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <Label>{t("recommendations")}</Label>
          {a.recommendations.length === 0 ? (
            <p className="text-muted-foreground">{t("noRecommendations")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {a.recommendations.map((r) => (
                <li
                  key={r.taskId}
                  className="flex flex-col gap-0.5 rounded-md bg-surface-muted/60 px-3 py-2"
                  data-testid="ai-recommendation"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-primary/10 px-1.5 py-px text-xs text-primary">
                      {tp(r.action)}
                    </span>
                    <Link href={`/tasks?task=${r.taskId}`} className="font-medium hover:underline">
                      {r.taskTitle}
                    </Link>
                    <Uncertainty level={r.uncertainty} />
                  </span>
                  <span>{r.reason}</span>
                  <span className="text-muted-foreground">{t("benefit", { text: r.benefit })}</span>
                  {r.nextStep ? (
                    <span className="text-muted-foreground">
                      {t("nextStep", { text: r.nextStep })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
          {a.notes.map((note, i) => (
            <p key={i} className="text-muted-foreground">
              {note}
            </p>
          ))}
          {a.ignored > 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="ai-ignored">
              {t("ignored", { count: a.ignored })}
            </p>
          ) : null}
        </div>
      );
    case "goal_plan":
      return (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            <span className="font-medium">{a.goalTitle}</span> · {a.summary}
          </p>
          <div className="flex flex-col gap-1">
            <Label>{t("steps")}</Label>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {a.steps.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.title}</span>
                  <span className="text-muted-foreground"> — {s.rationale}</span>
                </li>
              ))}
            </ol>
          </div>
          {a.assumptions.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Label>{t("assumptions")}</Label>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {a.assumptions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    case "contributions":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium">{a.taskTitle}</span> · {a.explanation}
          </p>
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {Object.entries(a.reasons).map(([id, reason]) => (
              <li key={id}>{t("reason", { name: proposal.labels[id] ?? "?", reason })}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("contributionsNote")}</p>
        </div>
      );
    case "automation_rule":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="rounded-md bg-surface-muted/60 px-3 py-2 break-words">“{a.request}”</p>
          <p>{a.explanation}</p>
          {!a.supported ? (
            <div className="flex flex-col gap-1" data-testid="ai-unsupported">
              <Label>{t("unsupported")}</Label>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {a.unsupportedReasons.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("ruleDisabledNote")}</p>
          )}
        </div>
      );
    case "question":
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium break-words">{a.question}</p>
          <p className="whitespace-pre-line" data-testid="ai-answer">
            {a.output.answer}
          </p>
          {a.output.basedOn.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("basedOn", { areas: a.output.basedOn.map((area) => ta(area)).join("、") })}
            </p>
          ) : null}
          {a.output.dataGaps.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Label>{t("dataGaps")}</Label>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {a.output.dataGaps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
  }
}

function EntityRefLink({ type, id, title }: { type: string; id: string; title: string }) {
  const href =
    type === "task"
      ? `/tasks?task=${id}`
      : type === "project"
        ? `/projects/${id}`
        : type === "goal"
          ? `/development/goals/${id}`
          : `/automation/${id}`;
  return (
    <Link href={href} className="w-fit text-xs text-primary hover:underline">
      {title}
    </Link>
  );
}

/* ---------------------------------------------------------------- editing */

function ChangeEditor({
  proposal,
  itemKey,
  change,
  onChange,
}: {
  proposal: AiProposal;
  itemKey: string;
  change: ProposalChange;
  onChange: (change: ProposalChange) => void;
}) {
  const t = useTranslations("ai.change");
  const priority = usePriorityLabel();
  switch (change.type) {
    case "set_task_priority":
      return (
        <label className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
          {t("priority")}
          <Select
            className="h-8 w-28"
            value={change.priority}
            onChange={(e) => onChange({ ...change, priority: Number(e.target.value) })}
          >
            {[4, 3, 2, 1, 0].map((p) => (
              <option key={p} value={p}>
                {priority(p)}
              </option>
            ))}
          </Select>
        </label>
      );
    case "create_goal_task": {
      const a = proposal.analysis;
      const step = a.kind === "goal_plan" ? a.steps[a.taskSteps[itemKey] ?? 0] : undefined;
      return (
        <div className="flex flex-col gap-2 pl-6 sm:flex-row sm:items-center">
          <Input
            className="h-8 min-w-0 flex-1"
            value={change.title}
            maxLength={200}
            aria-label={t("title")}
            onChange={(e) => onChange({ ...change, title: e.target.value })}
          />
          <Input
            type="date"
            className="h-8 sm:w-40"
            value={change.dueDate ?? ""}
            aria-label={t("dueDate")}
            onChange={(e) => onChange({ ...change, dueDate: e.target.value || null })}
          />
          <span className="text-xs text-muted-foreground">
            {[
              step ? t("step", { step: step.title }) : null,
              change.estimatedMinutes ? t("minutes", { minutes: change.estimatedMinutes }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      );
    }
    case "set_task_contributions":
      return (
        <ul className="flex flex-wrap gap-2 pl-6">
          {change.contributions.map((c) => (
            <li
              key={c.attributeId}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
            >
              {proposal.labels[c.attributeId] ?? "?"}
              <Select
                className="h-7 w-20"
                value={c.weight}
                aria-label={t("weight", { name: proposal.labels[c.attributeId] ?? "?" })}
                onChange={(e) =>
                  onChange({
                    ...change,
                    contributions: change.contributions.map((x) =>
                      x.attributeId === c.attributeId
                        ? { ...x, weight: Number(e.target.value) }
                        : x,
                    ),
                  })
                }
              >
                {([3, 2, 1] as const).map((w) => (
                  <option key={w} value={w}>
                    {t(`weights.w${w}`)}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={t("removeContribution", {
                  name: proposal.labels[c.attributeId] ?? "?",
                })}
                onClick={() =>
                  onChange({
                    ...change,
                    contributions: change.contributions.filter(
                      (x) => x.attributeId !== c.attributeId,
                    ),
                  })
                }
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      );
    case "create_automation_rule":
      return <p className="pl-6 text-xs text-muted-foreground">{t("ruleSavedDisabled")}</p>;
  }
}
