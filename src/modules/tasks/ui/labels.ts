"use client";

import { useFormatter, useNow, useTimeZone, useTranslations } from "next-intl";
import { useCallback } from "react";

import { dueState, priorityId, splitMinutes, todayIn, type TaskStatus } from "../domain";

/** Display label of a status: the user's own name, or the translated default. */
export function useStatusLabel() {
  const t = useTranslations("tasks.status");
  return useCallback(
    (status: Pick<TaskStatus, "name" | "systemKey">) =>
      status.name ?? (status.systemKey ? t(status.systemKey) : ""),
    [t],
  );
}

export function usePriorityLabel() {
  const t = useTranslations("tasks.priority");
  return useCallback((priority: number) => t(priorityId(priority)), [t]);
}

export function useDurationLabel() {
  const t = useTranslations("tasks");
  return useCallback((minutes: number) => t("duration", splitMinutes(minutes)).trim(), [t]);
}

/** Today's date in the user's timezone ("YYYY-MM-DD"). */
export function useToday(): string {
  const timeZone = useTimeZone() ?? "UTC";
  const now = useNow({ updateInterval: 60_000 });
  return todayIn(timeZone, now);
}

/** Formats a date-only value without timezone shifts, plus its relation to today. */
export function useDueLabel() {
  const t = useTranslations("tasks.due");
  const format = useFormatter();
  const today = useToday();
  return useCallback(
    (dueDate: string, dueTime: string | null) => {
      const state = dueState(dueDate, today);
      const date = new Date(`${dueDate}T00:00:00Z`);
      const sameYear = dueDate.slice(0, 4) === today.slice(0, 4);
      const formatted = format.dateTime(date, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
      });
      const day = state === "today" ? t("today") : state === "tomorrow" ? t("tomorrow") : formatted;
      return { state, text: dueTime ? `${day} ${dueTime}` : day };
    },
    [format, t, today],
  );
}
