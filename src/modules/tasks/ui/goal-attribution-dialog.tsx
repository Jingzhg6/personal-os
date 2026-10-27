"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useAttributeLabel, useDevelopmentAttributes } from "@/modules/character/ui";
import {
  overAllocated,
  splitGrowth,
  type Allocation,
  type TaskAttributionView,
} from "@/modules/development/domain";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ColorDot } from "@/shared/ui/color";
import { Dialog } from "@/shared/ui/dialog";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

const key = (goalId: string, attributeId: string) => `${goalId}:${attributeId}`;

/**
 * 成长归属: how much of this task's Growth XP (per attribute) counts towards each of its goals.
 * Shares are percentages of the XP the task earned; together at most 100 %, the rest 未归属.
 * The task's XP itself never changes. Talks to the development router directly.
 */
export function GoalAttributionDialog({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const t = useTranslations("development.attribution");
  const trpc = useTRPC();
  const { data } = useQuery({
    ...trpc.development.attribution.forTask.queryOptions({ taskId }),
    retry: false,
  });
  return (
    <Dialog open onClose={onClose} title={t("title")}>
      {data ? (
        <AttributionForm key={data.taskId} view={data} onClose={onClose} />
      ) : (
        <div className="h-32 animate-pulse rounded-md bg-surface-muted" aria-hidden />
      )}
    </Dialog>
  );
}

function AttributionForm({ view, onClose }: { view: TaskAttributionView; onClose: () => void }) {
  const t = useTranslations("development.attribution");
  const tc = useTranslations("common");
  const tw = useTranslations("development.form.weights");
  const format = useFormatter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const label = useAttributeLabel();
  const { data: attributes = [] } = useDevelopmentAttributes();
  const attributeOf = new Map(attributes.map((a) => [a.id, a]));
  const [shares, setShares] = useState<Map<string, number>>(
    () => new Map(view.allocations.map((a) => [key(a.goalId, a.attributeId), a.share])),
  );
  const save = useMutation(
    trpc.development.attribution.set.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(trpc.development.pathFilter()),
      onError: (error) => toast.show(errorMessage(error), "error"),
      onSuccess: () => {
        toast.show(t("saved"));
        onClose();
      },
    }),
  );

  const current: Allocation[] = [];
  for (const goal of view.goals) {
    for (const attribute of view.attributes) {
      const share = shares.get(key(goal.id, attribute.attributeId)) ?? 0;
      if (share > 0) {
        current.push({
          goalId: goal.id,
          taskId: view.taskId,
          attributeId: attribute.attributeId,
          share,
        });
      }
    }
  }
  const over = new Set(overAllocated(current));
  const editable = view.goals.filter((goal) => goal.status !== "archived");

  if (view.goals.length === 0 || view.attributes.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground" data-testid="attribution-empty">
          {view.goals.length === 0 ? t("noGoals") : t("noContributions")}
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {tc("close")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="attribution-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (over.size > 0) return;
        save.mutate({
          taskId: view.taskId,
          allocations: current
            .filter((a) => editable.some((goal) => goal.id === a.goalId))
            .map(({ goalId, attributeId, share }) => ({ goalId, attributeId, share })),
        });
      }}
    >
      <p className="text-sm">
        <span className="text-muted-foreground">{t("task")}</span>{" "}
        <span className="font-medium">{view.taskTitle}</span>
      </p>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
        {view.attributes.map((row) => {
          const attribute = attributeOf.get(row.attributeId);
          const name = attribute ? label(attribute) : "";
          const rowShares = view.goals.map((goal) => ({
            goalId: goal.id,
            share: shares.get(key(goal.id, row.attributeId)) ?? 0,
          }));
          const split = splitGrowth(row.lifetimeXp, rowShares);
          const total = rowShares.reduce((sum, s) => sum + s.share, 0);
          return (
            <fieldset
              key={row.attributeId}
              className={cn(
                "flex flex-col gap-2 rounded-md border border-border p-3",
                over.has(row.attributeId) && "border-danger",
              )}
              data-testid="attribution-attribute"
            >
              <legend className="flex flex-wrap items-center gap-x-2 px-1 text-sm font-medium">
                {attribute ? <ColorDot color={attribute.color} /> : null}
                {attribute?.icon ? <span aria-hidden>{attribute.icon}</span> : null}
                {name}
                {row.weight ? (
                  <span className="rounded bg-surface-muted px-1.5 text-xs font-normal">
                    {tw(String(row.weight) as "1" | "2" | "3")}
                  </span>
                ) : null}
                <span className="text-xs font-normal text-muted-foreground">
                  {row.lifetimeXp !== 0
                    ? t("earned", { xp: format.number(row.lifetimeXp) })
                    : t("notEarned")}
                </span>
              </legend>
              {view.goals.map((goal) => {
                const share = shares.get(key(goal.id, row.attributeId)) ?? 0;
                const archived = goal.status === "archived";
                return (
                  <label key={goal.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {goal.title}
                      {archived ? (
                        <span className="ml-1 text-xs text-muted-foreground">{t("archived")}</span>
                      ) : null}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={5}
                      value={share}
                      disabled={archived}
                      aria-label={t("shareLabel", { goal: goal.title, attribute: name })}
                      onChange={(event) => {
                        const value = Math.max(
                          0,
                          Math.min(100, Math.round(Number(event.target.value) || 0)),
                        );
                        setShares((map) => new Map(map).set(key(goal.id, row.attributeId), value));
                      }}
                      className="h-8 w-20 rounded-md border border-input bg-surface px-2 text-right text-sm tabular-nums disabled:opacity-60"
                    />
                    <span className="w-6 text-muted-foreground">%</span>
                    <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                      {t("xp", { xp: format.number(split.byGoal.get(goal.id) ?? 0) })}
                    </span>
                  </label>
                );
              })}
              <div
                className="flex items-center gap-2 border-t border-border pt-2 text-sm text-muted-foreground"
                data-testid="attribution-unattributed"
              >
                <span className="flex-1">{t("unattributed")}</span>
                <span className="w-20 text-right tabular-nums">{Math.max(0, 100 - total)}</span>
                <span className="w-6">%</span>
                <span className="w-16 text-right text-xs tabular-nums">
                  {t("xp", { xp: format.number(split.unattributed) })}
                </span>
              </div>
              {over.has(row.attributeId) ? (
                <p role="alert" className="text-xs text-danger">
                  {t("over")}
                </p>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={over.size > 0 || save.isPending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
