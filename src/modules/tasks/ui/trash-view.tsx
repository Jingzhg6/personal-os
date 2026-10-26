"use client";

import { CornerDownRight, RotateCcw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import type { TrashedTask } from "../domain";
import { useTaskActions, useTrash } from "./use-task-data";

export function TrashView({ title }: { title: string }) {
  const t = useTranslations("tasks.trash");
  const tc = useTranslations("common");
  const format = useFormatter();
  const toast = useToast();
  const actions = useTaskActions();
  const { data: trash = [], isPending } = useTrash();
  const [purging, setPurging] = useState<TrashedTask | null>(null);
  const [emptying, setEmptying] = useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={title}
        description={t("description")}
        actions={
          trash.length > 0 ? (
            <Button variant="secondary" onClick={() => setEmptying(true)}>
              <Trash2 />
              {t("emptyTrash")}
            </Button>
          ) : null
        }
      />

      {!isPending && trash.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <Trash2 className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="font-medium">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
        </div>
      ) : null}

      <ul
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
        aria-label={title}
      >
        {trash.map((task) => (
          <li
            key={task.id}
            data-testid="trash-row"
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm">{task.title}</span>
              <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span>{t("deletedAt", { date: format.dateTime(task.deletedAt, "long") })}</span>
                {task.subtaskCount > 0 ? (
                  <span>{t("withSubtasks", { count: task.subtaskCount })}</span>
                ) : null}
                {task.parentTitle ? (
                  <span className="inline-flex items-center gap-1">
                    <CornerDownRight className="size-3" aria-hidden />
                    {t("inParent", { title: task.parentTitle })}
                  </span>
                ) : null}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                actions.restore.mutate(
                  { id: task.id },
                  { onSuccess: () => toast.show(t("restored", { title: task.title })) },
                )
              }
            >
              <RotateCcw />
              {t("restore")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPurging(task)}>
              {t("purge")}
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={purging !== null}
        title={purging ? t("purgeTitle", { title: purging.title }) : ""}
        description={t("purgeBody")}
        confirmLabel={t("purge")}
        pending={actions.purge.isPending}
        onCancel={() => setPurging(null)}
        onConfirm={() =>
          purging &&
          actions.purge.mutate(
            { id: purging.id },
            {
              onSuccess: () => {
                setPurging(null);
                toast.show(t("purged"));
              },
            },
          )
        }
      />
      <ConfirmDialog
        open={emptying}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        confirmLabel={tc("delete")}
        pending={actions.emptyTrash.isPending}
        onCancel={() => setEmptying(false)}
        onConfirm={() =>
          actions.emptyTrash.mutate(undefined, {
            onSuccess: () => {
              setEmptying(false);
              toast.show(t("emptied"));
            },
          })
        }
      />
    </div>
  );
}
