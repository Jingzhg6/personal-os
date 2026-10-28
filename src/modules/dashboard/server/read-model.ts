import {
  getLevelProgress,
  getStageProgress,
  isActiveAttribute,
  attributeScore,
} from "@/modules/character/domain";
import {
  getXpActivity,
  getXpTotals,
  listAttributes,
  listHistory,
} from "@/modules/character/server";
import { getFocus } from "@/modules/development/server";
import { calculateRewardPurchase } from "@/modules/rewards/domain";
import { getBalances, listLevelRewards, listRewards } from "@/modules/rewards/server";
import { getUserSettings } from "@/modules/settings/server";
import { addDays, todayIn } from "@/modules/tasks/domain";
import { countCompletedTasks } from "@/modules/tasks/server";
import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";

import {
  FOCUS_WINDOW_DAYS,
  buildTrend,
  growthFocus,
  nextLevelReward,
  periodStart,
  rankGrowth,
  weekStart,
  type DashboardGrowth,
  type DashboardOverview,
  type DashboardPeriod,
} from "../domain";

/*
 * The dashboard read model. It calls the owning modules' read functions — XP totals and activity
 * (character), balances and rewards (rewards), completed tasks (tasks) — and only arranges the
 * results. It writes nothing and has no rules of its own about XP, levels or prices.
 */

const REWARD_PREVIEW_SIZE = 4;
const RECENT_ACTIVITY_SIZE = 8;
const WEEK_TOP_SIZE = 3;

async function localCalendar(db: DbExecutor, userId: string) {
  const settings = await getUserSettings(db, userId);
  const timeZone = settings.timeZone ?? defaultTimeZone;
  return { timeZone, today: todayIn(timeZone), weekStartsOn: settings.weekStartsOn };
}

export async function getDashboard(db: DbExecutor, userId: string): Promise<DashboardOverview> {
  const { timeZone, today, weekStartsOn } = await localCalendar(db, userId);
  const week = weekStart(today, weekStartsOn);
  const focusFrom = addDays(today, -(FOCUS_WINDOW_DAYS - 1));

  const [
    totals,
    attributes,
    history,
    weekActivity,
    focusActivity,
    completedTasks,
    rewards,
    chosenFocus,
  ] = await Promise.all([
    getXpTotals(db, userId),
    listAttributes(db, userId),
    listHistory(db, userId, { limit: RECENT_ACTIVITY_SIZE }),
    getXpActivity(db, userId, { from: week, timeZone }),
    getXpActivity(db, userId, { from: focusFrom, timeZone }),
    countCompletedTasks(db, userId, { from: week, timeZone }),
    listRewards(db, userId),
    getFocus(db, userId),
  ]);
  const balances = await getBalances(db, userId, totals);
  const levelRewards = await listLevelRewards(db, userId, balances);

  const active = attributes.filter(isActiveAttribute);
  const onRadar = active.filter((attribute) => attribute.onRadar);
  const available = rewards.filter((reward) => reward.enabled && reward.remaining !== 0);

  return {
    today,
    level: getLevelProgress(totals.lifetimeLevelXp),
    stage: getStageProgress(totals.lifetimeLevelXp),
    totals,
    balances,
    attributes: attributes.map((attribute) => ({
      ...attribute,
      progress: getLevelProgress(attributeScore(attribute)),
    })),
    activeAttributeIds: active.map((attribute) => attribute.id),
    week: {
      from: week,
      completedTasks,
      activeXp: weekActivity.activeXp,
      growthXp: weekActivity.growthXp,
      levelXp: weekActivity.levelXp,
      top: rankGrowth(weekActivity.byAttribute, active, WEEK_TOP_SIZE),
    },
    focus: growthFocus(focusActivity.byAttribute, onRadar),
    chosenFocusAttributeIds: chosenFocus,
    recentActivity: history.entries,
    nextLevelReward: nextLevelReward(levelRewards, totals.lifetimeLevelXp),
    levelRewardCount: levelRewards.length,
    rewardPreview: available.slice(0, REWARD_PREVIEW_SIZE).map((reward) => ({
      reward,
      affordable: calculateRewardPurchase(reward, balances, { strategy: "active_first" }).canRedeem,
    })),
    enabledRewardCount: available.length,
  };
}

/** The period-dependent part: growth ranking and trend. */
export async function getDashboardGrowth(
  db: DbExecutor,
  userId: string,
  period: DashboardPeriod,
): Promise<DashboardGrowth> {
  const { timeZone, today } = await localCalendar(db, userId);
  const start = periodStart(period, today);
  const [activity, attributes] = await Promise.all([
    getXpActivity(db, userId, { from: start, timeZone }),
    listAttributes(db, userId),
  ]);
  // "All time" starts on the first day anything was earned.
  const from = start ?? activity.days[0]?.date ?? today;
  const { bucket, points } = buildTrend(activity.days, from, today);
  return {
    period,
    from,
    to: today,
    bucket,
    points,
    ranking: rankGrowth(activity.byAttribute, attributes.filter(isActiveAttribute)),
    activeXp: activity.activeXp,
    growthXp: activity.growthXp,
    levelXp: activity.levelXp,
  };
}
