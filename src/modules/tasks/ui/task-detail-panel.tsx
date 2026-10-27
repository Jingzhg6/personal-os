"use client";

import { useQuery } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import { ChevronLeft, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { useAreaLabel, useAreas } from "@/modules/areas/ui";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { RichTextEditor } from "@/shared/ui/rich-text-editor";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import {
  isClosedCategory,
  isRichTextEmpty,
  MAX_ESTIMATE_MINUTES,
  priorities,
  statusCategories,
  type RichTextDoc,
  type TaskDetail,
  type UpdateTaskInput,
} from "../domain";
import { useDurationLabel, useStatusLabel, useToday } from "./labels";
import { ContributionsField } from "./contributions-field";
import { DependenciesField } from "./dependencies-field";
import { ParentField } from "./parent-field";
import { useProjectOptions } from "./project-chip";
import { SortableList } from "./sortable-list";
import { StatusToggle } from "./status-toggle";
import { TagPicker } from "./tag-picker";
import { useStatuses, useTags, useTaskActions, useTaskDetail } from "./use-task-data";

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}

/**
 * Detail view of a single task. View-agnostic: any screen (list now; matrix, Kanban, Gantt
 * later) can open it for the same task record.
 */
export function TaskDetailPanel({ taskId, onClose, onOpenTask }: TaskDetailPanelProps) {
  const t = useTranslations("tasks.detail");
  const { data: task, isError, isPending } = useTaskDetail(taskId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label={t("label")}
      className="fixed inset-0 z-40 flex flex-col bg-surface shadow-md lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[480px] lg:border-l lg:border-border"
    >
      {task ? (
        <TaskDetailContent key={task.id} task={task} onClose={onClose} onOpenTask={onOpenTask} />
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="flex h-14 items-center justify-end border-b border-border px-3">
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("close")}>
              <X />
            </Button>
          </div>
          <p className="p-6 text-sm text-muted-foreground">
            {isError ? t("notFound") : isPending ? null : t("notFound")}
          </p>
        </div>
      )}
    </aside>
  );
}

function TaskDetailContent({
  task,
  onClose,
  onOpenTask,
}: {
  task: TaskDetail;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const ta = useTranslations("areas");
  const tp = useTranslations("projects");
  const { data: projects = [] } = useProjectOptions();
  const format = useFormatter();
  const toast = useToast();
  const actions = useTaskActions();
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const statusLabel = useStatusLabel();
  const areaLabel = useAreaLabel();
  const durationLabel = useDurationLabel();
  const ids = { title: useId(), estimate: useId() };

  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(task.estimatedMinutes?.toString() ?? "");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [descriptionState, setDescriptionState] = useState<"idle" | "saving" | "saved">("idle");

  const closed = isClosedCategory(task.statusCategory);
  const status = statuses.find((s) => s.id === task.statusId);
  const update = (patch: UpdateTaskInput["patch"], options?: { onSuccess?: () => void }) =>
    actions.update.mutate({ id: task.id, patch }, options);

  function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed) return setTitle(task.title);
    if (trimmed !== task.title) update({ title: trimmed });
  }

  function saveEstimate() {
    const minutes = estimate.trim() === "" ? null : Math.round(Number(estimate));
    if (
      minutes !== null &&
      (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_ESTIMATE_MINUTES)
    ) {
      return setEstimate(task.estimatedMinutes?.toString() ?? "");
    }
    if (minutes !== task.estimatedMinutes) update({ estimatedMinutes: minutes });
  }

  function saveDescription(doc: JSONContent) {
    const description = isRichTextEmpty(doc as RichTextDoc) ? null : (doc as RichTextDoc);
    if (JSON.stringify(description) === JSON.stringify(task.description)) return;
    setDescriptionState("saving");
    update({ description }, { onSuccess: () => setDescriptionState("saved") });
  }

  function addSubtask(event: FormEvent) {
    event.preventDefault();
    const value = subtaskTitle.trim();
    if (!value) return;
    actions.create.mutate(
      { title: value, parentTaskId: task.id },
      { onSuccess: () => setSubtaskTitle("") },
    );
  }

  const flagValue = (flag: boolean | null) => (flag === null ? "" : flag ? "yes" : "no");
  const parseFlag = (value: string) => (value === "" ? null : value === "yes");

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        {task.parent ? (
          <button
            type="button"
            onClick={() => onOpenTask(task.parent!.id)}
            className="flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            title={t("detail.parent")}
          >
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{task.parent.title}</span>
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={closed ? "secondary" : "primary"}
            size="sm"
            onClick={() => (closed ? actions.reopen : actions.complete).mutate({ id: task.id })}
          >
            {closed ? t("detail.reopen") : t("detail.complete")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirmingDelete(true)}
            aria-label={t("detail.delete")}
            title={t("detail.delete")}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={t("detail.close")}
            title={t("detail.close")}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-5 py-5">
          <div className="flex items-start gap-3">
            <div className="pt-1.5">
              <StatusToggle task={task} color={status?.color} actions={actions} />
            </div>
            <label htmlFor={ids.title} className="sr-only">
              {t("fields.title")}
            </label>
            <textarea
              id={ids.title}
              value={title}
              onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              rows={1}
              maxLength={500}
              className="field-sizing-content min-h-9 w-full resize-none bg-transparent text-lg leading-snug font-semibold outline-none"
            />
          </div>

          <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
            <Property label={t("fields.parent")}>
              <ParentField task={task} onOpenTask={onOpenTask} />
            </Property>

            <Property label={t("fields.status")}>
              <Select
                aria-label={t("fields.status")}
                value={task.statusId}
                onChange={(event) =>
                  actions.setStatus.mutate({ id: task.id, statusId: event.target.value })
                }
              >
                {statusCategories.map((category) => (
                  <optgroup key={category} label={t(`statusCategory.${category}`)}>
                    {statuses
                      .filter((s) => s.category === category)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {statusLabel(s)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Property>

            <Property label={t("fields.priority")}>
              <Select
                aria-label={t("fields.priority")}
                value={task.priority}
                onChange={(event) => update({ priority: Number(event.target.value) })}
              >
                {priorities.map((id, value) => (
                  <option key={id} value={value}>
                    {t(`priority.${id}`)}
                  </option>
                ))}
              </Select>
            </Property>

            <Property label={t("fields.project")}>
              {task.parentTaskId ? (
                <span className="text-sm text-muted-foreground">
                  {t("detail.inheritedProject")}
                </span>
              ) : (
                <Select
                  aria-label={t("fields.project")}
                  value={task.projectId ?? ""}
                  onChange={(event) => update({ projectId: event.target.value || null })}
                >
                  <option value="">{tp("none")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              )}
            </Property>

            {task.projectId ? (
              <Property label={t("fields.milestone")}>
                <MilestoneSelect
                  projectId={task.projectId}
                  value={task.milestoneId}
                  onChange={(milestoneId) => update({ milestoneId })}
                />
              </Property>
            ) : null}

            <Property label={t("fields.area")}>
              <Select
                aria-label={t("fields.area")}
                value={task.areaId ?? ""}
                onChange={(event) => update({ areaId: event.target.value || null })}
              >
                <option value="">{ta("none")}</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {areaLabel(area)}
                  </option>
                ))}
              </Select>
            </Property>

            <Property label={t("fields.urgent")}>
              <Select
                aria-label={t("fields.urgent")}
                value={flagValue(task.isUrgent)}
                onChange={(event) => update({ isUrgent: parseFlag(event.target.value) })}
              >
                <option value="">{t("flags.unset")}</option>
                <option value="yes">{t("flags.urgent")}</option>
                <option value="no">{t("flags.notUrgent")}</option>
              </Select>
            </Property>

            <Property label={t("fields.important")}>
              <Select
                aria-label={t("fields.important")}
                value={flagValue(task.isImportant)}
                onChange={(event) => update({ isImportant: parseFlag(event.target.value) })}
              >
                <option value="">{t("flags.unset")}</option>
                <option value="yes">{t("flags.important")}</option>
                <option value="no">{t("flags.notImportant")}</option>
              </Select>
            </Property>

            <Property label={t("fields.startDate")}>
              <Input
                type="date"
                aria-label={t("fields.startDate")}
                value={task.startDate ?? ""}
                max={task.dueDate ?? undefined}
                onChange={(event) => update({ startDate: event.target.value || null })}
              />
            </Property>

            <Property label={t("fields.dueDate")}>
              {/* Wraps the time below the date on narrow screens instead of overflowing. */}
              <div className="flex flex-wrap gap-2">
                <Input
                  type="date"
                  className="min-w-36 flex-1"
                  aria-label={t("fields.dueDate")}
                  value={task.dueDate ?? ""}
                  min={task.startDate ?? undefined}
                  onChange={(event) =>
                    update(
                      event.target.value
                        ? { dueDate: event.target.value }
                        : { dueDate: null, dueTime: null },
                    )
                  }
                />
                <Input
                  type="time"
                  aria-label={t("fields.dueTime")}
                  value={task.dueTime ?? ""}
                  disabled={!task.dueDate}
                  onChange={(event) => update({ dueTime: event.target.value || null })}
                  className="w-32 shrink-0"
                />
              </div>
            </Property>

            <Property label={t("fields.estimate")} htmlFor={ids.estimate}>
              <div className="flex items-center gap-2">
                <Input
                  id={ids.estimate}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_ESTIMATE_MINUTES}
                  step={5}
                  value={estimate}
                  onChange={(event) => setEstimate(event.target.value)}
                  onBlur={saveEstimate}
                  onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                  className="w-24"
                />
                <span className="text-muted-foreground">{t("minutes")}</span>
                {task.estimatedMinutes && task.estimatedMinutes >= 60 ? (
                  <span className="text-xs text-muted-foreground">
                    {durationLabel(task.estimatedMinutes)}
                  </span>
                ) : null}
              </div>
            </Property>

            <Property label={t("fields.tags")}>
              <TagPicker
                tags={tags}
                value={task.tagIds}
                onChange={(tagIds) => update({ tagIds })}
                onCreate={(name) => actions.createTag.mutateAsync({ name })}
              />
            </Property>
          </dl>

          <ContributionsField task={task} />

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t("fields.description")}</h3>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {descriptionState === "saving"
                  ? t("detail.saving")
                  : descriptionState === "saved"
                    ? t("detail.saved")
                    : null}
              </span>
            </div>
            <RichTextEditor
              value={task.description as JSONContent | null}
              placeholder={t("detail.descriptionPlaceholder")}
              label={t("fields.description")}
              onChange={saveDescription}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              {t("fields.subtasks")}
              {task.subtaskCount > 0 ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                  {`${task.completedSubtaskCount}/${task.subtaskCount}`}
                </span>
              ) : null}
            </h3>
            <SortableList
              items={task.subtasks}
              enabled
              className="flex flex-col"
              label={t("fields.subtasks")}
              handleLabel={(subtask) => t("detail.subtaskDrag", { title: subtask.title })}
              onMove={(id, afterId, beforeId) => actions.move.mutate({ id, afterId, beforeId })}
              renderItem={(subtask, sortable) => (
                <li
                  key={subtask.id}
                  ref={sortable.ref}
                  style={sortable.style}
                  data-testid="subtask-row"
                  className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-surface-muted"
                >
                  {sortable.handle}
                  <StatusToggle
                    task={subtask}
                    color={statuses.find((s) => s.id === subtask.statusId)?.color}
                    actions={actions}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenTask(subtask.id)}
                    className={
                      isClosedCategory(subtask.statusCategory)
                        ? "flex-1 truncate text-left text-sm text-muted-foreground line-through"
                        : "flex-1 truncate text-left text-sm"
                    }
                  >
                    {subtask.title}
                  </button>
                </li>
              )}
            />
            <form onSubmit={addSubtask}>
              <Input
                value={subtaskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                placeholder={t("detail.addSubtask")}
                aria-label={t("detail.addSubtask")}
                maxLength={500}
              />
            </form>
          </section>

          <DependenciesField task={task} onOpenTask={onOpenTask} />

          <footer className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>{t("detail.created", { date: format.dateTime(task.createdAt, "long") })}</span>
            {task.completedAt ? (
              <span>
                {t("detail.completedAt", { date: format.dateTime(task.completedAt, "long") })}
              </span>
            ) : null}
          </footer>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={t("detail.deleteTitle")}
        description={t("detail.deleteBody")}
        confirmLabel={tc("delete")}
        pending={actions.remove.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() =>
          actions.remove.mutate(
            { id: task.id },
            {
              onSuccess: () => {
                setConfirmingDelete(false);
                toast.show(t("detail.deleted"));
                if (task.parent) onOpenTask(task.parent.id);
                else onClose();
              },
            },
          )
        }
      />
    </>
  );
}

function Property({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function MilestoneSelect({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string | null;
  onChange: (milestoneId: string | null) => void;
}) {
  const t = useTranslations("tasks");
  const trpc = useTRPC();
  const today = useToday();
  const { data: project } = useQuery(trpc.projects.byId.queryOptions({ id: projectId, today }));
  return (
    <Select
      aria-label={t("fields.milestone")}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{t("detail.noMilestone")}</option>
      {(project?.milestones ?? []).map((milestone) => (
        <option key={milestone.id} value={milestone.id}>
          {milestone.name}
        </option>
      ))}
    </Select>
  );
}
