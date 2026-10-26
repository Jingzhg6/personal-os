"use client";

import { useTranslations } from "next-intl";

import type { ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";

import { isClosedCategory, type Task } from "../domain";
import { StatusIcon } from "./status-icon";
import type { useTaskActions } from "./use-task-data";

/** Round checkbox: completes an open task, reopens a closed one. */
export function StatusToggle({
  task,
  color,
  actions,
}: {
  task: Pick<Task, "id" | "title" | "statusCategory">;
  color?: ColorId;
  actions: ReturnType<typeof useTaskActions>;
}) {
  const t = useTranslations("tasks.row");
  const closed = isClosedCategory(task.statusCategory);
  const label = closed ? t("reopen", { title: task.title }) : t("complete", { title: task.title });

  return (
    <button
      type="button"
      role="checkbox"
      data-row-toggle
      aria-checked={task.statusCategory === "completed"}
      aria-label={label}
      title={label}
      onClick={() => (closed ? actions.reopen : actions.complete).mutate({ id: task.id })}
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
  );
}
