import { z } from "zod";

import {
  xpForLevel,
  type AttributeValue,
  type LevelProgress,
  type StageProgress,
  type XpDay,
  type XpEntry,
  type XpTotals,
} from "@/modules/character/domain";
import {
  earlyClaimCost,
  type LevelReward,
  type Reward,
  type XpBalances,
} from "@/modules/rewards/domain";
import { addDays, type IsoDate } from "@/modules/tasks/domain";

/*
 * The dashboard is a read model: it owns no tables and no rules about XP or rewards. Everything
 * here only selects, groups or orders figures the character and rewards modules computed.
 */

/* ---------------------------------------------------------------- periods */

export const dashboardPeriods = ["7d", "30d", "90d", "all"] as const;
export type DashboardPeriod = (typeof dashboardPeriods)[number];
export const defaultDashboardPeriod: DashboardPeriod = "30d";

export const dashboardGrowthInput = z.object({ period: z.enum(dashboardPeriods) });

const periodDays: Record<Exclude<DashboardPeriod, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** First local date of a period ending today (inclusive); null for all time. */
export function periodStart(period: DashboardPeriod, today: IsoDate): IsoDate | null {
  return period === "all" ? null : addDays(today, -(periodDays[period] - 1));
}

/** First day of the week containing `today` (`weekStartsOn`: 0 = Sunday … 6 = Saturday). */
export function weekStart(today: IsoDate, weekStartsOn: number): IsoDate {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((weekday - weekStartsOn + 7) % 7));
}

/** Days between two local dates (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ---------------------------------------------------------------- trend */

export type TrendBucket = "day" | "week" | "month";

export interface TrendPoint {
  /** First local date of the bucket. */
  start: IsoDate;
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

function bucketStart(date: IsoDate, from: IsoDate, bucket: TrendBucket): IsoDate {
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
  from: IsoDate,
  to: IsoDate,
): { bucket: TrendBucket; points: TrendPoint[] } {
  const bucket = trendBucket(daysBetween(from, to) + 1);
  const points = new Map<IsoDate, TrendPoint>();
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

/* ---------------------------------------------------------------- growth ranking & focus */

export interface AttributeGrowth {
  attributeId: string;
  growthXp: number;
}

/**
 * Attributes that grew in the period, most first. Ties keep the user's attribute order. Only
 * attributes in `attributes` (the active ones) are ranked.
 */
export function rankGrowth(
  byAttribute: readonly AttributeGrowth[],
  attributes: readonly { id: string }[],
  limit = 5,
): AttributeGrowth[] {
  const growthOf = new Map(byAttribute.map((row) => [row.attributeId, row.growthXp]));
  return attributes
    .map((attribute) => ({ attributeId: attribute.id, growthXp: growthOf.get(attribute.id) ?? 0 }))
    .filter((row) => row.growthXp > 0)
    .sort((a, b) => b.growthXp - a.growthXp)
    .slice(0, limit);
}

/** The window the growth focus looks at. */
export const FOCUS_WINDOW_DAYS = 30;

export interface GrowthFocus {
  /** Most Growth XP in the window (only if it grew at all). */
  fastest: AttributeGrowth | null;
  /**
   * Least Growth XP in the window (zero included) — only when something grew at all, with two or
   * more attributes, and never the fastest one.
   */
  slowest: AttributeGrowth | null;
}

/**
 * Transparent rule, no scoring: among the active radar attributes, the one with the most Growth XP
 * in the last 30 days, and the one with the least (zero included). Ties: first in the user's order.
 * Nothing grew → neither (the UI says so instead of ranking zeros).
 */
export function growthFocus(
  byAttribute: readonly AttributeGrowth[],
  attributes: readonly { id: string }[],
): GrowthFocus {
  const growthOf = new Map(byAttribute.map((row) => [row.attributeId, row.growthXp]));
  const rows = attributes.map((attribute) => ({
    attributeId: attribute.id,
    growthXp: growthOf.get(attribute.id) ?? 0,
  }));
  let fastest: AttributeGrowth | null = null;
  let slowest: AttributeGrowth | null = null;
  for (const row of rows) {
    if (row.growthXp > 0 && (!fastest || row.growthXp > fastest.growthXp)) fastest = row;
    if (!slowest || row.growthXp < slowest.growthXp) slowest = row;
  }
  const comparable =
    fastest !== null && rows.length >= 2 && slowest?.attributeId !== fastest.attributeId;
  return { fastest, slowest: comparable ? slowest : null };
}

/* ---------------------------------------------------------------- level reward */

export interface NextLevelReward {
  reward: LevelReward;
  /** Lifetime Level XP the reward's level needs. */
  requiredLevelXp: number;
  /** Level XP still missing (0 once reached). Equals the early-claim price while it is allowed. */
  missingLevelXp: number;
  /** 0–1: lifetime Level XP / required. */
  ratio: number;
}

/**
 * The level reward worth showing: one that can be claimed now (lowest level first), else the
 * nearest unclaimed one ahead. Null when every level reward is claimed (or none exist).
 */
export function nextLevelReward(
  rewards: readonly LevelReward[],
  lifetimeLevelXp: number,
): NextLevelReward | null {
  const open = rewards
    .filter((reward) => reward.state !== "claimed")
    .sort((a, b) => a.level - b.level);
  const reward = open.find((r) => r.state === "claimable") ?? open[0];
  if (!reward) return null;
  const requiredLevelXp = xpForLevel(reward.level);
  return {
    reward,
    requiredLevelXp,
    missingLevelXp: earlyClaimCost(lifetimeLevelXp, reward.level),
    ratio: requiredLevelXp === 0 ? 1 : Math.min(1, Math.max(0, lifetimeLevelXp) / requiredLevelXp),
  };
}

/* ---------------------------------------------------------------- read model */

export interface RewardPreview {
  reward: Reward;
  /** The current spendable balances cover it (rewards module's purchase rule). */
  affordable: boolean;
}

export interface DashboardOverview {
  today: IsoDate;
  level: LevelProgress;
  stage: StageProgress;
  totals: XpTotals;
  balances: XpBalances;
  /** Every attribute (archived and legacy too: activity may credit them), with its level. */
  attributes: AttributeValue[];
  /** Active, non-legacy attributes in the user's order — what the radar and focus use. */
  activeAttributeIds: string[];
  week: {
    from: IsoDate;
    completedTasks: number;
    activeXp: number;
    growthXp: number;
    levelXp: number;
    top: AttributeGrowth[];
  };
  /** Growth XP over the last FOCUS_WINDOW_DAYS days. */
  focus: GrowthFocus;
  recentActivity: XpEntry[];
  nextLevelReward: NextLevelReward | null;
  levelRewardCount: number;
  rewardPreview: RewardPreview[];
  enabledRewardCount: number;
}

export interface DashboardGrowth {
  period: DashboardPeriod;
  from: IsoDate;
  to: IsoDate;
  bucket: TrendBucket;
  points: TrendPoint[];
  ranking: AttributeGrowth[];
  activeXp: number;
  growthXp: number;
  levelXp: number;
}
