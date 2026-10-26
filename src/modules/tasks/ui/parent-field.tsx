"use client";

import { ArrowUpToLine, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { Button } from "@/shared/ui/button";
import { Popover } from "@/shared/ui/popover";
import { useToast } from "@/shared/ui/toast";

import type { TaskDetail } from "../domain";
import { useToday } from "./labels";
import { useTaskActions, useTaskList } from "./use-task-data";

/** Shows and changes the task's parent (subtask ↔ top-level, or another parent). */
export function ParentField({
  task,
  onOpenTask,
}: {
  task: TaskDetail;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("tasks.detail");
  return (
    <div className="flex min-w-0 items-center gap-2">
      {task.parent ? (
        <button
          type="button"
          onClick={() => onOpenTask(task.parent!.id)}
          className="min-w-0 truncate text-left text-sm text-primary hover:underline"
        >
          {task.parent.title}
        </button>
      ) : (
        <span className="text-sm text-muted-foreground">{t("noParent")}</span>
      )}
      <Popover
        align="end"
        trigger={(props) => (
          <Button variant="ghost" size="sm" className="ml-auto" {...props}>
            {t("changeParent")}
          </Button>
        )}
      >
        {(close) => <ParentPicker task={task} onDone={close} />}
      </Popover>
    </div>
  );
}

function ParentPicker({ task, onDone }: { task: TaskDetail; onDone: () => void }) {
  const t = useTranslations("tasks.detail");
  const toast = useToast();
  const actions = useTaskActions();
  const today = useToday();
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const { data: candidates = [] } = useTaskList({
    today,
    search: deferred || undefined,
    sort: "updated",
    includeSubtasks: true,
    filter: { categories: ["backlog", "unstarted", "started"] },
  });

  // The server rejects cycles; hiding the task and its direct subtasks keeps the list sensible.
  const excluded = new Set([task.id, task.parentTaskId, ...task.subtasks.map((s) => s.id)]);
  const options = candidates.filter((c) => !excluded.has(c.id)).slice(0, 8);

  const setParent = (parentTaskId: string | null) =>
    actions.setParent.mutate(
      { id: task.id, parentTaskId },
      {
        onSuccess: () => {
          toast.show(t("parentChanged"));
          onDone();
        },
      },
    );

  return (
    <div className="flex w-72 flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md bg-surface-muted px-2">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("parentSearch")}
          aria-label={t("parentSearch")}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ul role="listbox" aria-label={t("parentResults")} className="max-h-60 overflow-y-auto">
        {task.parentTaskId ? (
          <li>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => setParent(null)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary hover:bg-surface-muted"
            >
              <ArrowUpToLine className="size-3.5" aria-hidden />
              {t("makeTopLevel")}
            </button>
          </li>
        ) : null}
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => setParent(option.id)}
              className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
            >
              <span className="truncate text-sm">{option.title}</span>
              {option.parentTitle ? (
                <span className="truncate text-xs text-muted-foreground">{option.parentTitle}</span>
              ) : null}
            </button>
          </li>
        ))}
        {options.length === 0 ? (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("parentEmpty")}</li>
        ) : null}
      </ul>
    </div>
  );
}
