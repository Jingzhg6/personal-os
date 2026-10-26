import { z } from "zod";

import { statusCategories } from "./statuses";

/*
 * How a task list is filtered, searched and sorted. The same shape is used by the API and
 * mirrored in the URL (`?q=…&area=…&sort=…`) so every filtered view is shareable and survives
 * reloads. It describes *views* of the one tasks table; nothing is copied per view.
 */

export const taskSorts = ["manual", "due", "priority", "created", "updated"] as const;
export type TaskSort = (typeof taskSorts)[number];

export const dueFilters = ["overdue", "today", "week", "none", "any"] as const;
export type DueFilter = (typeof dueFilters)[number];

export const flagFilters = ["yes", "no", "unset"] as const;
export type FlagFilter = (typeof flagFilters)[number];

export const taskFilter = z.object({
  categories: z.array(z.enum(statusCategories)).max(statusCategories.length).optional(),
  priorities: z.array(z.number().int().min(0).max(4)).max(5).optional(),
  /** Tasks in any of these areas… */
  areaIds: z.array(z.uuid()).max(100).optional(),
  /** …or without an area. */
  noArea: z.boolean().optional(),
  /** Tasks in any of these projects… */
  projectIds: z.array(z.uuid()).max(100).optional(),
  /** …or in no project. */
  noProject: z.boolean().optional(),
  milestoneIds: z.array(z.uuid()).max(100).optional(),
  /** Tasks having any of these tags. */
  tagIds: z.array(z.uuid()).max(100).optional(),
  urgent: z.enum(flagFilters).optional(),
  important: z.enum(flagFilters).optional(),
  due: z.enum(dueFilters).optional(),
});
export type TaskFilter = z.infer<typeof taskFilter>;

export const taskListQuery = z.object({
  search: z.string().trim().max(200).optional(),
  filter: taskFilter.default({}),
  sort: z.enum(taskSorts).default("manual"),
  /** Include subtasks as flat results (always on while searching). */
  includeSubtasks: z.boolean().default(false),
  /** The user's today ("YYYY-MM-DD"), for due-date filters. */
  today: z.iso.date(),
});
export type TaskListQuery = z.infer<typeof taskListQuery>;

/** Number of active filter dimensions (for the "清除筛选" affordance). */
export function countActiveFilters(filter: TaskFilter): number {
  return [
    filter.categories?.length,
    filter.priorities?.length,
    filter.areaIds?.length || filter.noArea,
    filter.projectIds?.length || filter.noProject,
    filter.milestoneIds?.length,
    filter.tagIds?.length,
    filter.urgent,
    filter.important,
    filter.due,
  ].filter(Boolean).length;
}

/* ---------------------------------------------------------------- URL state */

export interface ListUrlState {
  search: string;
  filter: TaskFilter;
  sort: TaskSort;
}

const NO_AREA_TOKEN = "none";
const uuid = z.uuid();

const csv = (value: string | null) => (value ? value.split(",").filter(Boolean) : []);
const nonEmpty = <T>(values: T[]) => (values.length > 0 ? values : undefined);
const oneOf = <T extends string>(options: readonly T[], value: string | null) =>
  options.find((option) => option === value);

/** Reads list state from URL search params, silently dropping anything invalid. */
export function readListParams(params: URLSearchParams): ListUrlState {
  const areaTokens = csv(params.get("area"));
  const projectTokens = csv(params.get("project"));
  return {
    search: (params.get("q") ?? "").slice(0, 200),
    sort: oneOf(taskSorts, params.get("sort")) ?? "manual",
    filter: {
      categories: nonEmpty(
        csv(params.get("status")).filter((c): c is (typeof statusCategories)[number] =>
          (statusCategories as readonly string[]).includes(c),
        ),
      ),
      priorities: nonEmpty(
        csv(params.get("priority"))
          .map(Number)
          .filter((p) => Number.isInteger(p) && p >= 0 && p <= 4),
      ),
      areaIds: nonEmpty(areaTokens.filter((id) => uuid.safeParse(id).success)),
      noArea: areaTokens.includes(NO_AREA_TOKEN) || undefined,
      projectIds: nonEmpty(projectTokens.filter((id) => uuid.safeParse(id).success)),
      noProject: projectTokens.includes(NO_AREA_TOKEN) || undefined,
      milestoneIds: nonEmpty(
        csv(params.get("milestone")).filter((id) => uuid.safeParse(id).success),
      ),
      tagIds: nonEmpty(csv(params.get("tag")).filter((id) => uuid.safeParse(id).success)),
      urgent: oneOf(flagFilters, params.get("urgent")),
      important: oneOf(flagFilters, params.get("important")),
      due: oneOf(dueFilters, params.get("due")),
    },
  };
}

/** Writes list state to URL search params, keeping unrelated params (e.g. `task`). */
export function writeListParams(state: ListUrlState, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  const set = (key: string, value: string | undefined) =>
    value ? params.set(key, value) : params.delete(key);
  const { filter } = state;
  set("q", state.search.trim() || undefined);
  set("sort", state.sort === "manual" ? undefined : state.sort);
  set("status", filter.categories?.join(","));
  set("priority", filter.priorities?.join(","));
  set(
    "area",
    [...(filter.areaIds ?? []), ...(filter.noArea ? [NO_AREA_TOKEN] : [])].join(",") || undefined,
  );
  set(
    "project",
    [...(filter.projectIds ?? []), ...(filter.noProject ? [NO_AREA_TOKEN] : [])].join(",") ||
      undefined,
  );
  set("milestone", filter.milestoneIds?.join(","));
  set("tag", filter.tagIds?.join(","));
  set("urgent", filter.urgent);
  set("important", filter.important);
  set("due", filter.due);
  return params;
}
