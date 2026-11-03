"use client";

import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GripVertical,
  Repeat,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useWeekStartsOn } from "@/modules/settings/ui";
import {
  quadrants,
  type Quadrant,
  matrixPlacement,
  type TaskListQuery,
} from "@/modules/tasks/domain";
import {
  StatusIcon,
  TaskDetailPanel,
  useRecurrenceRefresh,
  useTaskList,
  useTaskPanel,
  useToday,
} from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { PageHeader } from "@/shared/ui/page-header";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import {
  calendarViews,
  conflictingBlockIds,
  DEFAULT_BLOCK_MINUTES,
  shiftDate,
  stepAnchor,
  viewDates,
  type CalendarView,
  type ScheduleBlock,
} from "../domain";
import { MonthGrid, TimeGrid, type ShownBlock } from "./calendar";
import { useDragEngine, type DragOp, type DragTask } from "./drag";
import { useScheduleBlocks, useZonedClock, type BlockTimes, type Clock } from "./use-schedule";

const OPEN = ["backlog", "unstarted", "started"] as const;
const SHORT_DATE = { timeZone: "UTC", month: "numeric", day: "numeric" } as const;
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d\d-\d\d$/.test(v);

/**
 * Schedule Planner: one quadrant's open tasks on the left, a day / week / month calendar on the
 * right. Dragging a task onto the calendar creates a schedule block (the task itself does not
 * change); blocks can be moved and resized, and every change is saved at once.
 */
export function PlannerView({ title }: { title: string }) {
  const t = useTranslations("schedule");
  const tm = useTranslations("tasks.matrix.placements");
  const format = useFormatter();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = useToday();
  const weekStartsOn = useWeekStartsOn();
  const clock = useZonedClock();
  const { openTaskId, openTask, closeTask } = useTaskPanel();
  useRecurrenceRefresh();

  const view: CalendarView = (calendarViews as readonly string[]).includes(
    searchParams.get("view") ?? "",
  )
    ? (searchParams.get("view") as CalendarView)
    : "week";
  const anchor = isDate(searchParams.get("date")) ? searchParams.get("date")! : today;
  const quadrant: Quadrant = (quadrants as readonly string[]).includes(searchParams.get("q") ?? "")
    ? (searchParams.get("q") as Quadrant)
    : "do";
  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const days = useMemo(() => viewDates(view, anchor, weekStartsOn), [view, anchor, weekStartsOn]);
  const range = useMemo(
    () => ({
      from: new Date(clock.instant(days[0]!, 0)),
      to: new Date(clock.instant(shiftDate(days.at(-1)!, 1), 0)),
    }),
    [clock, days],
  );
  const schedule = useScheduleBlocks(range);

  // Tasks of the chosen quadrant (open ones, subtasks included), from the shared task list.
  const query: TaskListQuery = useMemo(
    () => ({ today, sort: "due", includeSubtasks: true, filter: { categories: [...OPEN] } }),
    [today],
  );
  const taskList = useTaskList(query);
  // Recurring instances are generated weeks ahead: list only those up to the end of the visible
  // range, so one series does not fill the list.
  const lastDay = days.at(-1)!;
  const tasks = (taskList.data ?? []).filter(
    (task) =>
      matrixPlacement(task) === quadrant &&
      !(task.recurrenceId && task.dueDate && task.dueDate > lastDay),
  );
  // Titles and statuses on blocks come from the task: refresh blocks when tasks change.
  const { refresh } = schedule;
  useEffect(() => {
    if (taskList.dataUpdatedAt) void refresh();
  }, [taskList.dataUpdatedAt, refresh]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<ShownBlock | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  function commit(op: DragOp, times: BlockTimes) {
    if (op.kind === "create") {
      setCreating(phantom(op.task, times));
      schedule.create.mutate(
        { taskId: op.task.id, ...times },
        {
          onSuccess: (block) => {
            setSelectedId(block.id);
            toast.show(t("placed", { title: op.task.title }));
          },
          onSettled: () => setCreating(null),
        },
      );
      return;
    }
    const { block } = op;
    if (
      block.startAt.getTime() === times.startAt.getTime() &&
      block.endAt.getTime() === times.endAt.getTime() &&
      block.allDay === times.allDay
    )
      return;
    schedule.update.mutate({ id: block.id, ...times });
  }

  const { drag, begin } = useDragEngine({
    clock,
    scroller,
    onCommit: commit,
    onClick: (op) => {
      if (op.kind !== "create") setSelectedId(op.block.id);
    },
  });

  // What the calendar draws: stored blocks, with the dragged one at its preview position.
  const shown: ShownBlock[] = useMemo(() => {
    const list: ShownBlock[] = schedule.blocks.map((b) =>
      drag && drag.op.kind !== "create" && drag.op.block.id === b.id && drag.preview
        ? { ...b, ...drag.preview }
        : b,
    );
    if (drag?.op.kind === "create" && drag.preview) list.push(phantom(drag.op.task, drag.preview));
    if (creating) list.push(creating);
    return list;
  }, [schedule.blocks, drag, creating]);
  const conflicts = useMemo(() => conflictingBlockIds(shown), [shown]);
  const realConflicts = [...conflicts].filter((id) => !id.startsWith("new:")).length;
  const selected = schedule.blocks.find((b) => b.id === selectedId) ?? null;
  const blockCount = (taskId: string) => schedule.blocks.filter((b) => b.taskId === taskId).length;

  /** Keyboard alternative to dragging: plan the task on the anchor day. */
  function place(task: DragTask) {
    let times: BlockTimes;
    if (view === "month") {
      times = {
        startAt: new Date(clock.instant(anchor, 0)),
        endAt: new Date(clock.instant(shiftDate(anchor, 1), 0)),
        allDay: true,
      };
    } else {
      const date =
        view === "day" || days.includes(today) ? (view === "day" ? anchor : today) : days[0]!;
      const nextHour = date === today ? Math.ceil(clock.minutes(Date.now()) / 60) * 60 : 0;
      const start = Math.min(Math.max(9 * 60, nextHour), 23 * 60);
      const startAt = clock.instant(date, start);
      const minutes = task.estimatedMinutes ?? DEFAULT_BLOCK_MINUTES;
      times = {
        startAt: new Date(startAt),
        endAt: new Date(startAt + minutes * 60_000),
        allDay: false,
      };
    }
    commit({ kind: "create", task }, times);
  }

  const heading =
    view === "day"
      ? format.dateTime(new Date(`${anchor}T00:00:00Z`), {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "short",
        })
      : view === "week"
        ? `${format.dateTime(new Date(`${days[0]}T00:00:00Z`), { timeZone: "UTC", month: "long", day: "numeric" })} – ${format.dateTime(new Date(`${days[6]}T00:00:00Z`), { timeZone: "UTC", month: "long", day: "numeric" })}`
        : format.dateTime(new Date(`${anchor}T00:00:00Z`), {
            timeZone: "UTC",
            year: "numeric",
            month: "long",
          });

  const calendarProps = {
    blocks: shown,
    conflicts,
    selectedId,
    draggingId: drag && drag.op.kind !== "create" ? drag.op.block.id : null,
    clock,
    today,
    begin,
    onSelect: setSelectedId,
  };

  return (
    <div className={cn("transition-[padding]", openTaskId && "lg:pr-[480px]")}>
      <div className="flex flex-col gap-4" data-testid="schedule-planner">
        <PageHeader title={title} description={t("description")} />
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Left: one quadrant's tasks, then the selected block */}
          <div className="flex min-w-0 flex-col gap-4">
            <QuadrantTasks
              quadrant={quadrant}
              onQuadrant={(q) => setParams({ q })}
              tasks={tasks}
              loading={taskList.isPending}
              placeLabel={(task) =>
                t("placeLabel", { title: task.title, date: view === "month" ? anchor : heading })
              }
              blockCount={blockCount}
              begin={begin}
              onPlace={place}
              onOpen={openTask}
              labelOf={(q) => tm(`${q}.title`)}
            />
            <BlockEditor
              key={selected?.id ?? "none"}
              block={selected}
              clock={clock}
              onSave={(times) =>
                selected &&
                schedule.update.mutate(
                  { id: selected.id, ...times },
                  { onSuccess: () => toast.show(t("block.saved")) },
                )
              }
              onDelete={() =>
                selected &&
                schedule.remove.mutate(
                  { id: selected.id },
                  {
                    onSuccess: () => {
                      setSelectedId(null);
                      toast.show(t("block.deleted"));
                    },
                  },
                )
              }
              onOpenTask={() => selected && openTask(selected.taskId)}
            />
          </div>

          {/* Right: the calendar */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("previous")}
                  onClick={() => setParams({ date: stepAnchor(view, anchor, -1) })}
                  data-testid="schedule-prev"
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setParams({ date: null })}>
                  {t("today")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("next")}
                  onClick={() => setParams({ date: stepAnchor(view, anchor, 1) })}
                  data-testid="schedule-next"
                >
                  <ChevronRight aria-hidden />
                </Button>
                <h2
                  className="ml-1 text-sm font-semibold sm:text-base"
                  data-testid="schedule-heading"
                >
                  {heading}
                </h2>
              </div>
              <div
                role="group"
                aria-label={t("views.label")}
                className="inline-flex rounded-md border border-border p-0.5"
              >
                {calendarViews.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={view === key}
                    data-testid={`schedule-view-${key}`}
                    onClick={() => setParams({ view: key === "week" ? null : key })}
                    className={cn(
                      "rounded px-3 py-1 text-sm",
                      view === key
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`views.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* Always takes its line, so the calendar does not jump while a drag changes conflicts. */}
            <p className="min-h-4 text-xs text-danger" data-testid="schedule-conflicts">
              {realConflicts > 0 ? t("conflicts", { count: realConflicts }) : null}
            </p>
            {view === "month" ? (
              <MonthGrid
                days={days}
                month={anchor.slice(0, 7)}
                onOpenDay={(date) => setParams({ view: "day", date })}
                {...calendarProps}
              />
            ) : (
              <TimeGrid days={days} scroller={scroller} {...calendarProps} />
            )}
          </div>
        </div>
      </div>

      {drag?.op.kind === "create" ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 max-w-56 truncate rounded-md border border-primary/50 bg-surface px-2 py-1 text-xs font-medium shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
        >
          {drag.op.task.title}
        </div>
      ) : null}

      {openTaskId ? (
        <TaskDetailPanel taskId={openTaskId} onClose={closeTask} onOpenTask={openTask} />
      ) : null}
    </div>
  );
}

function phantom(task: DragTask, times: BlockTimes): ShownBlock {
  return {
    id: `new:${task.id}`,
    taskId: task.id,
    ...times,
    phantom: true,
    task: {
      title: task.title,
      statusCategory: "unstarted",
      priority: 0,
      isUrgent: null,
      isImportant: null,
      recurrenceId: null,
      dueDate: null,
    },
  };
}

interface ListTask extends DragTask {
  statusCategory: string;
  statusId: string;
  dueDate: string | null;
  recurrenceId: string | null;
}

function QuadrantTasks({
  quadrant,
  onQuadrant,
  tasks,
  loading,
  placeLabel,
  blockCount,
  begin,
  onPlace,
  onOpen,
  labelOf,
}: {
  quadrant: Quadrant;
  onQuadrant: (q: Quadrant) => void;
  tasks: ListTask[];
  loading: boolean;
  placeLabel: (task: ListTask) => string;
  blockCount: (taskId: string) => number;
  begin: ReturnType<typeof useDragEngine>["begin"];
  onPlace: (task: ListTask) => void;
  onOpen: (id: string) => void;
  labelOf: (q: Quadrant) => string;
}) {
  const t = useTranslations("schedule");
  const format = useFormatter();
  const id = useId();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{t("quadrantLabel")}</Label>
          <Select
            id={id}
            value={quadrant}
            onChange={(e) => onQuadrant(e.target.value as Quadrant)}
            data-testid="schedule-quadrant"
          >
            {quadrants.map((q) => (
              <option key={q} value={q}>
                {labelOf(q)}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            {t("tasksIn", { count: tasks.length })}
          </span>
        </div>
        {!loading && tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("noTasks")}</p>
        ) : (
          <ul
            className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto lg:max-h-[50vh]"
            data-testid="schedule-task-list"
          >
            {tasks.map((task) => {
              const count = blockCount(task.id);
              return (
                <li
                  key={task.id}
                  data-testid="schedule-task"
                  className="group flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1.5 hover:bg-surface-muted"
                >
                  <button
                    type="button"
                    aria-label={t("dragHandle", { title: task.title })}
                    data-testid="schedule-task-handle"
                    onPointerDown={(event) =>
                      begin(
                        {
                          kind: "create",
                          task: {
                            id: task.id,
                            title: task.title,
                            estimatedMinutes: task.estimatedMinutes,
                          },
                        },
                        event,
                      )
                    }
                    className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" aria-hidden />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <button
                      type="button"
                      onClick={() => onOpen(task.id)}
                      className="flex min-w-0 items-center gap-1 text-left text-sm"
                    >
                      <StatusIcon
                        category={task.statusCategory as never}
                        className="size-3.5 shrink-0"
                      />
                      {task.recurrenceId ? (
                        <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      ) : null}
                      <span className="truncate">{task.title}</span>
                    </button>
                    <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                      {task.dueDate ? (
                        <span>
                          {format.dateTime(new Date(`${task.dueDate}T00:00:00Z`), SHORT_DATE)}
                        </span>
                      ) : null}
                      {task.estimatedMinutes ? (
                        <span>{t("estimate", { minutes: task.estimatedMinutes })}</span>
                      ) : null}
                      {count > 0 ? (
                        <span className="text-primary">{t("scheduledCount", { count })}</span>
                      ) : null}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={placeLabel(task)}
                    title={t("place")}
                    data-testid="schedule-task-place"
                    onClick={() => onPlace(task)}
                  >
                    <CalendarPlus aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function BlockEditor({
  block,
  clock,
  onSave,
  onDelete,
  onOpenTask,
}: {
  block: ScheduleBlock | null;
  clock: Clock;
  onSave: (times: BlockTimes) => void;
  onDelete: () => void;
  onOpenTask: () => void;
}) {
  const t = useTranslations("schedule.block");
  const tc = useTranslations("tasks.statusCategory");
  const id = useId();
  const local = (at: Date) => `${clock.date(at)}T${clock.time(at)}`;
  const span = block ? clock.span(block) : null;
  const [allDay, setAllDay] = useState(block?.allDay ?? false);
  const [start, setStart] = useState(block ? local(block.startAt) : "");
  const [end, setEnd] = useState(block ? local(block.endAt) : "");
  const [first, setFirst] = useState(span?.first ?? "");
  const [last, setLast] = useState(span?.last ?? "");

  if (!block) {
    return (
      <Card className="hidden lg:block">
        <CardContent className="text-xs text-muted-foreground">{t("none")}</CardContent>
      </Card>
    );
  }

  const toInstant = (value: string) => {
    const [date, time] = value.split("T") as [string, string];
    const [h, m] = time.split(":").map(Number) as [number, number];
    return clock.instant(date, h * 60 + m);
  };
  let times: BlockTimes | null = null;
  if (allDay && first && last && last >= first) {
    times = {
      startAt: new Date(clock.instant(first, 0)),
      endAt: new Date(clock.instant(shiftDate(last, 1), 0)),
      allDay: true,
    };
  } else if (!allDay && start && end && toInstant(end) > toInstant(start)) {
    times = { startAt: new Date(toInstant(start)), endAt: new Date(toInstant(end)), allDay: false };
  }

  return (
    <Card data-testid="schedule-editor">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          {block.task.recurrenceId ? (
            <Repeat
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label={t("recurring")}
            />
          ) : null}
          <span className="truncate" data-testid="schedule-editor-title">
            {block.task.title}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <span className="text-xs text-muted-foreground">
          {t("status", { status: tc(block.task.statusCategory as never) })}
        </span>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              const next = e.target.checked;
              setAllDay(next);
              if (next) {
                setFirst(start.slice(0, 10));
                setLast(
                  end.slice(0, 10) < start.slice(0, 10) ? start.slice(0, 10) : end.slice(0, 10),
                );
              } else {
                setStart(`${first}T09:00`);
                setEnd(`${first}T${pad(10)}:00`);
              }
            }}
            data-testid="schedule-editor-allday"
          />
          {t("allDay")}
        </label>
        {allDay ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-first`}>{t("startDate")}</Label>
              <Input
                id={`${id}-first`}
                type="date"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-last`}>{t("endDate")}</Label>
              <Input
                id={`${id}-last`}
                type="date"
                value={last}
                min={first}
                onChange={(e) => setLast(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-start`}>{t("start")}</Label>
              <Input
                id={`${id}-start`}
                type="datetime-local"
                step={900}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                data-testid="schedule-editor-start"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${id}-end`}>{t("end")}</Label>
              <Input
                id={`${id}-end`}
                type="datetime-local"
                step={900}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                data-testid="schedule-editor-end"
              />
            </div>
          </div>
        )}
        {!times ? <p className="text-xs text-danger">{t("invalid")}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!times}
            onClick={() => times && onSave(times)}
            data-testid="schedule-editor-save"
          >
            {t("save")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpenTask}>
            <ExternalLink aria-hidden />
            {t("openTask")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            data-testid="schedule-editor-delete"
            className="text-danger"
          >
            <Trash2 aria-hidden />
            {t("delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
