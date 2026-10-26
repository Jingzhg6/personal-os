"use client";

import type { JSONContent } from "@tiptap/react";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AreaBadge, useAreas } from "@/modules/areas/ui";
import { isRichTextEmpty, type RichTextDoc } from "@/modules/tasks/domain";
import { KanbanBoard, TaskListView, useTaskPanel } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { colorClasses } from "@/shared/ui/color";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { RichTextEditor } from "@/shared/ui/rich-text-editor";
import { useToast } from "@/shared/ui/toast";

import type { ProjectDetail } from "../domain";
import { MilestonesPanel } from "./milestones-panel";
import { ProjectProgress, ProjectStatusBadge, useDateOnly } from "./project-bits";
import { ProjectFormDialog } from "./project-form-dialog";
import { useProject, useProjectActions } from "./use-projects";

const views = ["tasks", "board", "milestones", "notes"] as const;
type View = (typeof views)[number];

/**
 * One project. Its 任务 and 看板 tabs are the shared task views filtered to this project:
 * the project owns no copies of tasks.
 */
export function ProjectDetailView({ id }: { id: string }) {
  const t = useTranslations("projects");
  const { data: project, isError } = useProject(id);

  if (isError) {
    return <p className="mx-auto max-w-6xl text-sm text-muted-foreground">{t("notFound")}</p>;
  }
  if (!project) return null;
  return <ProjectDetailContent project={project} />;
}

function ProjectDetailContent({ project }: { project: ProjectDetail }) {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const dateOnly = useDateOnly();
  const { openTaskId } = useTaskPanel();
  const { data: areas = [] } = useAreas();
  const actions = useProjectActions();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const view: View = views.find((v) => v === searchParams.get("view")) ?? "tasks";
  const area = areas.find((a) => a.id === project.areaId);
  const tabHref = (next: View) => (next === "tasks" ? pathname : `${pathname}?view=${next}`);

  return (
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <Link
          href="/projects"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t("backToList")}
        </Link>

        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <span
              aria-hidden
              className={cn("mt-2.5 size-3 shrink-0 rounded-full", colorClasses[project.color].dot)}
            />
            <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{project.name}</h1>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                {t("edit")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleting(true)}
                aria-label={t("delete")}
                title={t("delete")}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-6 text-sm text-muted-foreground">
            <ProjectStatusBadge status={project.status} />
            {area ? <AreaBadge area={area} /> : null}
            {project.startDate || project.targetDate ? (
              <span className="tabular-nums">
                {t("dates", {
                  start: project.startDate ? dateOnly(project.startDate) : "…",
                  end: project.targetDate ? dateOnly(project.targetDate) : "…",
                })}
              </span>
            ) : null}
          </div>
          <ProjectProgress progress={project.progress} className="max-w-md pl-6" />
        </header>

        <nav
          aria-label={t("tabs.label")}
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {views.map((key) => (
            <Link
              key={key}
              href={tabHref(key)}
              scroll={false}
              aria-current={view === key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                view === key
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${key}`)}
            </Link>
          ))}
        </nav>

        {view === "tasks" ? (
          <TaskListView
            title={project.name}
            variant={{ kind: "project", projectId: project.id }}
            embedded
          />
        ) : view === "board" ? (
          <KanbanBoard projectId={project.id} embedded />
        ) : view === "milestones" ? (
          <MilestonesPanel project={project} />
        ) : (
          <div className="max-w-3xl">
            <RichTextEditor
              value={project.description as JSONContent | null}
              placeholder={t("notesPlaceholder")}
              label={t("tabs.notes")}
              onChange={(doc) => {
                const description = isRichTextEmpty(doc as RichTextDoc)
                  ? null
                  : (doc as ProjectDetail["description"]);
                if (JSON.stringify(description) !== JSON.stringify(project.description)) {
                  actions.update.mutate({ id: project.id, patch: { description } });
                }
              }}
            />
          </div>
        )}
      </div>

      {editing ? (
        <ProjectFormDialog
          open
          project={project}
          pending={actions.update.isPending}
          onClose={() => setEditing(false)}
          onSubmit={(values) =>
            actions.update.mutate(
              { id: project.id, patch: values },
              {
                onSuccess: () => {
                  setEditing(false);
                  toast.show(t("saved"));
                },
              },
            )
          }
        />
      ) : null}
      <ConfirmDialog
        open={deleting}
        title={t("deleteTitle", { name: project.name })}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        pending={actions.remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          actions.remove.mutate(
            { id: project.id },
            {
              onSuccess: () => {
                toast.show(t("deleted"));
                router.push("/projects");
              },
            },
          )
        }
      />
    </div>
  );
}
