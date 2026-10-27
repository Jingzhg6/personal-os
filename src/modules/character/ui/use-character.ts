"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { Attribute, XpEntryKind, XpSourceType } from "../domain";

/*
 * XP changes as a side effect of other modules' actions (completing a task anywhere). Instead of
 * every module invalidating character queries, they are always refetched when shown.
 */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useCharacterOverview() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.character.overview.queryOptions(), ...alwaysFresh });
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

export function useSetAttributeArea() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  return useMutation(
    trpc.character.attributes.setArea.mutationOptions({
      onSettled: () => queryClient.invalidateQueries(trpc.character.pathFilter()),
      onError: (error) => toast.show(errorMessage(error), "error"),
    }),
  );
}

/** Attribute label: the user's name for it, else the translated system key. */
export function useAttributeLabel() {
  const t = useTranslations("character.attributes.keys");
  return useCallback(
    (attribute: Pick<Attribute, "name" | "systemKey">) => attribute.name ?? t(attribute.systemKey),
    [t],
  );
}

/** Where a ledger entry's source lives (milestones have no page of their own). */
export function sourceHref(type: XpSourceType, id: string): string | null {
  if (type === "task") return `/tasks?task=${id}`;
  if (type === "project") return `/projects/${id}`;
  return null;
}
