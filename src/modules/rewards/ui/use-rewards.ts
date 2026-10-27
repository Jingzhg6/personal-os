"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { LevelReward, RewardLedgerEntry } from "../domain";

/* Balances move with XP earned anywhere: always refetched when shown. */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useBalances() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.rewards.balances.queryOptions(), ...alwaysFresh });
}

export function useRewards() {
  const trpc = useTRPC();
  return useQuery(trpc.rewards.list.queryOptions());
}

export function useLevelRewards() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.rewards.levelRewards.list.queryOptions(), ...alwaysFresh });
}

export function useRewardHistory() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.rewards.history.queryOptions(), ...alwaysFresh });
}

export function useRewardMutations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries(trpc.rewards.pathFilter()),
        queryClient.invalidateQueries(trpc.character.pathFilter()),
      ]),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  return {
    create: useMutation(trpc.rewards.create.mutationOptions(options)),
    update: useMutation(trpc.rewards.update.mutationOptions(options)),
    remove: useMutation(trpc.rewards.delete.mutationOptions(options)),
    redeem: useMutation(trpc.rewards.redeem.mutationOptions(options)),
    createLevel: useMutation(trpc.rewards.levelRewards.create.mutationOptions(options)),
    updateLevel: useMutation(trpc.rewards.levelRewards.update.mutationOptions(options)),
    removeLevel: useMutation(trpc.rewards.levelRewards.delete.mutationOptions(options)),
    claimLevel: useMutation(trpc.rewards.levelRewards.claim.mutationOptions(options)),
  };
}

/** Level reward / history label: the user's name, else the translated seed key. */
export function useLevelRewardLabel() {
  const t = useTranslations("rewards.level.keys");
  return useCallback(
    (reward: Pick<LevelReward, "name" | "systemKey">) =>
      reward.name ?? (reward.systemKey ? t(reward.systemKey) : ""),
    [t],
  );
}

export function useEntryTitle() {
  const t = useTranslations("rewards.level.keys");
  return useCallback(
    (entry: Pick<RewardLedgerEntry, "title" | "titleKey">) =>
      entry.title ?? (entry.titleKey ? t(entry.titleKey) : ""),
    [t],
  );
}
