"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useAreaLabel } from "@/modules/areas/ui";
import { cn } from "@/shared/lib/cn";
import { MenuCheckbox, Popover } from "@/shared/ui/popover";

import { statusCategories, type Task, type TaskStatus } from "../domain";
import { useStatusChange } from "./complete-dialog";
import { usePriorityLabel, useStatusLabel } from "./labels";
import { useProjectOptions } from "./project-chip";
import type { TaskLookups } from "./task-row";
import type { useTaskActions } from "./use-task-data";

const field =
  "h-7 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-muted-foreground transition-colors hover:border-input hover:bg-surface focus-visible:border-ring focus-visible:bg-surface focus-visible:outline-none";

const OPEN_PROJECTS = new Set(["planned", "active", "paused"]);

/**
 * Notion-style property strip under a task row: status, priority, area, project, start and due
 * date, each edited in place. Every change goes through the normal task API (optimistic, rolled
 * back with a message if the server refuses); moving into a completed status asks for the date.
 */
export function TaskQuickFields({
  task,
  lookups,
  actions,
  showProject,
}: {
  task: Task;
  lookups: TaskLookups;
  actions: ReturnType<typeof useTaskActions>;
  showProject: boolean;
}) {
  const t = useTranslations("tasks");
  const statusLabel = useStatusLabel();
  const priorityLabel = usePriorityLabel();
  const areaLabel = useAreaLabel();
  const { data: projects = [] } = useProjectOptions();
  const statuses = [...lookups.statuses.values()];
  const statusChange = useStatusChange(actions, statuses);
  const update = (patch: Parameters<typeof actions.update.mutate>[0]["patch"]) =>
    actions.update.mutate({ id: task.id, patch });
  const isSubtask = task.parentTaskId !== null;
  const projectChoices = projects.filter(
    (p) => OPEN_PROJECTS.has(p.status) || p.id === task.projectId,
  );

  const status = lookups.statuses.get(task.statusId);
  const area = task.areaId ? lookups.areas.get(task.areaId) : undefined;
  const project = projects.find((p) => p.id === task.projectId);
  const name = (field: string, value: string) =>
    t("quickEdit.value", { title: task.title, field, value });

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5"
      data-testid="task-quick-fields"
      role="group"
      aria-label={t("quickEdit.label", { title: task.title })}
    >
      <QuickMenu
        field="status"
        label={t("fields.status")}
        value={status ? statusLabel(status) : ""}
        accessibleName={name(t("fields.status"), status ? statusLabel(status) : "")}
        options={statusCategories.flatMap((category) =>
          statuses
            .filter((s: TaskStatus) => s.category === category)
            .map((s) => ({
              id: s.id,
              label: statusLabel(s),
              group: t(`statusCategory.${category}`),
            })),
        )}
        current={task.statusId}
        onSelect={(statusId) => statusChange.change(task, statusId)}
      />
      <QuickMenu
        field="priority"
        label={t("fields.priority")}
        value={task.priority ? priorityLabel(task.priority) : t("quickEdit.noPriority")}
        accessibleName={name(
          t("fields.priority"),
          task.priority ? priorityLabel(task.priority) : t("quickEdit.noPriority"),
        )}
        options={[4, 3, 2, 1, 0].map((p) => ({
          id: String(p),
          label: p === 0 ? t("quickEdit.noPriority") : priorityLabel(p),
        }))}
        current={String(task.priority)}
        onSelect={(value) => update({ priority: Number(value) })}
      />
      <QuickMenu
        field="area"
        label={t("fields.area")}
        value={area ? areaLabel(area) : t("quickEdit.noArea")}
        accessibleName={name(t("fields.area"), area ? areaLabel(area) : t("quickEdit.noArea"))}
        options={[
          { id: "", label: t("quickEdit.noArea") },
          ...[...lookups.areas.values()].map((a) => ({ id: a.id, label: areaLabel(a) })),
        ]}
        current={task.areaId ?? ""}
        onSelect={(value) => update({ areaId: value || null })}
      />
      {showProject && !isSubtask ? (
        <QuickMenu
          field="project"
          label={t("fields.project")}
          value={project ? project.name : t("quickEdit.noProject")}
          accessibleName={name(
            t("fields.project"),
            project ? project.name : t("quickEdit.noProject"),
          )}
          options={[
            { id: "", label: t("quickEdit.noProject") },
            ...projectChoices.map((p) => ({ id: p.id, label: p.name })),
          ]}
          current={task.projectId ?? ""}
          onSelect={(value) => update({ projectId: value || null })}
        />
      ) : null}

      <Quick label={t("fields.startDate")}>
        <QuickDate
          label={t("quickEdit.field", { field: t("fields.startDate"), title: task.title })}
          empty={t("quickEdit.noDate")}
          value={task.startDate}
          max={task.dueDate}
          onChange={(value) => update({ startDate: value })}
          quick="start"
        />
      </Quick>

      <Quick label={t("fields.dueDate")}>
        <QuickDate
          label={t("quickEdit.field", { field: t("fields.dueDate"), title: task.title })}
          empty={t("quickEdit.noDate")}
          value={task.dueDate}
          min={task.startDate}
          onChange={(value) => update({ dueDate: value })}
          quick="due"
        />
      </Quick>
      {statusChange.dialog}
    </div>
  );
}

/**
 * One property as a compact button showing its value; the choices exist only while its menu is
 * open (so a long list of tasks does not carry every project and area in each row).
 */
function QuickMenu({
  field: fieldId,
  label,
  value,
  accessibleName,
  options,
  current,
  onSelect,
}: {
  field: string;
  label: string;
  value: string;
  accessibleName: string;
  options: { id: string; label: string; group?: string }[];
  current: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Popover
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-haspopup="menu"
          aria-label={accessibleName}
          title={accessibleName}
          data-quick={fieldId}
          className={cn(field, "inline-flex max-w-40 items-center gap-1")}
        >
          <span aria-hidden className="text-[11px] text-muted-foreground/70">
            {label}
          </span>
          <span className="truncate text-foreground/80">{value}</span>
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label={label} className="flex max-h-72 w-52 flex-col overflow-y-auto">
          {options.map((option, i) => (
            <div key={option.id || "none"}>
              {option.group && option.group !== options[i - 1]?.group ? (
                <p
                  role="presentation"
                  className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  {option.group}
                </p>
              ) : null}
              <MenuCheckbox
                type="radio"
                checked={option.id === current}
                onChange={() => {
                  close();
                  if (option.id !== current) onSelect(option.id);
                }}
              >
                <span className="truncate">{option.label}</span>
              </MenuCheckbox>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * A native date field (picker, typing and clearing as the browser provides). Empty, it shows a
 * quiet 「未设置」 instead of the browser's mm/dd/yyyy mask until it is focused.
 */
function QuickDate({
  label,
  empty,
  value,
  min,
  max,
  onChange,
  quick,
}: {
  label: string;
  empty: string;
  value: string | null;
  min?: string | null;
  max?: string | null;
  onChange: (value: string | null) => void;
  quick: string;
}) {
  return (
    <span className="relative inline-flex items-center">
      <input
        type="date"
        aria-label={label}
        className={cn(field, "peer quick-date w-[8.5rem]")}
        data-empty={!value}
        value={value ?? ""}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(e) => onChange(e.target.value || null)}
        data-quick={quick}
      />
      {value ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1.5 text-xs text-muted-foreground/60 peer-focus:hidden"
        >
          {empty}
        </span>
      )}
    </span>
  );
}

/** A labelled cell (the visible label is short and muted, like a property name). */
function Quick({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span aria-hidden className="text-[11px] text-muted-foreground/70">
        {label}
      </span>
      {children}
    </span>
  );
}
