"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useTRPC } from "@/shared/trpc/react";

/**
 * Fills the user's calendar series up to their horizon once when a task view opens (the worker
 * does the same every minute; this covers installations without it). Idempotent on the server;
 * lists are refreshed only when instances were created.
 */
export function useRecurrenceRefresh() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const done = useRef(false);
  const refresh = useMutation(
    trpc.tasks.recurrence.refresh.mutationOptions({
      onSuccess: ({ created }) => {
        if (created > 0) void queryClient.invalidateQueries(trpc.tasks.pathFilter());
      },
    }),
  );
  const { mutate } = refresh;
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    mutate();
  }, [mutate]);
}
