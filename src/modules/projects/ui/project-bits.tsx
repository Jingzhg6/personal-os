"use client";

import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/shared/lib/cn";
import { ProgressBar } from "@/shared/ui/progress-bar";

import { progressRatio, type Progress, type ProjectStatus } from "../domain";

const statusTones: Record<ProjectStatus, string> = {
  planned: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
  active: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  paused: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-zinc-500/12 text-zinc-500 line-through",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const t = useTranslations("projects.status");
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        statusTones[status],
      )}
    >
      {t(status)}
    </span>
  );
}

export function ProjectProgress({
  progress,
  className,
}: {
  progress: Progress;
  className?: string;
}) {
  const t = useTranslations("projects");
  const format = useFormatter();
  const ratio = progressRatio(progress);
  const label =
    ratio === null
      ? t("noTasks")
      : t("progress", { completed: progress.completed, total: progress.total });
  const percent = ratio === null ? null : format.number(ratio, "percent");
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <ProgressBar value={ratio} label={label} tone={ratio === 1 ? "success" : "primary"} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {percent ? <span className="tabular-nums">{percent}</span> : null}
      </div>
    </div>
  );
}

/** Formats a date-only value (no timezone shift). */
export function useDateOnly() {
  const format = useFormatter();
  return (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
}
