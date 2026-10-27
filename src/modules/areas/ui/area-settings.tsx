"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { colorIds, type ColorId } from "@/shared/lib/colors";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { colorClasses } from "@/shared/ui/color";
import { ColorPicker } from "@/shared/ui/color-picker";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { areaIconIds, type Area, type AreaIconId } from "../domain";
import { AreaIcon } from "./area-icon";
import { useAreaLabel, useAreas } from "./use-areas";

function useAreaMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSuccess: () => queryClient.invalidateQueries(trpc.areas.pathFilter()),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.areas.create.mutationOptions(options)),
    update: useMutation(trpc.areas.update.mutationOptions(options)),
    move: useMutation(trpc.areas.move.mutationOptions(options)),
    // Deleting an area clears it on tasks, projects and view scopes: refresh every view.
    remove: useMutation(
      trpc.areas.delete.mutationOptions({
        ...options,
        onSuccess: () => queryClient.invalidateQueries(),
      }),
    ),
  };
}

export function AreaSettings() {
  const t = useTranslations("areas.settings");
  const { data: areas = [] } = useAreas();
  const mutations = useAreaMutations();
  const [newName, setNewName] = useState("");

  function onAdd(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const color: ColorId = colorIds[(areas.length + 1) % colorIds.length]!;
    mutations.create.mutate({ name, color, icon: "circle" }, { onSuccess: () => setNewName("") });
  }

  return (
    <div className="flex flex-col gap-4">
      <ul
        className="divide-y divide-border rounded-lg border border-border bg-surface"
        aria-label={t("title")}
      >
        {areas.map((area, index) => (
          <AreaRow
            key={area.id}
            area={area}
            isFirst={index === 0}
            isLast={index === areas.length - 1}
            mutations={mutations}
          />
        ))}
      </ul>

      <form onSubmit={onAdd} className="flex gap-2">
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={t("namePlaceholder")}
          aria-label={t("namePlaceholder")}
          maxLength={60}
        />
        <Button type="submit" disabled={!newName.trim() || mutations.create.isPending}>
          <Plus />
          {t("add")}
        </Button>
      </form>
    </div>
  );
}

function AreaRow({
  area,
  isFirst,
  isLast,
  mutations,
}: {
  area: Area;
  isFirst: boolean;
  isLast: boolean;
  mutations: ReturnType<typeof useAreaMutations>;
}) {
  const t = useTranslations("areas");
  const tc = useTranslations("common");
  const label = useAreaLabel();
  const toast = useToast();
  const defaultLabel = area.systemKey ? t(`defaults.${area.systemKey}`) : null;
  const [name, setName] = useState(label(area));
  const [iconsOpen, setIconsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function saveName() {
    const trimmed = name.trim();
    // Seeded areas: keeping (or clearing back to) the translated default stores no custom name.
    const next = area.systemKey && (trimmed === "" || trimmed === defaultLabel) ? null : trimmed;
    if (next === "") return setName(label(area));
    if (next === area.name) return setName(next ?? defaultLabel ?? "");
    mutations.update.mutate({ id: area.id, name: next });
  }

  function setIcon(icon: AreaIconId) {
    setIconsOpen(false);
    mutations.update.mutate({ id: area.id, icon });
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:p-4" data-testid="area-row">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <button
          type="button"
          onClick={() => setIconsOpen((open) => !open)}
          aria-expanded={iconsOpen}
          aria-label={t("settings.chooseIcon")}
          title={t("settings.chooseIcon")}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            colorClasses[area.color].soft,
          )}
        >
          <AreaIcon icon={area.icon} />
        </button>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={saveName}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          placeholder={defaultLabel ?? t("settings.namePlaceholder")}
          aria-label={`${t("settings.name")}: ${label(area)}`}
          maxLength={60}
          className="min-w-40 flex-1"
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isFirst}
            onClick={() => mutations.move.mutate({ id: area.id, direction: "up" })}
            aria-label={`${tc("moveUp")}: ${label(area)}`}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isLast}
            onClick={() => mutations.move.mutate({ id: area.id, direction: "down" })}
            aria-label={`${tc("moveDown")}: ${label(area)}`}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirming(true)}
            aria-label={`${tc("delete")}: ${label(area)}`}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-11">
        <ColorPicker
          value={area.color}
          onChange={(color) => mutations.update.mutate({ id: area.id, color })}
          label={`${t("settings.color")}: ${label(area)}`}
        />
        {area.systemKey && area.name ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => {
              setName(defaultLabel ?? "");
              mutations.update.mutate({ id: area.id, name: null });
            }}
          >
            {t("settings.resetName")}
          </button>
        ) : null}
        {defaultLabel && area.name ? (
          <span className="text-xs text-muted-foreground">
            {t("settings.defaultName", { name: defaultLabel })}
          </span>
        ) : null}
      </div>

      {iconsOpen ? (
        <div
          role="radiogroup"
          aria-label={t("settings.icon")}
          className="ml-11 grid w-fit grid-cols-8 gap-1"
        >
          {areaIconIds.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={area.icon === icon}
              aria-label={t(`icons.${icon}`)}
              title={t(`icons.${icon}`)}
              onClick={() => setIcon(icon)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                area.icon === icon && "bg-accent text-accent-foreground",
              )}
            >
              <AreaIcon icon={icon} />
            </button>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t("settings.deleteTitle", { name: label(area) })}
        description={t("settings.deleteBody")}
        confirmLabel={tc("delete")}
        pending={mutations.remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          mutations.remove.mutate(
            { id: area.id },
            {
              onSuccess: () => {
                setConfirming(false);
                toast.show(t("settings.deleted"));
              },
            },
          )
        }
      />
    </li>
  );
}
