"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type {
  StatusCategory,
  Task,
  TaskDependency,
  TaskDetail,
  TaskListQuery,
  TaskStatus,
  UpdateTaskInput,
} from "../domain";

/*
 * Client data access for tasks. All views share one TanStack Query cache keyed by tRPC
 * procedure + input, so a change made anywhere (list, view, search, detail panel, later
 * matrix/Kanban) refreshes every view of the same task.
 */

interface Timeline {
  tasks: Task[];
  dependencies: TaskDependency[];
}

export function useTaskList(query: TaskListQuery, options: { enabled?: boolean } = {}) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.tasks.list.queryOptions(query),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Tasks of a list query plus the dependencies between them (Gantt chart). */
export function useTimeline(query: TaskListQuery) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.tasks.timeline.queryOptions(query),
    placeholderData: keepPreviousData,
  });
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

export function useTrash() {
  const trpc = useTRPC();
  return useQuery(trpc.tasks.trash.list.queryOptions());
}

type Patch = UpdateTaskInput["patch"];

function applyPatch<T extends Task>(task: T, id: string, patch: Patch): T {
  return task.id === id ? { ...task, ...patch } : task;
}

/** Moves `id` between `afterId` and `beforeId` in a cached list (optimistic reorder). */
function reorder(
  tasks: Task[],
  id: string,
  afterId: string | null,
  beforeId: string | null,
): Task[] {
  const moving = tasks.find((t) => t.id === id);
  if (!moving) return tasks;
  const rest = tasks.filter((t) => t.id !== id);
  const index = afterId
    ? rest.findIndex((t) => t.id === afterId) + 1
    : beforeId
      ? rest.findIndex((t) => t.id === beforeId)
      : rest.length;
  return [...rest.slice(0, index), moving, ...rest.slice(index)];
}

export function useTaskActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();

  const listQueries = () =>
    queryClient.getQueriesData<Task[]>({ queryKey: trpc.tasks.list.pathKey() });
  const detailQueries = () =>
    queryClient.getQueriesData<TaskDetail>({ queryKey: trpc.tasks.byId.pathKey() });
  const timelineQueries = () =>
    queryClient.getQueriesData<Timeline>({ queryKey: trpc.tasks.timeline.pathKey() });

  // Project and development-goal progress are computed from tasks, so task changes refresh
  // those queries too.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.tasks.pathFilter()),
      queryClient.invalidateQueries(trpc.projects.pathFilter()),
      queryClient.invalidateQueries(trpc.development.pathFilter()),
    ]);
  const onError = (error: unknown) => toast.show(errorMessage(error), "error");

  /** Optimistically rewrites cached lists and details; returns a rollback function. */
  async function optimistic(
    changeList: (tasks: Task[]) => Task[],
    changeDetail: (detail: TaskDetail) => TaskDetail,
  ) {
    await queryClient.cancelQueries(trpc.tasks.pathFilter());
    const lists = listQueries();
    const details = detailQueries();
    const timelines = timelineQueries();
    for (const [key, tasks] of lists) if (tasks) queryClient.setQueryData(key, changeList(tasks));
    for (const [key, detail] of details)
      if (detail) queryClient.setQueryData(key, changeDetail(detail));
    // The Gantt chart reads the same tasks, so a moved bar does not jump back while saving.
    for (const [key, timeline] of timelines)
      if (timeline)
        queryClient.setQueryData(key, { ...timeline, tasks: changeList(timeline.tasks) });
    return () => {
      for (const [key, tasks] of lists) queryClient.setQueryData(key, tasks);
      for (const [key, detail] of details) queryClient.setQueryData(key, detail);
      for (const [key, timeline] of timelines) queryClient.setQueryData(key, timeline);
    };
  }

  const forTask = (id: string, change: (task: Task) => Task) => {
    const apply = <T extends Task>(t: T): T => (t.id === id ? (change(t) as T) : t);
    return optimistic(
      (tasks) => tasks.map(apply),
      (detail) => ({ ...apply(detail), subtasks: detail.subtasks.map(apply) }),
    );
  };

  const withCategory = (category: StatusCategory) => (task: Task) => ({
    ...task,
    statusCategory: category,
    completedAt: category === "completed" ? new Date() : null,
  });

  const rollbackOnError = {
    onError: (error: unknown, _input: unknown, rollback: (() => void) | undefined) => {
      rollback?.();
      onError(error);
    },
    onSettled: invalidate,
  };

  return {
    create: useMutation(trpc.tasks.create.mutationOptions({ onSettled: invalidate, onError })),
    update: useMutation(
      trpc.tasks.update.mutationOptions({
        ...rollbackOnError,
        onMutate: ({ id, patch }) => forTask(id, (task) => applyPatch(task, id, patch)),
      }),
    ),
    setStatus: useMutation(
      trpc.tasks.setStatus.mutationOptions({
        ...rollbackOnError,
        onMutate: ({ id, statusId }) => {
          const status = queryClient
            .getQueryData<TaskStatus[]>(trpc.tasks.statuses.list.queryKey())
            ?.find((s) => s.id === statusId);
          return forTask(id, (task) =>
            status ? { ...withCategory(status.category)(task), statusId } : { ...task, statusId },
          );
        },
      }),
    ),
    complete: useMutation(
      trpc.tasks.complete.mutationOptions({
        ...rollbackOnError,
        onMutate: ({ id }) => forTask(id, withCategory("completed")),
      }),
    ),
    reopen: useMutation(
      trpc.tasks.reopen.mutationOptions({
        ...rollbackOnError,
        onMutate: ({ id }) => forTask(id, withCategory("unstarted")),
      }),
    ),
    move: useMutation(
      trpc.tasks.move.mutationOptions({
        ...rollbackOnError,
        onMutate: ({ id, afterId, beforeId }) =>
          optimistic(
            (tasks) => reorder(tasks, id, afterId, beforeId),
            (detail) => ({ ...detail, subtasks: reorder(detail.subtasks, id, afterId, beforeId) }),
          ),
      }),
    ),
    setParent: useMutation(
      trpc.tasks.setParent.mutationOptions({ onSettled: invalidate, onError }),
    ),
    remove: useMutation(trpc.tasks.delete.mutationOptions({ onSettled: invalidate, onError })),
    restore: useMutation(
      trpc.tasks.trash.restore.mutationOptions({ onSettled: invalidate, onError }),
    ),
    purge: useMutation(trpc.tasks.trash.purge.mutationOptions({ onSettled: invalidate, onError })),
    emptyTrash: useMutation(
      trpc.tasks.trash.empty.mutationOptions({ onSettled: invalidate, onError }),
    ),
    addDependency: useMutation(
      trpc.tasks.dependencies.add.mutationOptions({ onSettled: invalidate, onError }),
    ),
    removeDependency: useMutation(
      trpc.tasks.dependencies.remove.mutationOptions({ onSettled: invalidate, onError }),
    ),
    createTag: useMutation(
      trpc.tasks.tags.create.mutationOptions({ onSettled: invalidate, onError }),
    ),
  };
}

/** Exposed for tests. */
export const __test = { reorder };
