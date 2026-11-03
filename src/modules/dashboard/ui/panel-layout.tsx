"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

/** Dashboard panels in their default order (also the phone order). */
export const DASHBOARD_PANELS = [
  "character",
  "xp",
  "growth",
  "focus",
  "levelReward",
  "rewardStore",
  "week",
  "activity",
] as const;
export type DashboardPanelId = (typeof DASHBOARD_PANELS)[number];

/** The saved order, with unknown ids dropped and panels added later appended in default order. */
export function mergePanelOrder(saved: readonly string[] | null | undefined): DashboardPanelId[] {
  const known = new Set<string>(DASHBOARD_PANELS);
  const kept = (saved ?? []).filter(
    (id, index, all): id is DashboardPanelId => known.has(id) && all.indexOf(id) === index,
  );
  return [...kept, ...DASHBOARD_PANELS.filter((id) => !kept.includes(id))];
}

const isDefault = (order: readonly string[]) => order.every((id, i) => DASHBOARD_PANELS[i] === id);

/** The user's panel order, saved to their settings on every change. */
export function usePanelOrder() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { data: settings } = useQuery(trpc.settings.get.queryOptions());
  const [local, setLocal] = useState<DashboardPanelId[] | null>(null);
  const save = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: (updated) => queryClient.setQueryData(trpc.settings.get.queryKey(), updated),
      onError: (error) => {
        setLocal(null);
        toast.show(errorMessage(error), "error");
      },
    }),
  );
  const order = local ?? mergePanelOrder(settings?.dashboardPanels);
  const set = (next: DashboardPanelId[]) => {
    setLocal(next);
    save.mutate({ dashboardPanels: isDefault(next) ? null : next });
  };
  return { order, ready: settings !== undefined, custom: !isDefault(order), set };
}

export interface Panel {
  id: DashboardPanelId;
  /** Grid span classes for this panel. */
  className?: string;
  content: ReactNode;
}

/**
 * Panels in a responsive grid, reorderable by dragging their handle (or with the keyboard: focus
 * the handle, Space to lift, arrows to move, Space to drop).
 */
export function PanelGrid({
  panels,
  onReorder,
}: {
  panels: Panel[];
  onReorder: (ids: DashboardPanelId[]) => void;
}) {
  const t = useTranslations("dashboard.layout");
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const name = (panelId: unknown) => t(`panels.${panelId as DashboardPanelId}`);
  const position = (panelId: unknown) => panels.findIndex((p) => p.id === panelId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("start", { name: name(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { name: name(active.id), position: position(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("end", { name: name(active.id), position: position(over.id) }) : undefined,
    onDragCancel: ({ active }) => t("cancel", { name: name(active.id) }),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = panels.map((p) => p.id);
    const from = ids.indexOf(active.id as DashboardPanelId);
    const to = ids.indexOf(over.id as DashboardPanelId);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
    >
      <SortableContext items={panels.map((p) => p.id)} strategy={rectSortingStrategy}>
        <div
          className="grid grid-flow-row-dense gap-6 md:grid-cols-2 lg:grid-cols-3"
          data-testid="dashboard-panels"
        >
          {panels.map((panel) => (
            <SortablePanel
              key={panel.id}
              panel={panel}
              label={t("handle", { name: name(panel.id) })}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortablePanel({ panel, label }: { panel: Panel; label: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: panel.id });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/panel relative min-w-0 [&>*:not(button)]:h-full",
        panel.className,
        isDragging && "z-20 opacity-80 shadow-lg",
      )}
      data-testid={`panel-${panel.id}`}
      data-panel={panel.id}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={label}
        data-testid={`panel-handle-${panel.id}`}
        className="absolute -top-2.5 -right-2.5 z-10 flex size-7 cursor-grab touch-none items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-opacity hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing sm:opacity-0 sm:group-hover/panel:opacity-100"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      {panel.content}
    </section>
  );
}
