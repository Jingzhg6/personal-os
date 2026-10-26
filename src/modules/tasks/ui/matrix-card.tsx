"use client";

import { useDraggable } from "@dnd-kit/core";
import { ArrowRightLeft, CornerDownRight, GripVertical, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";

import { AreaBadge } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { ColorDot } from "@/shared/ui/color";
import { MenuCheckbox, Popover } from "@/shared/ui/popover";

import {
  matrixPlacement,
  matrixPlacements,
  type MatrixPlacement,
  type Tag,
  type Task,
} from "../domain";
import { useDueLabel } from "./labels";
import { PriorityIcon } from "./priority-icon";
import { StatusToggle } from "./status-toggle";
import type { TaskLookups } from "./task-row";
import type { useTaskActions } from "./use-task-data";

const dueTones = {
  overdue: "text-danger",
  today: "text-warning",
  tomorrow: "text-foreground",
  upcoming: "text-muted-foreground",
} as const;

interface MatrixCardProps {
  task: Task;
  lookups: TaskLookups;
  selected: boolean;
  onOpen: (id: string) => void;
  onMove: (task: Task, placement: MatrixPlacement) => void;
  actions: ReturnType<typeof useTaskActions>;
}

/** A task card in the matrix. Dragging it (or using its menu) only changes the task's flags. */
export function MatrixCard(props: MatrixCardProps) {
  const t = useTranslations("tasks.matrix");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: props.task.id,
  });

  return (
    <li
      ref={setNodeRef}
      // Pointer drag from anywhere on the card; keyboard drag from the handle.
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler | undefined}
      data-testid="matrix-card"
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
            aria-label={t("drag.handle", { title: props.task.title })}
            title={t("drag.handle", { title: props.task.title })}
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
export function MatrixCardPreview(props: Omit<MatrixCardProps, "onMove" | "onOpen" | "selected">) {
  return (
    <div className="rotate-1 shadow-md">
      <CardBody {...props} selected={false} onOpen={() => {}} onMove={() => {}} preview />
    </div>
  );
}

function CardBody({
  task,
  lookups,
  selected,
  onOpen,
  onMove,
  actions,
  handle,
  preview = false,
}: MatrixCardProps & { handle?: React.ReactNode; preview?: boolean }) {
  const t = useTranslations("tasks");
  const dueLabel = useDueLabel();
  const status = lookups.statuses.get(task.statusId);
  const area = task.areaId ? lookups.areas.get(task.areaId) : undefined;
  const tags = task.tagIds
    .map((id) => lookups.tags.get(id))
    .filter((tag): tag is Tag => Boolean(tag));
  const due = task.dueDate ? dueLabel(task.dueDate, task.dueTime) : null;
  const current = matrixPlacement(task);

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
        {preview ? null : (
          <Popover
            align="end"
            trigger={(props) => (
              <button
                type="button"
                {...props}
                aria-label={t("matrix.moveMenu", { title: task.title })}
                title={t("matrix.moveMenu", { title: task.title })}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <ArrowRightLeft className="size-3.5" aria-hidden />
              </button>
            )}
          >
            {(close) => (
              <div
                role="menu"
                aria-label={t("matrix.moveMenu", { title: task.title })}
                className="flex w-44 flex-col"
              >
                {matrixPlacements.map((placement) => (
                  <MenuCheckbox
                    key={placement}
                    type="radio"
                    checked={current === placement}
                    onChange={() => {
                      close();
                      if (placement !== current) onMove(task, placement);
                    }}
                  >
                    {t(`matrix.placements.${placement}.title`)}
                  </MenuCheckbox>
                ))}
              </div>
            )}
          </Popover>
        )}
      </div>

      {area || due || task.priority || tags.length > 0 || task.subtaskCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-14 text-xs text-muted-foreground">
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
