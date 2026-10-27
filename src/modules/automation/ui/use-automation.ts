"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToday } from "@/modules/tasks/ui";
import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

/* Executions happen after other modules' changes: always shown fresh. */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useRules() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.automation.rules.list.queryOptions(), ...alwaysFresh });
}

export function useRule(id: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.automation.rules.byId.queryOptions({ id }),
    ...alwaysFresh,
    retry: false,
  });
}

export function useExecutions(id: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.automation.executions.list.queryOptions({ id, limit: 30 }),
    ...alwaysFresh,
  });
}

export function useHealth() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.automation.health.queryOptions(), ...alwaysFresh });
}

export function useNotifications() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.automation.notifications.list.queryOptions(), ...alwaysFresh });
}

/** Names for ids used in rules (areas, projects, statuses), from their own modules' APIs. */
export function useLookups() {
  const trpc = useTRPC();
  const today = useToday();
  const areas = useQuery(trpc.areas.list.queryOptions());
  const projects = useQuery(trpc.projects.list.queryOptions({ today }));
  const statuses = useQuery(trpc.tasks.statuses.list.queryOptions());
  const settings = useQuery(trpc.settings.get.queryOptions());
  return {
    areas: areas.data ?? [],
    projects: projects.data ?? [],
    statuses: statuses.data ?? [],
    timeZone: settings.data?.timeZone ?? null,
  };
}

/**
 * Automation mutations. Rules can create tasks and notifications as a side effect of any
 * mutation, so every query is refreshed afterwards.
 */
export function useAutomationActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () => queryClient.invalidateQueries(),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  const r = trpc.automation.rules;
  return {
    create: useMutation(r.create.mutationOptions(options)),
    update: useMutation(r.update.mutationOptions(options)),
    setEnabled: useMutation(r.setEnabled.mutationOptions(options)),
    setArchived: useMutation(r.setArchived.mutationOptions(options)),
    remove: useMutation(r.delete.mutationOptions(options)),
    retry: useMutation(trpc.automation.executions.retry.mutationOptions(options)),
    runDue: useMutation(trpc.automation.runDue.mutationOptions(options)),
    markRead: useMutation(trpc.automation.notifications.markRead.mutationOptions(options)),
  };
}
