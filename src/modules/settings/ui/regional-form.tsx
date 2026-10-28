"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import { useTRPC } from "@/shared/trpc/react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { useErrorMessage } from "@/shared/ui/use-error-message";
import { useMounted } from "@/shared/ui/use-mounted";

import type { UserSettings } from "../domain";

const REGIONS = [
  "Africa",
  "America",
  "Antarctica",
  "Arctic",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
] as const;
type Region = (typeof REGIONS)[number] | "other";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** "UTC+08:00" for a zone right now ("UTC" when the offset is zero). */
function offsetLabel(timeZone: string, now: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return (part ?? "GMT").replace("GMT", "UTC");
}

/** Every IANA zone the browser knows, grouped by region; the stored zone is always present. */
function zoneGroups(current: string | null, now: Date) {
  const all = new Set<string>(Intl.supportedValuesOf?.("timeZone") ?? []);
  all.add("UTC");
  if (current) all.add(current);
  const groups = new Map<Region, { value: string; label: string }[]>();
  for (const zone of [...all].sort()) {
    const prefix = zone.split("/")[0]!;
    const region: Region = (REGIONS as readonly string[]).includes(prefix)
      ? (prefix as Region)
      : "other";
    const list = groups.get(region) ?? [];
    list.push({ value: zone, label: `(${offsetLabel(zone, now)}) ${zone.replaceAll("_", " ")}` });
    groups.set(region, list);
  }
  return [...REGIONS, "other" as const]
    .filter((r) => groups.has(r))
    .map((region) => ({ region, zones: groups.get(region)! }));
}

/** Time zone and first day of the week. Saving refreshes every view that depends on them. */
export function RegionalForm({ settings }: { settings: UserSettings }) {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const mounted = useMounted();
  const ids = { zone: useId(), week: useId() };
  const [saved, setSaved] = useState(settings);
  const [timeZone, setTimeZone] = useState(settings.timeZone ?? "");
  const [weekStartsOn, setWeekStartsOn] = useState(settings.weekStartsOn);

  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: async (next) => {
        setSaved(next);
        toast.show(t("saved"));
        // "Today", periods and week boundaries are computed from these: refetch everything.
        await queryClient.invalidateQueries();
        router.refresh();
      },
      onError: (error) => toast.show(errorMessage(error), "error"),
    }),
  );

  // The browser's zone list and clock exist only after mount (no hydration mismatch).
  const groups = useMemo(
    () => (mounted ? zoneGroups(saved.timeZone, now) : []),
    // Offsets only change at DST transitions; recomputing on every tick is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, saved.timeZone],
  );
  const browserZone = mounted ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  const zoneChanged = timeZone !== "" && timeZone !== saved.timeZone;
  const weekChanged = weekStartsOn !== saved.weekStartsOn;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!zoneChanged && !weekChanged) return;
    update.mutate({
      ...(zoneChanged ? { timeZone } : {}),
      ...(weekChanged ? { weekStartsOn } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="regional-form">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.zone}>{t("regional.timeZone")}</Label>
        <Select
          id={ids.zone}
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          data-testid="settings-time-zone"
        >
          {timeZone === "" ? <option value="">{t("regional.notSet")}</option> : null}
          {groups.length === 0 && timeZone !== "" ? (
            <option value={timeZone}>{timeZone}</option>
          ) : null}
          {groups.map(({ region, zones }) => (
            <optgroup key={region} label={t(`regional.regions.${region}`)}>
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {mounted ? (
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="settings-zone-now">
            {t("regional.now", {
              time: format.dateTime(now, {
                timeZone: timeZone || "UTC",
                month: "long",
                day: "numeric",
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        ) : null}
        {browserZone && browserZone !== timeZone ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {t("regional.browser", { zone: browserZone })}
            <button
              type="button"
              className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setTimeZone(browserZone)}
              data-testid="settings-use-browser-zone"
            >
              {t("regional.useBrowser")}
            </button>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("regional.keepsZone")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.week}>{t("regional.weekStartsOn")}</Label>
        <Select
          id={ids.week}
          className="sm:max-w-48"
          value={weekStartsOn}
          onChange={(e) => setWeekStartsOn(Number(e.target.value))}
          data-testid="settings-week-start"
        >
          {WEEKDAYS.map((day) => (
            <option key={day} value={day}>
              {t(`weekdays.${day}`)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t("regional.weekHint")}</p>
      </div>

      <div>
        <Button
          type="submit"
          disabled={update.isPending || (!zoneChanged && !weekChanged)}
          data-testid="settings-save"
        >
          {update.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
