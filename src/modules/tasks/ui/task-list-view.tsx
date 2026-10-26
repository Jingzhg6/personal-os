"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Keyboard, ListTodo, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { useAreas } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";

import {
  countActiveFilters,
  deadlineGroup,
  deadlineGroups,
  isClosedCategory,
  type ScopedViewKey,
  type Task,
  type TaskListQuery,
} from "../domain";
import { FilterBar } from "./filter-bar";
import { useToday } from "./labels";
import { useMilestoneLookup } from "./project-chip";
import { QuickAdd } from "./quick-add";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { SortableList } from "./sortable-list";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskRow, type TaskLookups } from "./task-row";
import { useListKeyboard } from "./use-list-keyboard";
import { useListUrlState } from "./use-list-state";
import { useTaskPanel } from "./use-task-panel";
import { useStatuses, useTags, useTaskActions, useTaskList } from "./use-task-data";
import { ViewScopeBar, ViewScopeEditor } from "./view-scope";

/**
 * Which slice of the one tasks table this screen shows:
 *  - all:       every top-level task
 *  - scoped:    tasks in the areas assigned to a navigation view (工作, 业务, 行政任务, 个人生活)
 *  - deadlines: open tasks and subtasks with a due date, grouped by when they are due
 *  - project:   the top-level tasks of one project (embedded in the project page)
 */
export type TaskListVariant =
  | { kind: "all" }
  | { kind: "scoped"; view: ScopedViewKey }
  | { kind: "deadlines" }
  | { kind: "project"; projectId: string };

const OPEN_CATEGORIES = ["backlog", "unstarted", "started"] as const;

export function TaskListView({
  title,
  variant = { kind: "all" },
  embedded = false,
}: {
  title: string;
  variant?: TaskListVariant;
  /** Inside another page (e.g. a project): no page header, the host page provides it. */
  embedded?: boolean;
}) {
  const t = useTranslations("tasks");
  const trpc = useTRPC();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const today = useToday();
  const [state, setState] = useListUrlState();
  const listRef = useRef<HTMLDivElement>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const scopeQuery = useQuery({
    ...trpc.tasks.views.get.queryOptions({
      key: variant.kind === "scoped" ? variant.view : "work",
    }),
    enabled: variant.kind === "scoped",
  });
  const scope = variant.kind === "scoped" ? scopeQuery.data : undefined;
  const scopeEmpty = variant.kind === "scoped" && scope !== undefined && scope.areaIds.length === 0;

  const searching = state.search.trim() !== "";
  const query: TaskListQuery = useMemo(() => {
    const base = { today, search: searching ? state.search.trim() : undefined };
    if (variant.kind === "deadlines") {
      return {
        ...base,
        sort: "due",
        includeSubtasks: true,
        filter: {
          ...state.filter,
          due: "any",
          categories: state.filter.categories ?? [...OPEN_CATEGORIES],
        },
      };
    }
    return {
      ...base,
      sort: state.sort,
      includeSubtasks: false,
      filter:
        variant.kind === "scoped"
          ? { ...state.filter, areaIds: scope?.areaIds ?? [], noArea: undefined }
          : variant.kind === "project"
            ? { ...state.filter, projectIds: [variant.projectId], noProject: undefined }
            : state.filter,
    };
  }, [today, searching, state, variant, scope?.areaIds]);

  const listEnabled = variant.kind !== "scoped" || (scope !== undefined && !scopeEmpty);
  const { data: tasks = [], isPending } = useTaskList(query, { enabled: listEnabled });
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const actions = useTaskActions();
  const milestones = useMilestoneLookup(variant.kind === "project" ? variant.projectId : undefined);

  const lookups: TaskLookups = useMemo(
    () => ({
      statuses: new Map(statuses.map((s) => [s.id, s])),
      areas: new Map(areas.map((a) => [a.id, a])),
      tags: new Map(tags.map((tag) => [tag.id, tag])),
      milestones,
    }),
    [statuses, areas, tags, milestones],
  );

  useListKeyboard(listRef, { onHelp: () => setHelpOpen(true) });

  const flat = searching || variant.kind === "deadlines";
  const canDrag = variant.kind !== "deadlines" && state.sort === "manual" && !searching;
  const filtered = searching || countActiveFilters(state.filter) > 0;
  const open = tasks.filter((task) => !isClosedCategory(task.statusCategory));
  const closed = tasks.filter((task) => isClosedCategory(task.statusCategory));

  const row = (task: Task, sortable?: Parameters<typeof TaskRow>[0]["sortable"]) => (
    <TaskRow
      key={task.id}
      task={task}
      lookups={lookups}
      selected={task.id === openTaskId}
      onOpen={openTask}
      actions={actions}
      sortable={sortable}
      showParent={flat}
      showProject={variant.kind !== "project"}
    />
  );

  let body: ReactNode;
  if (scopeEmpty && scope) {
    body = (
      <EmptyState
        icon={<ListTodo />}
        title={t("views.emptyScope.title")}
        description={t("views.emptyScope.description")}
      >
        <ViewScopeEditor scope={scope} prominent />
      </EmptyState>
    );
  } else if (!isPending && tasks.length === 0) {
    body = filtered ? (
      <EmptyState
        icon={<SearchX />}
        title={t("noMatches.title")}
        description={t("noMatches.description")}
      />
    ) : variant.kind === "deadlines" ? (
      <EmptyState
        icon={<ListTodo />}
        title={t("deadlines.empty.title")}
        description={t("deadlines.empty.description")}
      />
    ) : (
      <EmptyState
        icon={<ListTodo />}
        title={t("empty.title")}
        description={t("empty.description")}
      />
    );
  } else if (variant.kind === "deadlines") {
    body = deadlineGroups.map((group) => {
      const inGroup = tasks.filter(
        (task) => task.dueDate && deadlineGroup(task.dueDate, today) === group,
      );
      if (inGroup.length === 0) return null;
      return (
        <section key={group} aria-labelledby={`deadline-${group}`} className="flex flex-col gap-1">
          <h2
            id={`deadline-${group}`}
            className={cn(
              "px-3 text-xs font-medium",
              group === "overdue" ? "text-danger" : "text-muted-foreground",
            )}
          >
            {t(`deadlines.groups.${group}`)}
            <span className="ml-1.5 tabular-nums">{inGroup.length}</span>
          </h2>
          <ul className="flex flex-col gap-0.5">{inGroup.map((task) => row(task))}</ul>
        </section>
      );
    });
  } else {
    body = (
      <>
        {open.length > 0 ? (
          <section aria-labelledby="open-tasks">
            <h2 id="open-tasks" className="sr-only">
              {t("groups.open")}
            </h2>
            <SortableList
              items={open}
              enabled={canDrag}
              className="flex flex-col gap-0.5"
              label={t("groups.open")}
              handleLabel={(task) => t("drag.handle", { title: task.title })}
              onMove={(id, afterId, beforeId) => actions.move.mutate({ id, afterId, beforeId })}
              renderItem={(task, sortable) => row(task, sortable)}
            />
          </section>
        ) : null}
        {closed.length > 0 ? (
          <section aria-labelledby="closed-tasks" className="flex flex-col gap-2">
            <h2 id="closed-tasks">
              <button
                type="button"
                aria-expanded={showClosed}
                onClick={() => setShowClosed((value) => !value)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                {showClosed ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
                {showClosed ? t("hideClosed") : t("showClosed", { count: closed.length })}
              </button>
            </h2>
            {showClosed ? (
              <ul className="flex flex-col gap-0.5">{closed.map((task) => row(task))}</ul>
            ) : null}
          </section>
        ) : null}
      </>
    );
  }

  const description = isPending
    ? null
    : searching
      ? t("searchResults", { count: tasks.length })
      : t("count", { count: open.length });

  return (
    // On wide screens the list makes room for the detail panel instead of hiding under it.
    <div className={cn("transition-[padding]", openTaskId && !embedded && "lg:pr-[480px]")}>
      <div className={cn("flex flex-col gap-5", !embedded && "mx-auto max-w-4xl")}>
        {embedded ? null : (
          <PageHeader
            title={title}
            description={listEnabled ? description : null}
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setHelpOpen(true)}
                aria-label={t("shortcuts.open")}
                title={t("shortcuts.open")}
              >
                <Keyboard />
              </Button>
            }
          />
        )}

        {scope && !scopeEmpty ? <ViewScopeBar scope={scope} /> : null}

        {variant.kind !== "deadlines" && !scopeEmpty ? (
          <QuickAdd
            defaults={{
              areaId: scope?.areaIds[0] ?? null,
              projectId: variant.kind === "project" ? variant.projectId : null,
            }}
          />
        ) : null}

        {!scopeEmpty ? (
          <FilterBar
            state={state}
            onChange={setState}
            areas={areas}
            tags={tags}
            hide={{
              area: variant.kind === "scoped",
              project: variant.kind === "project",
              due: variant.kind === "deadlines",
              sort: variant.kind === "deadlines",
            }}
          />
        ) : null}

        {!canDrag && variant.kind !== "deadlines" && open.length > 1 ? (
          <p className="-mt-2 px-1 text-xs text-muted-foreground">{t("drag.hint")}</p>
        ) : null}

        <div ref={listRef} className="flex flex-col gap-5">
          {body}
        </div>

        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
        <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center [&>svg]:size-8 [&>svg]:text-muted-foreground/60">
      {icon}
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
