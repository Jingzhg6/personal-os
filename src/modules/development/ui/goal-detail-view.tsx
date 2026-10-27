"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  FolderKanban,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sprout,
  Target,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import {
  TaskCompletionToggle,
  TaskDetailPanel,
  TaskPicker,
  useTaskPanel,
  useToday,
} from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { colorClasses } from "@/shared/ui/color";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Popover } from "@/shared/ui/popover";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import { RECENT_WINDOW_DAYS, type GoalDetail, type GoalStatus } from "../domain";
import { AttributeName, attributeHref, EmptyState, SectionCard } from "./bits";
import { GoalFormDialog } from "./goal-form-dialog";
import { ActionProgress, PriorityBadge } from "./goals-section";
import { useDevelopmentActions, useGoalDetail, useGoalStatusLabel } from "./use-development";

const DATE = { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" } as const;
const SHORT = { month: "short", day: "numeric", timeZone: "UTC" } as const;

const statusTone: Record<GoalStatus, string> = {
  active: "bg-primary/12 text-primary",
  paused: "bg-warning/15 text-foreground",
  completed: "bg-success/15 text-success",
  archived: "bg-surface-muted text-muted-foreground",
};

export function GoalDetailView({ id }: { id: string }) {
  const t = useTranslations("development.goalDetail");
  const { data, isError } = useGoalDetail(id);
  const { openTaskId, openTask, closeTask } = useTaskPanel();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-testid="goal-detail">
      <Link
        href="/development"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t("back")}
      </Link>
      {isError ? (
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      ) : data ? (
        <>
          <GoalHeader detail={data} />
          {data.goal.status === "archived" ? (
            <p className="rounded-md bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
              {t("archivedNotice")}
            </p>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <ProgressCard detail={data} />
              <TasksCard detail={data} onOpenTask={openTask} />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
              <AttributesCard detail={data} />
              <ProjectsCard detail={data} />
            </div>
          </div>
        </>
      ) : (
        <div className="h-64 animate-pulse rounded-lg bg-surface-muted" aria-hidden />
      )}
      {openTaskId ? (
        <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
      ) : null}
    </div>
  );
}

function GoalHeader({ detail }: { detail: GoalDetail }) {
  const t = useTranslations("development.goalDetail");
  const tg = useTranslations("development.goals");
  const format = useFormatter();
  const statusLabel = useGoalStatusLabel();
  const router = useRouter();
  const actions = useDevelopmentActions();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { goal } = detail;
  const setStatus = (status: GoalStatus) => actions.setStatus.mutate({ id: goal.id, status });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Target className="size-6 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 break-words" data-testid="goal-title">
                {goal.title}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  statusTone[goal.status],
                )}
                data-testid="goal-status"
              >
                {statusLabel(goal.status)}
              </span>
              <PriorityBadge priority={goal.priority} />
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <CalendarDays className="size-4" aria-hidden />
                {goal.targetDate
                  ? tg("target", {
                      date: format.dateTime(new Date(`${goal.targetDate}T00:00:00Z`), DATE),
                    })
                  : tg("noTarget")}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              {t("edit")}
            </Button>
            {goal.status === "active" ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setStatus("paused")}>
                  <Pause />
                  {t("pause")}
                </Button>
                <Button size="sm" onClick={() => setStatus("completed")}>
                  <CheckCircle2 />
                  {t("complete")}
                </Button>
              </>
            ) : null}
            {goal.status === "paused" ? (
              <Button variant="secondary" size="sm" onClick={() => setStatus("active")}>
                <Play />
                {t("resume")}
              </Button>
            ) : null}
            {goal.status === "completed" ? (
              <Button variant="secondary" size="sm" onClick={() => setStatus("active")}>
                <RotateCcw />
                {t("reopen")}
              </Button>
            ) : null}
            {goal.status === "archived" ? (
              <Button size="sm" onClick={() => setStatus("active")}>
                <ArchiveRestore />
                {t("restore")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setStatus("archived")}>
                <Archive />
                {t("archive")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleting(true)}
              aria-label={t("delete")}
              title={t("delete")}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
        <section aria-label={t("description")}>
          {goal.description ? (
            <p
              className="text-sm leading-relaxed whitespace-pre-line"
              data-testid="goal-description"
            >
              {goal.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noDescription")}</p>
          )}
        </section>
      </CardContent>
      {editing ? (
        <GoalFormDialog
          open
          goal={goal}
          pending={actions.update.isPending}
          onClose={() => setEditing(false)}
          onSubmit={(patch) =>
            actions.update.mutate(
              { id: goal.id, patch: { ...patch, description: patch.description ?? null } },
              { onSuccess: () => setEditing(false) },
            )
          }
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        title={t("deleteTitle", { title: goal.title })}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        pending={actions.remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          actions.remove.mutate({ id: goal.id }, { onSuccess: () => router.push("/development") })
        }
      />
    </Card>
  );
}

function ProgressCard({ detail }: { detail: GoalDetail }) {
  const t = useTranslations("development.goalDetail");
  const { actions } = detail;
  const stats = [
    { key: "linked" as const, value: actions.linked },
    { key: "completed" as const, value: actions.completed },
    { key: "open" as const, value: actions.open },
    { key: "cancelled" as const, value: actions.cancelled },
  ];
  return (
    <SectionCard
      icon={<ListChecks className="size-4" aria-hidden />}
      title={t("progress")}
      testId="goal-progress"
    >
      <ActionProgress actions={actions} />
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(({ key, value }) => (
          <div key={key} className="rounded-md bg-surface-muted/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{t(key)}</dt>
            <dd className="text-lg font-semibold" data-testid={`goal-stat-${key}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("progressHint")}</p>
    </SectionCard>
  );
}

function TasksCard({
  detail,
  onOpenTask,
}: {
  detail: GoalDetail;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("development.goalDetail");
  const format = useFormatter();
  const toast = useToast();
  const actions = useDevelopmentActions();
  const archived = detail.goal.status === "archived";
  const linked = new Set<string | null>(detail.tasks.map((task) => task.id));

  return (
    <SectionCard
      icon={<CheckCircle2 className="size-4" aria-hidden />}
      title={t("tasks")}
      testId="goal-tasks"
      action={
        archived ? null : (
          <Popover
            align="end"
            trigger={(props) => (
              <Button variant="ghost" size="sm" {...props}>
                <Plus />
                {t("linkTask")}
              </Button>
            )}
          >
            {(close) => (
              <TaskPicker
                excludeIds={linked}
                includeCompleted
                searchLabel={t("searchTasks")}
                resultsLabel={t("taskResults")}
                emptyLabel={t("noTaskResults")}
                onSelect={(task) => {
                  close();
                  actions.linkTask.mutate({ goalId: detail.goal.id, taskId: task.id });
                }}
              />
            )}
          </Popover>
        )
      }
    >
      {detail.tasks.length === 0 ? (
        <EmptyState testId="goal-tasks-empty" title={t("noTasks")} hint={t("noTasksHint")} />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {detail.tasks.map((task) => (
            <li
              key={task.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted/60"
              data-testid="goal-task"
              data-category={task.statusCategory}
            >
              <TaskCompletionToggle task={task} />
              <button
                type="button"
                onClick={() => onOpenTask(task.id)}
                aria-label={t("openTask", { title: task.title })}
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-sm hover:underline",
                  (task.statusCategory === "completed" || task.statusCategory === "cancelled") &&
                    "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </button>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {t(`taskStatus.${task.statusCategory}`)}
              </span>
              {task.dueDate ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t("due", {
                    date: format.dateTime(new Date(`${task.dueDate}T00:00:00Z`), SHORT),
                  })}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("unlinkTask", { title: task.title })}
                title={t("unlinkTask", { title: task.title })}
                onClick={() =>
                  actions.unlinkTask.mutate({ goalId: detail.goal.id, taskId: task.id })
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {archived ? null : (
        <NewTaskForm
          detail={detail}
          onCreated={(title) => toast.show(t("taskCreated", { title }))}
        />
      )}
    </SectionCard>
  );
}

/** Creates an ordinary task, linked to this goal (one transaction on the server). */
function NewTaskForm({
  detail,
  onCreated,
}: {
  detail: GoalDetail;
  onCreated: (title: string) => void;
}) {
  const t = useTranslations("development.goalDetail");
  const actions = useDevelopmentActions();
  const [title, setTitle] = useState("");
  const [useAttributes, setUseAttributes] = useState(true);
  const inputId = useId();
  const checkboxId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    actions.createTask.mutate(
      { goalId: detail.goal.id, task: { title: value }, useGoalAttributes: useAttributes },
      {
        onSuccess: () => {
          setTitle("");
          onCreated(value);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-4">
      <label htmlFor={inputId} className="sr-only">
        {t("newTask")}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={title}
          maxLength={500}
          placeholder={t("newTaskPlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" disabled={!title.trim() || actions.createTask.isPending}>
          <Plus />
          <span className="hidden sm:inline">{t("createTask")}</span>
        </Button>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          id={checkboxId}
          type="checkbox"
          checked={useAttributes}
          onChange={(event) => setUseAttributes(event.target.checked)}
          className="mt-0.5 size-3.5 accent-primary"
        />
        <label htmlFor={checkboxId}>
          {t("useAttributes")}
          <span className="block">{t("useAttributesHint")}</span>
        </label>
      </div>
    </form>
  );
}

function AttributesCard({ detail }: { detail: GoalDetail }) {
  const t = useTranslations("development.goalDetail");
  const tf = useTranslations("development.form.weights");
  const format = useFormatter();
  return (
    <SectionCard
      icon={<Sprout className="size-4" aria-hidden />}
      title={t("attributes")}
      testId="goal-attributes"
    >
      <ul className="flex flex-col gap-3">
        {detail.attributes.map((link) => (
          <li key={link.attributeId} className="flex flex-col gap-1" data-testid="goal-attribute">
            <div className="flex items-center justify-between gap-2 text-sm">
              <AttributeName
                attribute={link.attribute}
                href={attributeHref(link.attributeId)}
                className="font-medium"
              />
              <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                {t("weight", { weight: tf(String(link.weight) as "1" | "2" | "3") })}
              </span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("growth", {
                lifetime: format.number(link.lifetimeGrowthXp),
                recent: format.number(link.recentGrowthXp),
                days: RECENT_WINDOW_DAYS,
              })}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function ProjectsCard({ detail }: { detail: GoalDetail }) {
  const t = useTranslations("development.goalDetail");
  const trpc = useTRPC();
  const today = useToday();
  const actions = useDevelopmentActions();
  const archived = detail.goal.status === "archived";
  const { data: projects = [] } = useQuery({
    ...trpc.projects.list.queryOptions({ today }),
    enabled: !archived,
  });
  const linked = new Set(detail.projects.map((project) => project.id));
  const available = projects.filter((project) => !linked.has(project.id));
  const selectId = useId();

  return (
    <SectionCard
      icon={<FolderKanban className="size-4" aria-hidden />}
      title={t("projects")}
      testId="goal-projects"
    >
      {detail.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {detail.projects.map((project) => (
            <li key={project.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={cn("size-2.5 shrink-0 rounded-sm", colorClasses[project.color].dot)}
                  aria-hidden
                />
                <Link
                  href={`/projects/${project.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {project.name}
                </Link>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("unlinkProject", { name: project.name })}
                  title={t("unlinkProject", { name: project.name })}
                  onClick={() =>
                    actions.unlinkProject.mutate({ goalId: detail.goal.id, projectId: project.id })
                  }
                >
                  <X />
                </Button>
              </div>
              <ProgressBar
                value={
                  project.progress.total ? project.progress.completed / project.progress.total : 0
                }
                label={t("projectProgress", {
                  done: project.progress.completed,
                  total: project.progress.total,
                })}
              />
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("projectProgress", {
                  done: project.progress.completed,
                  total: project.progress.total,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!archived && available.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            {t("linkProject")}
          </label>
          <Select
            id={selectId}
            value=""
            onChange={(event) => {
              if (event.target.value) {
                actions.linkProject.mutate({
                  goalId: detail.goal.id,
                  projectId: event.target.value,
                });
              }
            }}
          >
            <option value="">{t("chooseProject")}</option>
            {available.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </SectionCard>
  );
}
