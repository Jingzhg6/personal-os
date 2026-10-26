"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToday } from "@/modules/tasks/ui";
import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { ProjectStatus } from "../domain";

export function useProjects(statuses?: ProjectStatus[]) {
  const trpc = useTRPC();
  const today = useToday();
  return useQuery(trpc.projects.list.queryOptions({ today, statuses }));
}

export function useProject(id: string) {
  const trpc = useTRPC();
  const today = useToday();
  return useQuery({ ...trpc.projects.byId.queryOptions({ id, today }), retry: false });
}

/** Project mutations. Progress depends on tasks, so task queries are refreshed too. */
export function useProjectActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.projects.pathFilter()),
        queryClient.invalidateQueries(trpc.tasks.pathFilter()),
      ]),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.projects.create.mutationOptions(options)),
    update: useMutation(trpc.projects.update.mutationOptions(options)),
    // The deleted project's page stays mounted until the caller navigates away; refetching
    // its detail would only 404 and unmount it, so refresh just the lists and tasks.
    remove: useMutation(
      trpc.projects.delete.mutationOptions({
        onError: options.onError,
        onSettled: () =>
          Promise.all([
            queryClient.invalidateQueries(trpc.projects.list.pathFilter()),
            queryClient.invalidateQueries(trpc.tasks.pathFilter()),
          ]),
      }),
    ),
    createMilestone: useMutation(trpc.projects.milestones.create.mutationOptions(options)),
    updateMilestone: useMutation(trpc.projects.milestones.update.mutationOptions(options)),
    setMilestoneCompleted: useMutation(
      trpc.projects.milestones.setCompleted.mutationOptions(options),
    ),
    deleteMilestone: useMutation(trpc.projects.milestones.delete.mutationOptions(options)),
  };
}
