"use client";

import {
  CalendarClock,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderKanban,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";

import { useAreaLabel, useAreas } from "@/modules/areas/ui";
import type { TaskFilter } from "@/modules/tasks/domain";
import { KanbanBoard, TaskDetailPanel, useTaskPanel } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Card } from "@/shared/ui/card";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";

import type { Project } from "../domain";
import { ProjectProgress, ProjectStatusBadge, useDateOnly } from "./project-bits";
import { useProjects } from "./use-projects";

const ALL = "all";
const NONE = "none";

/**
 * Kanban by area (V3): the projects of one area as cards with their computed progress. A card
 * opens into the usual status board of that project's tasks — the same tasks, statuses and drag
 * rules as everywhere else, so a moved card changes the task (and the progress) everywhere.
 */
export function AreaBoardView({ title }: { title: string }) {
  const t = useTranslations("projects.board");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectId = useId();
  const { data: areas = [] } = useAreas();
  const areaLabel = useAreaLabel();
  const { data: projects, isPending } = useProjects();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const area = searchParams.get("area") ?? ALL;
  const setArea = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) params.delete("area");
    else params.set("area", value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const all = projects ?? [];
  const groups: { key: string; label: string; projects: Project[] }[] = [];
  const pick = (key: string, label: string, list: Project[]) => {
    if (area === ALL ? list.length > 0 : area === key) groups.push({ key, label, projects: list });
  };
  for (const a of areas)
    pick(
      a.id,
      areaLabel(a),
      all.filter((p) => p.areaId === a.id),
    );
  pick(
    NONE,
    t("noArea"),
    all.filter((p) => !p.areaId || !areas.some((a) => a.id === p.areaId)),
  );
  // A chosen area is shown even without projects (its tasks without a project still have a board).
  if (area !== ALL && groups.length === 0) {
    const chosen = areas.find((a) => a.id === area);
    if (chosen || area === NONE)
      groups.push({ key: area, label: chosen ? areaLabel(chosen) : t("noArea"), projects: [] });
  }
  const shown = groups.flatMap((g) => g.projects);
  const allOpen = shown.length > 0 && shown.every((p) => open.has(p.id));

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="flex flex-col gap-5" data-testid="area-board">
        <PageHeader title={title} description={t("description")} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor={selectId}>{t("area")}</Label>
            <Select
              id={selectId}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              data-testid="area-board-area"
            >
              <option value={ALL}>{t("allAreas")}</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {areaLabel(a)}
                </option>
              ))}
              <option value={NONE}>{t("noArea")}</option>
            </Select>
          </div>
          {shown.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map((p) => p.id)))}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              data-testid="area-board-toggle-all"
            >
              {allOpen ? (
                <ChevronsDownUp className="size-4" aria-hidden />
              ) : (
                <ChevronsUpDown className="size-4" aria-hidden />
              )}
              {allOpen ? t("collapseAll") : t("expandAll")}
            </button>
          ) : null}
        </div>

        {isPending ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-muted" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <FolderKanban className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">{t("empty")}</p>
            <Link href="/projects" className="text-sm text-primary hover:underline">
              {t("toProjects")}
            </Link>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3" aria-label={group.label}>
              {area === ALL ? (
                <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
              ) : null}
              {group.projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  open={open.has(project.id)}
                  onToggle={() => toggle(project.id)}
                  onOpenTask={openTask}
                />
              ))}
              <LooseTasksCard
                areaId={group.key === NONE ? null : group.key}
                open={open.has(`loose:${group.key}`)}
                onToggle={() => toggle(`loose:${group.key}`)}
                onOpenTask={openTask}
              />
            </section>
          ))
        )}

        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  open,
  onToggle,
  onOpenTask,
}: {
  project: Project;
  open: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("projects.board");
  const date = useDateOnly();
  const bodyId = `project-board-${project.id}`;
  return (
    <Card
      className="overflow-hidden p-0"
      data-testid="area-board-project"
      data-project={project.id}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid="area-board-project-toggle"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span className="truncate font-medium">{project.name}</span>
          <ProjectStatusBadge status={project.status} />
        </button>
        {project.targetDate ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("deadline", { date: date(project.targetDate) })}
          </span>
        ) : null}
        <ProjectProgress progress={project.progress} className="w-full sm:w-56" />
        <Link href={`/projects/${project.id}`} className="text-xs text-primary hover:underline">
          {t("openProject")}
        </Link>
      </div>
      {open ? (
        <div id={bodyId} className="border-t border-border bg-surface-muted/30 px-4 py-3">
          <KanbanBoard projectId={project.id} embedded hideFilters onOpenTask={onOpenTask} />
        </div>
      ) : null}
    </Card>
  );
}

/** The area's tasks that belong to no project, as one more collapsible board. */
function LooseTasksCard({
  areaId,
  open,
  onToggle,
  onOpenTask,
}: {
  areaId: string | null;
  open: boolean;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("projects.board");
  const filter = useMemo<TaskFilter>(
    () => (areaId ? { areaIds: [areaId], noProject: true } : { noArea: true, noProject: true }),
    [areaId],
  );
  return (
    <Card className="overflow-hidden border-dashed p-0" data-testid="area-board-loose">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")}
          aria-hidden
        />
        {t("looseTasks")}
      </button>
      {open ? (
        <div className="border-t border-border bg-surface-muted/30 px-4 py-3">
          <KanbanBoard embedded hideFilters baseFilter={filter} onOpenTask={onOpenTask} />
        </div>
      ) : null}
    </Card>
  );
}
