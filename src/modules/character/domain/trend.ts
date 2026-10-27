/*
 * XP over time as a continuous series — shared by every chart of Growth / Level / Active XP
 * (dashboard, attribute pages). Dates are local calendar days "YYYY-MM-DD" in the user's timezone.
 */
import type { XpDay } from "./ledger";

type LocalDate = string;

function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days between two local dates (b − a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ---------------------------------------------------------------- trend */

export type TrendBucket = "day" | "week" | "month";

export interface TrendPoint {
  /** First local date of the bucket. */
  start: LocalDate;
  activeXp: number;
  growthXp: number;
  levelXp: number;
}

/** Day buckets up to ~3 months, weeks up to two years, months beyond. */
export function trendBucket(spanDays: number): TrendBucket {
  if (spanDays <= 92) return "day";
  if (spanDays <= 731) return "week";
  return "month";
}

function bucketStart(date: LocalDate, from: LocalDate, bucket: TrendBucket): LocalDate {
  if (bucket === "day") return date;
  if (bucket === "month") return `${date.slice(0, 7)}-01`;
  return addDays(from, Math.floor(daysBetween(from, date) / 7) * 7);
}

/**
 * Continuous series from `from` to `to` (inclusive): days without entries are zeros, so the
 * chart's x-axis is real time and a quiet week reads as a gap, not as nothing.
 */
export function buildTrend(
  days: readonly XpDay[],
  from: LocalDate,
  to: LocalDate,
): { bucket: TrendBucket; points: TrendPoint[] } {
  const bucket = trendBucket(daysBetween(from, to) + 1);
  const points = new Map<LocalDate, TrendPoint>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const start = bucketStart(date, from, bucket);
    if (!points.has(start)) points.set(start, { start, activeXp: 0, growthXp: 0, levelXp: 0 });
  }
  for (const day of days) {
    if (day.date < from || day.date > to) continue;
    const point = points.get(bucketStart(day.date, from, bucket))!;
    point.activeXp += day.activeXp;
    point.growthXp += day.growthXp;
    point.levelXp += day.levelXp;
  }
  return { bucket, points: [...points.values()] };
}
