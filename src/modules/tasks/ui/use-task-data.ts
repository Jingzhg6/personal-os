"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { StatusCategory, Task, TaskDetail, UpdateTaskInput } from "../domain";

/*
 * Client data access for tasks. All views share one TanStack Query cache keyed by tRPC
 * procedure, so a change made anywhere (list, detail panel, later matrix/Kanban) refreshes
 * every view of the same task.
 */

export function useTaskList() {
  const trpc = useTRPC();
  return useQuery(trpc.tasks.list.queryOptions());
}

export function useTaskDetail(id: string | null) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.tasks.byId.queryOptions({ id: id ?? "" }),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useStatuses() {
  const trpc = useTRPC();
  return useQuery(trpc.tasks.statuses.list.queryOptions());
}

export function useTags() {
  const trpc = useTRPC();
  return useQuery(trpc.tasks.tags.list.queryOptions());
}

type Patch = UpdateTaskInput["patch"];

function applyPatch<T extends Task>(task: T, id: string, patch: Patch): T {
  return task.id === id ? { ...task, ...patch } : task;
}

export function useTaskActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();

  const listKey = trpc.tasks.list.queryKey();
  const detailKeys = () =>
    queryClient.getQueriesData<TaskDetail>({ queryKey: trpc.tasks.byId.pathKey() });

  const invalidate = () => queryClient.invalidateQueries(trpc.tasks.pathFilter());
  const onError = (error: unknown) => toast.show(errorMessage(error), "error");

  /** Optimistically rewrites a task in the list and in any open detail (including as a subtask). */
  async function optimistic(id: string, change: (task: Task) => Task) {
    await queryClient.cancelQueries(trpc.tasks.pathFilter());
    const previousList = queryClient.getQueryData<Task[]>(listKey);
    const previousDetails = detailKeys();
    queryClient.setQueryData<Task[]>(listKey, (tasks) =>
      tasks?.map((t) => (t.id === id ? change(t) : t)),
    );
    for (const [key, detail] of previousDetails) {
      if (!detail) continue;
      queryClient.setQueryData<TaskDetail>(key, {
        ...(detail.id === id ? (change(detail) as TaskDetail) : detail),
        subtasks: detail.subtasks.map((s) => (s.id === id ? change(s) : s)),
      });
    }
    return () => {
      queryClient.setQueryData(listKey, previousList);
      for (const [key, detail] of previousDetails) queryClient.setQueryData(key, detail);
    };
  }

  const withCategory = (category: StatusCategory) => (task: Task) => ({
    ...task,
    statusCategory: category,
    completedAt: category === "completed" ? new Date() : null,
  });

  const mutationOptions = { onSettled: invalidate };

  return {
    create: useMutation(trpc.tasks.create.mutationOptions({ ...mutationOptions, onError })),
    update: useMutation(
      trpc.tasks.update.mutationOptions({
        ...mutationOptions,
        onMutate: ({ id, patch }) => optimistic(id, (task) => applyPatch(task, id, patch)),
        onError: (error, _input, rollback) => {
          rollback?.();
          onError(error);
        },
      }),
    ),
    setStatus: useMutation(trpc.tasks.setStatus.mutationOptions({ ...mutationOptions, onError })),
    complete: useMutation(
      trpc.tasks.complete.mutationOptions({
        ...mutationOptions,
        onMutate: ({ id }) => optimistic(id, withCategory("completed")),
        onError: (error, _input, rollback) => {
          rollback?.();
          onError(error);
        },
      }),
    ),
    reopen: useMutation(
      trpc.tasks.reopen.mutationOptions({
        ...mutationOptions,
        onMutate: ({ id }) => optimistic(id, withCategory("unstarted")),
        onError: (error, _input, rollback) => {
          rollback?.();
          onError(error);
        },
      }),
    ),
    remove: useMutation(trpc.tasks.delete.mutationOptions({ ...mutationOptions, onError })),
    createTag: useMutation(
      trpc.tasks.tags.create.mutationOptions({ onSettled: invalidate, onError }),
    ),
  };
}
