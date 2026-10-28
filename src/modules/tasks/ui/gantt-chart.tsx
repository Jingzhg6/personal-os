"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useAreas } from "@/modules/areas/ui";
import { useWeekStartsOn } from "@/modules/settings/ui";
import type { MilestoneMarker, Project } from "@/modules/projects/domain";
import { cn } from "@/shared/lib/cn";
import { useTRPC } from "@/shared/trpc/react";
import { colorClasses } from "@/shared/ui/color";
import { PageHeader } from "@/shared/ui/page-header";

import {
  addDays,
  daysBetween,
  hasScheduleConflict,
  isClosedCategory,
  scheduleSpan,
  timelineWindow,
  type StatusCategory,
  type Task,
  type TaskListQuery,
} from "../domain";
import { FilterBar } from "./filter-bar";
import { useToday } from "./labels";
import { GanttBar } from "./gantt-bar";
import { useProjectOptions } from "./project-chip";
import { StatusIcon } from "./status-icon";
import { TaskDetailPanel } from "./task-detail-panel";
import { useListUrlState } from "./use-list-state";
import { useTaskPanel } from "./use-task-panel";
import { useStatuses, useTags, useTaskActions, useTimeline } from "./use-task-data";

const zooms = { day: 36, week: 16, month: 5 } as const;
type Zoom = keyof typeof zooms;
const minDays: Record<Zoom, number> = { day: 28, week: 56, month: 180 };

const ROW = 36;
const MONTH_LABEL = { timeZone: "UTC", year: "numeric", month: "short" } as const;
const WEEK_LABEL = { timeZone: "UTC", month: "numeric", day: "numeric" } as const;
/** Cancelled tasks are left out unless the status filter asks for them. */
const DEFAULT_CATEGORIES: StatusCategory[] = ["backlog", "unstarted", "started", "completed"];

type Row = { kind: "group"; key: string; project: Project | null } | { kind: "task"; task: Task };

/**
 * Gantt chart of top-level tasks by start / due date, grouped by project, with milestones and
 * finish-to-start dependency arrows. Moving a bar edits the task's dates — the same task record
 * as every other view.
 */
export function GanttChart({
  title,
  projectId,
  embedded = false,
}: {
  title?: string;
  /** Limit the chart to one project (inside the project page). */
  projectId?: string;
  embedded?: boolean;
}) {
  const t = useTranslations("tasks.gantt");
  const format = useFormatter();
  const trpc = useTRPC();
  const today = useToday();
  const weekStartsOn = useWeekStartsOn();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useListUrlState();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  const scroller = useRef<HTMLDivElement>(null);
  const corner = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, "");
  const [announcement, setAnnouncement] = useState("");
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const zoomParam = searchParams.get("zoom");
  const zoom: Zoom = zoomParam === "day" || zoomParam === "month" ? zoomParam : "week";
  const dayWidth = zooms[zoom];
  const setZoom = (next: Zoom) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "week") params.delete("zoom");
    else params.set("zoom", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const query: TaskListQuery = useMemo(
    () => ({
      today,
      search: state.search.trim() || undefined,
      sort: "manual",
      includeSubtasks: false,
      filter: {
        ...state.filter,
        categories: state.filter.categories ?? DEFAULT_CATEGORIES,
        ...(projectId ? { projectIds: [projectId], noProject: undefined } : {}),
      },
    }),
    [today, state.search, state.filter, projectId],
  );
  const { data, isPending } = useTimeline(query);
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjectOptions();
  const { data: milestones = [] } = useQuery(trpc.projects.milestones.list.queryOptions());
  const actions = useTaskActions();

  const tasks = useMemo(() => data?.tasks ?? [], [data]);
  const scheduled = tasks.filter((task) => scheduleSpan(task));
  const unscheduled = tasks.filter((task) => !scheduleSpan(task));

  const rows: Row[] = useMemo(() => {
    const byStart = (a: Task, b: Task) => {
      const x = scheduleSpan(a)!;
      const y = scheduleSpan(b)!;
      return (
        x.start.localeCompare(y.start) ||
        x.end.localeCompare(y.end) ||
        a.sortKey.localeCompare(b.sortKey)
      );
    };
    const withDates = tasks.filter((task) => scheduleSpan(task)).sort(byStart);
    const groups = projectId
      ? projects.filter((p) => p.id === projectId)
      : projects.filter((p) => withDates.some((task) => task.projectId === p.id));
    const result: Row[] = [];
    for (const project of groups) {
      result.push({ kind: "group", key: project.id, project });
      for (const task of withDates.filter((x) => x.projectId === project.id))
        result.push({ kind: "task", task });
    }
    const loose = projectId ? [] : withDates.filter((task) => !task.projectId);
    if (loose.length > 0) {
      result.push({ kind: "group", key: "none", project: null });
      for (const task of loose) result.push({ kind: "task", task });
    }
    return result;
  }, [tasks, projects, projectId]);

  const visibleMilestones = milestones.filter(
    (m): m is MilestoneMarker & { dueDate: string } =>
      m.dueDate !== null &&
      rows.some((row) => row.kind === "group" && row.project?.id === m.projectId),
  );

  const spans = scheduled.map((task) => scheduleSpan(task)!);
  for (const row of rows) {
    const project = row.kind === "group" ? row.project : null;
    if (project?.startDate && project.targetDate)
      spans.push({ start: project.startDate, end: project.targetDate });
  }
  for (const m of visibleMilestones) spans.push({ start: m.dueDate, end: m.dueDate });
  const range = timelineWindow(spans, today, minDays[zoom], weekStartsOn);

  const width = range.days * dayWidth;
  const x = (date: string) => daysBetween(range.start, date) * dayWidth;
  const statusColor = new Map(statuses.map((s) => [s.id, s.color]));
  const rowOf = new Map(
    rows.flatMap((row, index) => (row.kind === "task" ? [[row.task.id, index] as const] : [])),
  );

  // Scroll so that today sits a quarter of the way into the visible timeline (beside the
  // pinned task-name column, whose width depends on the screen).
  const todayX = x(today);
  const scrollToToday = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const visible = element.clientWidth - (corner.current?.offsetWidth ?? 0);
    element.scrollLeft = Math.max(todayX - visible / 4, 0);
  }, [todayX]);
  useEffect(scrollToToday, [scrollToToday, zoom, isPending]);

  const shortDate = (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });

  const commit = (task: Task, patch: { startDate: string | null; dueDate: string | null }) => {
    actions.update.mutate({ id: task.id, patch });
    const span = scheduleSpan(patch)!;
    setAnnouncement(
      t("moved", { title: task.title, start: shortDate(span.start), end: shortDate(span.end) }),
    );
  };

  const arrows = (data?.dependencies ?? []).flatMap((dep) => {
    const from = rowOf.get(dep.blockingTaskId);
    const to = rowOf.get(dep.blockedTaskId);
    if (from === undefined || to === undefined) return [];
    const blocking = (rows[from] as { task: Task }).task;
    const blocked = (rows[to] as { task: Task }).task;
    const a = scheduleSpan(blocking)!;
    const b = scheduleSpan(blocked)!;
    return [
      {
        key: `${dep.blockingTaskId}-${dep.blockedTaskId}`,
        d: arrowPath(x(a.end) + dayWidth, from * ROW + ROW / 2, x(b.start), to * ROW + ROW / 2),
        conflict:
          !isClosedCategory(blocked.statusCategory) && hasScheduleConflict(blocking, blocked),
      },
    ];
  });

  const gridStyle = {
    gridTemplateColumns: `var(--gantt-label) ${width}px`,
  } as CSSProperties;

  return (
    <div className={cn("transition-[padding]", openTaskId && !embedded && "lg:pr-[480px]")}>
      <div className="flex flex-col gap-4">
        {embedded || !title ? null : <PageHeader title={title} description={t("description")} />}

        <FilterBar
          state={state}
          onChange={setState}
          areas={areas}
          tags={tags}
          hide={{ sort: true, project: Boolean(projectId) }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label={t("zoom.label")}
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {(Object.keys(zooms) as Zoom[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={zoom === key}
                onClick={() => setZoom(key)}
                className={cn(
                  "rounded px-3 py-1 text-sm",
                  zoom === key
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`zoom.${key}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={scrollToToday}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <CalendarClock className="size-4" aria-hidden />
            {t("today")}
          </button>
        </div>

        {!isPending && scheduled.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <CalendarClock className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="font-medium">{t("empty.title")}</p>
            <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
          </div>
        ) : (
          <div
            ref={scroller}
            role="region"
            aria-label={t("chart")}
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-surface [--gantt-label:8.5rem] sm:[--gantt-label:15rem]"
          >
            <div className="relative grid w-max min-w-full" style={gridStyle}>
              {/* Header */}
              <div
                ref={corner}
                className="sticky left-0 z-30 col-start-1 row-start-1 border-r border-b border-border bg-surface"
              />
              <TimelineHeader
                start={range.start}
                days={range.days}
                dayWidth={dayWidth}
                zoom={zoom}
                today={today}
              />

              {/* Background: weekends, month lines, today */}
              <div
                aria-hidden
                className="pointer-events-none relative col-start-2 row-start-2"
                style={{ gridRowEnd: `span ${Math.max(rows.length, 1)}` }}
              >
                <Background start={range.start} days={range.days} dayWidth={dayWidth} zoom={zoom} />
                <div
                  className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary/60"
                  style={{ left: todayX + dayWidth / 2 }}
                />
              </div>

              {rows.map((row, index) => {
                const gridRow = { gridRowStart: index + 2 };
                if (row.kind === "group") {
                  const project = row.project;
                  return (
                    <GroupRow
                      key={`g-${row.key}`}
                      style={gridRow}
                      project={project}
                      label={project ? project.name : t("noProject")}
                      linkable={!projectId}
                      span={
                        project?.startDate && project.targetDate
                          ? {
                              left: x(project.startDate),
                              width:
                                (daysBetween(project.startDate, project.targetDate) + 1) * dayWidth,
                            }
                          : null
                      }
                      milestones={visibleMilestones
                        .filter((m) => m.projectId === project?.id)
                        .map((m) => ({
                          id: m.id,
                          left: x(m.dueDate) + dayWidth / 2,
                          label: t("milestone", { name: m.name, date: shortDate(m.dueDate) }),
                          done: m.completedAt !== null,
                        }))}
                    />
                  );
                }
                const task = row.task;
                const span = scheduleSpan(task)!;
                const overdue =
                  !isClosedCategory(task.statusCategory) &&
                  task.dueDate !== null &&
                  task.dueDate < today;
                const blocked = task.openBlockerCount > 0 && !isClosedCategory(task.statusCategory);
                const dates =
                  span.start === span.end
                    ? shortDate(span.start)
                    : t("range", { start: shortDate(span.start), end: shortDate(span.end) });
                return (
                  <div key={task.id} className="contents">
                    <div
                      style={gridRow}
                      data-testid="gantt-row"
                      className={cn(
                        "sticky left-0 z-20 col-start-1 flex h-9 min-w-0 items-center gap-2 border-r border-b border-border bg-surface px-3",
                        task.id === openTaskId && "bg-accent",
                      )}
                    >
                      <StatusIcon
                        category={task.statusCategory}
                        color={statusColor.get(task.statusId)}
                        className="size-3.5 shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => openTask(task.id)}
                        className={cn(
                          "min-w-0 flex-1 truncate text-left text-sm",
                          isClosedCategory(task.statusCategory) &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </button>
                      {blocked ? (
                        <Lock
                          className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-label={t("blocked")}
                        />
                      ) : null}
                    </div>
                    <div
                      style={gridRow}
                      className="relative col-start-2 h-9 border-b border-border/60"
                    >
                      <GanttBar
                        task={task}
                        left={x(span.start)}
                        width={(daysBetween(span.start, span.end) + 1) * dayWidth}
                        dayWidth={dayWidth}
                        color={statusColor.get(task.statusId) ?? "gray"}
                        overdue={overdue}
                        label={t("bar", { title: task.title, dates })}
                        onOpen={() => openTask(task.id)}
                        onCommit={(patch) => commit(task, patch)}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Dependency arrows over the bars */}
              {arrows.length > 0 ? (
                <svg
                  aria-hidden
                  data-testid="gantt-arrows"
                  className="pointer-events-none relative z-10 col-start-2 row-start-2 overflow-visible"
                  style={{ gridRowEnd: `span ${rows.length}`, width, height: rows.length * ROW }}
                >
                  <defs>
                    <marker
                      id={`${markerId}-ok`}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
                    </marker>
                    <marker
                      id={`${markerId}-conflict`}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 z" className="fill-danger" />
                    </marker>
                  </defs>
                  {arrows.map((arrow) => (
                    <path
                      key={arrow.key}
                      d={arrow.d}
                      data-conflict={arrow.conflict || undefined}
                      fill="none"
                      strokeWidth={1.5}
                      markerEnd={`url(#${markerId}-${arrow.conflict ? "conflict" : "ok"})`}
                      className={arrow.conflict ? "stroke-danger" : "stroke-muted-foreground/70"}
                    />
                  ))}
                </svg>
              ) : null}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {unscheduled.length > 0 ? (
          <section aria-labelledby="gantt-unscheduled" className="flex flex-col gap-2">
            <h2 id="gantt-unscheduled">
              <button
                type="button"
                aria-expanded={showUnscheduled}
                onClick={() => setShowUnscheduled((v) => !v)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                {showUnscheduled ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
                {t("unscheduled", { count: unscheduled.length })}
              </button>
            </h2>
            {showUnscheduled ? (
              <>
                <p className="px-2 text-xs text-muted-foreground">{t("unscheduledHint")}</p>
                <ul className="flex flex-col gap-0.5">
                  {unscheduled.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted"
                    >
                      <StatusIcon
                        category={task.statusCategory}
                        color={statusColor.get(task.statusId)}
                        className="size-3.5"
                      />
                      <button
                        type="button"
                        onClick={() => openTask(task.id)}
                        className="min-w-0 flex-1 truncate text-left text-sm"
                      >
                        {task.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {openTaskId ? (
          <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Elbow path from the end of one bar to the start of another. When the next bar starts too close
 * (or before), the path drops between the rows and comes back from the left.
 */
function arrowPath(x1: number, y1: number, x2: number, y2: number) {
  const gap = 8;
  if (x2 - x1 >= gap * 2) {
    const mid = x1 + gap;
    return `M${x1},${y1} H${mid} V${y2} H${x2}`;
  }
  const between = y2 > y1 ? y2 - ROW / 2 : y2 + ROW / 2;
  return `M${x1},${y1} H${x1 + gap} V${between} H${x2 - gap} V${y2} H${x2}`;
}

function GroupRow({
  style,
  project,
  label,
  linkable,
  span,
  milestones,
}: {
  style: CSSProperties;
  project: Project | null;
  label: string;
  linkable: boolean;
  span: { left: number; width: number } | null;
  milestones: { id: string; left: number; label: string; done: boolean }[];
}) {
  const t = useTranslations("tasks.gantt");
  const dot = project ? colorClasses[project.color].dot : "bg-zinc-400";
  return (
    <>
      <div
        style={style}
        data-testid="gantt-group"
        className="sticky left-0 z-20 col-start-1 flex h-9 min-w-0 items-center gap-2 border-r border-b border-border bg-surface-muted px-3 text-sm font-medium"
      >
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", dot)} />
        {project && linkable ? (
          <Link
            href={`/projects/${project.id}?view=gantt`}
            className="min-w-0 truncate hover:underline"
          >
            {label}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{label}</span>
        )}
      </div>
      <div
        style={style}
        className="relative col-start-2 h-9 border-b border-border bg-surface-muted/40"
      >
        {span ? (
          <div
            title={t("projectSpan")}
            className={cn("absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full opacity-40", dot)}
            style={{ left: span.left, width: span.width }}
          />
        ) : null}
        {milestones.map((m) => (
          <span
            key={m.id}
            role="img"
            aria-label={m.label}
            title={m.label}
            data-testid="gantt-milestone"
            className={cn(
              "absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-surface",
              m.done ? "bg-muted-foreground" : dot,
            )}
            style={{ left: m.left }}
          />
        ))}
      </div>
    </>
  );
}

function TimelineHeader({
  start,
  days,
  dayWidth,
  zoom,
  today,
}: {
  start: string;
  days: number;
  dayWidth: number;
  zoom: Zoom;
  today: string;
}) {
  const format = useFormatter();
  const weekStartsOn = useWeekStartsOn();
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const months = dates.flatMap((date, i) =>
    i === 0 || date.endsWith("-01") ? [{ date, left: i * dayWidth }] : [],
  );
  const asDate = (date: string) => new Date(`${date}T00:00:00Z`);
  return (
    <div className="relative col-start-2 row-start-1 h-12 border-b border-border text-xs text-muted-foreground">
      {months.map((m, i) => (
        <div
          key={m.date}
          className="absolute top-0 flex h-6 items-center border-l border-border"
          style={{
            left: m.left,
            width: (months[i + 1]?.left ?? days * dayWidth) - m.left,
          }}
        >
          {/* Sticks beside the task-name column while its month is in view. */}
          <span className="sticky left-[var(--gantt-label)] truncate px-1.5 font-medium text-foreground">
            {format.dateTime(asDate(m.date), MONTH_LABEL)}
          </span>
        </div>
      ))}
      {zoom === "month"
        ? null
        : dates.map((date, i) => {
            const weekday = asDate(date).getUTCDay();
            if (zoom === "week" && weekday !== weekStartsOn) return null;
            return (
              <span
                key={date}
                className={cn(
                  "absolute bottom-0 flex h-6 items-center justify-center tabular-nums",
                  date === today && "font-semibold text-primary",
                )}
                style={{ left: i * dayWidth, width: zoom === "day" ? dayWidth : dayWidth * 7 }}
              >
                {zoom === "day"
                  ? asDate(date).getUTCDate()
                  : format.dateTime(asDate(date), WEEK_LABEL)}
              </span>
            );
          })}
    </div>
  );
}

function Background({
  start,
  days,
  dayWidth,
  zoom,
}: {
  start: string;
  days: number;
  dayWidth: number;
  zoom: Zoom;
}) {
  const marks = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (zoom !== "month" && (weekday === 0 || weekday === 6)) {
      marks.push(
        <div
          key={`w${i}`}
          className="absolute inset-y-0 bg-surface-muted/70"
          style={{ left: i * dayWidth, width: dayWidth }}
        />,
      );
    }
    if (date.endsWith("-01")) {
      marks.push(
        <div
          key={`m${i}`}
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: i * dayWidth }}
        />,
      );
    }
  }
  return <>{marks}</>;
}
