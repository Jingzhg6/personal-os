"use client";

import { useDraggable } from "@dnd-kit/core";
import { ArrowRightLeft, CornerDownRight, GripVertical, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AreaBadge } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { ColorDot } from "@/shared/ui/color";
import { MenuCheckbox, Popover } from "@/shared/ui/popover";

import { isClosedCategory, type Tag, type Task } from "../domain";
import { BlockedChip } from "./blocked-chip";
import { useDueLabel } from "./labels";
import { PriorityIcon } from "./priority-icon";
import { MilestoneChip, ProjectChip } from "./project-chip";
import { StatusToggle } from "./status-toggle";
import type { TaskLookups } from "./task-row";
import type { useTaskActions } from "./use-task-data";

const dueTones = {
  overdue: "text-danger",
  today: "text-warning",
  tomorrow: "text-foreground",
  upcoming: "text-muted-foreground",
} as const;

/** The card's "移到…" menu: the alternative to dragging for keyboard and touch users. */
export interface CardMoveMenu {
  label: string;
  options: { id: string; label: string }[];
  current: string;
  onSelect: (id: string) => void;
}

export interface TaskCardProps {
  task: Task;
  lookups: TaskLookups;
  selected: boolean;
  onOpen: (id: string) => void;
  actions: ReturnType<typeof useTaskActions>;
  moveMenu: CardMoveMenu;
  /** Accessible name of the keyboard drag handle. */
  dragLabel: string;
  /** Hide the project chip inside a project's own views. */
  showProject?: boolean;
  testId?: string;
}

/**
 * A task as a draggable card (Eisenhower matrix, Kanban board). Dragging a card or using its
 * menu changes a field of the one task record; the card holds no state of its own.
 */
export function TaskCard({ testId = "task-card", ...props }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: props.task.id,
  });

  return (
    <li
      ref={setNodeRef}
      // Pointer drag from anywhere on the card; keyboard drag from the handle.
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler | undefined}
      data-testid={testId}
      data-task-id={props.task.id}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
    >
      <CardBody
        {...props}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler | undefined}
            aria-label={props.dragLabel}
            title={props.dragLabel}
            className="-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 hover:text-foreground"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        }
      />
    </li>
  );
}

/** Static rendering used for the floating drag preview. */
export function TaskCardPreview(
  props: Pick<TaskCardProps, "task" | "lookups" | "actions" | "showProject">,
) {
  return (
    <div className="rotate-1 shadow-md">
      <CardBody {...props} selected={false} onOpen={() => {}} dragLabel="" />
    </div>
  );
}

function CardBody({
  task,
  lookups,
  selected,
  onOpen,
  actions,
  moveMenu,
  showProject = true,
  handle,
}: Omit<TaskCardProps, "moveMenu" | "testId"> & { moveMenu?: CardMoveMenu; handle?: ReactNode }) {
  const t = useTranslations("tasks");
  const dueLabel = useDueLabel();
  const status = lookups.statuses.get(task.statusId);
  const area = task.areaId ? lookups.areas.get(task.areaId) : undefined;
  const tags = task.tagIds
    .map((id) => lookups.tags.get(id))
    .filter((tag): tag is Tag => Boolean(tag));
  const due = task.dueDate ? dueLabel(task.dueDate, task.dueTime) : null;
  const preview = !moveMenu;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-surface px-2.5 py-2 text-sm transition-colors",
        selected ? "border-primary/50 bg-accent/40" : "border-border hover:border-input",
      )}
    >
      <div className="flex items-start gap-2">
        {handle ?? <span className="size-6 shrink-0" />}
        <div className="pt-0.5">
          <StatusToggle task={task} color={status?.color} actions={actions} />
        </div>
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          data-row-main
          className="min-w-0 flex-1 rounded-sm pt-0.5 text-left"
          tabIndex={preview ? -1 : undefined}
        >
          <span className="line-clamp-2 break-words">{task.title}</span>
          {task.parentTitle ? (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0" aria-hidden />
              {t("parentHint", { title: task.parentTitle })}
            </span>
          ) : null}
        </button>
        {moveMenu ? (
          <Popover
            align="end"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label={moveMenu.label}
                title={moveMenu.label}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <ArrowRightLeft className="size-3.5" aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <div
                role="menu"
                aria-label={moveMenu.label}
                className="flex max-h-72 w-48 flex-col overflow-y-auto"
              >
                {moveMenu.options.map((option) => (
                  <MenuCheckbox
                    key={option.id}
                    type="radio"
                    checked={moveMenu.current === option.id}
                    onChange={() => {
                      close();
                      if (option.id !== moveMenu.current) moveMenu.onSelect(option.id);
                    }}
                  >
                    {option.label}
                  </MenuCheckbox>
                ))}
              </div>
            )}
          </Popover>
        ) : null}
      </div>

      {(task.openBlockerCount > 0 && !isClosedCategory(task.statusCategory)) ||
      (showProject && task.projectId) ||
      (task.milestoneId && lookups.milestones?.has(task.milestoneId)) ||
      area ||
      due ||
      task.priority ||
      tags.length > 0 ||
      task.subtaskCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-14 text-xs text-muted-foreground">
          <BlockedChip task={task} />
          {showProject && task.projectId ? <ProjectChip projectId={task.projectId} /> : null}
          {task.milestoneId && lookups.milestones?.get(task.milestoneId) ? (
            <MilestoneChip name={lookups.milestones.get(task.milestoneId)!} />
          ) : null}
          {area ? <AreaBadge area={area} /> : null}
          {due ? <span className={cn("tabular-nums", dueTones[due.state])}>{due.text}</span> : null}
          {task.subtaskCount > 0 ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <ListChecks className="size-3.5" aria-hidden />
              {`${task.completedSubtaskCount}/${task.subtaskCount}`}
            </span>
          ) : null}
          {tags.slice(0, 2).map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1">
              <ColorDot color={tag.color} />
              {tag.name}
            </span>
          ))}
          <PriorityIcon priority={task.priority} />
        </div>
      ) : null}
    </div>
  );
}
