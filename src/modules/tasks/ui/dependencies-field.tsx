"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Popover } from "@/shared/ui/popover";
import { useToast } from "@/shared/ui/toast";

import {
  hasScheduleConflict,
  isClosedCategory,
  type DependencyRef,
  type TaskDetail,
} from "../domain";
import { useDueLabel } from "./labels";
import { StatusIcon } from "./status-icon";
import { TaskPicker } from "./task-picker";
import { useTaskActions } from "./use-task-data";

type Direction = "blockedBy" | "blocking";

/**
 * The task's finish-to-start dependencies in both directions: 前置任务 (must finish first) and
 * 后续任务 (waiting for this one). Each edge is stored once; both lists read it.
 */
export function DependenciesField({
  task,
  onOpenTask,
}: {
  task: TaskDetail;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("tasks.dependencies");
  const waiting = !isClosedCategory(task.statusCategory) && task.openBlockerCount > 0;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="task-dependencies">
      <div className="flex items-center justify-between gap-2">
        <h3 id="task-dependencies" className="text-sm font-medium">
          {t("title")}
        </h3>
        {waiting ? (
          <span className="inline-flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="size-3.5" aria-hidden />
            {t("openBlockers", { count: task.openBlockerCount })}
          </span>
        ) : null}
      </div>
      <DependencyGroup task={task} direction="blockedBy" onOpenTask={onOpenTask} />
      <DependencyGroup task={task} direction="blocking" onOpenTask={onOpenTask} />
    </section>
  );
}

function DependencyGroup({
  task,
  direction,
  onOpenTask,
}: {
  task: TaskDetail;
  direction: Direction;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("tasks.dependencies");
  const toast = useToast();
  const actions = useTaskActions();
  const dueLabel = useDueLabel();
  const refs = task[direction];
  const label = t(direction);

  const edge = (otherId: string) =>
    direction === "blockedBy"
      ? { blockingTaskId: otherId, blockedTaskId: task.id }
      : { blockingTaskId: task.id, blockedTaskId: otherId };
  // Dates conflict when the later task starts before the earlier one is due.
  const conflicts = (ref: DependencyRef) =>
    direction === "blockedBy" ? hasScheduleConflict(ref, task) : hasScheduleConflict(task, ref);

  return (
    <div className="flex flex-col gap-1" data-testid={`dependencies-${direction}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs text-muted-foreground">{label}</h4>
        <Popover
          align="end"
          trigger={(props) => (
            <Button variant="ghost" size="sm" {...props}>
              <Plus />
              {t(direction === "blockedBy" ? "addBlockedBy" : "addBlocking")}
            </Button>
          )}
        >
          {(close) => (
            <TaskPicker
              excludeIds={new Set([task.id, ...refs.map((r) => r.id)])}
              searchLabel={t("search")}
              resultsLabel={t("results")}
              emptyLabel={t("empty")}
              onSelect={(other) =>
                actions.addDependency.mutate(edge(other.id), {
                  onSuccess: () => {
                    toast.show(t("added"));
                    close();
                  },
                })
              }
            />
          )}
        </Popover>
      </div>
      {refs.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul aria-label={label} className="flex flex-col">
          {refs.map((ref) => {
            const closed = isClosedCategory(ref.statusCategory);
            const due = ref.dueDate ? dueLabel(ref.dueDate, null) : null;
            return (
              <li
                key={ref.id}
                className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-muted"
              >
                <StatusIcon category={ref.statusCategory} className="size-4 shrink-0" />
                <button
                  type="button"
                  onClick={() => onOpenTask(ref.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-sm",
                    closed && "text-muted-foreground line-through",
                  )}
                >
                  {ref.title}
                </button>
                {conflicts(ref) && !closed ? (
                  <span role="img" aria-label={t("conflict")} title={t("conflict")}>
                    <AlertTriangle className="size-3.5 shrink-0 text-danger" aria-hidden />
                  </span>
                ) : null}
                {due ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {due.text}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    actions.removeDependency.mutate(edge(ref.id), {
                      onSuccess: () => toast.show(t("removed")),
                    })
                  }
                  aria-label={t("remove", { title: ref.title })}
                  title={t("remove", { title: ref.title })}
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
