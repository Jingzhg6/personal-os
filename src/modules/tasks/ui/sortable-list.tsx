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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type CSSProperties, type ReactNode, type Ref } from "react";

import { cn } from "@/shared/lib/cn";

export interface SortableRender {
  ref: Ref<HTMLLIElement>;
  style: CSSProperties;
  /** Drag handle, or null when reordering is disabled. */
  handle: ReactNode;
  isDragging: boolean;
}

interface SortableListProps<T extends { id: string; title: string }> {
  items: T[];
  enabled: boolean;
  /** Called with the neighbours around the drop position. */
  onMove: (id: string, afterId: string | null, beforeId: string | null) => void;
  renderItem: (item: T, sortable: SortableRender) => ReactNode;
  handleLabel: (item: T) => string;
  className?: string;
  label?: string;
}

/** Vertical list reorderable by pointer or keyboard (Space to lift, arrows to move, Space to drop). */
export function SortableList<T extends { id: string; title: string }>({
  items,
  enabled,
  onMove,
  renderItem,
  handleLabel,
  className,
  label,
}: SortableListProps<T>) {
  const t = useTranslations("tasks.drag");
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (itemId: unknown) => items.find((item) => item.id === itemId)?.title ?? "";
  const positionOf = (itemId: unknown) => items.findIndex((item) => item.id === itemId) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("start", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t("over", { title: titleOf(active.id), position: positionOf(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? t("end", { title: titleOf(active.id), position: positionOf(over.id) }) : undefined,
    onDragCancel: ({ active }) => t("cancel", { title: titleOf(active.id) }),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(items, from, to);
    onMove(String(active.id), reordered[to - 1]?.id ?? null, reordered[to + 1]?.id ?? null);
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className={className} aria-label={label}>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              enabled={enabled}
              label={handleLabel(item)}
              renderItem={renderItem}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem<T extends { id: string; title: string }>({
  item,
  enabled,
  label,
  renderItem,
}: {
  item: T;
  enabled: boolean;
  label: string;
  renderItem: (item: T, sortable: SortableRender) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: !enabled,
  });

  const handle = enabled ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      data-drag-handle
      className={cn(
        // Revealed on hover/focus; always visible on touch screens, which have no hover.
        "-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing [@media(hover:none)]:opacity-100",
        isDragging && "opacity-100",
      )}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  ) : null;

  return renderItem(item, {
    ref: setNodeRef,
    style: {
      transform: CSS.Translate.toString(transform),
      transition,
      position: "relative",
      zIndex: isDragging ? 10 : undefined,
    },
    handle,
    isDragging,
  });
}
