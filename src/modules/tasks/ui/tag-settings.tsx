"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { ColorPicker } from "@/shared/ui/color-picker";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { tagName, type Tag } from "../domain";
import { useTags } from "./use-task-data";

function useTagMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () => queryClient.invalidateQueries(trpc.tasks.pathFilter()),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.tasks.tags.create.mutationOptions(options)),
    update: useMutation(trpc.tasks.tags.update.mutationOptions(options)),
    remove: useMutation(trpc.tasks.tags.delete.mutationOptions(options)),
  };
}

export function TagSettings() {
  const t = useTranslations("tasks.settings.tags");
  const { data: tags = [], isPending } = useTags();
  const mutations = useTagMutations();
  const [name, setName] = useState("");
  const valid = tagName.safeParse(name).success;

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    mutations.create.mutate({ name: name.trim(), color: "blue" }, { onSuccess: () => setName("") });
  }

  return (
    <div className="flex flex-col gap-4">
      {!isPending && tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}
      {tags.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} mutations={mutations} />
          ))}
        </ul>
      ) : null}
      <form onSubmit={onAdd} className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          aria-label={t("namePlaceholder")}
          maxLength={40}
          aria-invalid={name !== "" && !valid}
        />
        <Button type="submit" disabled={!valid || mutations.create.isPending}>
          <Plus />
          {t("add")}
        </Button>
      </form>
    </div>
  );
}

function TagRow({ tag, mutations }: { tag: Tag; mutations: ReturnType<typeof useTagMutations> }) {
  const t = useTranslations("tasks.settings.tags");
  const tc = useTranslations("common");
  const toast = useToast();
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);

  function saveName() {
    const trimmed = name.trim();
    if (trimmed === tag.name) return;
    if (!tagName.safeParse(trimmed).success) return setName(tag.name);
    mutations.update.mutate({ id: tag.id, name: trimmed }, { onError: () => setName(tag.name) });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 p-3" data-testid="tag-row">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={saveName}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        aria-label={`${t("name")}: ${tag.name}`}
        maxLength={40}
        className="min-w-36 flex-1"
      />
      <ColorPicker
        value={tag.color}
        onChange={(color) => mutations.update.mutate({ id: tag.id, color })}
        label={`${tc("colorLabel")}: ${tag.name}`}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setConfirming(true)}
        aria-label={`${tc("delete")}: ${tag.name}`}
      >
        <Trash2 />
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t("deleteTitle", { name: tag.name })}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        pending={mutations.remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          mutations.remove.mutate(
            { id: tag.id },
            {
              onSuccess: () => {
                setConfirming(false);
                toast.show(t("deleted"));
              },
            },
          )
        }
      />
    </li>
  );
}
