"use client";

import { CircleCheck, Circle, ListFilter, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useToday } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/toast";

import type { Milestone, ProjectDetail } from "../domain";
import { ProjectProgress } from "./project-bits";
import { useProjectActions } from "./use-projects";

export function MilestonesPanel({ project }: { project: ProjectDetail }) {
  const t = useTranslations("projects.milestones");
  const actions = useProjectActions();
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");

  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    actions.createMilestone.mutate(
      { projectId: project.id, name: name.trim(), dueDate: dueDate || null },
      {
        onSuccess: () => {
          setName("");
          setDueDate("");
        },
      },
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {project.milestones.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {project.milestones.map((milestone) => (
            <MilestoneRow key={milestone.id} milestone={milestone} projectId={project.id} />
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          aria-label={t("namePlaceholder")}
          maxLength={120}
          className="min-w-48 flex-1"
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          aria-label={t("dueDate")}
          className="w-44"
        />
        <Button type="submit" disabled={!name.trim() || actions.createMilestone.isPending}>
          <Plus />
          {t("add")}
        </Button>
      </form>
    </div>
  );
}

function MilestoneRow({ milestone, projectId }: { milestone: Milestone; projectId: string }) {
  const t = useTranslations("projects.milestones");
  const tc = useTranslations("common");
  const toast = useToast();
  const today = useToday();
  const actions = useProjectActions();
  const [name, setName] = useState(milestone.name);
  const [confirming, setConfirming] = useState(false);
  const done = milestone.completedAt !== null;
  const overdue = !done && milestone.dueDate !== null && milestone.dueDate < today;

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) return setName(milestone.name);
    if (trimmed !== milestone.name)
      actions.updateMilestone.mutate({ id: milestone.id, patch: { name: trimmed } });
  }

  return (
    <li data-testid="milestone-row" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={
            done ? t("reopen", { name: milestone.name }) : t("complete", { name: milestone.name })
          }
          onClick={() =>
            actions.setMilestoneCompleted.mutate({ id: milestone.id, completed: !done })
          }
          className="shrink-0 text-muted-foreground hover:text-primary"
        >
          {done ? (
            <CircleCheck className="size-5 text-success" aria-hidden />
          ) : (
            <Circle className="size-5" aria-hidden />
          )}
        </button>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          aria-label={`${t("name")}: ${milestone.name}`}
          maxLength={120}
          className={cn("min-w-40 flex-1", done && "text-muted-foreground line-through")}
        />
        <Input
          type="date"
          value={milestone.dueDate ?? ""}
          onChange={(event) =>
            actions.updateMilestone.mutate({
              id: milestone.id,
              patch: { dueDate: event.target.value || null },
            })
          }
          aria-label={`${t("dueDate")}: ${milestone.name}`}
          className={cn("w-44", overdue && "border-danger text-danger")}
        />
        <Link
          href={`/projects/${projectId}?milestone=${milestone.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ListFilter className="size-3.5" aria-hidden />
          {t("showTasks")}
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setConfirming(true)}
          aria-label={t("delete", { name: milestone.name })}
          title={t("delete", { name: milestone.name })}
        >
          <Trash2 />
        </Button>
      </div>
      <ProjectProgress progress={milestone.progress} className="pl-8" />
      <ConfirmDialog
        open={confirming}
        title={t("deleteTitle", { name: milestone.name })}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        pending={actions.deleteMilestone.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          actions.deleteMilestone.mutate(
            { id: milestone.id },
            {
              onSuccess: () => {
                setConfirming(false);
                toast.show(t("deleted"));
              },
            },
          )
        }
      />
    </li>
  );
}
