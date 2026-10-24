/** A calendar date "YYYY-MM-DD" in the user's timezone. Date-only values never shift with travel. */
export type IsoDate = string;

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DueState = "overdue" | "today" | "tomorrow" | "upcoming";

export function dueState(dueDate: IsoDate, today: IsoDate): DueState {
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  if (dueDate === addDays(today, 1)) return "tomorrow";
  return "upcoming";
}

/** Splits minutes into hours and minutes for display ("1 小时 30 分钟"). */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
