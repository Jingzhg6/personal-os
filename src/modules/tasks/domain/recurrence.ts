import { RRule } from "rrule";
import { z } from "zod";

/*
 * Recurring tasks (Phase 1, ADR 0023). A series (`task_recurrences`) stores an RFC 5545 RRULE
 * and a mode; its instances are ordinary tasks (`recurrence_id`, `recurrence_index`). One instance
 * is open at a time: when it is closed (completed, cancelled = skipped, or failed), the next one is
 * created. Pure: dates are local calendar dates ("YYYY-MM-DD") in the series' time zone.
 */

export const recurrenceModes = ["fixed", "after_completion"] as const;
export type RecurrenceMode = (typeof recurrenceModes)[number];

export const recurrenceFrequencies = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFrequency = (typeof recurrenceFrequencies)[number];

/** Upper bound on instances of one series (a series with COUNT may ask for fewer). */
export const MAX_RECURRENCE_COUNT = 1000;

const isoDate = z.iso.date();

/** The structured rule the UI edits; stored as an RRULE string. */
export const recurrenceRule = z
  .strictObject({
    frequency: z.enum(recurrenceFrequencies),
    interval: z.number().int().min(1).max(365),
    /** Weekly: ISO weekdays 1 (Mon) … 7 (Sun). Empty = the weekday of the first due date. */
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .max(7)
      .refine((d) => new Set(d).size === d.length, "Duplicate weekday")
      .default([]),
    /** Monthly: day of month 1…31, or -1 for the last day. Null = the first due date's day. */
    monthDay: z
      .union([z.number().int().min(1).max(31), z.literal(-1)])
      .nullable()
      .default(null),
    end: z
      .discriminatedUnion("type", [
        z.strictObject({ type: z.literal("never") }),
        z.strictObject({ type: z.literal("until"), date: isoDate }),
        z.strictObject({
          type: z.literal("count"),
          count: z.number().int().min(1).max(MAX_RECURRENCE_COUNT),
        }),
      ])
      .default({ type: "never" }),
  })
  .refine((r) => r.frequency === "weekly" || r.weekdays.length === 0, {
    message: "Weekdays only apply to weekly rules",
  })
  .refine((r) => r.frequency === "monthly" || r.monthDay === null, {
    message: "A day of month only applies to monthly rules",
  });
export type RecurrenceRule = z.infer<typeof recurrenceRule>;
export type RecurrenceRuleInput = z.input<typeof recurrenceRule>;

export const setRecurrenceInput = z.object({
  taskId: z.uuid(),
  rule: recurrenceRule,
  mode: z.enum(recurrenceModes).default("fixed"),
});
export const recurrenceTaskInput = z.object({ taskId: z.uuid() });

/** What the task panel shows about a task's series. */
export interface TaskRecurrence {
  id: string;
  rule: RecurrenceRule;
  mode: RecurrenceMode;
  timeZone: string;
  /** This task's position in the series (1 = the first). */
  index: number;
  /** True for the series' newest instance (only it can still produce a successor). */
  isLatest: boolean;
  /** Instances created so far. */
  instances: number;
  endedAt: Date | null;
  /** The next due dates a fixed schedule would produce after this instance (preview). */
  upcoming: string[];
}

/* ---------------------------------------------------------------- RRULE text */

const FREQ = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
} as const;
const WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

/** A local date as the UTC midnight rrule computes with (floating dates, no time zone). */
const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);

export function addDaysTo(date: string, days: number): string {
  const d = asUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

function rruleOf(rule: RecurrenceRule, dtstart: string) {
  return new RRule({
    freq: FREQ[rule.frequency],
    interval: rule.interval,
    dtstart: asUtc(dtstart),
    byweekday: rule.weekdays.length > 0 ? rule.weekdays.map((d) => WEEKDAYS[d - 1]!) : null,
    bymonthday: rule.monthDay ?? null,
    until: rule.end.type === "until" ? asUtc(rule.end.date) : null,
    // COUNT is enforced by the app over created instances, not by rrule (see planNext).
  });
}

/** The stored form: "DTSTART:YYYYMMDD\nRRULE:…" (COUNT kept in the text for completeness). */
export function serializeRule(rule: RecurrenceRule, dtstart: string): string {
  const options = rruleOf(rule, dtstart).origOptions;
  const text = RRule.optionsToString({
    ...options,
    count: rule.end.type === "count" ? rule.end.count : null,
  });
  // rrule writes DTSTART with a time; a date-only series stores the date.
  return text.replace(/DTSTART:(\d{8})T000000Z/, "DTSTART;VALUE=DATE:$1");
}

/** Reads a stored rule back. Unknown or unsupported parts → null (shown, never executed). */
export function parseStoredRule(text: string): { rule: RecurrenceRule; dtstart: string } | null {
  try {
    const options = RRule.parseString(text.replace("DTSTART;VALUE=DATE:", "DTSTART:"));
    const dtstart = options.dtstart ? fromUtc(options.dtstart) : null;
    const frequency = (Object.keys(FREQ) as RecurrenceFrequency[]).find(
      (k) => FREQ[k] === options.freq,
    );
    if (!dtstart || !frequency) return null;
    const weekdays = (Array.isArray(options.byweekday) ? options.byweekday : [])
      .map((d) => (typeof d === "number" ? d : (d as { weekday: number }).weekday) + 1)
      .sort();
    const monthDay = Array.isArray(options.bymonthday)
      ? (options.bymonthday[0] ?? null)
      : (options.bymonthday ?? null);
    const parsed = recurrenceRule.safeParse({
      frequency,
      interval: options.interval ?? 1,
      weekdays,
      monthDay,
      end: options.until
        ? { type: "until", date: fromUtc(options.until) }
        : options.count
          ? { type: "count", count: options.count }
          : { type: "never" },
    });
    return parsed.success ? { rule: parsed.data, dtstart } : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- next instance */

/** First occurrence strictly after `after`, for a series anchored at `dtstart`. */
export function occurrenceAfter(
  rule: RecurrenceRule,
  dtstart: string,
  after: string,
): string | null {
  const next = rruleOf(rule, dtstart).after(asUtc(after), false);
  return next ? fromUtc(next) : null;
}

/** Weekly rules without weekdays repeat on the anchor's weekday; monthly on its day. */
function effectiveRule(rule: RecurrenceRule, anchor: string): RecurrenceRule {
  if (rule.frequency === "weekly" && rule.weekdays.length === 0) {
    const day = asUtc(anchor).getUTCDay(); // 0 = Sunday
    return { ...rule, weekdays: [day === 0 ? 7 : day] };
  }
  return rule;
}

export type NextPlan = { dueDate: string } | { end: "until" | "count" | "none" };

/**
 * The due date of the instance after `source`, or why the series ends.
 *
 * - **fixed**: the schedule's next occurrence after the source's due date. Occurrences that are
 *   already in the past (before `today`) are skipped, so a long-overdue series never floods the
 *   list with a backlog of instances.
 * - **after_completion**: the first occurrence after the day the source was closed (`closedOn`),
 *   counted from that day.
 *
 * The series ends after its UNTIL date, after COUNT instances (`sourceIndex` is the source's
 * position), or when the rule yields no further occurrence.
 */
export function planNext(input: {
  rule: RecurrenceRule;
  mode: RecurrenceMode;
  dtstart: string;
  sourceDue: string;
  sourceIndex: number;
  closedOn: string;
  today: string;
}): NextPlan {
  const { rule, mode } = input;
  if (rule.end.type === "count" && input.sourceIndex >= rule.end.count) return { end: "count" };
  let next: string | null;
  if (mode === "fixed") {
    const scheduled = effectiveRule(rule, input.dtstart);
    next = occurrenceAfter(scheduled, input.dtstart, input.sourceDue);
    if (next && next < input.today) {
      next = occurrenceAfter(scheduled, input.dtstart, addDaysTo(input.today, -1));
    }
  } else {
    // Counted from the closing day: a weekly rule without weekdays means "a week after that".
    const anchored = effectiveRule(rule, input.closedOn);
    next = occurrenceAfter(anchored, input.closedOn, input.closedOn);
  }
  if (!next) return { end: rule.end.type === "until" ? "until" : "none" };
  if (rule.end.type === "until" && next > rule.end.date) return { end: "until" };
  return { dueDate: next };
}

/** Up to `n` due dates a fixed schedule produces after `from` (for the panel's preview). */
export function upcomingDates(
  rule: RecurrenceRule,
  dtstart: string,
  from: string,
  n: number,
): string[] {
  const scheduled = effectiveRule(rule, dtstart);
  const dates: string[] = [];
  let cursor = from;
  while (dates.length < n) {
    const next = occurrenceAfter(scheduled, dtstart, cursor);
    if (!next || (rule.end.type === "until" && next > rule.end.date)) break;
    dates.push(next);
    cursor = next;
  }
  return dates;
}
