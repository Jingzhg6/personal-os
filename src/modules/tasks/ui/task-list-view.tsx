"use client";

import { ChevronDown, ChevronRight, ListTodo } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import { useAreas } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { PageHeader } from "@/shared/ui/page-header";

import { isClosedCategory } from "../domain";
import { QuickAdd } from "./quick-add";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskRow, type TaskLookups } from "./task-row";
import { useStatuses, useTags, useTaskActions, useTaskList } from "./use-task-data";

/** Search parameter holding the task open in the detail panel (shareable, back-button friendly). */
export const TASK_PARAM = "task";

export function TaskListView() {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get(TASK_PARAM);

  const { data: tasks = [], isPending } = useTaskList();
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const actions = useTaskActions();
  const [showClosed, setShowClosed] = useState(false);

  const lookups: TaskLookups = useMemo(
    () => ({
      statuses: new Map(statuses.map((s) => [s.id, s])),
      areas: new Map(areas.map((a) => [a.id, a])),
      tags: new Map(tags.map((tag) => [tag.id, tag])),
    }),
    [statuses, areas, tags],
  );

  const open = tasks.filter((task) => !isClosedCategory(task.statusCategory));
  const closed = tasks.filter((task) => isClosedCategory(task.statusCategory));

  const openTask = useCallback(
    (id: string) => router.push(`${pathname}?${TASK_PARAM}=${id}`, { scroll: false }),
    [pathname, router],
  );
  const closeTask = useCallback(() => router.push(pathname, { scroll: false }), [pathname, router]);

  const row = (task: (typeof tasks)[number]) => (
    <TaskRow
      key={task.id}
      task={task}
      lookups={lookups}
      selected={task.id === openTaskId}
      onOpen={openTask}
      actions={actions}
    />
  );

  return (
    // On wide screens the list makes room for the detail panel instead of hiding under it.
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <PageHeader
          title={t("title")}
          description={isPending ? null : t("count", { count: open.length })}
        />

        <QuickAdd />

        {!isPending && tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <ListTodo className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">{t("empty.title")}</p>
            <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
          </div>
        ) : null}

        {open.length > 0 ? (
          <section aria-labelledby="open-tasks">
            <h2 id="open-tasks" className="sr-only">
              {t("groups.open")}
            </h2>
            <ul className="flex flex-col gap-0.5">{open.map(row)}</ul>
          </section>
        ) : null}

        {closed.length > 0 ? (
          <section aria-labelledby="closed-tasks" className="flex flex-col gap-2">
            <h2 id="closed-tasks">
              <button
                type="button"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((value) => !value)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                {showClosed ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
                {showClosed ? t("hideClosed") : t("showClosed", { count: closed.length })}
              </button>
            </h2>
            {showClosed ? <ul className="flex flex-col gap-0.5">{closed.map(row)}</ul> : null}
          </section>
        ) : null}

        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
      </div>
    </div>
  );
}
