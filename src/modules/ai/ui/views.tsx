"use client";

import {
  CalendarRange,
  History,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";

import { useAttributeLabel } from "@/modules/character/ui";
import { useToday } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";

import {
  AI_LIMITS,
  aiCapabilities,
  type AiCapability,
  type AiProposal,
  type GenerateInput,
} from "../domain";
import { ProposalCard } from "./proposal-card";
import { ReviewFactsCard } from "./review-facts";
import { AiStatusNotice, GenerateError } from "./status-notice";
import {
  useAiStatus,
  useGenerate,
  useProposalActions,
  useProposals,
  useReviewFacts,
} from "./use-ai";

/* ---------------------------------------------------------------- shared pieces */

/** One generation slot: button, pending, error, and the resulting proposal (kept fresh). */
function useSlot() {
  const generate = useGenerate();
  const { data: proposals } = useProposals();
  const latest = generate.data
    ? (proposals?.find((p) => p.id === generate.data.id) ?? generate.data)
    : null;
  return { generate, latest };
}

function SlotResult({ slot, testId }: { slot: ReturnType<typeof useSlot>; testId: string }) {
  const t = useTranslations("ai.status");
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {slot.generate.isPending ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="ai-pending"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("generating")}
        </p>
      ) : null}
      {slot.generate.isError ? <GenerateError error={slot.generate.error} /> : null}
      {slot.latest && !slot.generate.isPending ? (
        <ProposalCard key={`${slot.latest.id}:${slot.latest.status}`} proposal={slot.latest} />
      ) : null}
    </div>
  );
}

function GenerateButton({
  slot,
  input,
  label,
  disabled,
  testId,
}: {
  slot: ReturnType<typeof useSlot>;
  input: GenerateInput | null;
  label: string;
  disabled?: boolean;
  testId: string;
}) {
  const { data: status } = useAiStatus();
  return (
    <Button
      disabled={!status?.available || !input || disabled || slot.generate.isPending}
      onClick={() => input && slot.generate.mutate(input)}
      data-testid={testId}
    >
      {slot.generate.isPending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <Sparkles aria-hidden />
      )}
      {label}
    </Button>
  );
}

function Panel({
  icon,
  title,
  description,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function TextArea(props: React.ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        props.className,
      )}
    />
  );
}

/* ---------------------------------------------------------------- /ai */

export function AiHomeView({ title }: { title: string }) {
  const t = useTranslations("ai.home");
  const slot = useSlot();
  const [question, setQuestion] = useState("");
  const { data: proposals } = useProposals(5);
  const links: { href: string; icon: ReactNode; key: "review" | "planning" | "history" }[] = [
    { href: "/ai/review", icon: <ListChecks className="size-5" aria-hidden />, key: "review" },
    {
      href: "/ai/planning",
      icon: <CalendarRange className="size-5" aria-hidden />,
      key: "planning",
    },
    { href: "/ai/history", icon: <History className="size-5" aria-hidden />, key: "history" },
  ];
  const recent = (proposals ?? []).filter((p) => p.id !== slot.latest?.id).slice(0, 3);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-testid="ai-home">
      <PageHeader title={title} description={t("description")} />
      <AiStatusNotice />
      <div className="grid gap-3 sm:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-muted"
          >
            <span className="flex items-center gap-2 font-medium text-primary">
              {link.icon}
              {t(`links.${link.key}.title`)}
            </span>
            <span className="text-sm text-muted-foreground">{t(`links.${link.key}.body`)}</span>
          </Link>
        ))}
      </div>
      <Panel
        icon={<MessageCircleQuestion className="size-4 text-primary" aria-hidden />}
        title={t("ask.title")}
        description={t("ask.hint")}
        testId="ai-ask"
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = question.trim();
            if (text) slot.generate.mutate({ capability: "question", question: text });
          }}
        >
          <TextArea
            value={question}
            maxLength={AI_LIMITS.userTextChars}
            placeholder={t("ask.placeholder")}
            aria-label={t("ask.title")}
            onChange={(e) => setQuestion(e.target.value)}
            data-testid="ai-question"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("ask.count", { count: question.length, max: AI_LIMITS.userTextChars })}
            </span>
            <GenerateButton
              slot={slot}
              input={question.trim() ? { capability: "question", question: question.trim() } : null}
              label={t("ask.submit")}
              testId="ai-ask-submit"
            />
          </div>
        </form>
        <SlotResult slot={slot} testId="ai-ask-result" />
      </Panel>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("recent")}</h2>
          <Link href="/ai/history" className="text-sm text-primary hover:underline">
            {t("allHistory")}
          </Link>
        </div>
        {proposals && recent.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="ai-recent-empty">
            {t("recentEmpty")}
          </p>
        ) : null}
        {recent.map((p) => (
          <ProposalCard key={`${p.id}:${p.status}`} proposal={p} />
        ))}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- /ai/review */

export function AiReviewView({ title }: { title: string }) {
  const t = useTranslations("ai.review");
  const { data: facts, isError } = useReviewFacts();
  const review = useSlot();
  const priorities = useSlot();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-testid="ai-review">
      <PageHeader title={title} description={t("description")} />
      <AiStatusNotice />
      {facts ? <ReviewFactsCard facts={facts} /> : null}
      {isError ? <p className="text-sm text-danger">{t("factsError")}</p> : null}
      <Panel
        icon={<Sparkles className="size-4 text-primary" aria-hidden />}
        title={t("analysisTitle")}
        description={t("analysisHint")}
        testId="ai-review-analysis"
      >
        <div>
          <GenerateButton
            slot={review}
            input={{ capability: "review" }}
            label={t("generate")}
            testId="ai-generate-review"
          />
        </div>
        <SlotResult slot={review} testId="ai-review-result" />
      </Panel>
      <Panel
        icon={<ListChecks className="size-4 text-primary" aria-hidden />}
        title={t("prioritiesTitle")}
        description={t("prioritiesHint")}
        testId="ai-priorities"
      >
        <div>
          <GenerateButton
            slot={priorities}
            input={{ capability: "priorities" }}
            label={t("generatePriorities")}
            testId="ai-generate-priorities"
          />
        </div>
        <SlotResult slot={priorities} testId="ai-priorities-result" />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- /ai/planning */

export function AiPlanningView({ title }: { title: string }) {
  const t = useTranslations("ai.planning");
  const trpc = useTRPC();
  const today = useToday();
  const attributeLabel = useAttributeLabel();
  const goals = useQuery(trpc.development.goals.list.queryOptions());
  const tasks = useQuery(
    trpc.tasks.list.queryOptions({
      filter: { categories: ["backlog", "unstarted", "started"] },
      sort: "manual",
      includeSubtasks: false,
      today,
    }),
  );
  const plan = useSlot();
  const contributions = useSlot();
  const automation = useSlot();
  const [goalId, setGoalId] = useState("");
  const [note, setNote] = useState("");
  const [taskId, setTaskId] = useState("");
  const [request, setRequest] = useState("");
  const openGoals = (goals.data ?? []).filter(
    (g) => g.status === "active" || g.status === "paused",
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-testid="ai-planning">
      <PageHeader title={title} description={t("description")} />
      <AiStatusNotice />

      <Panel
        icon={<CalendarRange className="size-4 text-primary" aria-hidden />}
        title={t("plan.title")}
        description={t("plan.hint")}
        testId="ai-plan"
      >
        {goals.data && openGoals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("plan.noGoals")}{" "}
            <Link href="/development" className="text-primary hover:underline">
              {t("plan.createGoal")}
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              aria-label={t("plan.goal")}
              data-testid="ai-plan-goal"
            >
              <option value="">{t("plan.chooseGoal")}</option>
              {openGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
            <TextArea
              value={note}
              maxLength={AI_LIMITS.userTextChars}
              placeholder={t("plan.notePlaceholder")}
              aria-label={t("plan.note")}
              onChange={(e) => setNote(e.target.value)}
            />
            <div>
              <GenerateButton
                slot={plan}
                input={
                  goalId ? { capability: "goal_plan", goalId, note: note.trim() || null } : null
                }
                label={t("plan.generate")}
                testId="ai-generate-plan"
              />
            </div>
          </div>
        )}
        <SlotResult slot={plan} testId="ai-plan-result" />
      </Panel>

      <Panel
        icon={<Sparkles className="size-4 text-primary" aria-hidden />}
        title={t("contributions.title")}
        description={t("contributions.hint")}
        testId="ai-contributions"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            className="min-w-0 flex-1"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            aria-label={t("contributions.task")}
            data-testid="ai-contributions-task"
          >
            <option value="">{t("contributions.chooseTask")}</option>
            {(tasks.data ?? []).slice(0, 200).map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
          <GenerateButton
            slot={contributions}
            input={taskId ? { capability: "contributions", taskId } : null}
            label={t("contributions.generate")}
            testId="ai-generate-contributions"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("contributions.discipline", {
            name: attributeLabel({ name: null, systemKey: "discipline" }),
          })}
        </p>
        <SlotResult slot={contributions} testId="ai-contributions-result" />
      </Panel>

      <Panel
        icon={<ListChecks className="size-4 text-primary" aria-hidden />}
        title={t("automation.title")}
        description={t("automation.hint")}
        testId="ai-automation"
      >
        <TextArea
          value={request}
          maxLength={AI_LIMITS.userTextChars}
          placeholder={t("automation.placeholder")}
          aria-label={t("automation.title")}
          onChange={(e) => setRequest(e.target.value)}
          data-testid="ai-automation-request"
        />
        <div>
          <GenerateButton
            slot={automation}
            input={
              request.trim() ? { capability: "automation_rule", request: request.trim() } : null
            }
            label={t("automation.generate")}
            testId="ai-generate-automation"
          />
        </div>
        <SlotResult slot={automation} testId="ai-automation-result" />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- /ai/history */

const filters = ["all", "proposed", "applied", "closed"] as const;
type Filter = (typeof filters)[number];
const matches = (filter: Filter, p: AiProposal) =>
  filter === "all" ||
  (filter === "proposed" && p.status === "proposed") ||
  (filter === "applied" && p.status === "applied") ||
  (filter === "closed" && !["proposed", "applied"].includes(p.status));

export function AiHistoryView({ title }: { title: string }) {
  const t = useTranslations("ai.history");
  const tc = useTranslations("ai.capability");
  const { data: proposals } = useProposals(100);
  const { clear } = useProposalActions();
  const [filter, setFilter] = useState<Filter>("all");
  const [capability, setCapability] = useState<AiCapability | "">("");
  const [confirmClear, setConfirmClear] = useState(false);
  const shown = (proposals ?? []).filter(
    (p) => matches(filter, p) && (!capability || p.capability === capability),
  );
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-testid="ai-history">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          proposals && proposals.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmClear(true)}
              data-testid="ai-clear"
            >
              <Trash2 aria-hidden />
              {t("clear")}
            </Button>
          ) : null
        }
      />
      <AiStatusNotice />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filter")}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              buttonVariants({ variant: filter === f ? "primary" : "secondary", size: "sm" }),
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
        <Select
          className="h-8 w-auto"
          value={capability}
          onChange={(e) => setCapability(e.target.value as AiCapability | "")}
          aria-label={t("capability")}
        >
          <option value="">{t("allCapabilities")}</option>
          {aiCapabilities.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </Select>
      </div>
      {proposals && proposals.length === 0 ? (
        <Card data-testid="ai-history-empty">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <History className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{t("empty")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : null}
      {proposals && proposals.length > 0 && shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {shown.map((p) => (
          <ProposalCard key={`${p.id}:${p.status}`} proposal={p} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("retention", { days: AI_LIMITS.retentionDays })}
      </p>
      <ConfirmDialog
        open={confirmClear}
        title={t("clearTitle")}
        description={t("clearBody")}
        confirmLabel={t("clear")}
        pending={clear.isPending}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => clear.mutate(undefined, { onSettled: () => setConfirmClear(false) })}
      />
    </div>
  );
}
