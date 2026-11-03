import { z } from "zod";

/*
 * Schedule Planner (V2, ADR 0028). A schedule block says when a task is planned to be worked on.
 * Tasks stay what needs doing (title, priority, quadrant, XP, goals, recurrence); blocks only add
 * time. A task can have many blocks; blocks are views of the task, never copies. Pure.
 */

/** A planned slot is at least this long (the day view snaps to it). */
export const SLOT_MINUTES = 15;
/** Default length of a block made from a task without an estimate. */
export const DEFAULT_BLOCK_MINUTES = 60;
/** Longest block (a multi-day plan) and longest listed range. */
export const MAX_BLOCK_DAYS = 62;
export const MAX_RANGE_DAYS = 100;

const DAY_MS = 86_400_000;

const blockTimes = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    /** Whole days (week/month planning) rather than a time of day. */
    allDay: z.boolean().default(false),
  })
  .refine((b) => b.endAt.getTime() > b.startAt.getTime(), {
    message: "End must be after start",
    path: ["endAt"],
  })
  .refine((b) => b.endAt.getTime() - b.startAt.getTime() <= MAX_BLOCK_DAYS * DAY_MS, {
    message: "Block too long",
    path: ["endAt"],
  });

export const createBlockInput = z.intersection(z.object({ taskId: z.uuid() }), blockTimes);
export const updateBlockInput = z.intersection(z.object({ id: z.uuid() }), blockTimes);
export const blockIdInput = z.object({ id: z.uuid() });
export const listBlocksInput = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((r) => r.to > r.from && r.to.getTime() - r.from.getTime() <= MAX_RANGE_DAYS * DAY_MS, {
    message: "Invalid range",
  });

export type CreateBlockInput = z.infer<typeof createBlockInput>;
export type UpdateBlockInput = z.infer<typeof updateBlockInput>;

/** A block with what the calendar shows of its task (always the task's current values). */
export interface ScheduleBlock {
  id: string;
  taskId: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  task: {
    title: string;
    statusCategory: string;
    priority: number;
    isUrgent: boolean | null;
    isImportant: boolean | null;
    recurrenceId: string | null;
    dueDate: string | null;
  };
}

/** Ids of timed blocks that overlap another timed block (all-day plans never conflict). */
export function conflictingBlockIds(
  blocks: readonly Pick<ScheduleBlock, "id" | "startAt" | "endAt" | "allDay">[],
): Set<string> {
  const timed = blocks
    .filter((b) => !b.allDay)
    .toSorted((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const conflicts = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j]!.startAt.getTime() >= timed[i]!.endAt.getTime()) break;
      conflicts.add(timed[i]!.id);
      conflicts.add(timed[j]!.id);
    }
  }
  return conflicts;
}

/** Rounds minutes to the slot grid. */
export const snapMinutes = (minutes: number) => Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;

/* ------------------------------------------------------------------ calendar layout (pure) */

/** "YYYY-MM-DD" plus n days (calendar arithmetic, no time zone). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** First day of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn: number): string {
  return shiftDate(date, -((weekday(date) - weekStartsOn + 7) % 7));
}

export type CalendarView = "day" | "week" | "month";
export const calendarViews = ["day", "week", "month"] as const satisfies readonly CalendarView[];

/** The visible dates of a view around `anchor` (month: whole weeks covering the month). */
export function viewDates(view: CalendarView, anchor: string, weekStartsOn: number): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const first = startOfWeek(anchor, weekStartsOn);
    return Array.from({ length: 7 }, (_, i) => shiftDate(first, i));
  }
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const first = startOfWeek(monthStart, weekStartsOn);
  const nextMonth = shiftDate(monthStart, 32).slice(0, 7);
  const dates: string[] = [];
  for (let d = first; dates.length < 42; d = shiftDate(d, 1)) {
    if (dates.length % 7 === 0 && d.slice(0, 7) === nextMonth) break;
    dates.push(d);
  }
  return dates;
}

/** The anchor one step before / after (a day, a week or a month). */
export function stepAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  if (view === "day") return shiftDate(anchor, direction);
  if (view === "week") return shiftDate(anchor, 7 * direction);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const month = new Date(Date.UTC(y, m - 1 + direction, 1));
  return month.toISOString().slice(0, 10);
}

/** A block's part in one row of days: columns [start, end] inclusive, and its lane. */
export interface Segment<T> {
  item: T;
  start: number;
  end: number;
  lane: number;
  /** Whether the block continues before / after this row. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Lays out date spans over a row of consecutive days: each span gets the first lane free across
 * its columns, so multi-day bars never overlap.
 */
export function layoutSegments<T>(
  items: readonly { item: T; first: string; last: string }[],
  days: readonly string[],
): Segment<T>[] {
  const rowFirst = days[0]!;
  const rowLast = days.at(-1)!;
  const visible = items
    .filter((i) => i.last >= rowFirst && i.first <= rowLast)
    .toSorted(
      (a, b) =>
        a.first.localeCompare(b.first) || dayDiff(b.first, b.last) - dayDiff(a.first, a.last),
    );
  const lanes: number[] = []; // last occupied column per lane
  return visible.map((i) => {
    const start = Math.max(0, dayDiff(rowFirst, i.first));
    const end = Math.min(days.length - 1, dayDiff(rowFirst, i.last));
    let lane = lanes.findIndex((lastEnd) => lastEnd < start);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = end;
    return {
      item: i.item,
      start,
      end,
      lane,
      clippedStart: i.first < rowFirst,
      clippedEnd: i.last > rowLast,
    };
  });
}

/**
 * Side-by-side columns for overlapping timed blocks in one day: [startMin, endMin) intervals get a
 * column and the column count of their overlap cluster.
 */
export function layoutColumns<T>(
  items: readonly { item: T; start: number; end: number }[],
): { item: T; start: number; end: number; column: number; columns: number }[] {
  const sorted = items.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const result: { item: T; start: number; end: number; column: number; columns: number }[] = [];
  let cluster: typeof result = [];
  let clusterEnd = -Infinity;
  const columnsEnd: number[] = [];
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((c) => c.column + 1));
    for (const c of cluster) c.columns = columns;
    cluster = [];
    columnsEnd.length = 0;
  };
  for (const i of sorted) {
    if (i.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let column = columnsEnd.findIndex((end) => end <= i.start);
    if (column < 0) column = columnsEnd.length;
    columnsEnd[column] = i.end;
    clusterEnd = Math.max(clusterEnd, i.end);
    const placed = { ...i, column, columns: 1 };
    cluster.push(placed);
    result.push(placed);
  }
  flush();
  return result;
}
