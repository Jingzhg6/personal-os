"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Map as MapIcon,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { TaskPicker } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Popover } from "@/shared/ui/popover";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { useToast } from "@/shared/ui/toast";

import {
  countedActions,
  RECENT_WINDOW_DAYS,
  type GoalDetail,
  type PlanStatus,
  type PlanSummary,
} from "../domain";
import { EmptyState, SectionCard } from "./bits";
import { textareaClass } from "./goal-form-dialog";
import { GoalTaskRow } from "./goal-task-row";
import { useDevelopmentActions } from "./use-development";

const statusTone: Record<PlanStatus, string> = {
  active: "bg-primary/12 text-primary",
  paused: "bg-warning/15 text-foreground",
  completed: "bg-success/15 text-success",
  archived: "bg-surface-muted text-muted-foreground",
};

/** 成长计划: the ways chosen to reach the goal, each grouping existing tasks. */
export function PlansSection({
  detail,
  onOpenTask,
  onAttribute,
}: {
  detail: GoalDetail;
  onOpenTask: (id: string) => void;
  onAttribute: (taskId: string) => void;
}) {
  const t = useTranslations("development.plans");
  const archivedGoal = detail.goal.status === "archived";
  const visible = detail.plans.filter((p) => p.plan.status !== "archived");
  const archived = detail.plans.filter((p) => p.plan.status === "archived");

  return (
    <SectionCard
      icon={<MapIcon className="size-4" aria-hidden />}
      title={t("title")}
      testId="goal-plans"
    >
      <p className="-mt-2 text-xs text-muted-foreground">{t("hint")}</p>
      {visible.length === 0 ? (
        <EmptyState title={t("empty")} hint={t("emptyHint")} testId="plans-empty" />
      ) : (
        <ol className="flex flex-col gap-3">
          {visible.map((summary, index) => (
            <PlanItem
              key={summary.plan.id}
              summary={summary}
              detail={detail}
              index={index}
              count={visible.length}
              onOpenTask={onOpenTask}
              onAttribute={onAttribute}
            />
          ))}
        </ol>
      )}
      {archived.length > 0 ? (
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground select-none">
            {t("archivedCount", { count: archived.length })}
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {archived.map((summary, index) => (
              <PlanItem
                key={summary.plan.id}
                summary={summary}
                detail={detail}
                index={index}
                count={archived.length}
                onOpenTask={onOpenTask}
                onAttribute={onAttribute}
              />
            ))}
          </ol>
        </details>
      ) : null}
      {archivedGoal ? null : <NewPlanForm goalId={detail.goal.id} />}
    </SectionCard>
  );
}

function PlanItem({
  summary,
  detail,
  index,
  count,
  onOpenTask,
  onAttribute,
}: {
  summary: PlanSummary;
  detail: GoalDetail;
  index: number;
  count: number;
  onOpenTask: (id: string) => void;
  onAttribute: (taskId: string) => void;
}) {
  const t = useTranslations("development.plans");
  const tg = useTranslations("development.goals");
  const tStatus = useTranslations("development.goals.status");
  const actions = useDevelopmentActions();
  const [open, setOpen] = useState(index === 0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { plan } = summary;
  const total = countedActions(summary.actions);
  const tasks = summary.taskIds.flatMap((id) => {
    const task = detail.tasks.find((candidate) => candidate.id === id);
    return task ? [task] : [];
  });
  const accepts = plan.status !== "archived" && detail.goal.status !== "archived";
  const setStatus = (status: PlanStatus) => actions.setPlanStatus.mutate({ id: plan.id, status });
  const panelId = useId();

  return (
    <li
      className="rounded-lg border border-border bg-surface"
      data-testid="plan"
      data-status={plan.status}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary tabular-nums">
          {index + 1}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium" data-testid="plan-title">
              {plan.title}
            </span>
            {plan.status !== "active" ? (
              <span className={cn("rounded-full px-2 py-0.5 text-xs", statusTone[plan.status])}>
                {tStatus(plan.status)}
              </span>
            ) : null}
          </span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
            <span data-testid="plan-actions">
              {summary.actions.linked === 0
                ? t("noActions")
                : tg("actions", { done: summary.actions.completed, total })}
            </span>
            <span>{t("recent", { days: RECENT_WINDOW_DAYS, count: summary.recentCompleted })}</span>
          </span>
          {summary.actions.linked > 0 ? (
            <ProgressBar
              value={total > 0 ? summary.actions.completed / total : 0}
              label={t("progressLabel", { title: plan.title })}
              className="max-w-xs"
            />
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border px-4 py-3">
          {editing ? (
            <PlanEditForm summary={summary} onDone={() => setEditing(false)} />
          ) : plan.description ? (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{plan.description}</p>
          ) : null}

          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTasks")}</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {tasks.map((task) => (
                <GoalTaskRow
                  key={task.id}
                  task={task}
                  attribution={detail.taskAttribution[task.id]}
                  onOpen={() => onOpenTask(task.id)}
                  onAttribute={() => onAttribute(task.id)}
                  removeLabel={t("unlinkTask", { title: task.title })}
                  onRemove={() =>
                    actions.unlinkPlanTask.mutate({ planId: plan.id, taskId: task.id })
                  }
                />
              ))}
            </ul>
          )}

          {accepts ? (
            <div className="flex flex-col gap-2">
              <PlanTaskForm planId={plan.id} />
              <Popover
                trigger={(props) => (
                  <Button variant="ghost" size="sm" className="w-fit" {...props}>
                    <Plus />
                    {t("linkTask")}
                  </Button>
                )}
              >
                {(close) => (
                  <TaskPicker
                    excludeIds={new Set(summary.taskIds)}
                    includeCompleted
                    searchLabel={t("searchTasks")}
                    resultsLabel={t("taskResults")}
                    emptyLabel={t("noTaskResults")}
                    onSelect={(task) => {
                      close();
                      actions.linkPlanTask.mutate({ planId: plan.id, taskId: task.id });
                    }}
                  />
                )}
              </Popover>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1 border-t border-border pt-3">
            {plan.status !== "archived" ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                {t("edit")}
              </Button>
            ) : null}
            {plan.status === "active" ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setStatus("paused")}>
                  <Pause />
                  {t("pause")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setStatus("completed")}>
                  <CheckCircle2 />
                  {t("complete")}
                </Button>
              </>
            ) : null}
            {plan.status === "paused" ? (
              <Button variant="ghost" size="sm" onClick={() => setStatus("active")}>
                <Play />
                {t("resume")}
              </Button>
            ) : null}
            {plan.status === "completed" ? (
              <Button variant="ghost" size="sm" onClick={() => setStatus("active")}>
                <RotateCcw />
                {t("reopen")}
              </Button>
            ) : null}
            {plan.status === "archived" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatus("active")}
                disabled={detail.goal.status === "archived"}
              >
                <ArchiveRestore />
                {t("restore")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setStatus("archived")}>
                <Archive />
                {t("archive")}
              </Button>
            )}
            {plan.status !== "archived" ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("moveUp", { title: plan.title })}
                  title={t("moveUp", { title: plan.title })}
                  disabled={index === 0}
                  onClick={() => actions.movePlan.mutate({ id: plan.id, direction: "up" })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("moveDown", { title: plan.title })}
                  title={t("moveDown", { title: plan.title })}
                  disabled={index === count - 1}
                  onClick={() => actions.movePlan.mutate({ id: plan.id, direction: "down" })}
                >
                  <ArrowDown />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("delete", { title: plan.title })}
              title={t("delete", { title: plan.title })}
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={deleting}
        title={t("deleteTitle", { title: plan.title })}
        description={t("deleteBody")}
        confirmLabel={t("deleteConfirm")}
        pending={actions.deletePlan.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          actions.deletePlan.mutate({ id: plan.id }, { onSuccess: () => setDeleting(false) })
        }
      />
    </li>
  );
}

function PlanEditForm({ summary, onDone }: { summary: PlanSummary; onDone: () => void }) {
  const t = useTranslations("development.plans");
  const tc = useTranslations("common");
  const actions = useDevelopmentActions();
  const [title, setTitle] = useState(summary.plan.title);
  const [description, setDescription] = useState(summary.plan.description ?? "");
  const ids = { title: useId(), description: useId() };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        actions.updatePlan.mutate(
          {
            id: summary.plan.id,
            patch: { title: title.trim(), description: description.trim() || null },
          },
          { onSuccess: onDone },
        );
      }}
    >
      <label htmlFor={ids.title} className="sr-only">
        {t("titleLabel")}
      </label>
      <Input
        id={ids.title}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor={ids.description} className="sr-only">
        {t("descriptionLabel")}
      </label>
      <textarea
        id={ids.description}
        rows={2}
        maxLength={2000}
        value={description}
        placeholder={t("descriptionPlaceholder")}
        onChange={(e) => setDescription(e.target.value)}
        className={textareaClass}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim()}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

/** A new, ordinary task — linked to the goal (default allocation) and put in this plan. */
function PlanTaskForm({ planId }: { planId: string }) {
  const t = useTranslations("development.plans");
  const toast = useToast();
  const actions = useDevelopmentActions();
  const [title, setTitle] = useState("");
  const id = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    actions.createPlanTask.mutate(
      { planId, task: { title: value }, useGoalAttributes: true },
      {
        onSuccess: () => {
          setTitle("");
          toast.show(t("taskCreated", { title: value }));
        },
      },
    );
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor={id} className="sr-only">
        {t("newTask")}
      </label>
      <Input
        id={id}
        value={title}
        maxLength={500}
        placeholder={t("newTaskPlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Button type="submit" size="md" disabled={!title.trim() || actions.createPlanTask.isPending}>
        <Plus />
        <span className="hidden sm:inline">{t("createTask")}</span>
      </Button>
    </form>
  );
}

function NewPlanForm({ goalId }: { goalId: string }) {
  const t = useTranslations("development.plans");
  const toast = useToast();
  const actions = useDevelopmentActions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expanded, setExpanded] = useState(false);
  const ids = { title: useId(), description: useId() };
  return (
    <form
      className="flex flex-col gap-2 border-t border-border pt-4"
      data-testid="new-plan"
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value) return;
        actions.createPlan.mutate(
          { goalId, title: value, description: description.trim() || null },
          {
            onSuccess: () => {
              setTitle("");
              setDescription("");
              setExpanded(false);
              toast.show(t("created", { title: value }));
            },
          },
        );
      }}
    >
      <label htmlFor={ids.title} className="text-sm font-medium">
        {t("new")}
      </label>
      <div className="flex gap-2">
        <Input
          id={ids.title}
          value={title}
          maxLength={120}
          placeholder={t("titlePlaceholder")}
          onFocus={() => setExpanded(true)}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button type="submit" disabled={!title.trim() || actions.createPlan.isPending}>
          <Plus />
          <span className="hidden sm:inline">{t("create")}</span>
        </Button>
      </div>
      {expanded ? (
        <>
          <label htmlFor={ids.description} className="sr-only">
            {t("descriptionLabel")}
          </label>
          <textarea
            id={ids.description}
            rows={2}
            maxLength={2000}
            value={description}
            placeholder={t("descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
            className={textareaClass}
          />
        </>
      ) : null}
    </form>
  );
}
