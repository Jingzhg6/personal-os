"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTimeZone } from "next-intl";
import { useCallback, useMemo } from "react";

import { localDate, localParts, zonedInstant } from "@/shared/lib/zoned-time";
import { useTRPC } from "@/shared/trpc/react";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";

import { shiftDate, type ScheduleBlock } from "../domain";

/** Local-time helpers in the user's time zone (from settings, via next-intl). */
export function useZonedClock() {
  const timeZone = useTimeZone() ?? "UTC";
  return useMemo(() => {
    /** Instant of a local date + minutes since midnight (minutes may run past either end). */
    const instant = (date: string, minutes: number) => {
      const days = Math.floor(minutes / 1440);
      const rest = minutes - days * 1440;
      const hh = String(Math.floor(rest / 60)).padStart(2, "0");
      const mm = String(rest % 60).padStart(2, "0");
      return zonedInstant(shiftDate(date, days), `${hh}:${mm}`, timeZone).instant;
    };
    const minutes = (at: Date | number) => {
      const p = localParts(typeof at === "number" ? at : at.getTime(), timeZone);
      return p.hour * 60 + p.minute;
    };
    const date = (at: Date | number) =>
      localDate(typeof at === "number" ? at : at.getTime(), timeZone);
    /** First and last local day a block covers (an end at midnight belongs to the day before). */
    const span = (block: Pick<ScheduleBlock, "startAt" | "endAt">) => ({
      first: date(block.startAt),
      last: date(Math.max(block.endAt.getTime() - 1, block.startAt.getTime())),
    });
    const time = (at: Date | number) => {
      const m = minutes(at);
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    return { timeZone, instant, minutes, date, span, time };
  }, [timeZone]);
}

export type Clock = ReturnType<typeof useZonedClock>;

export interface BlockTimes {
  startAt: Date;
  endAt: Date;
  allDay: boolean;
}

/** Blocks of [from, to) and the mutations; moves are applied to the cache at once. */
export function useScheduleBlocks(range: { from: Date; to: Date }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const listOptions = trpc.schedule.list.queryOptions(range);
  const query = useQuery({ ...listOptions, placeholderData: (previous) => previous });

  const refresh = useCallback(
    () => queryClient.invalidateQueries(trpc.schedule.list.pathFilter()),
    [queryClient, trpc],
  );
  const onError = (error: unknown) => {
    toast.show(errorMessage(error), "error");
  };

  const create = useMutation(trpc.schedule.create.mutationOptions({ onError, onSettled: refresh }));
  const update = useMutation(
    trpc.schedule.update.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries(trpc.schedule.list.pathFilter());
        queryClient.setQueryData(listOptions.queryKey, (old) =>
          old?.map((b) =>
            b.id === input.id
              ? {
                  ...b,
                  startAt: input.startAt as Date,
                  endAt: input.endAt as Date,
                  allDay: input.allDay ?? false,
                }
              : b,
          ),
        );
      },
      onError,
      onSettled: refresh,
    }),
  );
  const remove = useMutation(
    trpc.schedule.delete.mutationOptions({
      onMutate: async ({ id }) => {
        queryClient.setQueryData(listOptions.queryKey, (old) => old?.filter((b) => b.id !== id));
      },
      onError,
      onSettled: refresh,
    }),
  );

  return { blocks: query.data ?? [], isPending: query.isPending, create, update, remove, refresh };
}
