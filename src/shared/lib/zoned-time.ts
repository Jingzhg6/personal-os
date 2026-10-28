/*
 * Local dates and wall-clock times in IANA time zones, with explicit daylight-saving rules
 * (ADR 0020 §8): a local time inside a spring-forward gap resolves to the same distance after the
 * gap; a local time that exists twice resolves to its first occurrence. Pure; uses Intl only.
 */

const DAY = 86_400_000;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock fields of an instant in a time zone. */
export function localParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of the zone from UTC at an instant, in ms (Paris in summer: +2 h). */
export function zoneOffset(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "YYYY-MM-DD" local date of an instant. */
export function localDate(instant: number, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The instant of a local date and time in a zone, with the DST rules above. Returns the instant
 * and how the local time was resolved.
 */
export function zonedInstant(
  date: string,
  time: string,
  timeZone: string,
): { instant: number; resolution: "exact" | "gap" | "overlap" } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = [
    ...new Set([zoneOffset(wall - DAY, timeZone), zoneOffset(wall + DAY, timeZone)]),
  ];
  const valid = offsets
    .map((offset) => wall - offset)
    .filter((instant) => zoneOffset(instant, timeZone) === wall - instant)
    .sort((a, b) => a - b);
  if (valid.length === 0) {
    // In a gap: shift forward by the gap (use the offset in force before it).
    return { instant: wall - zoneOffset(wall - DAY, timeZone), resolution: "gap" };
  }
  return { instant: valid[0]!, resolution: valid.length > 1 ? "overlap" : "exact" };
}
