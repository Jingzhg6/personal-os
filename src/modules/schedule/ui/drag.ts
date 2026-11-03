"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DEFAULT_BLOCK_MINUTES,
  dayDiff,
  shiftDate,
  SLOT_MINUTES,
  snapMinutes,
  type ScheduleBlock,
} from "../domain";
import type { BlockTimes, Clock } from "./use-schedule";

/*
 * One pointer-driven drag engine for the whole planner: dragging a task from the list onto the
 * calendar, moving a block, and resizing it (top/bottom edge in the time grid, right edge of a
 * date bar). Drop targets are plain elements marked `data-drop="grid"` (a day column of the time
 * grid: the pointer's height gives the time) or `data-drop="day"` (a whole day), found under the
 * pointer, so the same code serves the day, week and month views.
 */

export interface DragTask {
  id: string;
  title: string;
  estimatedMinutes: number | null;
}

export type DragOp =
  | { kind: "create"; task: DragTask }
  | { kind: "move"; block: ScheduleBlock; grab: Hit | null }
  | { kind: "resize-start" | "resize-end" | "resize-days"; block: ScheduleBlock };

export type Hit = { type: "grid"; date: string; minutes: number } | { type: "day"; date: string };

export interface DragState {
  op: DragOp;
  preview: BlockTimes | null;
  x: number;
  y: number;
}

const MIN_MS = SLOT_MINUTES * 60_000;

export function hitAt(x: number, y: number): Hit | null {
  if (typeof document === "undefined") return null;
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;
    const kind = element.dataset.drop;
    const date = element.dataset.date;
    if (!kind || !date) continue;
    if (kind === "day") return { type: "day", date };
    const rect = element.getBoundingClientRect();
    const minutes = Math.min(Math.max(((y - rect.top) / rect.height) * 1440, 0), 1440);
    return { type: "grid", date, minutes };
  }
  return null;
}

/** Where the dragged thing would land for a pointer over `hit`. */
export function propose(op: DragOp, hit: Hit | null, clock: Clock): BlockTimes | null {
  if (!hit) return null;
  const allDayRange = (first: string, last: string): BlockTimes => ({
    startAt: new Date(clock.instant(first, 0)),
    endAt: new Date(clock.instant(shiftDate(last, 1), 0)),
    allDay: true,
  });

  if (op.kind === "create") {
    if (hit.type === "day") return allDayRange(hit.date, hit.date);
    const duration = op.task.estimatedMinutes ?? DEFAULT_BLOCK_MINUTES;
    const start = Math.min(snapMinutes(hit.minutes), 1440 - SLOT_MINUTES);
    const startAt = clock.instant(hit.date, start);
    return {
      startAt: new Date(startAt),
      endAt: new Date(startAt + duration * 60_000),
      allDay: false,
    };
  }

  const { block } = op;
  const span = clock.span(block);
  const duration = block.endAt.getTime() - block.startAt.getTime();

  if (op.kind === "move") {
    if (hit.type === "grid") {
      if (block.allDay) {
        const startAt = clock.instant(
          hit.date,
          Math.min(snapMinutes(hit.minutes), 1440 - SLOT_MINUTES),
        );
        return {
          startAt: new Date(startAt),
          endAt: new Date(startAt + DEFAULT_BLOCK_MINUTES * 60_000),
          allDay: false,
        };
      }
      // Keep the point where the block was grabbed under the pointer.
      const grab = op.grab;
      const offset =
        grab?.type === "grid"
          ? (clock.instant(grab.date, grab.minutes) - block.startAt.getTime()) / 60_000
          : 0;
      const startAt = clock.instant(hit.date, snapMinutes(hit.minutes - offset));
      return { startAt: new Date(startAt), endAt: new Date(startAt + duration), allDay: false };
    }
    const from = op.grab?.date ?? span.first;
    const delta = dayDiff(from, hit.date);
    if (block.allDay) return allDayRange(shiftDate(span.first, delta), shiftDate(span.last, delta));
    const startAt = clock.instant(shiftDate(span.first, delta), clock.minutes(block.startAt));
    return { startAt: new Date(startAt), endAt: new Date(startAt + duration), allDay: false };
  }

  if (op.kind === "resize-days") {
    const last = hit.date < span.first ? span.first : hit.date;
    if (block.allDay) return allDayRange(span.first, last);
    const endAt = clock.instant(last, clock.minutes(block.endAt) || 1440);
    return {
      startAt: block.startAt,
      endAt: new Date(Math.max(endAt, block.startAt.getTime() + MIN_MS)),
      allDay: false,
    };
  }

  if (hit.type !== "grid") return null;
  const at = clock.instant(hit.date, snapMinutes(hit.minutes));
  if (op.kind === "resize-end") {
    return {
      startAt: block.startAt,
      endAt: new Date(Math.max(at, block.startAt.getTime() + MIN_MS)),
      allDay: false,
    };
  }
  return {
    startAt: new Date(Math.min(at, block.endAt.getTime() - MIN_MS)),
    endAt: block.endAt,
    allDay: false,
  };
}

/**
 * Pointer handling: a drag starts after a few pixels (a plain click stays a click), follows the
 * pointer with a live preview, scrolls the time grid near its edges, and commits on release.
 * Escape cancels.
 */
export function useDragEngine({
  clock,
  onCommit,
  onClick,
  scroller,
}: {
  clock: Clock;
  onCommit: (op: DragOp, times: BlockTimes) => void;
  onClick: (op: DragOp) => void;
  scroller: React.RefObject<HTMLElement | null>;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const session = useRef<{
    op: DragOp;
    x0: number;
    y0: number;
    active: boolean;
    preview: BlockTimes | null;
  } | null>(null);
  const handlers = useRef({ clock, onCommit, onClick });
  useEffect(() => {
    handlers.current = { clock, onCommit, onClick };
  });

  const end = useCallback(() => {
    session.current = null;
    setDrag(null);
    document.body.style.removeProperty("user-select");
  }, []);

  useEffect(() => {
    function move(event: PointerEvent) {
      const s = session.current;
      if (!s) return;
      if (!s.active) {
        if (Math.hypot(event.clientX - s.x0, event.clientY - s.y0) < 4) return;
        s.active = true;
        document.body.style.setProperty("user-select", "none");
      }
      event.preventDefault();
      const element = scroller.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right) {
          if (event.clientY < rect.top + 32) element.scrollTop -= 16;
          else if (event.clientY > rect.bottom - 32) element.scrollTop += 16;
        }
      }
      s.preview = propose(s.op, hitAt(event.clientX, event.clientY), handlers.current.clock);
      setDrag({ op: s.op, preview: s.preview, x: event.clientX, y: event.clientY });
    }
    function up() {
      const s = session.current;
      if (!s) return;
      if (!s.active) handlers.current.onClick(s.op);
      else if (s.preview) handlers.current.onCommit(s.op, s.preview);
      end();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && session.current) end();
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", key);
    };
  }, [end, scroller]);

  const begin = useCallback((op: DragOp, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const grab = hitAt(event.clientX, event.clientY);
    const withGrab = op.kind === "move" ? { ...op, grab } : op;
    session.current = {
      op: withGrab,
      x0: event.clientX,
      y0: event.clientY,
      active: false,
      preview: null,
    };
  }, []);

  return { drag, begin };
}
