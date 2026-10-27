"use client";

import { CornerDownRight, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";

import { AreaBadge } from "@/modules/areas/ui";
import type { Area } from "@/modules/areas/domain";
import { cn } from "@/shared/lib/cn";
import { ColorDot } from "@/shared/ui/color";

import { isClosedCategory, type Tag, type Task, type TaskStatus } from "../domain";
import { useDueLabel, usePriorityLabel } from "./labels";
import { PriorityIcon } from "./priority-icon";
import { BlockedChip } from "./blocked-chip";
import { MilestoneChip, ProjectChip } from "./project-chip";
import type { SortableRender } from "./sortable-list";
import { StatusToggle } from "./status-toggle";
import type { useTaskActions } from "./use-task-data";

export interface TaskLookups {
  statuses: Map<string, TaskStatus>;
  areas: Map<string, Area>;
  tags: Map<string, Tag>;
  /** Milestone names, inside a project's views. */
  milestones?: Map<string, string>;
}

const dueTones = {
  overdue: "text-danger",
  today: "text-warning",
  tomorrow: "text-foreground",
  upcoming: "text-muted-foreground",
} as const;

export function TaskRow({
  task,
  lookups,
  selected,
  onOpen,
  actions,
  sortable,
  showParent = false,
  showProject = true,
}: {
  task: Task;
  lookups: TaskLookups;
  selected: boolean;
  onOpen: (id: string) => void;
  actions: ReturnType<typeof useTaskActions>;
  /** Drag-and-drop wiring when the row is inside a SortableList. */
  sortable?: SortableRender;
  /** Show "属于「父任务」" for subtasks listed outside their parent. */
  showParent?: boolean;
  /** Hide the project chip inside a project's own views. */
  showProject?: boolean;
}) {
  const t = useTranslations("tasks");
  const dueLabel = useDueLabel();
  const priorityLabel = usePriorityLabel();
  const closed = isClosedCategory(task.statusCategory);
  const status = lookups.statuses.get(task.statusId);
  const area = task.areaId ? lookups.areas.get(task.areaId) : undefined;
  const tags = task.tagIds
    .map((id) => lookups.tags.get(id))
    .filter((tag): tag is Tag => Boolean(tag));
  const due = task.dueDate ? dueLabel(task.dueDate, task.dueTime) : null;

  return (
    <li
      ref={sortable?.ref}
      style={sortable?.style}
      data-testid="task-row"
      data-task-id={task.id}
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
        selected ? "bg-accent/70" : "hover:bg-surface-muted",
        sortable?.isDragging && "bg-surface-raised shadow-md",
      )}
    >
      {sortable?.handle}
      <StatusToggle task={task} color={status?.color} actions={actions} />
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        aria-current={selected ? "true" : undefined}
        data-row-main
        className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm",
              closed
                ? "text-muted-foreground line-through decoration-muted-foreground/50"
                : "text-foreground",
            )}
          >
            {task.title}
          </span>
          {showParent && task.parentTitle ? (
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" aria-hidden />
              {t("parentHint", { title: task.parentTitle })}
            </span>
          ) : null}
        </span>

        <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <BlockedChip task={task} />
          {task.isUrgent ? (
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600 dark:text-red-300">
              {t("flags.urgent")}
            </span>
          ) : null}
          {task.isImportant ? (
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-medium text-violet-600 dark:text-violet-300">
              {t("flags.important")}
            </span>
          ) : null}
          {task.subtaskCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              title={t("row.subtasks", {
                done: task.completedSubtaskCount,
                total: task.subtaskCount,
              })}
            >
              <ListChecks className="size-3.5" aria-hidden />
              {`${task.completedSubtaskCount}/${task.subtaskCount}`}
            </span>
          ) : null}
          {tags.slice(0, 3).map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1">
              <ColorDot color={tag.color} />
              {tag.name}
            </span>
          ))}
          {showProject && task.projectId ? <ProjectChip projectId={task.projectId} /> : null}
          {task.milestoneId && lookups.milestones?.get(task.milestoneId) ? (
            <MilestoneChip name={lookups.milestones.get(task.milestoneId)!} />
          ) : null}
          {area ? <AreaBadge area={area} /> : null}
          {due ? (
            <span
              className={cn("tabular-nums", !closed && dueTones[due.state])}
              title={t("row.due", { date: due.text })}
            >
              {due.text}
            </span>
          ) : null}
          {task.priority ? (
            <span title={t("row.priority", { priority: priorityLabel(task.priority) })}>
              <PriorityIcon priority={task.priority} />
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
