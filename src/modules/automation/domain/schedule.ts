/*
 * Time-zone aware schedules (ADR 0020). Pure: no clock, no database.
 *
 * A schedule is a local wall-clock time in an IANA time zone. Daylight-saving rules:
 * - a local time that does not exist (spring-forward gap) runs at the same distance after the
 *   gap: 02:30 on a day that jumps from 02:00 to 03:00 runs at 03:30;
 * - a local time that exists twice (fall-back overlap) runs once, at its first occurrence.
 * Monthly schedules on day 29–31 run on the month's last day in shorter months.
 */

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

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock fields of an instant in a time zone. */
export function localParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of the zone from UTC at an instant, in ms (Paris in summer: +2 h). */
export function zoneOffset(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "YYYY-MM-DD" local date of an instant. */
export function localDate(instant: number, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The instant of a local date and time in a zone, with the DST rules above. Returns the instant
 * and how the local time was resolved.
 */
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string,
): { instant: number; resolution: "exact" | "gap" | "overlap" } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = [
    ...new Set([zoneOffset(wall - DAY, timeZone), zoneOffset(wall + DAY, timeZone)]),
  ];
  const valid = offsets
    .map((offset) => wall - offset)
    .filter((instant) => zoneOffset(instant, timeZone) === wall - instant)
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    // In a gap: shift forward by the gap (use the offset in force before it).
    return { instant: wall - zoneOffset(wall - DAY, timeZone), resolution: "gap" };
  }
  return { instant: valid[0]!, resolution: valid.length > 1 ? "overlap" : "exact" };
}

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
