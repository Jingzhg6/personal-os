"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { useAreaLabel } from "@/modules/areas/ui";
import { usePriorityLabel, useStatusLabel } from "@/modules/tasks/ui";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

import {
  actionsFor,
  conditionsFor,
  goalStatusValues,
  LIMITS,
  ruleConfigSchema,
  scheduleKinds,
  templateTokens,
  triggerKeyOf,
  triggerTypes,
  type Action,
  type ActionType,
  type Condition,
  type ConditionType,
  type RuleConfig,
  type Schedule,
  type TriggerType,
} from "../domain";
import { RuleSummary } from "./summary";
import { useHealth, useLookups } from "./use-automation";

const textareaClass =
  "w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

const PRIORITIES = [0, 1, 2, 3, 4];

/** Drafts are loose while editing; the domain schema decides what is valid. */
type ConditionDraft = { type: ConditionType; value: string };
type ActionDraft = {
  type: ActionType;
  title: string;
  text: string;
  areaId: string;
  projectId: string;
  priority: number;
  dueInDays: string;
};

const emptyAction = (type: ActionType): ActionDraft => ({
  type,
  title: "",
  text: "",
  areaId: "",
  projectId: "",
  priority: type === "set_task_priority" ? 3 : 0,
  dueInDays: "",
});

function conditionToDraft(c: Condition): ConditionDraft {
  switch (c.type) {
    case "task_priority":
    case "project_priority":
      return { type: c.type, value: String(c.priority) };
    case "task_area":
    case "project_area":
      return { type: c.type, value: c.areaId };
    case "task_project":
      return { type: c.type, value: c.projectId };
    case "task_status":
      return { type: c.type, value: c.statusId };
    case "goal_status":
      return { type: c.type, value: c.status };
    case "finance_all_valued":
      return { type: c.type, value: "" };
  }
}

function draftToCondition(d: ConditionDraft): unknown {
  switch (d.type) {
    case "task_priority":
    case "project_priority":
      return { type: d.type, priority: Number(d.value) };
    case "task_area":
    case "project_area":
      return { type: d.type, areaId: d.value };
    case "task_project":
      return { type: d.type, projectId: d.value };
    case "task_status":
      return { type: d.type, statusId: d.value };
    case "goal_status":
      return { type: d.type, status: d.value };
    case "finance_all_valued":
      return { type: d.type };
  }
}

function actionToDraft(a: Action): ActionDraft {
  const base = emptyAction(a.type);
  switch (a.type) {
    case "create_task":
      return {
        ...base,
        title: a.title,
        text: a.description ?? "",
        areaId: a.areaId ?? "",
        projectId: a.projectId ?? "",
        priority: a.priority,
        dueInDays: a.dueInDays === null ? "" : String(a.dueInDays),
      };
    case "create_follow_up_task":
      return {
        ...base,
        title: a.title,
        text: a.description ?? "",
        priority: a.priority,
        dueInDays: a.dueInDays === null ? "" : String(a.dueInDays),
      };
    case "notify":
      return { ...base, title: a.title, text: a.body ?? "" };
    case "set_task_priority":
      return { ...base, priority: a.priority };
  }
}

function draftToAction(d: ActionDraft): unknown {
  const due = d.dueInDays === "" ? null : Number(d.dueInDays);
  const text = d.text.trim() || null;
  switch (d.type) {
    case "create_task":
      return {
        type: d.type,
        title: d.title,
        description: text,
        areaId: d.areaId || null,
        projectId: d.projectId || null,
        priority: d.priority,
        dueInDays: due,
      };
    case "create_follow_up_task":
      return {
        type: d.type,
        title: d.title,
        description: text,
        priority: d.priority,
        dueInDays: due,
      };
    case "notify":
      return { type: d.type, title: d.title, body: text };
    case "set_task_priority":
      return { type: d.type, priority: d.priority };
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The guided rule builder: trigger → its settings → optional conditions → actions → review.
 * Saving never enables a rule.
 */
export function RuleBuilder({
  initial,
  pending,
  submitLabel,
  note,
  onSubmit,
  onCancel,
}: {
  initial?: RuleConfig;
  pending?: boolean;
  submitLabel: string;
  note: string;
  onSubmit: (config: RuleConfig) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("automation");
  const toast = useToast();
  const ids = { name: useId(), description: useId() };
  const initialSchedule: Schedule | null =
    initial?.trigger.type === "schedule" ? initial.trigger.schedule : null;

  const [triggerType, setTriggerType] = useState<TriggerType>(
    initial?.trigger.type ?? "task.completed",
  );
  const [schedule, setSchedule] = useState({
    kind: initialSchedule?.kind ?? "monthly",
    date: initialSchedule?.kind === "once" ? initialSchedule.date : today(),
    time: initialSchedule?.time ?? "09:00",
    weekdays: initialSchedule?.kind === "weekly" ? initialSchedule.weekdays : [1],
    day: initialSchedule?.kind === "monthly" ? initialSchedule.day : 1,
  });
  const [conditions, setConditions] = useState<ConditionDraft[]>(
    initial?.conditions.map(conditionToDraft) ?? [],
  );
  const [actions, setActions] = useState<ActionDraft[]>(
    initial?.actions.map(actionToDraft) ?? [emptyAction("create_follow_up_task")],
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [showErrors, setShowErrors] = useState(false);

  const availableConditions = conditionsFor(triggerType);
  const availableActions = actionsFor(triggerType);

  function buildSchedule(): unknown {
    switch (schedule.kind) {
      case "once":
        return { kind: "once", date: schedule.date, time: schedule.time };
      case "daily":
        return { kind: "daily", time: schedule.time };
      case "weekly":
        return { kind: "weekly", weekdays: schedule.weekdays, time: schedule.time };
      case "monthly":
        return { kind: "monthly", day: schedule.day, time: schedule.time };
    }
  }

  const candidate = {
    name,
    description: description.trim() || null,
    trigger:
      triggerType === "schedule"
        ? { type: "schedule", schedule: buildSchedule() }
        : { type: triggerType },
    conditions: conditions.map(draftToCondition),
    actions: actions.map(draftToAction),
    timeZone: initial?.timeZone ?? null,
  };
  const parsed = ruleConfigSchema.safeParse(candidate);

  function changeTrigger(next: TriggerType) {
    setTriggerType(next);
    const conditionsOk = conditionsFor(next);
    const actionsOk = actionsFor(next);
    setConditions((list) => list.filter((c) => conditionsOk.includes(c.type)));
    setActions((list) => {
      const kept = list.filter((a) => actionsOk.includes(a.type));
      return kept.length
        ? kept
        : [
            emptyAction(
              actionsOk.includes("create_follow_up_task") ? "create_follow_up_task" : "notify",
            ),
          ];
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (!parsed.success) {
      toast.show(t("builder.invalid"), "error");
      return;
    }
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" data-testid="rule-builder" noValidate>
      <Step title={t("builder.step1")}>
        <div
          role="radiogroup"
          aria-label={t("builder.step1")}
          className="grid gap-2 sm:grid-cols-2"
        >
          {triggerTypes.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={type === triggerType}
              onClick={() => changeTrigger(type)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm",
                type === triggerType
                  ? "border-primary bg-primary/8 ring-1 ring-primary"
                  : "border-border hover:bg-surface-muted",
              )}
              data-testid={`trigger-${type}`}
            >
              <span className="font-medium">{t(`triggers.${triggerKeyOf(type)}`)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`triggerHints.${triggerKeyOf(type)}`)}
              </span>
            </button>
          ))}
        </div>
      </Step>

      <Step title={t("builder.step2")}>
        {triggerType === "schedule" ? (
          <ScheduleFields value={schedule} onChange={setSchedule} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("builder.noConfig")}</p>
        )}
      </Step>

      <Step title={t("builder.step3")} hint={t("conditions.hint")}>
        {availableConditions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("conditions.unavailable")}</p>
        ) : (
          <>
            {conditions.map((condition, index) => (
              <ConditionRow
                key={index}
                value={condition}
                types={availableConditions}
                invalid={
                  showErrors && condition.type !== "finance_all_valued" && condition.value === ""
                }
                onChange={(next) =>
                  setConditions((list) => list.map((c, i) => (i === index ? next : c)))
                }
                onRemove={() => setConditions((list) => list.filter((_, i) => i !== index))}
              />
            ))}
            {conditions.length < LIMITS.conditions ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={() =>
                  setConditions((list) => [
                    ...list,
                    {
                      type: availableConditions[0]!,
                      value: availableConditions[0] === "task_priority" ? "3" : "",
                    },
                  ])
                }
                data-testid="condition-add"
              >
                <Plus aria-hidden />
                {t("conditions.add")}
              </Button>
            ) : null}
          </>
        )}
      </Step>

      <Step title={t("builder.step4")} hint={t("actions.hint", { max: LIMITS.actions })}>
        {actions.map((action, index) => (
          <ActionRow
            key={index}
            value={action}
            types={availableActions}
            showErrors={showErrors}
            canRemove={actions.length > 1}
            onChange={(next) => setActions((list) => list.map((a, i) => (i === index ? next : a)))}
            onRemove={() => setActions((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        {actions.length < LIMITS.actions ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => setActions((list) => [...list, emptyAction(availableActions[0]!)])}
            data-testid="action-add"
          >
            <Plus aria-hidden />
            {t("actions.add")}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("actions.tokens", { tokens: templateTokens.join(" ") })}
        </p>
      </Step>

      <Step title={t("builder.step5")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t("builder.name")}</Label>
          <Input
            id={ids.name}
            value={name}
            maxLength={80}
            placeholder={t("builder.namePlaceholder")}
            aria-invalid={showErrors && name.trim() === ""}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.description}>{t("builder.description")}</Label>
          <textarea
            id={ids.description}
            rows={2}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={textareaClass}
          />
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/50 p-3">
          <span className="text-xs font-medium text-muted-foreground">{t("builder.summary")}</span>
          {parsed.success ? (
            <RuleSummary
              trigger={parsed.data.trigger}
              conditions={parsed.data.conditions}
              actions={parsed.data.actions}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("builder.invalid")}</p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{note}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("builder.cancel")}
          </Button>
          <Button type="submit" disabled={pending} data-testid="rule-save">
            {submitLabel}
          </Button>
        </div>
      </Step>
    </form>
  );
}

function Step({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

type ScheduleDraft = {
  kind: Schedule["kind"];
  date: string;
  time: string;
  weekdays: number[];
  day: number;
};

function ScheduleFields({
  value,
  onChange,
}: {
  value: ScheduleDraft;
  onChange: (value: ScheduleDraft) => void;
}) {
  const t = useTranslations("automation.schedule");
  const { timeZone } = useLookups();
  const { data: health } = useHealth();
  const ids = { kind: useId(), date: useId(), time: useId(), day: useId() };
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex flex-col gap-3" data-testid="schedule-fields">
      <p
        className={cn(
          "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
          health?.scheduler.operational
            ? "border-success/50 bg-success/10"
            : "border-warning/60 bg-warning/10",
        )}
        data-testid="schedule-runtime"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {health?.scheduler.operational ? t("workerOk") : t("workerMissing")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.kind}>{t("kind")}</Label>
          <Select
            id={ids.kind}
            value={value.kind}
            onChange={(event) => set({ kind: event.target.value as Schedule["kind"] })}
          >
            {scheduleKinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </Select>
        </div>
        {value.kind === "once" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.date}>{t("date")}</Label>
            <Input
              id={ids.date}
              type="date"
              value={value.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </div>
        ) : null}
        {value.kind === "monthly" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.day}>{t("day")}</Label>
            <Select
              id={ids.day}
              value={value.day}
              onChange={(e) => set({ day: Number(e.target.value) })}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.time}>{t("time")}</Label>
          <Input
            id={ids.time}
            type="time"
            value={value.time}
            onChange={(e) => set({ time: e.target.value })}
          />
        </div>
      </div>
      {value.kind === "weekly" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{t("weekdays")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
              const on = value.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      weekdays: on
                        ? value.weekdays.filter((x) => x !== d)
                        : [...value.weekdays, d].sort(),
                    })
                  }
                  className={cn(
                    "size-9 rounded-full border text-sm",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {t(`weekday.${d}` as "weekday.1")}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {value.kind === "monthly" && value.day > 28 ? (
        <p className="text-xs text-muted-foreground">{t("dayHint")}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("timeZone", { zone })}</p>
      <p className="text-xs text-muted-foreground">{t("dst")}</p>
    </div>
  );
}

function ConditionRow({
  value,
  types,
  invalid,
  onChange,
  onRemove,
}: {
  value: ConditionDraft;
  types: ConditionType[];
  invalid: boolean;
  onChange: (value: ConditionDraft) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("automation");
  const areaLabel = useAreaLabel();
  const statusLabel = useStatusLabel();
  const priorityLabel = usePriorityLabel();
  const { areas, projects, statuses } = useLookups();
  const id = useId();

  let options: { value: string; label: string }[] | null = null;
  switch (value.type) {
    case "task_priority":
    case "project_priority":
      options = PRIORITIES.map((p) => ({ value: String(p), label: priorityLabel(p) }));
      break;
    case "task_area":
    case "project_area":
      options = areas.map((a) => ({ value: a.id, label: areaLabel(a) }));
      break;
    case "task_project":
      options = projects.map((p) => ({ value: p.id, label: p.name }));
      break;
    case "task_status":
      options = statuses.map((s) => ({ value: s.id, label: statusLabel(s) }));
      break;
    case "goal_status":
      options = goalStatusValues.map((s) => ({ value: s, label: t(`goalStatus.${s}`) }));
      break;
    case "finance_all_valued":
      options = null;
  }

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="condition-row">
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label htmlFor={`${id}-type`}>{t("conditions.type")}</Label>
        <Select
          id={`${id}-type`}
          value={value.type}
          onChange={(event) => onChange({ type: event.target.value as ConditionType, value: "" })}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`conditions.types.${type}`)}
            </option>
          ))}
        </Select>
      </div>
      {options ? (
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-value`} className="sr-only">
            {t(`conditions.types.${value.type}`)}
          </Label>
          <Select
            id={`${id}-value`}
            value={value.value}
            aria-invalid={invalid}
            onChange={(event) => onChange({ ...value, value: event.target.value })}
            data-testid="condition-value"
          >
            <option value="" disabled>
              {t("conditions.select")}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <Button variant="ghost" size="icon" aria-label={t("conditions.remove")} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

function ActionRow({
  value,
  types,
  showErrors,
  canRemove,
  onChange,
  onRemove,
}: {
  value: ActionDraft;
  types: ActionType[];
  showErrors: boolean;
  canRemove: boolean;
  onChange: (value: ActionDraft) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("automation.actions");
  const areaLabel = useAreaLabel();
  const priorityLabel = usePriorityLabel();
  const { areas, projects } = useLookups();
  const id = useId();
  const set = (patch: Partial<ActionDraft>) => onChange({ ...value, ...patch });
  const isTask = value.type === "create_task" || value.type === "create_follow_up_task";

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      data-testid="action-row"
    >
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${id}-type`}>{t("type")}</Label>
          <Select
            id={`${id}-type`}
            value={value.type}
            onChange={(event) =>
              onChange({ ...emptyAction(event.target.value as ActionType), title: value.title })
            }
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </Select>
        </div>
        {canRemove ? (
          <Button variant="ghost" size="icon" aria-label={t("remove")} onClick={onRemove}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t(`typeHints.${value.type}`)}</p>
      {value.type !== "set_task_priority" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-title`}>{isTask ? t("taskTitle") : t("notifyTitle")}</Label>
          <Input
            id={`${id}-title`}
            value={value.title}
            maxLength={isTask ? 200 : 120}
            aria-invalid={showErrors && value.title.trim() === ""}
            onChange={(event) => set({ title: event.target.value })}
          />
        </div>
      ) : null}
      {value.type !== "set_task_priority" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-text`}>{isTask ? t("description") : t("notifyBody")}</Label>
          <textarea
            id={`${id}-text`}
            rows={2}
            maxLength={isTask ? 2000 : 500}
            value={value.text}
            onChange={(event) => set({ text: event.target.value })}
            className={textareaClass}
          />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {value.type === "create_task" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-area`}>{t("area")}</Label>
              <Select
                id={`${id}-area`}
                value={value.areaId}
                onChange={(e) => set({ areaId: e.target.value })}
              >
                <option value="">{t("noArea")}</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {areaLabel(a)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-project`}>{t("project")}</Label>
              <Select
                id={`${id}-project`}
                value={value.projectId}
                onChange={(e) => set({ projectId: e.target.value })}
              >
                <option value="">{t("noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
        {value.type !== "notify" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-priority`}>{t("priority")}</Label>
            <Select
              id={`${id}-priority`}
              value={value.priority}
              onChange={(e) => set({ priority: Number(e.target.value) })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {isTask ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-due`}>{t("dueInDays")}</Label>
            <Select
              id={`${id}-due`}
              value={value.dueInDays}
              onChange={(e) => set({ dueInDays: e.target.value })}
            >
              <option value="">{t("dueNone")}</option>
              {[0, 1, 2, 3, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {t("dueDays", { days: d })}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
