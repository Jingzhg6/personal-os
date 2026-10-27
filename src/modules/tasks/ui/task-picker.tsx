"use client";

import { Search } from "lucide-react";
import { useDeferredValue, useState, type ReactNode } from "react";

import type { Task } from "../domain";
import { useToday } from "./labels";
import { useTaskList } from "./use-task-data";

/**
 * Searchable list of open tasks (any level), used to pick a parent, a dependency or an action for
 * a development goal (`includeCompleted`: completed tasks too).
 */
export function TaskPicker({
  excludeIds,
  includeCompleted = false,
  searchLabel,
  resultsLabel,
  emptyLabel,
  onSelect,
  before,
}: {
  excludeIds: ReadonlySet<string | null>;
  includeCompleted?: boolean;
  searchLabel: string;
  resultsLabel: string;
  emptyLabel: string;
  onSelect: (task: Task) => void;
  /** Extra option rendered above the results (e.g. "设为顶层任务"). */
  before?: ReactNode;
}) {
  const today = useToday();
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const { data: candidates = [] } = useTaskList({
    today,
    search: deferred || undefined,
    sort: "updated",
    includeSubtasks: true,
    filter: {
      categories: includeCompleted
        ? ["backlog", "unstarted", "started", "completed"]
        : ["backlog", "unstarted", "started"],
    },
  });
  const options = candidates.filter((c) => !excludeIds.has(c.id)).slice(0, 8);

  return (
    <div className="flex w-72 flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md bg-surface-muted px-2">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <ul role="listbox" aria-label={resultsLabel} className="max-h-60 overflow-y-auto">
        {before}
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onSelect(option)}
              className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
            >
              <span className="truncate text-sm">{option.title}</span>
              {option.parentTitle ? (
                <span className="truncate text-xs text-muted-foreground">{option.parentTitle}</span>
              ) : null}
            </button>
          </li>
        ))}
        {options.length === 0 ? (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</li>
        ) : null}
      </ul>
    </div>
  );
}
