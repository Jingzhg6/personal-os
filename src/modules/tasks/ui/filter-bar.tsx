"use client";

import { ArrowUpDown, ChevronDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAreaLabel } from "@/modules/areas/ui";
import type { Area } from "@/modules/areas/domain";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ColorDot } from "@/shared/ui/color";
import { MenuCheckbox, Popover } from "@/shared/ui/popover";
import { Select } from "@/shared/ui/select";

import {
  countActiveFilters,
  dueFilters,
  flagFilters,
  priorities,
  statusCategories,
  taskSorts,
  type FlagFilter,
  type ListUrlState,
  type Tag,
  type TaskFilter,
} from "../domain";
import { useProjectOptions } from "./project-chip";
import type { ListStateUpdate } from "./use-list-state";

export const SEARCH_INPUT_ID = "task-search";

export interface FilterBarProps {
  state: ListUrlState;
  onChange: (update: ListStateUpdate) => void;
  areas: Area[];
  tags: Tag[];
  /** Controls fixed by the current view are hidden. */
  hide?: { area?: boolean; due?: boolean; sort?: boolean; project?: boolean };
}

function toggle<T>(values: T[] | undefined, value: T): T[] | undefined {
  const next = values?.includes(value)
    ? values.filter((v) => v !== value)
    : [...(values ?? []), value];
  return next.length > 0 ? next : undefined;
}

export function FilterBar({ state, onChange, areas, tags, hide = {} }: FilterBarProps) {
  const t = useTranslations("tasks");
  const areaLabel = useAreaLabel();
  const { data: projects = [] } = useProjectOptions();
  const [searchVersion, setSearchVersion] = useState(0);
  const { filter } = state;
  /** Applies a change computed from the latest filter (safe for rapid successive clicks). */
  const setFilter = (change: (current: TaskFilter) => Partial<TaskFilter>) =>
    onChange((previous) => ({ filter: { ...previous.filter, ...change(previous.filter) } }));
  const active = countActiveFilters(filter) > 0 || state.search.trim() !== "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          key={searchVersion}
          initial={state.search}
          onChange={(search) => onChange({ search })}
        />
        {!hide.sort ? (
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />
            <Select
              aria-label={t("sort.label")}
              value={state.sort}
              onChange={(event) => onChange({ sort: event.target.value as ListUrlState["sort"] })}
              className="w-36"
            >
              {taskSorts.map((sort) => (
                <option key={sort} value={sort}>
                  {t(`sort.${sort}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={t("filters.label")}
      >
        <FilterMenu label={t("filters.status")} count={filter.categories?.length ?? 0}>
          {statusCategories.map((category) => (
            <MenuCheckbox
              key={category}
              checked={filter.categories?.includes(category) ?? false}
              onChange={() => setFilter((f) => ({ categories: toggle(f.categories, category) }))}
            >
              {t(`statusCategory.${category}`)}
            </MenuCheckbox>
          ))}
        </FilterMenu>

        <FilterMenu label={t("filters.priority")} count={filter.priorities?.length ?? 0}>
          {[...priorities.keys()].reverse().map((value) => (
            <MenuCheckbox
              key={value}
              checked={filter.priorities?.includes(value) ?? false}
              onChange={() => setFilter((f) => ({ priorities: toggle(f.priorities, value) }))}
            >
              {t(`priority.${priorities[value]!}`)}
            </MenuCheckbox>
          ))}
        </FilterMenu>

        {!hide.project ? (
          <FilterMenu
            label={t("filters.project")}
            count={(filter.projectIds?.length ?? 0) + (filter.noProject ? 1 : 0)}
          >
            {projects.map((project) => (
              <MenuCheckbox
                key={project.id}
                checked={filter.projectIds?.includes(project.id) ?? false}
                onChange={() =>
                  setFilter((f) => ({ projectIds: toggle(f.projectIds, project.id) }))
                }
              >
                <ColorDot color={project.color} />
                <span className="truncate">{project.name}</span>
              </MenuCheckbox>
            ))}
            <MenuCheckbox
              checked={filter.noProject ?? false}
              onChange={() => setFilter((f) => ({ noProject: f.noProject ? undefined : true }))}
            >
              {t("filters.noProject")}
            </MenuCheckbox>
          </FilterMenu>
        ) : null}

        {!hide.area ? (
          <FilterMenu
            label={t("filters.area")}
            count={(filter.areaIds?.length ?? 0) + (filter.noArea ? 1 : 0)}
          >
            {areas.map((area) => (
              <MenuCheckbox
                key={area.id}
                checked={filter.areaIds?.includes(area.id) ?? false}
                onChange={() => setFilter((f) => ({ areaIds: toggle(f.areaIds, area.id) }))}
              >
                <ColorDot color={area.color} />
                <span className="truncate">{areaLabel(area)}</span>
              </MenuCheckbox>
            ))}
            <MenuCheckbox
              checked={filter.noArea ?? false}
              onChange={() => setFilter((f) => ({ noArea: f.noArea ? undefined : true }))}
            >
              {t("filters.noArea")}
            </MenuCheckbox>
          </FilterMenu>
        ) : null}

        <FilterMenu label={t("filters.tag")} count={filter.tagIds?.length ?? 0}>
          {tags.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("filters.noTags")}</p>
          ) : null}
          {tags.map((tag) => (
            <MenuCheckbox
              key={tag.id}
              checked={filter.tagIds?.includes(tag.id) ?? false}
              onChange={() => setFilter((f) => ({ tagIds: toggle(f.tagIds, tag.id) }))}
            >
              <ColorDot color={tag.color} />
              <span className="truncate">{tag.name}</span>
            </MenuCheckbox>
          ))}
        </FilterMenu>

        <FlagMenu flag="urgent" filter={filter} onChange={setFilter} />
        <FlagMenu flag="important" filter={filter} onChange={setFilter} />

        {!hide.due ? (
          <FilterMenu label={t("filters.due")} count={filter.due ? 1 : 0}>
            {dueFilters.map((value) => (
              <MenuCheckbox
                key={value}
                type="radio"
                checked={filter.due === value}
                onChange={() => setFilter((f) => ({ due: f.due === value ? undefined : value }))}
              >
                {t(`filters.dueOptions.${value}`)}
              </MenuCheckbox>
            ))}
          </FilterMenu>
        ) : null}

        {active ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchVersion((v) => v + 1);
              onChange({ search: "", filter: {} });
            }}
          >
            <X />
            {t("filters.clear")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function FlagMenu({
  flag,
  filter,
  onChange,
}: {
  flag: "urgent" | "important";
  filter: TaskFilter;
  onChange: (change: (current: TaskFilter) => Partial<TaskFilter>) => void;
}) {
  const t = useTranslations("tasks.filters");
  return (
    <FilterMenu label={t(flag)} count={filter[flag] ? 1 : 0}>
      {flagFilters.map((value: FlagFilter) => (
        <MenuCheckbox
          key={value}
          type="radio"
          checked={filter[flag] === value}
          onChange={() => onChange((f) => ({ [flag]: f[flag] === value ? undefined : value }))}
        >
          {t(`flag.${value}`)}
        </MenuCheckbox>
      ))}
    </FilterMenu>
  );
}

function FilterMenu({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations("tasks.filters");
  return (
    <Popover
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={count > 0 ? t("selected", { label, count }) : label}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs transition-colors",
            count > 0
              ? "border-primary/40 bg-accent font-medium text-accent-foreground"
              : "border-border bg-surface text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {count > 0 ? <span className="tabular-nums">{count}</span> : null}
          <ChevronDown className="size-3" aria-hidden />
        </button>
      )}
    >
      <div role="menu" aria-label={label} className="flex max-h-72 flex-col overflow-y-auto">
        {children}
      </div>
    </Popover>
  );
}

function SearchInput({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("tasks.search");
  const [value, setValue] = useState(initial);
  const onChangeRef = useRef(onChange);
  const first = useRef(true);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onChangeRef.current(value), 250);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border border-input bg-surface px-3 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        id={SEARCH_INPUT_ID}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            setValue("");
          }
        }}
        placeholder={t("placeholder")}
        aria-label={t("label")}
        maxLength={200}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label={t("clear")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
