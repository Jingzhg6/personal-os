"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2, Target, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { Popover } from "@/shared/ui/popover";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { TaskDetail } from "../domain";

/**
 * 成长目标: which development goals this task acts on. Planning only — the task's XP is decided by
 * its completion rule and contributions, never by its goals. Talks to the development router
 * directly (like the project picker), so the tasks UI does not depend on the development UI.
 */
export function GoalsField({ task }: { task: TaskDetail }) {
  const t = useTranslations("development.taskField");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const { data: linked = [] } = useQuery({
    ...trpc.development.goals.forTask.queryOptions({ taskId: task.id }),
    // A task moved to the Trash is "not found": fail fast instead of retrying, so mutations that
    // await this refetch (e.g. deleting the task) are not held up.
    retry: false,
  });
  const { data: goals = [] } = useQuery(trpc.development.goals.list.queryOptions());
  const setGoals = useMutation(
    trpc.development.goals.setForTask.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(trpc.development.pathFilter()),
      onError: (error) => toast.show(errorMessage(error), "error"),
    }),
  );
  const linkedIds = linked.map((goal) => goal.id);
  const available = goals.filter((goal) => !linkedIds.includes(goal.id));
  const save = (goalIds: string[]) => setGoals.mutate({ taskId: task.id, goalIds });

  return (
    <section className="flex flex-col gap-2" aria-labelledby="task-goals">
      <div className="flex items-center justify-between gap-2">
        <h3 id="task-goals" className="flex items-center gap-1.5 text-sm font-medium">
          <Target className="size-4 text-primary" aria-hidden />
          {t("title")}
        </h3>
        <Popover
          align="end"
          trigger={(props) => (
            <Button variant="ghost" size="sm" {...props}>
              <Plus />
              {t("add")}
            </Button>
          )}
        >
          {(close) => (
            <div className="flex w-60 flex-col gap-1">
              <ul role="listbox" aria-label={t("search")} className="max-h-60 overflow-y-auto">
                {available.map((goal) => (
                  <li key={goal.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        close();
                        save([...linkedIds, goal.id]);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                    >
                      <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{goal.title}</span>
                    </button>
                  </li>
                ))}
                {available.length === 0 ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("empty")}</li>
                ) : null}
              </ul>
              <Link
                href="/development"
                className="flex items-center gap-1.5 border-t border-border px-2 pt-2 pb-1 text-xs text-primary hover:underline"
              >
                <Settings2 className="size-3.5" aria-hidden />
                {t("manage")}
              </Link>
            </div>
          )}
        </Popover>
      </div>
      {linked.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul aria-label={t("title")} className="flex flex-col gap-1" data-testid="task-goals">
          {linked.map((goal) => (
            <li key={goal.id} data-testid="task-goal" className="flex items-center gap-2 px-1 py-1">
              <Target className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Link
                href={`/development/goals/${goal.id}`}
                className="min-w-0 flex-1 truncate text-sm hover:underline"
              >
                {goal.title}
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => save(linkedIds.filter((id) => id !== goal.id))}
                aria-label={t("remove", { title: goal.title })}
                title={t("remove", { title: goal.title })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </section>
  );
}
