"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { useAreaLabel, useAreas } from "@/modules/areas/ui";
import { priorities } from "@/modules/tasks/domain";
import type { ColorId } from "@/shared/lib/colors";
import { Button } from "@/shared/ui/button";
import { ColorPicker } from "@/shared/ui/color-picker";
import { Dialog } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

import { projectStatuses, validateProjectDates, type Project, type ProjectStatus } from "../domain";

export interface ProjectFormValues {
  name: string;
  areaId: string | null;
  status: ProjectStatus;
  priority: number;
  color: ColorId;
  startDate: string | null;
  targetDate: string | null;
}

/** Create / edit a project. */
export function ProjectFormDialog({
  open,
  project,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Present when editing. */
  project?: Project;
  pending?: boolean;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}) {
  const t = useTranslations("projects");
  const tt = useTranslations("tasks");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const areaLabel = useAreaLabel();
  const { data: areas = [] } = useAreas();
  const ids = {
    name: useId(),
    area: useId(),
    status: useId(),
    priority: useId(),
    start: useId(),
    target: useId(),
  };
  const [values, setValues] = useState<ProjectFormValues>(() => ({
    name: project?.name ?? "",
    areaId: project?.areaId ?? null,
    status: project?.status ?? "active",
    priority: project?.priority ?? 0,
    color: project?.color ?? "indigo",
    startDate: project?.startDate ?? null,
    targetDate: project?.targetDate ?? null,
  }));
  const set = (patch: Partial<ProjectFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));
  const dateError = validateProjectDates(values);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim() || dateError) return;
    onSubmit({ ...values, name: values.name.trim() });
  }

  return (
    <Dialog open={open} onClose={onClose} title={project ? t("edit") : t("new")}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t("fields.name")}</Label>
          <Input
            id={ids.name}
            autoFocus
            value={values.name}
            maxLength={120}
            placeholder={t("fields.namePlaceholder")}
            onChange={(event) => set({ name: event.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.area}>{t("fields.area")}</Label>
            <Select
              id={ids.area}
              value={values.areaId ?? ""}
              onChange={(event) => set({ areaId: event.target.value || null })}
            >
              <option value="">{t("fields.noArea")}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {areaLabel(area)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.status}>{t("fields.status")}</Label>
            <Select
              id={ids.status}
              value={values.status}
              onChange={(event) => set({ status: event.target.value as ProjectStatus })}
            >
              {projectStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.start}>{t("fields.startDate")}</Label>
            <Input
              id={ids.start}
              type="date"
              value={values.startDate ?? ""}
              onChange={(event) => set({ startDate: event.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.target}>{t("fields.targetDate")}</Label>
            <Input
              id={ids.target}
              type="date"
              value={values.targetDate ?? ""}
              aria-invalid={Boolean(dateError)}
              onChange={(event) => set({ targetDate: event.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.priority}>{t("fields.priority")}</Label>
            <Select
              id={ids.priority}
              value={values.priority}
              onChange={(event) => set({ priority: Number(event.target.value) })}
            >
              {priorities.map((id, value) => (
                <option key={id} value={value}>
                  {tt(`priority.${id}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {dateError ? (
          <p role="alert" className="text-sm text-danger">
            {te("project.start_after_target")}
          </p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("fields.color")}</span>
          <ColorPicker
            value={values.color}
            onChange={(color) => set({ color })}
            label={t("fields.color")}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={pending || !values.name.trim() || Boolean(dateError)}>
            {project ? t("save") : t("new")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
