"use client";

import { Lock, Repeat } from "lucide-react";
import { useTranslations } from "next-intl";

import { isClosedCategory, type Task } from "../domain";

/** "受阻" marker for an open task still waiting for open 前置任务. */
export function BlockedChip({ task }: { task: Task }) {
  const t = useTranslations("tasks.dependencies");
  if (task.openBlockerCount === 0 || isClosedCategory(task.statusCategory)) return null;
  const label = t("blockedLabel", { count: task.openBlockerCount });
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300"
    >
      <Lock className="size-3" aria-hidden />
      <span aria-hidden>{t("blocked")}</span>
    </span>
  );
}

/** Marks an instance of a recurring series (ADR 0023). */
export function RecurringMark({ task }: { task: Task }) {
  const t = useTranslations("tasks.recurrence");
  if (!task.recurrenceId) return null;
  return (
    <span title={t("badge")} aria-label={t("badge")} data-testid="recurring-mark">
      <Repeat className="size-3.5 text-primary" aria-hidden />
    </span>
  );
}
