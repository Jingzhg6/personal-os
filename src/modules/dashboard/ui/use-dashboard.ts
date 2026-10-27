"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/shared/trpc/react";

import type { DashboardPeriod } from "../domain";

/*
 * Two requests for the whole page: the overview (everything that does not depend on the chosen
 * period) and the period-dependent growth ranking + trend. XP moves with actions taken anywhere,
 * so both are refetched whenever the dashboard is shown.
 */
const alwaysFresh = { staleTime: 0, refetchOnMount: "always" } as const;

export function useDashboard() {
  const trpc = useTRPC();
  return useQuery({ ...trpc.dashboard.overview.queryOptions(), ...alwaysFresh });
}

export function useDashboardGrowth(period: DashboardPeriod) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.dashboard.growth.queryOptions({ period }),
    ...alwaysFresh,
    // Keep the previous period on screen while the next one loads (no layout jump).
    placeholderData: keepPreviousData,
  });
}
