"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical, Inbox } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { AreaBadge, useAreas } from "@/modules/areas/ui";
import type { Task } from "@/modules/tasks/domain";
import { cn } from "@/shared/lib/cn";

import type { Project } from "../domain";

/** Drop target ids of project cards; task ids are the draggable ids. */
export const projectDropId = (projectId: string) => `project:${projectId}`;

/**
 * Open top-level tasks without a project, below the project cards. Each can be dragged onto a
 * project card, or moved with its 「移到项目」 menu (keyboard and touch). Either way the task's
 * project is updated in place — the task itself is never recreated.
 */
export function UnassignedTasks({
  tasks,
  projects,
  onMove,
}: {
  tasks: Task[];
  projects: Project[];
  onMove: (task: Task, projectId: string) => void;
}) {
  const t = useTranslations("projects.unassigned");
  return (
    <section
      aria-labelledby="unassigned-title"
      className="flex flex-col gap-3"
      data-testid="unassigned"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="unassigned-title" className="flex items-center gap-2 text-base font-semibold">
          <Inbox className="size-4 text-muted-foreground" aria-hidden />
          {t("title", { count: tasks.length })}
        </h2>
        {tasks.length > 0 ? <p className="text-xs text-muted-foreground">{t("hint")}</p> : null}
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <UnassignedTask key={task.id} task={task} projects={projects} onMove={onMove} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UnassignedTask({
  task,
  projects,
  onMove,
}: {
  task: Task;
  projects: Project[];
  onMove: (task: Task, projectId: string) => void;
}) {
  const t = useTranslations("projects.unassigned");
  const { data: areas = [] } = useAreas();
  const area = areas.find((a) => a.id === task.areaId);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: task.id,
  });

  return (
    <li
      ref={setNodeRef}
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler | undefined}
      data-testid="unassigned-task"
      data-task-id={task.id}
      className={cn(
        "flex touch-manipulation flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-sm shadow-xs",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler | undefined}
        aria-label={t("drag", { title: task.title })}
        title={t("drag", { title: task.title })}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <Link
        href={`/tasks?task=${task.id}`}
        className="min-w-0 flex-1 truncate hover:underline"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {task.title}
      </Link>
      {area ? <AreaBadge area={area} /> : null}
      <select
        aria-label={t("moveTo", { title: task.title })}
        value=""
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.value) onMove(task, e.target.value);
        }}
        className="h-7 max-w-40 rounded-md border border-input bg-surface px-1.5 text-xs text-muted-foreground"
      >
        <option value="">{t("moveToPlaceholder")}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </li>
  );
}

/** Wraps a project card so tasks can be dropped on it. */
export function ProjectDropZone({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: projectDropId(projectId) });
  return (
    <div
      ref={setNodeRef}
      data-testid="project-drop"
      data-over={isOver || undefined}
      className={cn(
        "h-full rounded-lg",
        isOver && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {children}
    </div>
  );
}
