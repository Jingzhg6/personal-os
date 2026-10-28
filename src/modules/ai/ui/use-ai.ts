"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/shared/trpc/react";

/* AI state changes on every generation and approval: always shown fresh. */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useAiStatus() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.ai.status.queryOptions(), ...alwaysFresh });
}

export function useReviewFacts() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.ai.reviewFacts.queryOptions(), ...alwaysFresh });
}

export function useProposals(limit = 50) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.ai.proposals.list.queryOptions({ limit }), ...alwaysFresh });
}

/** Generating writes only AI records (never other modules' data). */
export function useGenerate() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.ai.generate.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.ai.pathKey() }),
    }),
  );
}

export function useProposalActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refreshAi = () => queryClient.invalidateQueries({ queryKey: trpc.ai.pathKey() });
  return {
    // An approval changes tasks, goals or rules: everything is refreshed.
    approve: useMutation(
      trpc.ai.proposals.approve.mutationOptions({
        onSettled: () => queryClient.invalidateQueries(),
      }),
    ),
    discard: useMutation(trpc.ai.proposals.discard.mutationOptions({ onSettled: refreshAi })),
    remove: useMutation(trpc.ai.proposals.delete.mutationOptions({ onSettled: refreshAi })),
    clear: useMutation(trpc.ai.proposals.clear.mutationOptions({ onSettled: refreshAi })),
  };
}
