"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";
import { colorClasses } from "@/shared/ui/color";

import {
  daysBetween,
  editSchedule,
  isClosedCategory,
  scheduleSpan,
  type BarEdit,
  type Task,
} from "../domain";

type Patch = NonNullable<ReturnType<typeof editSchedule>>;

/** Pointer movement (px) below which a press on the bar counts as a click. */
const CLICK_SLOP = 4;

/**
 * One task as a bar on the timeline. Drag the body to move both dates, drag an end to change the
 * start or the due date; ← / → move by a day and Shift + ← / → change the due date.
 */
export function GanttBar({
  task,
  left,
  width,
  dayWidth,
  color,
  overdue,
  label,
  onOpen,
  onCommit,
}: {
  task: Task;
  left: number;
  width: number;
  dayWidth: number;
  color: ColorId;
  overdue: boolean;
  /** Accessible name: title, dates and keyboard help. */
  label: string;
  onOpen: () => void;
  onCommit: (patch: Patch) => void;
}) {
  const drag = useRef<{ edit: BarEdit; x: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ edit: BarEdit; delta: number } | null>(null);

  const span = scheduleSpan(task)!;
  const draft = preview ? editSchedule(task, preview.edit, preview.delta) : null;
  const shownSpan = draft ? scheduleSpan(draft)! : span;
  const shift = draft ? daysBetween(span.start, shownSpan.start) * dayWidth : 0;
  const shownWidth = draft ? (daysBetween(shownSpan.start, shownSpan.end) + 1) * dayWidth : width;
  const closed = isClosedCategory(task.statusCategory);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const edit = ((event.target as HTMLElement).dataset.edit as BarEdit | undefined) ?? "move";
    drag.current = { edit, x: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    if (Math.abs(dx) > CLICK_SLOP) current.moved = true;
    if (current.moved) setPreview({ edit: current.edit, delta: Math.round(dx / dayWidth) });
  }

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (!current.moved) {
      setPreview(null);
      onOpen();
      return;
    }
    const patch = editSchedule(
      task,
      current.edit,
      Math.round((event.clientX - current.x) / dayWidth),
    );
    setPreview(null);
    if (patch) onCommit(patch);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const patch = editSchedule(
      task,
      event.shiftKey ? "end" : "move",
      event.key === "ArrowRight" ? 1 : -1,
    );
    if (patch) onCommit(patch);
  }

  const outsideLabel = shownWidth < 48;
  return (
    <>
      <button
        type="button"
        data-testid="gantt-bar"
        data-task-id={task.id}
        aria-label={label}
        title={task.title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // Pointer clicks are handled on pointer-up; this is Enter / Space.
          if (event.detail === 0) onOpen();
        }}
        style={{ left: left + shift, width: Math.max(shownWidth, 6) }}
        className={cn(
          "absolute top-1.5 flex h-6 cursor-grab touch-none items-center overflow-hidden rounded-md text-left text-xs ring-1 ring-current/25 select-none ring-inset active:cursor-grabbing",
          colorClasses[color].soft,
          closed && "opacity-55",
          overdue && "ring-2 ring-danger",
          preview && "z-10 shadow-md",
        )}
      >
        {shownWidth >= 16 ? (
          <span data-edit="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
        ) : null}
        {!outsideLabel ? (
          <span className={cn("truncate px-2 font-medium", closed && "line-through")}>
            {task.title}
          </span>
        ) : null}
        {shownWidth >= 16 ? (
          <span data-edit="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
        ) : null}
      </button>
      {outsideLabel ? (
        // Short bars name the task beside them; the button keeps the accessible name.
        <span
          aria-hidden
          className="pointer-events-none absolute top-1.5 flex h-6 items-center text-xs whitespace-nowrap text-muted-foreground"
          style={{ left: left + shift + Math.max(shownWidth, 6) + 6 }}
        >
          {task.title}
        </span>
      ) : null}
    </>
  );
}
