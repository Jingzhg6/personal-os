"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import {
  isClosedCategory,
  recurrenceFrequencies,
  type RecurrenceFrequency,
  type RecurrenceMode,
  type RecurrenceRule,
  type TaskDetail,
} from "../domain";

type EndType = RecurrenceRule["end"]["type"];
type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface Draft {
  frequency: RecurrenceFrequency | "none";
  interval: number;
  weekdays: number[];
  monthDay: string;
  endType: EndType;
  until: string;
  count: number;
  mode: RecurrenceMode;
}

const fromRule = (rule: RecurrenceRule | null, mode: RecurrenceMode | null): Draft => ({
  frequency: rule?.frequency ?? "none",
  interval: rule?.interval ?? 1,
  weekdays: rule?.weekdays ?? [],
  monthDay: rule?.monthDay === null || rule?.monthDay === undefined ? "" : String(rule.monthDay),
  endType: rule?.end.type ?? "never",
  until: rule?.end.type === "until" ? rule.end.date : "",
  count: rule?.end.type === "count" ? rule.end.count : 10,
  mode: mode ?? "fixed",
});

function toRule(draft: Draft): RecurrenceRule | null {
  if (draft.frequency === "none") return null;
  return {
    frequency: draft.frequency,
    interval: Math.max(1, Math.min(365, Math.round(draft.interval) || 1)),
    weekdays: draft.frequency === "weekly" ? [...draft.weekdays].sort() : [],
    monthDay: draft.frequency === "monthly" && draft.monthDay ? Number(draft.monthDay) : null,
    end:
      draft.endType === "until" && draft.until
        ? { type: "until", date: draft.until }
        : draft.endType === "count"
          ? { type: "count", count: Math.max(1, Math.min(1000, Math.round(draft.count) || 1)) }
          : { type: "never" },
  };
}

/**
 * 重复: the task's recurring series (ADR 0023). Each occurrence is an ordinary task; closing the
 * open one (完成 / 跳过 / 失败) creates the next. Only the newest occurrence edits the series.
 */
export function RecurrenceField({ task }: { task: TaskDetail }) {
  const t = useTranslations("tasks.recurrence");
  const format = useFormatter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { data: recurrence } = useQuery({
    ...trpc.tasks.recurrence.get.queryOptions({ taskId: task.id }),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => fromRule(null, null));
  const [confirmStop, setConfirmStop] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.tasks.pathFilter()),
      queryClient.invalidateQueries(trpc.projects.pathFilter()),
      queryClient.invalidateQueries(trpc.development.pathFilter()),
      queryClient.invalidateQueries(trpc.character.pathFilter()),
    ]);
  const onError = (error: unknown) => toast.show(errorMessage(error), "error");
  const set = useMutation(
    trpc.tasks.recurrence.set.mutationOptions({
      onSettled: refresh,
      onError,
      onSuccess: () => setEditing(false),
    }),
  );
  const skip = useMutation(
    trpc.tasks.recurrence.skip.mutationOptions({
      onSettled: refresh,
      onError,
      onSuccess: () => toast.show(t("skipped")),
    }),
  );
  const stop = useMutation(
    trpc.tasks.recurrence.stop.mutationOptions({
      onSettled: refresh,
      onError,
      onSuccess: () => setConfirmStop(false),
    }),
  );

  if (recurrence === undefined || task.parentTaskId) return null;
  const date = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  const canEdit = !recurrence || (recurrence.isLatest && !recurrence.endedAt);
  const startEditing = () => {
    setDraft(fromRule(recurrence?.rule ?? null, recurrence?.mode ?? null));
    setEditing(true);
  };
  const rule = toRule(draft);

  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby="task-recurrence"
      data-testid="task-recurrence"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="task-recurrence" className="flex items-center gap-1.5 text-sm font-medium">
          <Repeat className="size-4 text-primary" aria-hidden />
          {t("title")}
        </h3>
        {canEdit && !editing ? (
          <Button variant="ghost" size="sm" onClick={startEditing} data-testid="recurrence-edit">
            {recurrence ? t("edit") : t("add")}
          </Button>
        ) : null}
      </div>

      {!editing && !recurrence ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}

      {!editing && recurrence ? (
        <div className="flex flex-col gap-1.5 text-sm" data-testid="recurrence-summary">
          <p>
            {summary(t, recurrence.rule)} · {t(`modes.${recurrence.mode}`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("position", { index: recurrence.index, total: recurrence.instances })}
            {recurrence.endedAt ? ` · ${t("ended")}` : ""}
            {!recurrence.isLatest ? ` · ${t("history")}` : ""}
          </p>
          {recurrence.upcoming.length > 0 && recurrence.isLatest ? (
            <p className="text-xs text-muted-foreground" data-testid="recurrence-upcoming">
              {t("upcoming", { dates: recurrence.upcoming.map(date).join("、") })}
            </p>
          ) : null}
          {recurrence.isLatest && !recurrence.endedAt ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {!isClosedCategory(task.statusCategory) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={skip.isPending}
                  onClick={() => skip.mutate({ taskId: task.id })}
                  data-testid="recurrence-skip"
                >
                  {t("skip")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmStop(true)}
                data-testid="recurrence-stop"
              >
                {t("stop")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm"
          data-testid="recurrence-form"
        >
          {!task.dueDate ? <p className="text-warning">{t("needsDueDate")}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t("frequency")}
              className="w-28"
              value={draft.frequency}
              onChange={(e) =>
                setDraft({ ...draft, frequency: e.target.value as Draft["frequency"] })
              }
              data-testid="recurrence-frequency"
            >
              {!recurrence ? <option value="none">{t("frequencies.none")}</option> : null}
              {recurrenceFrequencies.map((f) => (
                <option key={f} value={f}>
                  {t(`frequencies.${f}`)}
                </option>
              ))}
            </Select>
            {draft.frequency !== "none" ? (
              <label className="flex items-center gap-2">
                {t("every")}
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="w-20"
                  value={draft.interval}
                  aria-label={t("interval")}
                  onChange={(e) => setDraft({ ...draft, interval: Number(e.target.value) })}
                />
                {t(`units.${draft.frequency}`)}
              </label>
            ) : null}
          </div>

          {draft.frequency === "weekly" ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t("weekdays")}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const on = draft.weekdays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        weekdays: on
                          ? draft.weekdays.filter((x) => x !== d)
                          : [...draft.weekdays, d],
                      })
                    }
                    className={
                      on
                        ? "size-8 rounded-full bg-primary text-xs text-primary-foreground"
                        : "size-8 rounded-full border border-border text-xs"
                    }
                  >
                    {t(`weekdayShort.d${d as Weekday}`)}
                  </button>
                );
              })}
            </div>
          ) : null}

          {draft.frequency === "monthly" ? (
            <label className="flex items-center gap-2">
              {t("monthDay")}
              <Select
                className="w-32"
                value={draft.monthDay}
                onChange={(e) => setDraft({ ...draft, monthDay: e.target.value })}
              >
                <option value="">{t("sameDay")}</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t("dayN", { day: d })}
                  </option>
                ))}
                <option value="-1">{t("lastDay")}</option>
              </Select>
            </label>
          ) : null}

          {draft.frequency !== "none" ? (
            <>
              <label className="flex flex-wrap items-center gap-2">
                {t("endLabel")}
                <Select
                  className="w-28"
                  value={draft.endType}
                  onChange={(e) => setDraft({ ...draft, endType: e.target.value as EndType })}
                >
                  <option value="never">{t("ends.never")}</option>
                  <option value="until">{t("ends.until")}</option>
                  <option value="count">{t("ends.count")}</option>
                </Select>
                {draft.endType === "until" ? (
                  <Input
                    type="date"
                    className="w-40"
                    aria-label={t("ends.until")}
                    value={draft.until}
                    min={task.dueDate ?? undefined}
                    onChange={(e) => setDraft({ ...draft, until: e.target.value })}
                  />
                ) : null}
                {draft.endType === "count" ? (
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    className="w-24"
                    aria-label={t("ends.count")}
                    value={draft.count}
                    onChange={(e) => setDraft({ ...draft, count: Number(e.target.value) })}
                  />
                ) : null}
              </label>
              <label className="flex flex-col gap-1">
                <span>{t("modeLabel")}</span>
                <Select
                  value={draft.mode}
                  onChange={(e) => setDraft({ ...draft, mode: e.target.value as RecurrenceMode })}
                  data-testid="recurrence-mode"
                >
                  <option value="fixed">{t("modes.fixed")}</option>
                  <option value="after_completion">{t("modes.after_completion")}</option>
                </Select>
                <span className="text-xs text-muted-foreground">
                  {t(`modeHints.${draft.mode}`)}
                </span>
              </label>
            </>
          ) : null}

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!rule || !task.dueDate || set.isPending}
              onClick={() => rule && set.mutate({ taskId: task.id, rule, mode: draft.mode })}
              data-testid="recurrence-save"
            >
              {t("save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmStop}
        title={t("stopTitle")}
        description={t("stopBody")}
        confirmLabel={t("stop")}
        pending={stop.isPending}
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => stop.mutate({ taskId: task.id })}
      />
    </section>
  );
}

/** "每 2 周的周一、周三" etc. */
function summary(t: ReturnType<typeof useTranslations<"tasks.recurrence">>, rule: RecurrenceRule) {
  const every =
    rule.interval === 1
      ? t(`everyOne.${rule.frequency}`)
      : t("everyN", { n: rule.interval, unit: t(`units.${rule.frequency}`) });
  const on =
    rule.frequency === "weekly" && rule.weekdays.length > 0
      ? rule.weekdays.map((d) => t(`weekdayShort.d${d as Weekday}`)).join("、")
      : rule.frequency === "monthly" && rule.monthDay !== null
        ? rule.monthDay === -1
          ? t("lastDay")
          : t("dayN", { day: rule.monthDay })
        : "";
  const end =
    rule.end.type === "until"
      ? ` · ${t("untilDate", { date: rule.end.date })}`
      : rule.end.type === "count"
        ? ` · ${t("countN", { count: rule.end.count })}`
        : "";
  return `${every}${on}${end}`;
}
