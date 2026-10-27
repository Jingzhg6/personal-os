"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { GoalStatus } from "../domain";

/* Growth figures move with task completions anywhere: refetched whenever shown. */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useDevelopmentOverview() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.development.overview.queryOptions(), ...alwaysFresh });
}

export function useGoalDetail(id: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.development.goals.detail.queryOptions({ id }),
    ...alwaysFresh,
    retry: false,
  });
}

export function useAttributeDetail(id: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.development.attribute.queryOptions({ id }),
    ...alwaysFresh,
    retry: false,
  });
}

/**
 * Development mutations. Linking or creating tasks changes task queries as well (and the dashboard
 * shows the chosen focus), so those are refreshed too.
 */
export function useDevelopmentActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.development.pathFilter()),
        queryClient.invalidateQueries(trpc.tasks.pathFilter()),
        queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
      ]),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  const g = trpc.development.goals;
  const p = trpc.development.plans;
  return {
    updateVision: useMutation(trpc.development.updateVision.mutationOptions(options)),
    setFocus: useMutation(trpc.development.setFocus.mutationOptions(options)),
    create: useMutation(g.create.mutationOptions(options)),
    update: useMutation(g.update.mutationOptions(options)),
    setStatus: useMutation(g.setStatus.mutationOptions(options)),
    // The deleted goal's page navigates away; refetching its detail would only 404.
    remove: useMutation(
      g.delete.mutationOptions({
        onError: options.onError,
        onSettled: () =>
          Promise.all([
            queryClient.invalidateQueries(trpc.development.overview.pathFilter()),
            queryClient.invalidateQueries(g.list.pathFilter()),
            queryClient.invalidateQueries(g.forTask.pathFilter()),
          ]),
      }),
    ),
    linkTask: useMutation(g.linkTask.mutationOptions(options)),
    unlinkTask: useMutation(g.unlinkTask.mutationOptions(options)),
    createTask: useMutation(g.createTask.mutationOptions(options)),
    linkProject: useMutation(g.linkProject.mutationOptions(options)),
    unlinkProject: useMutation(g.unlinkProject.mutationOptions(options)),
    createPlan: useMutation(p.create.mutationOptions(options)),
    updatePlan: useMutation(p.update.mutationOptions(options)),
    setPlanStatus: useMutation(p.setStatus.mutationOptions(options)),
    movePlan: useMutation(p.move.mutationOptions(options)),
    deletePlan: useMutation(p.delete.mutationOptions(options)),
    linkPlanTask: useMutation(p.linkTask.mutationOptions(options)),
    unlinkPlanTask: useMutation(p.unlinkTask.mutationOptions(options)),
    createPlanTask: useMutation(p.createTask.mutationOptions(options)),
  };
}

export function useGoalStatusLabel() {
  const t = useTranslations("development.goals.status");
  return useCallback((status: GoalStatus) => t(status), [t]);
}
