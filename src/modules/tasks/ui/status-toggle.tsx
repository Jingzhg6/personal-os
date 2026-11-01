"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";

import { isClosedCategory, type Task } from "../domain";
import { CompleteDialog, type CompletableTask } from "./complete-dialog";
import { StatusIcon } from "./status-icon";
import { useTaskActions } from "./use-task-data";

/**
 * Round checkbox: completing an open task asks for the completion date first (CompleteDialog);
 * a closed task is reopened at once.
 */
export function StatusToggle({
  task,
  color,
  actions,
}: {
  task: Pick<Task, "id" | "title" | "statusCategory"> & Partial<CompletableTask>;
  color?: ColorId;
  actions: ReturnType<typeof useTaskActions>;
}) {
  const t = useTranslations("tasks.row");
  const [confirming, setConfirming] = useState(false);
  const closed = isClosedCategory(task.statusCategory);
  const label = closed ? t("reopen", { title: task.title }) : t("complete", { title: task.title });

  return (
    <>
      <button
        type="button"
        role="checkbox"
        data-row-toggle
        aria-checked={task.statusCategory === "completed"}
        aria-label={label}
        title={label}
        onClick={() => (closed ? actions.reopen.mutate({ id: task.id }) : setConfirming(true))}
        className={cn(
          "group/toggle -m-1 flex shrink-0 items-center justify-center rounded-full p-1 transition-transform active:scale-90",
        )}
      >
        <StatusIcon
          category={task.statusCategory}
          color={color}
          className={cn(!closed && "group-hover/toggle:text-primary")}
        />
      </button>
      {confirming ? (
        <CompleteDialog
          task={{ subtaskCount: 0, completedSubtaskCount: 0, ...task }}
          actions={actions}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/** The same toggle for pages outside the task views (e.g. a goal's actions). */
export function TaskCompletionToggle({
  task,
}: {
  task: Pick<Task, "id" | "title" | "statusCategory"> & Partial<CompletableTask>;
}) {
  const actions = useTaskActions();
  return <StatusToggle task={task} actions={actions} />;
}
