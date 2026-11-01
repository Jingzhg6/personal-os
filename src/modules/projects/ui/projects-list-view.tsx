"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarClock, Flag, FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { AreaBadge, useAreas } from "@/modules/areas/ui";
import type { Task } from "@/modules/tasks/domain";
import { useTaskActions, useTaskList, useToday } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { colorClasses } from "@/shared/ui/color";
import { PageHeader } from "@/shared/ui/page-header";
import { useToast } from "@/shared/ui/toast";

import { openProjectStatuses, type Project, type ProjectStatus } from "../domain";
import { ProjectProgress, ProjectStatusBadge, useDateOnly } from "./project-bits";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectDropZone, projectDropId, UnassignedTasks } from "./unassigned-tasks";
import { useProjectActions, useProjects } from "./use-projects";

const OPEN_TASKS = ["backlog", "unstarted", "started"] as const;

const tabs = {
  open: [...openProjectStatuses],
  closed: ["completed", "cancelled"],
  all: undefined,
} satisfies Record<string, ProjectStatus[] | undefined>;
type Tab = keyof typeof tabs;

export function ProjectsListView({ title }: { title: string }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const tab: Tab =
    (["open", "closed", "all"] as const).find((v) => v === searchParams.get("status")) ?? "open";
  const { data: projects = [], isPending } = useProjects(tabs[tab]);
  const { data: allProjects = [] } = useProjects();
  const actions = useProjectActions();
  const [creating, setCreating] = useState(false);
  const today = useToday();
  const taskActions = useTaskActions();
  const { data: unassignedData = [] } = useTaskList({
    today,
    sort: "manual",
    includeSubtasks: false,
    filter: { noProject: true, categories: [...OPEN_TASKS] },
  });
  // Hide a moved task at once (the list refreshes after the update).
  const unassigned = unassignedData.filter((task) => !task.projectId);
  const openProjects = allProjects.filter((p) =>
    (openProjectStatuses as readonly string[]).includes(p.status),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function moveToProject(task: Task, projectId: string) {
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) return;
    taskActions.update.mutate(
      { id: task.id, patch: { projectId } },
      {
        onSuccess: () =>
          toast.show(t("unassigned.moved", { title: task.title, project: project.name })),
      },
    );
  }

  const dndId = useId();
  const [dragging, setDragging] = useState<Task | null>(null);
  const titleOf = (id: unknown) => unassigned.find((x) => x.id === id)?.title ?? "";
  const projectOf = (id: unknown) => allProjects.find((p) => projectDropId(p.id) === id);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("unassigned.dragStart", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over && projectOf(over.id)
        ? t("unassigned.dragOver", { title: titleOf(active.id), project: projectOf(over.id)!.name })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over && projectOf(over.id)
        ? t("unassigned.moved", { title: titleOf(active.id), project: projectOf(over.id)!.name })
        : t("unassigned.dragCancel", { title: titleOf(active.id) }),
    onDragCancel: ({ active }) => t("unassigned.dragCancel", { title: titleOf(active.id) }),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const task = unassigned.find((x) => x.id === active.id);
    const project = over ? projectOf(over.id) : undefined;
    if (task && project) moveToProject(task, project.id);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t("new")}
          </Button>
        }
      />

      <nav aria-label={t("filters.label")} className="flex gap-1 border-b border-border">
        {(Object.keys(tabs) as Tab[]).map((key) => (
          <Link
            key={key}
            href={key === "open" ? pathname : `${pathname}?status=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === key
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`filters.${key}`)}
          </Link>
        ))}
      </nav>

      {!isPending && projects.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <FolderKanban className="size-8 text-muted-foreground/60" aria-hidden />
          {allProjects.length === 0 ? (
            <>
              <p className="font-medium">{t("empty.title")}</p>
              <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
              <Button className="mt-2" onClick={() => setCreating(true)}>
                <Plus />
                {t("new")}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyFiltered")}</p>
          )}
        </div>
      ) : null}

      <DndContext
        id={dndId}
        sensors={sensors}
        // Drop on the card under the pointer.
        collisionDetection={pointerWithin}
        onDragStart={({ active }) =>
          setDragging(unassigned.find((x) => x.id === active.id) ?? null)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t("unassigned.instructions") },
        }}
      >
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={title}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>

        <UnassignedTasks tasks={unassigned} projects={openProjects} onMove={moveToProject} />
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="w-72 rounded-md border border-primary/40 bg-surface-raised px-3 py-2 text-sm shadow-md">
              {dragging.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {creating ? (
        <ProjectFormDialog
          open
          pending={actions.create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(values) =>
            actions.create.mutate(values, {
              onSuccess: (project) => {
                setCreating(false);
                toast.show(t("created", { name: project.name }));
                router.push(`/projects/${project.id}`);
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const t = useTranslations("projects");
  const today = useToday();
  const dateOnly = useDateOnly();
  const { data: areas = [] } = useAreas();
  const area = areas.find((a) => a.id === project.areaId);
  const closed = project.status === "completed" || project.status === "cancelled";
  const targetPassed = Boolean(project.targetDate && project.targetDate < today && !closed);

  return (
    <li data-testid="project-card">
      <ProjectDropZone projectId={project.id}>
        <Link
          href={`/projects/${project.id}`}
          className="group flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-input"
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2.5 shrink-0 rounded-full",
                colorClasses[project.color].dot,
              )}
            />
            <h2 className="min-w-0 flex-1 leading-snug font-medium group-hover:underline">
              {project.name}
            </h2>
            <ProjectStatusBadge status={project.status} />
          </div>
          {area ? <AreaBadge area={area} className="w-fit" /> : null}
          <ProjectProgress progress={project.progress} className="mt-auto" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {project.targetDate ? (
              <span className={cn("inline-flex items-center gap-1", targetPassed && "text-danger")}>
                <CalendarClock className="size-3.5" aria-hidden />
                {targetPassed
                  ? t("targetPassed", { date: dateOnly(project.targetDate) })
                  : t("target", { date: dateOnly(project.targetDate) })}
              </span>
            ) : null}
            {project.progress.overdue > 0 ? (
              <span className="text-danger">
                {t("overdue", { count: project.progress.overdue })}
              </span>
            ) : null}
            {project.nextMilestone ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Flag className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {t("nextMilestone", { name: project.nextMilestone.name })}
                </span>
              </span>
            ) : null}
          </div>
        </Link>
      </ProjectDropZone>
    </li>
  );
}
