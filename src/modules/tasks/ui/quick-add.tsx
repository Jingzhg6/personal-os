"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type FormEvent } from "react";

import { useAreaLabel } from "@/modules/areas/ui";
import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";

import { parseQuickAdd } from "../domain";
import { useTaskActions } from "./use-task-data";

export function QuickAdd() {
  const t = useTranslations("tasks.quickAdd");
  const toast = useToast();
  const actions = useTaskActions();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const areaLabel = useAreaLabel();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || pending) return;

    setPending(true);
    try {
      // Areas and tags must be known before parsing, even if the user types before they load.
      const [areas, tags] = await Promise.all([
        queryClient.ensureQueryData(trpc.areas.list.queryOptions()),
        queryClient.ensureQueryData(trpc.tasks.tags.list.queryOptions()),
      ]);
      const parsed = parseQuickAdd(value, {
        areas: areas.map((area) => ({ id: area.id, label: areaLabel(area) })),
        tags,
      });
      if (!parsed.title) return;

      const created = [];
      for (const name of parsed.newTagNames) {
        created.push((await actions.createTag.mutateAsync({ name })).id);
      }
      const task = await actions.create.mutateAsync({
        title: parsed.title,
        priority: parsed.priority ?? undefined,
        areaId: parsed.areaId,
        tagIds: [...parsed.tagIds, ...created],
      });
      setValue("");
      toast.show(t("created", { title: task.title }));
    } catch {
      // Errors are shown by the mutation's onError toast.
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      <div className="flex h-11 items-center gap-2 rounded-lg border border-input bg-surface px-3 shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("label")}
          aria-describedby="quick-add-hint"
          maxLength={500}
          disabled={pending}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-flex">
          <CornerDownLeft className="size-3" aria-hidden />
        </kbd>
      </div>
      <p id="quick-add-hint" className="px-1 text-xs text-muted-foreground">
        {t("hint")}
      </p>
    </form>
  );
}
