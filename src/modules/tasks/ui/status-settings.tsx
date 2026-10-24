"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ColorPicker } from "@/shared/ui/color-picker";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { statusCategories, type StatusCategory, type TaskStatus } from "../domain";
import { useStatusLabel } from "./labels";
import { StatusIcon } from "./status-icon";
import { useStatuses } from "./use-task-data";

function useStatusMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () => queryClient.invalidateQueries(trpc.tasks.pathFilter()),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.tasks.statuses.create.mutationOptions(options)),
    update: useMutation(trpc.tasks.statuses.update.mutationOptions(options)),
    move: useMutation(trpc.tasks.statuses.move.mutationOptions(options)),
    remove: useMutation(trpc.tasks.statuses.delete.mutationOptions(options)),
  };
}

export function StatusSettings() {
  const t = useTranslations("tasks");
  const { data: statuses = [] } = useStatuses();
  const mutations = useStatusMutations();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("started");

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    mutations.create.mutate(
      { name: name.trim(), category, color: "blue" },
      { onSuccess: () => setName("") },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {statusCategories.map((cat) => {
        const inCategory = statuses.filter((s) => s.category === cat);
        return (
          <section key={cat} className="flex flex-col gap-2" aria-labelledby={`category-${cat}`}>
            <h3 id={`category-${cat}`} className="flex items-center gap-2 text-sm font-medium">
              <StatusIcon category={cat} />
              {t(`statusCategory.${cat}`)}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {inCategory.map((status, index) => (
                <StatusRow
                  key={status.id}
                  status={status}
                  siblings={inCategory}
                  isFirst={index === 0}
                  isLast={index === inCategory.length - 1}
                  mutations={mutations}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <form onSubmit={onAdd} className="flex flex-wrap gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("settings.statuses.namePlaceholder")}
          aria-label={t("settings.statuses.namePlaceholder")}
          maxLength={40}
          className="min-w-48 flex-1"
        />
        <Select
          value={category}
          onChange={(event) => setCategory(event.target.value as StatusCategory)}
          aria-label={t("fields.status")}
          className="w-40"
        >
          {statusCategories.map((cat) => (
            <option key={cat} value={cat}>
              {t(`statusCategory.${cat}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={!name.trim() || mutations.create.isPending}>
          <Plus />
          {t("settings.statuses.add")}
        </Button>
      </form>
    </div>
  );
}

function StatusRow({
  status,
  siblings,
  isFirst,
  isLast,
  mutations,
}: {
  status: TaskStatus;
  siblings: TaskStatus[];
  isFirst: boolean;
  isLast: boolean;
  mutations: ReturnType<typeof useStatusMutations>;
}) {
  const t = useTranslations("tasks.settings.statuses");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const ts = useTranslations("tasks.status");
  const label = useStatusLabel();
  const toast = useToast();
  const defaultLabel = status.systemKey ? ts(status.systemKey) : null;
  const [name, setName] = useState(label(status));
  const [confirming, setConfirming] = useState(false);
  const others = siblings.filter((s) => s.id !== status.id);
  const [replacement, setReplacement] = useState(others[0]?.id ?? "");

  function saveName() {
    const trimmed = name.trim();
    // Default statuses: keeping (or clearing back to) the translated default stores no custom name.
    const next = status.systemKey && (trimmed === "" || trimmed === defaultLabel) ? null : trimmed;
    if (next === "") return setName(label(status));
    if (next === status.name) return setName(next ?? defaultLabel ?? "");
    mutations.update.mutate({ id: status.id, name: next });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 p-3" data-testid="status-row">
      <StatusIcon category={status.category} color={status.color} />
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        placeholder={defaultLabel ?? undefined}
        aria-label={`${t("name")}: ${label(status)}`}
        maxLength={40}
        className="min-w-36 flex-1"
      />
      <ColorPicker
        value={status.color}
        onChange={(color) => mutations.update.mutate({ id: status.id, color })}
        label={`${tc("colorLabel")}: ${label(status)}`}
      />
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isFirst}
          onClick={() => mutations.move.mutate({ id: status.id, direction: "up" })}
          aria-label={`${tc("moveUp")}: ${label(status)}`}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isLast}
          onClick={() => mutations.move.mutate({ id: status.id, direction: "down" })}
          aria-label={`${tc("moveDown")}: ${label(status)}`}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={others.length === 0}
          title={others.length === 0 ? te("status.last_in_category") : undefined}
          onClick={() => setConfirming(true)}
          aria-label={`${tc("delete")}: ${label(status)}`}
        >
          <Trash2 />
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={t("deleteTitle", { name: label(status) })}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        pending={mutations.remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          mutations.remove.mutate(
            { id: status.id, replacementStatusId: replacement || undefined },
            {
              onSuccess: () => {
                setConfirming(false);
                toast.show(t("deleted"));
              },
            },
          )
        }
      >
        <label className="flex flex-col gap-1.5 text-sm">
          {t("replacement")}
          <Select value={replacement} onChange={(event) => setReplacement(event.target.value)}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s)}
              </option>
            ))}
          </Select>
        </label>
      </ConfirmDialog>
    </li>
  );
}
