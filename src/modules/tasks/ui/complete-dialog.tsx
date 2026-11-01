"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";

import { addDays, type Task, type TaskStatus } from "../domain";
import { useToday } from "./labels";
import type { useTaskActions } from "./use-task-data";

export type CompletableTask = Pick<
  Task,
  "id" | "title" | "statusCategory" | "subtaskCount" | "completedSubtaskCount"
>;

/**
 * Confirms a completion and its date (the day it was actually done). Today is preselected;
 * earlier days can be chosen to record a completion afterwards; future days cannot. Cancelling
 * changes nothing.
 */
export function CompleteDialog({
  task,
  statusId,
  actions,
  onClose,
}: {
  task: CompletableTask;
  /** A specific "completed" status (quick edit); otherwise the first one. */
  statusId?: string;
  actions: ReturnType<typeof useTaskActions>;
  onClose: () => void;
}) {
  const t = useTranslations("tasks.completeDialog");
  const today = useToday();
  const ids = { date: useId() };
  const [date, setDate] = useState(today);
  const openSubtasks = Math.max(0, (task.subtaskCount ?? 0) - (task.completedSubtaskCount ?? 0));
  const [includeSubtasks, setIncludeSubtasks] = useState(openSubtasks > 0);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

  function confirm() {
    if (!valid) return;
    actions.complete.mutate({
      id: task.id,
      completedOn: date,
      ...(statusId ? { statusId } : {}),
      ...(openSubtasks > 0 ? { includeSubtasks } : {}),
    });
    onClose();
  }

  return (
    <ConfirmDialog
      open
      tone="primary"
      title={t("title")}
      description={t("description", { title: task.title })}
      confirmLabel={t("confirm")}
      // x then Enter completes today; the date is one Shift+Tab away.
      initialFocus="confirm"
      onConfirm={confirm}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-3" data-testid="complete-dialog">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.date} className="text-sm font-medium">
            {t("date")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={ids.date}
              type="date"
              value={date}
              max={today}
              required
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
              data-testid="complete-date"
            />
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted"
              onClick={() => setDate(today)}
            >
              {t("today")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-muted"
              onClick={() => setDate(addDays(today, -1))}
            >
              {t("yesterday")}
            </button>
          </div>
          <p className={valid ? "text-xs text-muted-foreground" : "text-xs text-danger"}>
            {valid ? (date === today ? t("hintToday") : t("hintPast")) : t("invalid")}
          </p>
        </div>
        {openSubtasks > 0 ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeSubtasks}
              onChange={(e) => setIncludeSubtasks(e.target.checked)}
              data-testid="complete-subtasks"
            />
            <span>{t("subtasks", { count: openSubtasks })}</span>
          </label>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

/**
 * Status changes from menus and boards: moving an open task into a "completed" status goes
 * through CompleteDialog (date confirmation); any other change applies at once. Render `dialog`.
 */
export function useStatusChange(
  actions: ReturnType<typeof useTaskActions>,
  statuses: readonly TaskStatus[],
) {
  const [pending, setPending] = useState<{ task: CompletableTask; statusId: string } | null>(null);
  const change = (task: CompletableTask, statusId: string) => {
    const target = statuses.find((s) => s.id === statusId);
    if (target?.category === "completed" && task.statusCategory !== "completed") {
      setPending({ task, statusId });
    } else {
      actions.setStatus.mutate({ id: task.id, statusId });
    }
  };
  const dialog = pending ? (
    <CompleteDialog
      task={pending.task}
      statusId={pending.statusId}
      actions={actions}
      onClose={() => setPending(null)}
    />
  ) : null;
  return { change, dialog };
}
