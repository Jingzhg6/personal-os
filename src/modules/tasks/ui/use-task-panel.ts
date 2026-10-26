"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Search parameter holding the task open in the detail panel (shareable, back-button friendly). */
export const TASK_PARAM = "task";

/**
 * Which task the detail panel shows, kept in the URL so any view (list, matrix, later Kanban)
 * opens the same panel for the same task, and Back closes it.
 */
export function useTaskPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get(TASK_PARAM);

  const openTask = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(TASK_PARAM, id);
      router.push(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const closeTask = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(TASK_PARAM);
    const rest = params.toString();
    router.push(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  return { openTaskId, openTask, closeTask };
}
