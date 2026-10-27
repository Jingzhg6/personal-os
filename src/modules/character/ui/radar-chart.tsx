"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";

import { fractionalLevel, type AttributeValue } from "../domain";
import { useAttributeLabel } from "./use-character";

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 104;
const ANCHORS = { middle: "middle", start: "start", end: "end" } as const;

/** Labels left of the centre end at their point, labels right of it start there. */
function textAnchor(x: number) {
  if (Math.abs(x - CENTER) < 4) return ANCHORS.middle;
  return x > CENTER ? ANCHORS.start : ANCHORS.end;
}

/**
 * Radar of the attributes' levels. Purely a view of the values computed from the ledger; the
 * attribute list beside it is the accessible table of the same numbers.
 */
export function RadarChart({ attributes }: { attributes: AttributeValue[] }) {
  const t = useTranslations("character.attributes");
  const label = useAttributeLabel();
  const [hover, setHover] = useState<string | null>(null);

  // A radar needs at least three axes; the list beside it still shows every value.
  if (attributes.length < 3) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" data-testid="radar-too-few">
        {t("radarTooFew")}
      </p>
    );
  }

  const values = attributes.map((a) => fractionalLevel(a.xp));
  // Rings at whole levels; at least 5 so a new character is not a full-size shape.
  const rings = Math.max(5, Math.ceil(Math.max(...values, 1)));
  const angle = (i: number) => (Math.PI * 2 * i) / attributes.length - Math.PI / 2;
  const point = (i: number, value: number) => {
    const r = (value / rings) * RADIUS;
    return [CENTER + r * Math.cos(angle(i)), CENTER + r * Math.sin(angle(i))] as const;
  };
  const shape = values.map((v, i) => point(i, v).join(",")).join(" ");
  const hovered = attributes.findIndex((a) => a.id === hover);

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[22rem] overflow-visible"
        role="img"
        aria-label={t("radar")}
        data-testid="attribute-radar"
      >
        {/* Grid: recessive rings at each level and one spoke per attribute. */}
        {Array.from({ length: rings }, (_, ring) => (
          <polygon
            key={ring}
            points={attributes.map((_, i) => point(i, ring + 1).join(",")).join(" ")}
            className="fill-none stroke-border"
            strokeWidth={1}
          />
        ))}
        {attributes.map((a, i) => {
          const [x, y] = point(i, rings);
          return (
            <line
              key={a.id}
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
            />
          );
        })}

        <polygon
          points={shape}
          className="fill-primary/15 stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {attributes.map((a, i) => {
          const [x, y] = point(i, values[i]!);
          const [lx, ly] = point(i, rings + 0.95);
          const anchor = textAnchor(lx);
          return (
            <g
              key={a.id}
              onPointerEnter={() => setHover(a.id)}
              onPointerLeave={() => setHover(null)}
            >
              {/* Larger invisible hit target than the mark. */}
              <circle cx={x} cy={y} r={14} className="fill-transparent" data-testid="radar-point" />
              <circle
                cx={x}
                cy={y}
                r={hover === a.id ? 5.5 : 4}
                className="fill-primary stroke-surface"
                strokeWidth={2}
              />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                className={cn(
                  "fill-muted-foreground text-[12px]",
                  hover === a.id && "fill-foreground font-medium",
                )}
              >
                {a.icon ? `${a.icon} ${label(a)}` : label(a)}
              </text>
            </g>
          );
        })}

        {hovered >= 0 ? (
          <Tooltip
            x={point(hovered, values[hovered]!)[0]}
            y={point(hovered, values[hovered]!)[1]}
            title={label(attributes[hovered]!)}
            detail={`${t("level", { level: attributes[hovered]!.progress.level })} · ${t("xp", {
              xp: attributes[hovered]!.xp,
            })}`}
          />
        ) : null}
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">
        {t("radarHint")}
      </figcaption>
    </figure>
  );
}

function Tooltip({ x, y, title, detail }: { x: number; y: number; title: string; detail: string }) {
  const width = 120;
  const left = Math.min(Math.max(x - width / 2, 0), SIZE - width);
  const top = y > CENTER ? y - 56 : y + 12;
  return (
    <foreignObject x={left} y={top} width={width} height={44} className="pointer-events-none">
      <div className="rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-md">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground tabular-nums">{detail}</div>
      </div>
    </foreignObject>
  );
}
