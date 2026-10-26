"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { readListParams, writeListParams, type ListUrlState } from "../domain";

export type ListStateUpdate =
  Partial<ListUrlState> | ((previous: ListUrlState) => Partial<ListUrlState>);

/**
 * Search, filters and sort, stored in the URL so views are shareable and survive reloads.
 * Updates build on the latest requested state, so rapid successive changes (e.g. ticking two
 * filters quickly) are not lost while the URL is still updating.
 */
export function useListUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.toString();

  const state = useMemo(() => readListParams(new URLSearchParams(raw)), [raw]);
  const latest = useRef({ raw, state });
  useEffect(() => {
    latest.current = { raw, state };
  }, [raw, state]);

  const setState = useCallback(
    (update: ListStateUpdate) => {
      const previous = latest.current;
      const patch = typeof update === "function" ? update(previous.state) : update;
      const next = { ...previous.state, ...patch };
      const query = writeListParams(next, new URLSearchParams(previous.raw)).toString();
      latest.current = { raw: query, state: next };
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  return [state, setState] as const;
}
