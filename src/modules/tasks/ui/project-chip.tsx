"use client";

import { useQuery } from "@tanstack/react-query";
import { Flag, FolderKanban } from "lucide-react";
import Link from "next/link";

import type { Project } from "@/modules/projects/domain";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { colorClasses } from "@/shared/ui/color";

import { useToday } from "./labels";

/** All of the user's projects, shared by every task view (one cached query). */
export function useProjectOptions() {
  const trpc = useTRPC();
  const today = useToday();
  return useQuery(trpc.projects.list.queryOptions({ today }));
}

export function useProjectLookup(): Map<string, Project> {
  const { data = [] } = useProjectOptions();
  return new Map(data.map((project) => [project.id, project]));
}

/** Milestone names of one project (inside that project's views). */
export function useMilestoneLookup(projectId: string | undefined): Map<string, string> | undefined {
  const trpc = useTRPC();
  const today = useToday();
  const { data } = useQuery({
    ...trpc.projects.byId.queryOptions({ id: projectId ?? "", today }),
    enabled: Boolean(projectId),
  });
  return data ? new Map(data.milestones.map((m) => [m.id, m.name])) : undefined;
}

export function MilestoneChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[min(10rem,100%)] min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <Flag className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Small project label on task rows and cards; links to the project. */
export function ProjectChip({ projectId, className }: { projectId: string; className?: string }) {
  const project = useProjectLookup().get(projectId);
  if (!project) return null;
  return (
    <Link
      href={`/projects/${project.id}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex max-w-[min(10rem,100%)] min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:underline",
        colorClasses[project.color].soft,
        className,
      )}
    >
      <FolderKanban className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}
