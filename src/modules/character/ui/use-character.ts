"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { DevelopmentAttribute, XpEntryKind, XpSourceType } from "../domain";

/*
 * XP changes as a side effect of other modules' actions (completing a task anywhere). Instead of
 * every module invalidating character queries, they are always refetched when shown.
 */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useCharacterOverview() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.character.overview.queryOptions(), ...alwaysFresh });
}

/** Every development attribute, archived ones included (labels for history, settings). */
export function useDevelopmentAttributes() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.character.attributes.list.queryOptions(), ...alwaysFresh });
}

export function useXpHistory(filter: { kind?: XpEntryKind; attributeId?: string }) {
  const trpc = useTRPC();
  return useInfiniteQuery(
    trpc.character.history.infiniteQueryOptions(
      { ...filter, limit: 20 },
      { getNextPageParam: (page) => page.nextCursor ?? undefined, ...alwaysFresh },
    ),
  );
}

export function useAttributeMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  // Attributes appear in task details too (contributions), so refresh tasks as well.
  const options = {
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.character.pathFilter()),
        queryClient.invalidateQueries(trpc.tasks.pathFilter()),
      ]),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.character.attributes.create.mutationOptions(options)),
    update: useMutation(trpc.character.attributes.update.mutationOptions(options)),
    move: useMutation(trpc.character.attributes.move.mutationOptions(options)),
    remove: useMutation(trpc.character.attributes.delete.mutationOptions(options)),
  };
}

/** Attribute label: the user's name for it, else the translated seed key. */
export function useAttributeLabel() {
  const t = useTranslations("character.attributes.keys");
  return useCallback(
    (attribute: Pick<DevelopmentAttribute, "name" | "systemKey">) =>
      attribute.name ?? (attribute.systemKey ? t(attribute.systemKey) : ""),
    [t],
  );
}

/** Where a ledger entry's source lives (milestones have no page of their own). */
export function sourceHref(type: XpSourceType, id: string): string | null {
  if (type === "task") return `/tasks?task=${id}`;
  if (type === "project") return `/projects/${id}`;
  return null;
}
