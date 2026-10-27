"use client";

import { ArrowUpToLine } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/shared/ui/button";
import { Popover } from "@/shared/ui/popover";
import { useToast } from "@/shared/ui/toast";

import type { TaskDetail } from "../domain";
import { TaskPicker } from "./task-picker";
import { useTaskActions } from "./use-task-data";

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
    <TaskPicker
      // The server rejects cycles; hiding the task and its direct subtasks keeps the list sensible.
      excludeIds={new Set([task.id, task.parentTaskId, ...task.subtasks.map((s) => s.id)])}
      searchLabel={t("parentSearch")}
      resultsLabel={t("parentResults")}
      emptyLabel={t("parentEmpty")}
      onSelect={(option) => setParent(option.id)}
      before={
        task.parentTaskId ? (
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
        ) : null
      }
    />
  );
}
