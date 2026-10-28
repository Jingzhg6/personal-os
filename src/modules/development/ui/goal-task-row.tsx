"use client";

import { PieChart, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { Task } from "@/modules/tasks/domain";
import { TaskCompletionToggle } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

import type { GoalDetail } from "../domain";

const SHORT = { month: "short", day: "numeric", timeZone: "UTC" } as const;

/** One linked action: status, title, what it contributes to this goal, and its controls. */
export function GoalTaskRow({
  task,
  attribution,
  onOpen,
  onAttribute,
  removeLabel,
  onRemove,
}: {
  task: Task;
  attribution: GoalDetail["taskAttribution"][string] | undefined;
  onOpen: () => void;
  onAttribute: () => void;
  removeLabel: string;
  onRemove: () => void;
}) {
  const t = useTranslations("development.goalDetail");
  const ta = useTranslations("development.attribution");
  const format = useFormatter();
  const closed =
    task.statusCategory === "completed" ||
    task.statusCategory === "cancelled" ||
    task.statusCategory === "failed";

  return (
    <li
      className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 hover:bg-surface-muted/60"
      data-testid="goal-task"
      data-category={task.statusCategory}
    >
      <TaskCompletionToggle task={task} />
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("openTask", { title: task.title })}
        className={cn(
          // Wraps on phones (chips move to the next line), one line from `sm` up.
          "min-w-[8rem] flex-1 text-left text-sm break-words hover:underline sm:min-w-0 sm:truncate",
          closed && "text-muted-foreground line-through",
        )}
      >
        {task.title}
      </button>
      {/* Chips and controls stay together, right-aligned, when the row wraps. */}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {attribution?.needsAllocation ? (
            <span
              className="rounded bg-warning/15 px-1.5 py-0.5 font-medium text-foreground"
              title={ta("needsHint")}
              data-testid="task-needs-allocation"
            >
              {ta("needs")}
            </span>
          ) : attribution && attribution.attributedXp !== 0 ? (
            <span
              className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary tabular-nums"
              data-testid="task-attributed"
            >
              {ta("attributed", { xp: format.number(attribution.attributedXp) })}
            </span>
          ) : null}
          {attribution && attribution.unattributedXp > 0 && !attribution.needsAllocation ? (
            <span className="tabular-nums" data-testid="task-unattributed">
              {ta("unattributedXp", { xp: format.number(attribution.unattributedXp) })}
            </span>
          ) : null}
          <span className="hidden sm:inline">{t(`taskStatus.${task.statusCategory}`)}</span>
          {task.dueDate ? (
            <span className="tabular-nums">
              {t("due", { date: format.dateTime(new Date(`${task.dueDate}T00:00:00Z`), SHORT) })}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={ta("editFor", { title: task.title })}
            title={ta("editFor", { title: task.title })}
            onClick={onAttribute}
          >
            <PieChart />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={onRemove}
          >
            <X />
          </Button>
        </span>
      </span>
    </li>
  );
}
