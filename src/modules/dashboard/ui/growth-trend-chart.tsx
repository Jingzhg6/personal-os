"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";

import type { DashboardGrowth, TrendBucket, TrendPoint } from "../domain";

const HEIGHT = 168;
const MARGIN = { top: 10, right: 8, bottom: 24, left: 36 };
const MAX_BAR = 24;
const LABEL_SPACING = 72;

const DAY = { month: "numeric", day: "numeric", timeZone: "UTC" } as const;
const MONTH = { year: "numeric", month: "numeric", timeZone: "UTC" } as const;
const COMPACT = { notation: "compact" } as const;
/** Axis labels of a week bucket show its first day (the tooltip says "week of …"). */
const AXIS_BUCKET: Record<TrendBucket, TrendBucket> = { day: "day", week: "day", month: "month" };

/** A round axis maximum: 1, 2 or 5 × 10^n at or above `value`. */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!;
  return step * power;
}

/** Column path with a 4px rounded data end and a square baseline (up or down). */
function columnPath(x: number, width: number, base: number, top: number): string {
  const height = Math.abs(base - top);
  const r = Math.min(4, width / 2, height);
  if (top <= base) {
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`;
  }
  return `M${x},${base} V${top - r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top - r} V${base} Z`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Growth XP per day (or week / month) as columns — the primary series — with Active XP as a thin
 * line for context. One y-axis: both are XP. Values are reachable without hover in the hidden table.
 */
export function GrowthTrendChart({
  growth,
  periodName,
}: {
  growth: DashboardGrowth;
  periodName: string;
}) {
  const t = useTranslations("dashboard.trend");
  const format = useFormatter();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { points, bucket } = growth;

  const dateLabel = (point: TrendPoint, kind: TrendBucket = bucket) => {
    const date = new Date(`${point.start}T00:00:00Z`);
    if (kind === "month") return format.dateTime(date, MONTH);
    if (kind === "week") return t("tooltipWeek", { date: format.dateTime(date, DAY) });
    return format.dateTime(date, DAY);
  };

  const empty = points.every((p) => p.growthXp === 0 && p.activeXp === 0);
  if (empty) {
    return (
      <p
        className="flex h-[168px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
        data-testid="trend-empty"
      >
        {t("empty")}
      </p>
    );
  }

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const values = points.flatMap((p) => [p.growthXp, p.activeXp]);
  const yMax = niceCeil(Math.max(...values, 1));
  const yMin = -niceCeil(Math.max(0, -Math.min(...values, 0)));
  const y = (value: number) => MARGIN.top + ((yMax - value) / (yMax - yMin)) * innerHeight;
  const band = points.length ? innerWidth / points.length : 0;
  const barWidth = Math.max(1, Math.min(MAX_BAR, band - 2));
  const center = (i: number) => MARGIN.left + band * i + band / 2;
  const ticks = yMin < 0 ? [yMin, 0, yMax] : [0, yMax / 2, yMax];
  const labelCount = Math.max(2, Math.min(points.length, Math.floor(innerWidth / LABEL_SPACING)));
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, k) =>
      Math.round((k * (points.length - 1)) / Math.max(1, labelCount - 1)),
    ),
  );
  const line = points.map((p, i) => `${center(i)},${y(p.activeXp)}`).join(" ");
  const hovered = hover === null ? null : points[hover];

  return (
    <figure className="flex flex-col gap-2" data-testid="growth-trend">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" aria-hidden />
          {t("growth")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full bg-chart-active" aria-hidden />
          {t("active")}
        </span>
      </div>
      <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t("chartLabel", { period: periodName, bucket: t(`buckets.${bucket}`) })}
            className="block overflow-visible"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={MARGIN.left - 6}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {format.number(tick, COMPACT)}
                </text>
              </g>
            ))}
            {points.map((point, i) =>
              point.growthXp === 0 ? null : (
                <path
                  key={point.start}
                  d={columnPath(center(i) - barWidth / 2, barWidth, y(0), y(point.growthXp))}
                  className={hover === null || hover === i ? "fill-primary" : "fill-primary/45"}
                  data-testid="trend-bar"
                />
              ),
            )}
            <polyline
              points={line}
              fill="none"
              className="stroke-chart-active"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hover !== null ? (
              <circle
                cx={center(hover)}
                cy={y(points[hover]!.activeXp)}
                r={4}
                className="fill-chart-active stroke-surface"
                strokeWidth={2}
              />
            ) : null}
            {points.map((point, i) =>
              labelIndexes.has(i) ? (
                <text
                  key={point.start}
                  x={Math.min(Math.max(center(i), MARGIN.left + 16), width - MARGIN.right - 16)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {dateLabel(point, AXIS_BUCKET[bucket])}
                </text>
              ) : null,
            )}
            {/* Hit targets: the whole column band, larger than the mark. */}
            {points.map((point, i) => (
              <rect
                key={point.start}
                x={MARGIN.left + band * i}
                y={MARGIN.top}
                width={band}
                height={innerHeight}
                className="fill-transparent"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ))}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {hovered && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-36 rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(center(hover) - 72, 0), Math.max(0, width - 144)),
            }}
            data-testid="trend-tooltip"
          >
            <div className="mb-1 text-muted-foreground">{dateLabel(hovered)}</div>
            <TooltipRow swatch="bg-primary" label={t("growth")} value={hovered.growthXp} />
            <TooltipRow swatch={null} label={t("level")} value={hovered.levelXp} />
            <TooltipRow swatch="bg-chart-active" label={t("active")} value={hovered.activeXp} />
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("date")}</th>
            <th scope="col">{t("growth")}</th>
            <th scope="col">{t("level")}</th>
            <th scope="col">{t("active")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.start}>
              <th scope="row">{dateLabel(point)}</th>
              <td>{point.growthXp}</td>
              <td>{point.levelXp}</td>
              <td>{point.activeXp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** `swatch` null: a figure with no mark of its own in the chart (Level XP). */
function TooltipRow({
  swatch,
  label,
  value,
}: {
  swatch: string | null;
  label: string;
  value: number;
}) {
  const format = useFormatter();
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-sm", swatch)} aria-hidden />
      <span className="font-semibold text-foreground tabular-nums">{format.number(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
