"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import { toDisplayNumber, dec, type HistoryPointView } from "../domain";
import { useDay, useMoney } from "./format";

const HEIGHT = 200;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 52 };
const LABEL_SPACING = 80;
const COMPACT = { notation: "compact", maximumFractionDigits: 2 } as const;
const DAY_MS = 86_400_000;

function niceStep(span: number): number {
  const raw = span / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].find((m) => m * power >= raw)! * power;
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

const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * Net worth at each recorded valuation date, placed on a true time axis so gaps between records
 * stay visible. Only recorded dates get a mark; the line between marks is a visual guide, not data.
 * Every value is also available in the hidden table.
 */
export function NetWorthChart({
  points,
  baseCurrency,
  rangeName,
}: {
  points: HistoryPointView[];
  baseCurrency: string;
  rangeName: string;
}) {
  const t = useTranslations("finance.chart");
  const format = useFormatter();
  const money = useMoney();
  const day = useDay();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const values = points.map((p) => toDisplayNumber(dec(p.netWorth)));
  // Fitted to the data: a line needs no zero baseline (ticks are step multiples, so a range
  // that crosses zero still shows the zero line).
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(Math.max(high - low, Math.abs(high) * 0.05, 1));
  const yMin = Math.floor(low / step) * step;
  const yMax = Math.max(Math.ceil(high / step) * step, yMin + step);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);

  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const first = points.length ? time(points[0]!.date) : 0;
  const last = points.length ? time(points.at(-1)!.date) : 0;
  const span = Math.max(last - first, DAY_MS);
  const x = (date: string) =>
    points.length === 1
      ? MARGIN.left + innerWidth / 2
      : MARGIN.left + ((time(date) - first) / span) * innerWidth;
  const y = (value: number) => MARGIN.top + ((yMax - value) / (yMax - yMin)) * innerHeight;

  const labelCount = Math.max(1, Math.min(points.length, Math.floor(innerWidth / LABEL_SPACING)));
  const labelIndexes = new Set(
    Array.from({ length: labelCount }, (_, k) =>
      Math.round((k * (points.length - 1)) / Math.max(1, labelCount - 1)),
    ),
  );

  function nearest(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best]!.date) - px)) best = i;
    });
    setHover(best);
  }

  const hovered = hover === null ? null : points[hover];
  const line = points.map((p, i) => `${x(p.date)},${y(values[i]!)}`).join(" ");

  return (
    <figure className="flex flex-col gap-2" data-testid="net-worth-chart">
      <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t("label", { range: rangeName })}
            className="block overflow-visible"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? "stroke-muted-foreground/50" : "stroke-border"}
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
            {points.length > 1 ? (
              <polyline
                points={line}
                fill="none"
                className="stroke-primary"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {points.map((point, i) => (
              <circle
                key={point.date}
                cx={x(point.date)}
                cy={y(values[i]!)}
                r={hover === i ? 5 : 3.5}
                // Hollow: some balances on this date were carried from earlier records.
                className={
                  point.carried > 0 || point.unconverted > 0
                    ? "fill-surface stroke-primary"
                    : "fill-primary stroke-surface"
                }
                strokeWidth={2}
                data-testid="net-worth-point"
              />
            ))}
            {points.map((point, i) =>
              labelIndexes.has(i) ? (
                <text
                  key={point.date}
                  x={Math.min(Math.max(x(point.date), MARGIN.left + 18), width - MARGIN.right - 18)}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {day(point.date, true)}
                </text>
              ) : null,
            )}
            <rect
              x={MARGIN.left - 8}
              y={MARGIN.top}
              width={innerWidth + 16}
              height={innerHeight}
              className="fill-transparent"
              onPointerMove={nearest}
              onPointerDown={nearest}
            />
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}
        {hovered && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-48 rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(x(hovered.date) - 96, 0), Math.max(0, width - 192)),
            }}
            data-testid="net-worth-tooltip"
          >
            <div className="mb-1 text-muted-foreground">{day(hovered.date)}</div>
            <div className="font-semibold text-foreground tabular-nums">
              {money(hovered.netWorth, baseCurrency)}
            </div>
            <div className="mt-1 text-muted-foreground">
              {t("assets")} {money(hovered.assets, baseCurrency)} · {t("liabilities")}{" "}
              {money(hovered.liabilities, baseCurrency)}
            </div>
            <div className="mt-1 flex flex-col text-muted-foreground">
              <span>{t("valued", { count: hovered.valued })}</span>
              {hovered.carried > 0 ? <span>{t("carried", { count: hovered.carried })}</span> : null}
              {hovered.unconverted > 0 ? (
                <span className="text-foreground">
                  {t("unconverted", { count: hovered.unconverted })}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("date")}</th>
            <th scope="col">{t("netWorth")}</th>
            <th scope="col">{t("assets")}</th>
            <th scope="col">{t("liabilities")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{day(point.date)}</th>
              <td>{money(point.netWorth, baseCurrency)}</td>
              <td>{money(point.assets, baseCurrency)}</td>
              <td>{money(point.liabilities, baseCurrency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
