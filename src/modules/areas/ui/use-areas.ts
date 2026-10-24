"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useTRPC } from "@/shared/trpc/react";

import type { Area } from "../domain";

export function useAreas() {
  const trpc = useTRPC();
  return useQuery(trpc.areas.list.queryOptions());
}

/** Display label: the user's own name, or the translated default for seeded areas. */
export function useAreaLabel() {
  const t = useTranslations("areas.defaults");
  return useCallback(
    (area: Pick<Area, "name" | "systemKey">) =>
      area.name ?? (area.systemKey ? t(area.systemKey) : ""),
    [t],
  );
}
