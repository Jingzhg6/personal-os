/*
 * Time-zone aware schedules (ADR 0020). Pure: no clock, no database.
 *
 * A schedule is a local wall-clock time in an IANA time zone. Daylight-saving rules:
 * - a local time that does not exist (spring-forward gap) runs at the same distance after the
 *   gap: 02:30 on a day that jumps from 02:00 to 03:00 runs at 03:30;
 * - a local time that exists twice (fall-back overlap) runs once, at its first occurrence.
 * Monthly schedules on day 29–31 run on the month's last day in shorter months.
 */

import { localDate, zonedInstant } from "@/shared/lib/zoned-time";

export {
  isTimeZone,
  localDate,
  localParts,
  zonedInstant,
  zoneOffset,
} from "@/shared/lib/zoned-time";

const MINUTE = 60_000;
const DAY = 86_400_000;

export const scheduleKinds = ["once", "daily", "weekly", "monthly"] as const;
export type ScheduleKind = (typeof scheduleKinds)[number];

export type Schedule =
  | { kind: "once"; date: string; time: string }
  | { kind: "daily"; time: string }
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  | { kind: "weekly"; weekdays: number[]; time: string }
  | { kind: "monthly"; day: number; time: string };

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function lastDayOfMonth(date: string): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function matches(schedule: Schedule, date: string): boolean {
  switch (schedule.kind) {
    case "once":
      return date === schedule.date;
    case "daily":
      return true;
    case "weekly":
      return schedule.weekdays.includes(isoWeekday(date));
    case "monthly": {
      const day = Number(date.slice(8, 10));
      return day === Math.min(schedule.day, lastDayOfMonth(date));
    }
  }
}

/** Search window: a monthly schedule matches at least once in any 62 days. */
const SEARCH_DAYS = 400;

/** The first occurrence strictly after `after` (ms), or null when there is none (a past "once"). */
export function nextOccurrence(schedule: Schedule, timeZone: string, after: number): number | null {
  if (schedule.kind === "once") {
    const { instant } = zonedInstant(schedule.date, schedule.time, timeZone);
    return instant > after ? instant : null;
  }
  // Start a day early: the local date at `after` may be ahead of or behind UTC.
  let date = addDays(localDate(after, timeZone), -1);
  for (let i = 0; i < SEARCH_DAYS; i += 1, date = addDays(date, 1)) {
    if (!matches(schedule, date)) continue;
    const { instant } = zonedInstant(date, schedule.time, timeZone);
    if (instant > after) return instant;
  }
  return null;
}

/** Misfire grace: a missed occurrence still runs if the worker catches up within this window. */
export const MISFIRE_GRACE_MS = 6 * 60 * MINUTE;

export interface DuePlan {
  /** The occurrence to run now (the latest missed one), or null when it is too old. */
  run: number | null;
  /** Occurrences that were due but are not run (older ones, or all if beyond the grace). */
  skipped: number;
  /** The latest due occurrence (used as the key of a skipped record). */
  latest: number;
  /** Where the schedule continues. */
  next: number | null;
}

/**
 * Misfire policy for a schedule whose `nextRunAt` is due at `now`: coalesce every missed
 * occurrence into the latest one; run it if it is within the grace period, otherwise record it as
 * missed. Never back-fills more than one run.
 */
export function planDue(
  schedule: Schedule,
  timeZone: string,
  nextRunAt: number,
  now: number,
): DuePlan {
  let latest = nextRunAt;
  let count = 1;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const following = nextOccurrence(schedule, timeZone, latest);
    if (following === null || following > now) break;
    latest = following;
    count += 1;
  }
  const withinGrace = now - latest <= MISFIRE_GRACE_MS;
  return {
    run: withinGrace ? latest : null,
    skipped: withinGrace ? count - 1 : count,
    latest,
    next: nextOccurrence(schedule, timeZone, now),
  };
}
