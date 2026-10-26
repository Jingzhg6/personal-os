"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useAreas } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { PageHeader } from "@/shared/ui/page-header";

import { isClosedCategory, type Task, type TaskListQuery, type TaskStatus } from "../domain";
import { FilterBar } from "./filter-bar";
import { useStatusLabel, useToday } from "./labels";
import { useMilestoneLookup } from "./project-chip";
import { QuickAdd } from "./quick-add";
import { StatusIcon } from "./status-icon";
import { TaskCard, TaskCardPreview } from "./task-card";
import { TaskDetailPanel } from "./task-detail-panel";
import type { TaskLookups } from "./task-row";
import { useListUrlState } from "./use-list-state";
import { useTaskPanel } from "./use-task-panel";
import { useStatuses, useTags, useTaskActions, useTaskList } from "./use-task-data";

/** Closed columns (done / cancelled) only render this many cards. */
const CLOSED_COLUMN_LIMIT = 20;

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/**
 * Kanban board of top-level tasks, one column per task status (in workflow order). Moving a card
 * sets that task's status, through the same transition rules and events as everywhere else.
 */
export function KanbanBoard({
  title,
  projectId,
  embedded = false,
}: {
  title?: string;
  /** Limit the board to one project (inside the project page). */
  projectId?: string;
  embedded?: boolean;
}) {
  const t = useTranslations("tasks.kanban");
  const dndId = useId();
  const today = useToday();
  const statusLabel = useStatusLabel();
  const [state, setState] = useListUrlState();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const [dragging, setDragging] = useState<Task | null>(null);

  const query: TaskListQuery = useMemo(
    () => ({
      today,
      search: state.search.trim() || undefined,
      sort: "manual",
      includeSubtasks: false,
      filter: projectId
        ? { ...state.filter, projectIds: [projectId], noProject: undefined }
        : state.filter,
    }),
    [today, state.search, state.filter, projectId],
  );
  const { data: tasks = [] } = useTaskList(query);
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const actions = useTaskActions();
  const milestones = useMilestoneLookup(projectId);

  const lookups: TaskLookups = useMemo(
    () => ({
      statuses: new Map(statuses.map((s) => [s.id, s])),
      areas: new Map(areas.map((a) => [a.id, a])),
      tags: new Map(tags.map((tag) => [tag.id, tag])),
      milestones,
    }),
    [statuses, areas, tags, milestones],
  );

  const columns = useMemo(
    () =>
      statuses.map((status) => ({
        status,
        tasks: tasks.filter((task) => task.statusId === status.id),
      })),
    [statuses, tasks],
  );
  const statusOptions = statuses.map((status) => ({ id: status.id, label: statusLabel(status) }));
  const statusName = (id: unknown) => {
    const status = statuses.find((s) => s.id === id);
    return status ? statusLabel(status) : "";
  };
  const titleOf = (id: unknown) => tasks.find((task) => task.id === id)?.title ?? "";
  const setStatus = (task: Task, statusId: string) =>
    actions.setStatus.mutate({ id: task.id, statusId });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("drag.start", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("drag.over", { title: titleOf(active.id), status: statusName(over.id) }) : undefined,
    onDragEnd: ({ active, over }) => {
      const task = tasks.find((x) => x.id === active.id);
      if (!over || !task || task.statusId === over.id)
        return t("drag.noMove", { title: titleOf(active.id) });
      return t("drag.end", { title: task.title, status: statusName(over.id) });
    },
    onDragCancel: ({ active }) => t("drag.cancel", { title: titleOf(active.id) }),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const task = tasks.find((x) => x.id === active.id);
    if (task && over && task.statusId !== over.id) setStatus(task, String(over.id));
  }

  return (
    <div className={cn("transition-[padding]", openTaskId && !embedded && "lg:pr-[480px]")}>
      <div className="flex flex-col gap-5">
        {embedded || !title ? null : <PageHeader title={title} description={t("description")} />}

        <FilterBar
          state={state}
          onChange={setState}
          areas={areas}
          tags={tags}
          hide={{ sort: true, project: Boolean(projectId) }}
        />

        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={({ active }) =>
            setDragging(tasks.find((task) => task.id === active.id) ?? null)
          }
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t("drag.instructions") },
          }}
        >
          <div
            role="region"
            aria-label={t("board")}
            tabIndex={0}
            className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:snap-none lg:px-0"
          >
            {columns.map(({ status, tasks: columnTasks }) => (
              <Column
                key={status.id}
                status={status}
                label={statusLabel(status)}
                tasks={columnTasks}
                projectId={projectId}
                renderCard={(task) => (
                  <TaskCard
                    key={task.id}
                    testId="kanban-card"
                    task={task}
                    lookups={lookups}
                    selected={task.id === openTaskId}
                    onOpen={openTask}
                    actions={actions}
                    showProject={!projectId}
                    dragLabel={t("drag.handle", { title: task.title })}
                    moveMenu={{
                      label: t("moveMenu", { title: task.title }),
                      options: statusOptions,
                      current: task.statusId,
                      onSelect: (statusId) => setStatus(task, statusId),
                    }}
                  />
                )}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <div className="w-64">
                <TaskCardPreview
                  task={dragging}
                  lookups={lookups}
                  actions={actions}
                  showProject={!projectId}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
      </div>
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
  projectId,
  renderCard,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  projectId?: string;
  renderCard: (task: Task) => ReactNode;
}) {
  const t = useTranslations("tasks.kanban");
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const closed = isClosedCategory(status.category);
  const visible = closed ? tasks.slice(0, CLOSED_COLUMN_LIMIT) : tasks;
  const headingId = `kanban-${status.id}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid="kanban-column"
      data-status={label}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col gap-2 rounded-lg border bg-surface-muted/50 p-2.5 transition-colors lg:w-auto lg:min-w-64 lg:flex-1",
        isOver ? "border-primary bg-accent/60" : "border-border",
      )}
    >
      <header className="flex items-center gap-2 px-1">
        <StatusIcon category={status.category} color={status.color} className="size-4" />
        <h2 id={headingId} className="text-sm font-semibold">
          {label}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
      </header>

      <ul className="flex min-h-24 flex-1 flex-col gap-1.5" aria-label={label}>
        {visible.map(renderCard)}
        {tasks.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border py-6 text-xs text-muted-foreground">
            {t("dropHere")}
          </li>
        ) : null}
        {tasks.length > visible.length ? (
          <li className="px-1 text-xs text-muted-foreground">
            {t("more", { count: tasks.length - visible.length })}
          </li>
        ) : null}
      </ul>

      {closed ? null : (
        <QuickAdd
          compact
          label={t("addTo", { status: label })}
          defaults={{ statusId: status.id, projectId }}
        />
      )}
    </section>
  );
}
