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
  type DragStartEvent,
} from "@dnd-kit/core";
import { Grid2x2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";

import { useAreas } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { PageHeader } from "@/shared/ui/page-header";

import {
  flagsForPlacement,
  matrixPlacement,
  matrixPlacements,
  quadrants,
  type MatrixPlacement,
  type Task,
  type TaskListQuery,
} from "../domain";
import { FilterBar } from "./filter-bar";
import { useToday } from "./labels";
import { QuickAdd } from "./quick-add";
import { TaskDetailPanel } from "./task-detail-panel";
import type { TaskLookups } from "./task-row";
import { useListUrlState } from "./use-list-state";
import { useTaskPanel } from "./use-task-panel";
import { useStatuses, useTags, useTaskActions, useTaskList } from "./use-task-data";
import { TaskCard, TaskCardPreview } from "./task-card";

const OPEN_CATEGORIES = ["backlog", "unstarted", "started"] as const;

const accents: Record<MatrixPlacement, string> = {
  do: "bg-red-500",
  schedule: "bg-violet-500",
  delegate: "bg-amber-500",
  eliminate: "bg-zinc-400",
  unsorted: "bg-sky-500",
};

/** Prefer the zone under the pointer; fall back to overlap (keyboard dragging has no pointer). */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

/**
 * Eisenhower matrix: open tasks (and subtasks) placed by their urgent / important flags.
 * It reads the same task records as every other view; moving a card only updates the flags.
 */
export function MatrixView({ title }: { title: string }) {
  const t = useTranslations("tasks.matrix");
  const dndId = useId();
  const today = useToday();
  const [state, setState] = useListUrlState();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const [dragging, setDragging] = useState<Task | null>(null);

  const query: TaskListQuery = useMemo(
    () => ({
      today,
      search: state.search.trim() || undefined,
      sort: "due",
      includeSubtasks: true,
      filter: { ...state.filter, categories: state.filter.categories ?? [...OPEN_CATEGORIES] },
    }),
    [today, state.search, state.filter],
  );
  const { data: tasks = [], isPending } = useTaskList(query);
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const actions = useTaskActions();

  const lookups: TaskLookups = useMemo(
    () => ({
      statuses: new Map(statuses.map((s) => [s.id, s])),
      areas: new Map(areas.map((a) => [a.id, a])),
      tags: new Map(tags.map((tag) => [tag.id, tag])),
    }),
    [statuses, areas, tags],
  );

  const byPlacement = useMemo(() => {
    const groups: Record<MatrixPlacement, Task[]> = {
      do: [],
      schedule: [],
      delegate: [],
      eliminate: [],
      unsorted: [],
    };
    for (const task of tasks) groups[matrixPlacement(task)].push(task);
    return groups;
  }, [tasks]);

  const placementTitle = (placement: unknown) =>
    typeof placement === "string" && placement in byPlacement
      ? t(`placements.${placement as MatrixPlacement}.title`)
      : "";
  const titleOf = (id: unknown) => tasks.find((task) => task.id === id)?.title ?? "";

  const move = (task: Task, placement: MatrixPlacement) =>
    actions.update.mutate({ id: task.id, patch: flagsForPlacement(placement) });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("drag.start", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("drag.over", { title: titleOf(active.id), placement: placementTitle(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) => {
      const task = tasks.find((x) => x.id === active.id);
      if (!over || !task || matrixPlacement(task) === over.id)
        return t("drag.noMove", { title: titleOf(active.id) });
      return t("drag.end", { title: task.title, placement: placementTitle(over.id) });
    },
    onDragCancel: ({ active }) => t("drag.cancel", { title: titleOf(active.id) }),
  };

  function onDragStart({ active }: DragStartEvent) {
    setDragging(tasks.find((task) => task.id === active.id) ?? null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const task = tasks.find((x) => x.id === active.id);
    if (!task || !over) return;
    const target = over.id as MatrixPlacement;
    if (matrixPlacement(task) !== target) move(task, target);
  }

  const placementOptions = matrixPlacements.map((placement) => ({
    id: placement,
    label: t(`placements.${placement}.title`),
  }));

  const renderCard = (task: Task) => (
    <TaskCard
      key={task.id}
      testId="matrix-card"
      task={task}
      lookups={lookups}
      selected={task.id === openTaskId}
      onOpen={openTask}
      actions={actions}
      dragLabel={t("drag.handle", { title: task.title })}
      moveMenu={{
        label: t("moveMenu", { title: task.title }),
        options: placementOptions,
        current: matrixPlacement(task),
        onSelect: (placement) => move(task, placement as MatrixPlacement),
      }}
    />
  );

  return (
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <PageHeader
          title={title}
          description={
            isPending
              ? t("description")
              : `${t("summary", { unsorted: byPlacement.unsorted.length })} · ${t("description")}`
          }
        />

        <FilterBar
          state={state}
          onChange={setState}
          areas={areas}
          tags={tags}
          hide={{ sort: true }}
        />

        {!isPending &&
        tasks.length === 0 &&
        !state.search &&
        Object.keys(state.filter).every((k) => !state.filter[k as keyof typeof state.filter]) ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <Grid2x2 className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">{t("emptyAll.title")}</p>
            <p className="text-sm text-muted-foreground">{t("emptyAll.description")}</p>
          </div>
        ) : null}

        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t("drag.instructions") },
          }}
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex flex-col gap-2">
              <div
                aria-hidden
                className="hidden grid-cols-2 gap-4 text-center text-xs font-medium text-muted-foreground md:grid"
              >
                <span>{t("axis.urgent")}</span>
                <span>{t("axis.notUrgent")}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {quadrants.map((placement) => (
                  <Zone
                    key={placement}
                    placement={placement}
                    tasks={byPlacement[placement]}
                    renderCard={renderCard}
                  />
                ))}
              </div>
            </div>
            <Zone
              placement="unsorted"
              tasks={byPlacement.unsorted}
              renderCard={renderCard}
              // The unsorted tray is the inbox: first on narrow screens, beside the grid on wide ones.
              className="order-first xl:order-none xl:mt-6"
            />
          </div>

          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <TaskCardPreview task={dragging} lookups={lookups} actions={actions} />
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

function Zone({
  placement,
  tasks,
  renderCard,
  className,
}: {
  placement: MatrixPlacement;
  tasks: Task[];
  renderCard: (task: Task) => ReactNode;
  className?: string;
}) {
  const t = useTranslations("tasks.matrix");
  const { setNodeRef, isOver } = useDroppable({ id: placement });
  const title = t(`placements.${placement}.title`);
  const headingId = `matrix-${placement}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-testid={`matrix-zone-${placement}`}
      className={cn(
        "flex min-h-56 flex-col gap-2 rounded-lg border bg-surface-muted/50 p-3 transition-colors",
        isOver ? "border-primary bg-accent/60" : "border-border",
        className,
      )}
    >
      <header className="flex items-baseline gap-2">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", accents[placement])}
        />
        <h2 id={headingId} className="text-sm font-semibold">
          {title}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {t(`placements.${placement}.hint`)}
        </span>
      </header>

      <ul className="flex flex-1 flex-col gap-1.5" aria-label={title}>
        {tasks.map(renderCard)}
        {tasks.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border py-6 text-xs text-muted-foreground">
            {t("dropHere")}
          </li>
        ) : null}
      </ul>

      <QuickAdd
        compact
        label={t("addTo", { placement: title })}
        defaults={flagsForPlacement(placement)}
      />
    </section>
  );
}
