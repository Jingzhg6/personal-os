"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback } from "react";

import { useAreaLabel } from "@/modules/areas/ui";
import { usePriorityLabel, useStatusLabel } from "@/modules/tasks/ui";

import { triggerKeyOf, type Action, type Condition, type Schedule, type Trigger } from "../domain";
import { useLookups } from "./use-automation";

const DATE_TIME = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

export function useDateTime() {
  const format = useFormatter();
  return useCallback((date: Date) => format.dateTime(date, DATE_TIME), [format]);
}

export function useScheduleLabel() {
  const t = useTranslations("automation.schedule");
  return useCallback(
    (schedule: Schedule) => {
      switch (schedule.kind) {
        case "once":
          return t("summary.once", { date: schedule.date, time: schedule.time });
        case "daily":
          return t("summary.daily", { time: schedule.time });
        case "weekly":
          return t("summary.weekly", {
            days: [...schedule.weekdays]
              .sort()
              .map((d) => t(`weekday.${d}` as "weekday.1"))
              .join("、"),
            time: schedule.time,
          });
        case "monthly":
          return t("summary.monthly", { day: schedule.day, time: schedule.time });
      }
    },
    [t],
  );
}

/** Human-readable parts of a rule, resolving ids to the user's names. */
export function useRuleSummary() {
  const t = useTranslations("automation");
  const areaLabel = useAreaLabel();
  const statusLabel = useStatusLabel();
  const priorityLabel = usePriorityLabel();
  const scheduleLabel = useScheduleLabel();
  const { areas, projects, statuses } = useLookups();

  const trigger = useCallback(
    (value: Trigger) =>
      value.type === "schedule"
        ? `${t("triggers.schedule")} · ${scheduleLabel(value.schedule)}`
        : t(`triggers.${triggerKeyOf(value.type)}`),
    [t, scheduleLabel],
  );

  const condition = useCallback(
    (c: Condition) => {
      const type = t(`conditions.types.${c.type}`);
      const unknown = t("summary.unknown");
      let value: string | null = null;
      switch (c.type) {
        case "task_priority":
        case "project_priority":
          value = priorityLabel(c.priority);
          break;
        case "task_area":
        case "project_area": {
          const area = areas.find((a) => a.id === c.areaId);
          value = area ? areaLabel(area) : unknown;
          break;
        }
        case "task_project":
          value = projects.find((p) => p.id === c.projectId)?.name ?? unknown;
          break;
        case "task_status": {
          const status = statuses.find((s) => s.id === c.statusId);
          value = status ? statusLabel(status) : unknown;
          break;
        }
        case "goal_status":
          value = t(`goalStatus.${c.status}`);
          break;
        case "finance_all_valued":
          value = null;
      }
      return value === null
        ? t("summary.conditionFlag", { type })
        : t("summary.conditionLine", { type, value });
    },
    [t, areas, projects, statuses, areaLabel, statusLabel, priorityLabel],
  );

  const action = useCallback(
    (a: Action) => {
      switch (a.type) {
        case "create_task":
          return t("summary.createTask", { title: a.title });
        case "create_follow_up_task":
          return t("summary.createFollowUp", { title: a.title });
        case "notify":
          return t("summary.notify", { title: a.title });
        case "set_task_priority":
          return t("summary.setPriority", { priority: priorityLabel(a.priority) });
      }
    },
    [t, priorityLabel],
  );

  return { trigger, condition, action };
}

/** "当 … ，如果 … ，就 …" in one block. */
export function RuleSummary({
  trigger,
  conditions,
  actions,
}: {
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
}) {
  const t = useTranslations("automation.summary");
  const summary = useRuleSummary();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm" data-testid="rule-summary">
      <dt className="font-medium text-primary">{t("when")}</dt>
      <dd>{summary.trigger(trigger)}</dd>
      {conditions.length > 0 ? (
        <>
          <dt className="font-medium text-primary">{t("if")}</dt>
          <dd>{conditions.map(summary.condition).join(` ${t("and")} `)}</dd>
        </>
      ) : null}
      <dt className="font-medium text-primary">{t("then")}</dt>
      <dd>
        <ol className="flex flex-col gap-0.5">
          {actions.map((a, i) => (
            <li key={i}>
              {actions.length > 1 ? `${i + 1}. ` : ""}
              {summary.action(a)}
            </li>
          ))}
        </ol>
      </dd>
    </dl>
  );
}
