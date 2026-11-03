"use client";

import { AlertTriangle, Repeat } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { cn } from "@/shared/lib/cn";

import { layoutColumns, layoutSegments, type ScheduleBlock } from "../domain";
import type { DragOp } from "./drag";
import type { Clock } from "./use-schedule";

export const HOUR_PX = 48;
const DAY_PX = HOUR_PX * 24;
const LANE_PX = 22;
const MONTH_LANES = 3;
const HEADING_WIDE = {
  timeZone: "UTC",
  weekday: "short",
  month: "numeric",
  day: "numeric",
} as const;
const HEADING_DAY = { timeZone: "UTC", weekday: "short", month: "long", day: "numeric" } as const;
const WEEKDAY = { timeZone: "UTC", weekday: "short" } as const;

/** A block as drawn: the stored block, or its live preview while dragged. */
export interface ShownBlock extends ScheduleBlock {
  phantom?: boolean;
}

export interface CalendarProps {
  blocks: ShownBlock[];
  conflicts: Set<string>;
  selectedId: string | null;
  draggingId: string | null;
  clock: Clock;
  today: string;
  begin: (op: DragOp, event: ReactPointerEvent) => void;
  onSelect: (id: string) => void;
}

const isClosed = (category: string) => ["completed", "cancelled", "failed"].includes(category);

/** Colour by Eisenhower quadrant, so the planner reads like the matrix. */
function tone(block: ShownBlock) {
  const { isUrgent, isImportant } = block.task;
  if (isImportant && isUrgent) return "border-danger/50 bg-danger/12 text-foreground";
  if (isImportant) return "border-primary/50 bg-primary/12 text-foreground";
  if (isUrgent) return "border-warning/60 bg-warning/15 text-foreground";
  return "border-border bg-surface-muted text-foreground";
}

function BlockBody({
  block,
  timeLabel,
  conflict,
}: {
  block: ShownBlock;
  timeLabel?: string;
  conflict: boolean;
}) {
  const t = useTranslations("schedule");
  return (
    <span className="flex min-w-0 flex-col overflow-hidden leading-tight">
      <span
        className={cn(
          "flex min-w-0 items-center gap-1 truncate font-medium",
          isClosed(block.task.statusCategory) && "text-muted-foreground line-through",
        )}
      >
        {conflict ? (
          <AlertTriangle className="size-3 shrink-0 text-danger" aria-label={t("conflict")} />
        ) : null}
        {block.task.recurrenceId ? (
          <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <span className="truncate">{block.task.title}</span>
      </span>
      {timeLabel ? (
        <span className="truncate text-[11px] text-muted-foreground">{timeLabel}</span>
      ) : null}
    </span>
  );
}

/* --------------------------------------------------------------- time grid (day and week) */

export function TimeGrid({
  days,
  scroller,
  ...props
}: CalendarProps & { days: string[]; scroller: RefObject<HTMLDivElement | null> }) {
  const format = useFormatter();
  const t = useTranslations("schedule");
  const { blocks, clock, today } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Start the grid at 07:00 (or an hour before now on today).
  useEffect(() => {
    const hour = days.includes(today) ? Math.max(clock.minutes(new Date()) / 60 - 1, 0) : 7;
    scroller.current?.scrollTo({ top: Math.min(hour, 16) * HOUR_PX });
    // Only when the visible days change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join()]);

  const timed = blocks.filter((b) => !b.allDay);
  const allDay = blocks.filter((b) => b.allDay);
  const wide = days.length > 1;

  return (
    <div className="flex flex-col overflow-x-auto rounded-lg border border-border bg-surface">
      <div className={cn("flex flex-col", wide && "min-w-[640px]")}>
        {/* Day headings */}
        <div className="flex border-b border-border">
          <div className="w-12 shrink-0" />
          {days.map((date) => (
            <div
              key={date}
              className={cn(
                "min-w-0 flex-1 border-l border-border px-1 py-1.5 text-center text-xs",
                date === today ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {format.dateTime(new Date(`${date}T00:00:00Z`), wide ? HEADING_WIDE : HEADING_DAY)}
            </div>
          ))}
        </div>
        {/* All-day lane */}
        <div className="flex border-b border-border">
          <div className="flex w-12 shrink-0 items-center justify-center text-[11px] text-muted-foreground">
            {t("allDay")}
          </div>
          <DateRow {...props} days={days} items={allDay} lanes={Infinity} minLanes={1} />
        </div>
        {/* Hours */}
        <div ref={scroller} className="max-h-[65vh] overflow-y-auto" data-testid="schedule-grid">
          <div className="flex" style={{ height: DAY_PX }}>
            <div className="relative w-12 shrink-0" aria-hidden>
              {Array.from({ length: 23 }, (_, i) => (
                <span
                  key={i}
                  className="absolute right-1.5 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                  style={{ top: (i + 1) * HOUR_PX }}
                >
                  {String(i + 1).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {days.map((date) => (
              <DayColumn key={date} {...props} date={date} blocks={timed} now={now} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  date,
  blocks,
  now,
  conflicts,
  selectedId,
  draggingId,
  clock,
  today,
  begin,
  onSelect,
}: CalendarProps & { date: string; now: number }) {
  const t = useTranslations("schedule");
  const segments = layoutColumns(
    blocks.flatMap((block) => {
      const { first, last } = clock.span(block);
      if (date < first || date > last) return [];
      const start = first === date ? clock.minutes(block.startAt) : 0;
      const end = clock.date(block.endAt) === date ? clock.minutes(block.endAt) : 1440;
      return [{ item: block, start, end: Math.max(end, start + 15) }];
    }),
  );
  return (
    <div
      data-drop="grid"
      data-date={date}
      data-testid={`schedule-column-${date}`}
      className={cn(
        "relative min-w-0 flex-1 border-l border-border",
        date === today && "bg-primary/[0.03]",
      )}
      style={{
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX - 1}px, var(--color-border) ${HOUR_PX}px)`,
      }}
    >
      {date === today ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger/70"
          style={{ top: (clock.minutes(now) / 1440) * DAY_PX }}
        />
      ) : null}
      {segments.map(({ item: block, start, end, column, columns }) => {
        const conflict = conflicts.has(block.id);
        const height = ((end - start) / 1440) * DAY_PX;
        const timeLabel = `${clock.time(block.startAt)}–${clock.time(block.endAt)}`;
        const startsHere = clock.date(block.startAt) === date;
        const endsHere = clock.date(block.endAt) === date || clock.minutes(block.endAt) === 0;
        return (
          <div
            key={`${block.id}-${date}`}
            role="button"
            tabIndex={block.phantom ? -1 : 0}
            aria-label={t("block.label", { title: block.task.title, time: timeLabel })}
            aria-pressed={selectedId === block.id}
            data-testid={block.phantom ? "schedule-phantom" : "schedule-block"}
            data-block-id={block.id}
            onPointerDown={(event) =>
              !block.phantom && begin({ kind: "move", block, grab: null }, event)
            }
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !block.phantom) {
                event.preventDefault();
                onSelect(block.id);
              }
            }}
            className={cn(
              "absolute touch-none overflow-hidden rounded-md border px-1.5 py-0.5 text-xs shadow-xs select-none",
              tone(block),
              block.phantom && "pointer-events-none border-dashed opacity-70",
              draggingId === block.id && "z-20 opacity-85 shadow-md",
              conflict && "ring-2 ring-danger/70",
              selectedId === block.id && "ring-2 ring-ring",
              "cursor-grab active:cursor-grabbing",
            )}
            style={{
              top: (start / 1440) * DAY_PX,
              height: Math.max(height, 18),
              left: `calc(${(column / columns) * 100}% + 2px)`,
              width: `calc(${100 / columns}% - 4px)`,
            }}
          >
            {startsHere && !block.phantom ? (
              <span
                aria-label={t("block.resizeStart")}
                data-testid="schedule-resize-start"
                onPointerDown={(event) => begin({ kind: "resize-start", block }, event)}
                className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
              />
            ) : null}
            <BlockBody
              block={block}
              conflict={conflict}
              timeLabel={height >= 34 ? timeLabel : undefined}
            />
            {endsHere && !block.phantom ? (
              <span
                aria-label={t("block.resizeEnd")}
                data-testid="schedule-resize-end"
                onPointerDown={(event) => begin({ kind: "resize-end", block }, event)}
                className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- date bars (all-day lane and month) */

function DateRow({
  days,
  items,
  lanes,
  minLanes = 0,
  topOffset = 0,
  onMore,
  conflicts,
  selectedId,
  draggingId,
  clock,
  begin,
  onSelect,
}: CalendarProps & {
  days: string[];
  items: ShownBlock[];
  lanes: number;
  minLanes?: number;
  topOffset?: number;
  onMore?: (date: string) => void;
}) {
  const t = useTranslations("schedule");
  const segments = layoutSegments(
    items.map((block) => ({ item: block, ...spanOf(block, clock) })),
    days,
  );
  const shown = segments.filter((s) => s.lane < lanes);
  const hidden = days.map(
    (_, column) =>
      segments.filter((s) => s.lane >= lanes && s.start <= column && s.end >= column).length,
  );
  const used = Math.max(minLanes, Math.min(lanes, Math.max(0, ...segments.map((s) => s.lane + 1))));
  const width = 100 / days.length;
  return (
    <div
      className="relative min-w-0 flex-1"
      style={{ minHeight: topOffset + used * LANE_PX + (onMore ? 18 : 4) }}
    >
      <div className="absolute inset-0 flex">
        {days.map((date) => (
          <div
            key={date}
            data-drop="day"
            data-date={date}
            className="min-w-0 flex-1 border-l border-border first:border-l-0"
          />
        ))}
      </div>
      {shown.map(({ item: block, start, end, lane, clippedStart, clippedEnd }) => {
        const conflict = conflicts.has(block.id);
        const timeLabel = block.allDay ? undefined : clock.time(block.startAt);
        return (
          <div
            key={`${block.id}-${days[0]}`}
            role="button"
            tabIndex={block.phantom ? -1 : 0}
            aria-label={t("block.label", {
              title: block.task.title,
              time: block.allDay
                ? t("allDay")
                : `${clock.time(block.startAt)}–${clock.time(block.endAt)}`,
            })}
            aria-pressed={selectedId === block.id}
            data-testid={block.phantom ? "schedule-phantom" : "schedule-bar"}
            data-block-id={block.id}
            onPointerDown={(event) =>
              !block.phantom && begin({ kind: "move", block, grab: null }, event)
            }
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !block.phantom) {
                event.preventDefault();
                onSelect(block.id);
              }
            }}
            className={cn(
              "absolute flex touch-none items-center gap-1 overflow-hidden border px-1.5 text-[11px] select-none",
              tone(block),
              clippedStart ? "rounded-l-none border-l-0" : "rounded-l-md",
              clippedEnd ? "rounded-r-none border-r-0" : "rounded-r-md",
              block.phantom && "pointer-events-none border-dashed opacity-70",
              draggingId === block.id && "z-20 opacity-85 shadow-md",
              conflict && "ring-2 ring-danger/70",
              selectedId === block.id && "ring-2 ring-ring",
              "cursor-grab active:cursor-grabbing",
            )}
            style={{
              top: topOffset + lane * LANE_PX + 2,
              height: LANE_PX - 4,
              left: `calc(${start * width}% + 2px)`,
              width: `calc(${(end - start + 1) * width}% - 4px)`,
            }}
          >
            {timeLabel ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">{timeLabel}</span>
            ) : null}
            <BlockBody block={block} conflict={conflict} />
            {!clippedEnd && !block.phantom ? (
              <span
                aria-label={t("block.resizeDays")}
                data-testid="schedule-resize-days"
                onPointerDown={(event) => begin({ kind: "resize-days", block }, event)}
                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
              />
            ) : null}
          </div>
        );
      })}
      {onMore
        ? hidden.map((count, column) =>
            count > 0 ? (
              <button
                key={days[column]}
                type="button"
                onClick={() => onMore(days[column]!)}
                className="absolute bottom-0.5 truncate px-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
                style={{ left: `${column * width}%`, width: `${width}%` }}
              >
                {t("more", { count })}
              </button>
            ) : null,
          )
        : null}
    </div>
  );
}

function spanOf(block: ShownBlock, clock: Clock) {
  return clock.span(block);
}

/* --------------------------------------------------------------------------- month view */

export function MonthGrid({
  days,
  month,
  onOpenDay,
  ...props
}: CalendarProps & { days: string[]; month: string; onOpenDay: (date: string) => void }) {
  const format = useFormatter();
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  return (
    <div
      className="overflow-x-auto rounded-lg border border-border bg-surface"
      data-testid="schedule-month"
    >
      <div className="min-w-[560px]">
        <div className="flex border-b border-border">
          {weeks[0]!.map((date) => (
            <div
              key={date}
              className="min-w-0 flex-1 py-1.5 text-center text-xs text-muted-foreground"
            >
              {format.dateTime(new Date(`${date}T00:00:00Z`), WEEKDAY)}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="relative flex border-b border-border last:border-b-0">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex">
              {week.map((date) => (
                <div key={date} className="min-w-0 flex-1 px-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenDay(date)}
                    className={cn(
                      "pointer-events-auto rounded px-1 text-xs tabular-nums hover:bg-surface-muted",
                      date === props.today
                        ? "bg-primary font-semibold text-primary-foreground hover:bg-primary"
                        : date.slice(0, 7) === month
                          ? "text-foreground"
                          : "text-muted-foreground/60",
                    )}
                  >
                    {Number(date.slice(8))}
                  </button>
                </div>
              ))}
            </div>
            <DateRow
              days={week}
              items={props.blocks}
              lanes={MONTH_LANES}
              minLanes={MONTH_LANES}
              topOffset={24}
              onMore={onOpenDay}
              {...props}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
