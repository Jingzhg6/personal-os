import { addDays, type IsoDate } from "./dates";
import { scheduleSpan } from "./dependencies";

/*
 * Pure helpers for the Gantt chart: the visible window and date arithmetic for moving and
 * resizing bars. Dates are calendar days; the chart never deals with time zones.
 */

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * First day of the week on or before `date` (the header groups by week). `weekStartsOn` is the
 * user's setting: 0 = Sunday … 6 = Saturday; Monday by default.
 */
export function startOfWeek(date: IsoDate, weekStartsOn = 1): IsoDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday - weekStartsOn + 7) % 7));
}

/**
 * Visible range: every given span plus today, padded by a week on each side, starting on the
 * first day of a week and at least `minDays` long.
 */
export function timelineWindow(
  spans: readonly { start: IsoDate; end: IsoDate }[],
  today: IsoDate,
  minDays = 42,
  weekStartsOn = 1,
): { start: IsoDate; end: IsoDate; days: number } {
  let first = today;
  let last = today;
  for (const span of spans) {
    if (span.start < first) first = span.start;
    if (span.end > last) last = span.end;
  }
  const start = startOfWeek(addDays(first, -7), weekStartsOn);
  const end = addDays(start, Math.max(daysBetween(start, addDays(last, 7)), minDays - 1));
  return { start, end, days: daysBetween(start, end) + 1 };
}

export type BarEdit = "move" | "start" | "end";

/**
 * New dates after dragging a bar by `delta` days. Moving shifts whichever dates exist; resizing
 * a one-date task adds the missing date. Returns null when nothing changes or the edit would
 * put the start after the end.
 */
export function editSchedule(
  task: { startDate: IsoDate | null; dueDate: IsoDate | null },
  edit: BarEdit,
  delta: number,
): { startDate: IsoDate | null; dueDate: IsoDate | null } | null {
  const span = scheduleSpan(task);
  if (!span || delta === 0) return null;
  if (edit === "move") {
    return {
      startDate: task.startDate ? addDays(task.startDate, delta) : null,
      dueDate: task.dueDate ? addDays(task.dueDate, delta) : null,
    };
  }
  if (edit === "start") {
    const startDate = addDays(span.start, delta);
    return startDate > span.end ? null : { startDate, dueDate: span.end };
  }
  const dueDate = addDays(span.end, delta);
  return dueDate < span.start ? null : { startDate: span.start, dueDate };
}
