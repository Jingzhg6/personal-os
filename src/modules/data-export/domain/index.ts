/*
 * The personal data export (ADR 0025): one JSON document with every record the user owns,
 * grouped by owning module. Pure: format constants, the document type, the sensitive-key guard
 * and the file name.
 */

export const EXPORT_FORMAT = "personal-os-export";
/** Bumped when a section or a field changes meaning; adding a field keeps the version. */
export const EXPORT_VERSION = 1;

/** How values are written, stated in the file itself so it can be read without this code. */
export const exportConventions = {
  ids: "UUID strings; references between records use these ids",
  instants: "ISO 8601 in UTC, e.g. 2026-10-28T09:30:00.000Z",
  dates: "YYYY-MM-DD calendar dates without a time zone (due dates, valuation dates)",
  times: "HH:MM:SS local wall-clock times (task due time), read with the record's date",
  money:
    "decimal strings exactly as stored (amounts 6 decimals, FX rates 10), never floats; each amount carries its ISO 4217 currency code",
  missing: "null means not set or unknown; it is never written as 0 or an empty string",
  keys: "field names are camelCase versions of the database columns",
} as const;

/** Tables that hold the user's data but are deliberately not exported, and why. */
export const exportExclusions = {
  accounts: "sign-in credentials (password hash, provider tokens)",
  sessions: "active sign-in sessions and their tokens",
  verifications: "one-time verification values",
  automationEvents: "internal processing queue; each processed event is in automation.executions",
  automationWorkerStatus: "system-wide worker heartbeat, not personal data",
} as const;

export type ExportRow = Record<string, unknown>;

export interface ExportDocument {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  generatedAt: string;
  /** The user's time zone when the file was made (local dates in the file name use it). */
  timeZone: string | null;
  conventions: typeof exportConventions;
  excluded: typeof exportExclusions;
  /** Rows per table, e.g. `tasks.tasks: 42`. */
  counts: Record<string, number>;
  user: ExportRow;
  data: Record<string, Record<string, ExportRow[] | ExportRow | null>>;
}

const SENSITIVE_KEY = /password|token|secret|credential|api[-_]?key|private[-_]?key/i;

/** Every object key (with its path) that looks like a credential. The export must have none. */
export function findSensitiveKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSensitiveKeys(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(SENSITIVE_KEY.test(key) ? [`${path}.${key}`] : []),
    ...findSensitiveKeys(v, `${path}.${key}`),
  ]);
}

/** Total rows in the document (shown after a successful export). */
export function countRecords(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** `personal-os-export-2026-10-28.json`, dated in the user's zone (UTC when unknown). */
export function exportFileName(generatedAt: Date, timeZone: string | null): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(generatedAt);
  return `${EXPORT_FORMAT}-${date}.json`;
}
