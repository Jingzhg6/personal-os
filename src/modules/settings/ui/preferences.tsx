"use client";

import { createContext, useContext, type ReactNode } from "react";

import { defaultUserSettings, weekdayOrder, type IsoWeekday } from "../domain";

/*
 * Display preferences that are not part of next-intl (which already carries the time zone).
 * Provided once by the app layout from the stored settings; re-read on every navigation refresh.
 */

const WeekStartContext = createContext(defaultUserSettings.weekStartsOn);

export function PreferencesProvider({
  weekStartsOn,
  children,
}: {
  weekStartsOn: number;
  children: ReactNode;
}) {
  return <WeekStartContext value={weekStartsOn}>{children}</WeekStartContext>;
}

/** First day of the week (0 = Sunday … 6 = Saturday); Monday outside the app shell. */
export function useWeekStartsOn(): number {
  return useContext(WeekStartContext);
}

/** ISO weekdays (1 = Monday … 7 = Sunday) in the order of the user's week, for weekday pickers. */
export function useWeekdayOrder(): IsoWeekday[] {
  return weekdayOrder(useWeekStartsOn());
}
