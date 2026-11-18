"use client";

import { ChevronDown, FolderKanban } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { useAreaLabel, useAreas } from "@/modules/areas/ui";
import {
  matrixPlacement,
  matrixPlacements,
  type MatrixPlacement,
  type Task,
  type TaskListQuery,
} from "@/modules/tasks/domain";
import {
  MatrixView,
  StatusIcon,
  TaskDetailPanel,
  useTaskList,
  useTaskPanel,
  useToday,
} from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/page-header";

import { openProjectStatuses, type Project } from "../domain";
import { ProjectProgress, ProjectStatusBadge } from "./project-bits";
import { useProjects } from "./use-projects";

const OPEN = ["backlog", "unstarted", "started"] as const;
const VIEWS = ["tasks", "projects"] as const;

const placementTone: Record<MatrixPlacement, string> = {
  do: "bg-danger/12 text-danger",
  schedule: "bg-primary/12 text-primary",
  delegate: "bg-warning/15 text-warning",
  eliminate: "bg-surface-muted text-muted-foreground",
  unsorted: "border border-dashed border-border text-muted-foreground",
};

/**
 * Eisenhower matrix with a task / project switch (V3). The task view is the existing matrix; the
 * project view reads the same tasks and only groups them by project — switching never changes a
 * task's urgent / important flags.
 */
export function MatrixPage({ title }: { title: string }) {
  const t = useTranslations("projects.matrix");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "projects" ? "projects" : "tasks";
  const setView = (next: "tasks" | "projects") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "tasks") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const switcher = (
    <div
      role="group"
      aria-label={t("viewLabel")}
      className="inline-flex rounded-md border border-border p-0.5"
    >
      {VIEWS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => setView(key)}
          data-testid={`matrix-view-${key}`}
          className={cn(
            "rounded px-3 py-1 text-sm",
            view === key
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`views.${key}`)}
        </button>
      ))}
    </div>
  );
  return view === "tasks" ? (
    <MatrixView title={title} headerActions={switcher} />
  ) : (
    <ProjectMatrix title={title} switcher={switcher} />
  );
}

function ProjectMatrix({ title, switcher }: { title: string; switcher: React.ReactNode }) {
  const t = useTranslations("projects.matrix");
  const today = useToday();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { data: projects, isPending } = useProjects(showAll ? undefined : [...openProjectStatuses]);
  const query: TaskListQuery = useMemo(
    () => ({ today, sort: "due", includeSubtasks: true, filter: { categories: [...OPEN] } }),
    [today],
  );
  const { data: tasks = [] } = useTaskList(query);

  // Open tasks per project; subtasks belong to their parent's project.
  const byProject = useMemo(() => {
    const projectOf = new Map(tasks.map((task) => [task.id, task.projectId]));
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const projectId =
        task.projectId ?? (task.parentTaskId ? projectOf.get(task.parentTaskId) : null);
      if (!projectId) continue;
      map.set(projectId, [...(map.get(projectId) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5" data-testid="matrix-projects">
        <PageHeader title={title} description={t("description")} actions={switcher} />
        <label className="flex items-center gap-2 self-start text-sm text-muted-foreground">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t("showClosed")}
        </label>
        {isPending ? (
          <div className="grid gap-3 md:grid-cols-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-lg bg-surface-muted" />
            ))}
          </div>
        ) : (projects ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <FolderKanban className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">{t("empty")}</p>
            <Link href="/projects" className="text-sm text-primary hover:underline">
              {t("toProjects")}
            </Link>
          </div>
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2">
            {projects!.map((project) => (
              <ProjectQuadrantCard
                key={project.id}
                project={project}
                tasks={byProject.get(project.id) ?? []}
                open={open.has(project.id)}
                onToggle={() => toggle(project.id)}
                onOpenTask={openTask}
              />
            ))}
          </div>
        )}
        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
      </div>
    </div>
  );
}

function ProjectQuadrantCard({
  project,
  tasks,
  open,
  onToggle,
  onOpenTask,
}: {
  project: Project;
  tasks: Task[];
  open: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("projects.matrix");
  const tp = useTranslations("tasks.matrix.placements");
  const { data: areas = [] } = useAreas();
  const areaLabel = useAreaLabel();
  const area = areas.find((a) => a.id === project.areaId);
  const byPlacement = matrixPlacements.map((placement) => ({
    placement,
    tasks: tasks.filter((task) => matrixPlacement(task) === placement),
  }));
  return (
    <Card
      className="flex flex-col gap-3 p-4"
      data-testid="matrix-project"
      data-project={project.id}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-2 text-left"
        data-testid="matrix-project-toggle"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        <ProjectStatusBadge status={project.status} />
      </button>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{area ? areaLabel(area) : t("noArea")}</span>
        <Link href={`/projects/${project.id}`} className="text-primary hover:underline">
          {t("openProject")}
        </Link>
      </div>
      <ProjectProgress progress={project.progress} />
      <ul className="flex flex-wrap gap-1.5" aria-label={t("openByQuadrant")}>
        {byPlacement.map(({ placement, tasks: list }) => (
          <li
            key={placement}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs tabular-nums",
              placementTone[placement],
            )}
            title={tp(`${placement}.title`)}
          >
            {t("quadrantCount", { quadrant: tp(`${placement}.title`), count: list.length })}
          </li>
        ))}
      </ul>
      {open ? (
        tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noOpenTasks")}</p>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {byPlacement
              .filter((g) => g.tasks.length > 0)
              .map(({ placement, tasks: list }) => (
                <section key={placement} className="flex flex-col gap-1">
                  <h3 className="text-xs font-semibold text-muted-foreground">
                    {tp(`${placement}.title`)}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {list.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpenTask(task.id)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-muted",
                            task.parentTaskId && "pl-6",
                          )}
                          data-testid="matrix-project-task"
                        >
                          <StatusIcon
                            category={task.statusCategory}
                            className="size-3.5 shrink-0"
                          />
                          <span className="truncate">{task.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )
      ) : null}
    </Card>
  );
}
