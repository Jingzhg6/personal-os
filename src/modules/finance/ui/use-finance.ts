"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import type { HistoryRange } from "../domain";

/* Balances change only through this module, but are always shown fresh. */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useFinanceOverview() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.finance.overview.queryOptions(), ...alwaysFresh });
}

export function useFinanceHistory(range: HistoryRange) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.finance.history.queryOptions({ range }),
    ...alwaysFresh,
    placeholderData: (previous) => previous,
  });
}

export function useFinanceStructure() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.finance.structure.queryOptions(), ...alwaysFresh });
}

export function useAccountHistory(id: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.finance.accounts.history.queryOptions({ id }),
    ...alwaysFresh,
    retry: false,
  });
}

export function useBatchDraft(valuationDate: string | null) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.finance.snapshots.draft.queryOptions({ valuationDate: valuationDate ?? "" }),
    ...alwaysFresh,
    enabled: valuationDate !== null,
  });
}

/** Finance mutations; every one refreshes all finance queries (nothing else depends on them). */
export function useFinanceActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const options = {
    onSettled: () => queryClient.invalidateQueries(trpc.finance.pathFilter()),
    onError: (error: unknown) => toast.show(errorMessage(error), "error"),
  };
  const p = trpc.finance.providers;
  const a = trpc.finance.accounts;
  const s = trpc.finance.snapshots;
  return {
    setBaseCurrency: useMutation(trpc.finance.setBaseCurrency.mutationOptions(options)),
    createProvider: useMutation(p.create.mutationOptions(options)),
    updateProvider: useMutation(p.update.mutationOptions(options)),
    moveProvider: useMutation(p.move.mutationOptions(options)),
    archiveProvider: useMutation(p.setArchived.mutationOptions(options)),
    deleteProvider: useMutation(p.delete.mutationOptions(options)),
    createAccount: useMutation(a.create.mutationOptions(options)),
    updateAccount: useMutation(a.update.mutationOptions(options)),
    moveAccount: useMutation(a.move.mutationOptions(options)),
    archiveAccount: useMutation(a.setArchived.mutationOptions(options)),
    deleteAccount: useMutation(a.delete.mutationOptions(options)),
    saveBatch: useMutation(s.saveBatch.mutationOptions(options)),
    deleteSnapshot: useMutation(s.delete.mutationOptions(options)),
  };
}
