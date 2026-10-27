import "./events";

import { z } from "zod";

import {
  add,
  compare,
  dec,
  decimalPlaces,
  isDecimalString,
  isNegative,
  isZero,
  mul,
  round,
  sub,
  sum,
  toFixed,
  ZERO,
  type Dec,
} from "./decimal";

export * from "./decimal";

/*
 * Personal finance (ADR 0019): manual net-worth tracking. Providers hold accounts; accounts are
 * assets or liabilities in one currency; the user records dated balance snapshots. Each snapshot
 * keeps its original amount and currency, the FX rate used and the converted base value — fixed
 * forever. Totals and history are derived here from those snapshots, exactly (decimal.ts).
 *
 * Not measured, on purpose: income, spending, returns, profit or performance.
 */

/* ---------------------------------------------------------------- vocabularies (stable ids) */

export const providerTypes = ["bank", "ewallet", "cash", "broker", "other"] as const;
export type ProviderType = (typeof providerTypes)[number];

export const accountKinds = ["asset", "liability"] as const;
export type AccountKind = (typeof accountKinds)[number];

export const assetAccountTypes = [
  "current",
  "savings",
  "investment",
  "ewallet",
  "cash",
  "other",
] as const;
export const liabilityAccountTypes = ["credit_card", "loan", "other"] as const;
export const accountTypes = [
  "current",
  "savings",
  "investment",
  "ewallet",
  "cash",
  "credit_card",
  "loan",
  "other",
] as const;
export type AccountType = (typeof accountTypes)[number];

export const assetCategories = [
  "cash",
  "bank_deposit",
  "ewallet",
  "savings",
  "investment",
  "other",
] as const;
export type AssetCategory = (typeof assetCategories)[number];

/** A sensible default category for an asset account type (the user can change it). */
export function defaultCategory(type: AccountType): AssetCategory {
  const map: Partial<Record<AccountType, AssetCategory>> = {
    current: "bank_deposit",
    savings: "savings",
    investment: "investment",
    ewallet: "ewallet",
    cash: "cash",
  };
  return map[type] ?? "other";
}

export const DEFAULT_BASE_CURRENCY = "EUR";
/** Suggested currencies first; any ISO 4217 code the runtime knows is accepted. */
export const commonCurrencies = ["EUR", "CNY", "USD", "GBP", "CHF", "JPY", "HKD"] as const;
/** A valuation older than this (days) is shown as stale on the overview. */
export const STALE_AFTER_DAYS = 45;

/* ---------------------------------------------------------------- currencies & validation */

let knownCurrencies: Set<string> | null = null;
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  knownCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return knownCurrencies.has(code);
}

/** Minor-unit decimals of a currency (EUR 2, JPY 0, KWD 3). */
export function currencyPrecision(code: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
    .maximumFractionDigits!;
}

export const MAX_RATE_DECIMALS = 10;

export type AmountProblem = "invalid" | "negative" | "too_precise" | "too_large";

/** A balance as typed by the user: a non-negative decimal within the currency's precision. */
export function amountProblem(value: string, currency: string): AmountProblem | null {
  const text = value.trim();
  if (!isDecimalString(text)) return "invalid";
  if (text.startsWith("-")) return "negative";
  if (decimalPlaces(text) > currencyPrecision(currency)) return "too_precise";
  if (text.split(".")[0]!.replace(/^0+/, "").length > 15) return "too_large";
  return null;
}

export type RateProblem = "invalid" | "not_positive" | "too_precise" | "too_large";

export function rateProblem(value: string): RateProblem | null {
  const text = value.trim();
  if (!isDecimalString(text)) return "invalid";
  const rate = dec(text);
  if (isNegative(rate) || isZero(rate)) return "not_positive";
  if (decimalPlaces(text) > MAX_RATE_DECIMALS) return "too_precise";
  if (text.split(".")[0]!.replace(/^0+/, "").length > 9) return "too_large";
  return null;
}

/* ---------------------------------------------------------------- valuation */

export type FxSource = "identity" | "manual";

export interface Valuation {
  /** Rate to the base currency, as stored (null: no rate → unconverted). */
  fxRate: string | null;
  fxSource: FxSource | null;
  /** Converted value, rounded to the base currency's precision (null: unconverted). */
  baseAmount: string | null;
}

/**
 * Values one balance in the base currency. Same currency: rate 1 ("identity"). Otherwise the
 * user's rate, or — without one — no value at all: a missing rate is never treated as 1.
 */
export function valuate(
  amount: string,
  currency: string,
  baseCurrency: string,
  rate: string | null,
): Valuation {
  if (currency === baseCurrency) {
    return {
      fxRate: "1",
      fxSource: "identity",
      baseAmount: toFixed(
        round(dec(amount), currencyPrecision(baseCurrency)),
        currencyPrecision(baseCurrency),
      ),
    };
  }
  if (rate === null || rate.trim() === "")
    return { fxRate: null, fxSource: null, baseAmount: null };
  const precision = currencyPrecision(baseCurrency);
  return {
    fxRate: rate.trim(),
    fxSource: "manual",
    baseAmount: toFixed(round(mul(dec(amount), dec(rate.trim())), precision), precision),
  };
}

/* ---------------------------------------------------------------- entities */

export interface FinanceProvider {
  id: string;
  name: string;
  providerType: ProviderType;
  country: string | null;
  notes: string | null;
  sortKey: string;
  archivedAt: Date | null;
}

export interface FinanceAccount {
  id: string;
  providerId: string;
  name: string;
  kind: AccountKind;
  accountType: AccountType;
  /** Assets only. */
  assetCategory: AssetCategory | null;
  currency: string;
  includeInNetWorth: boolean;
  notes: string | null;
  sortKey: string;
  archivedAt: Date | null;
  /** Date-only: the account's balances count up to and including this day. */
  closedOn: string | null;
  snapshotCount: number;
}

export interface Snapshot {
  id: string;
  accountId: string;
  /** Date-only "YYYY-MM-DD". */
  valuationDate: string;
  /** Original amount in `currency` (for liabilities: the positive amount owed). */
  amount: string;
  currency: string;
  baseCurrency: string;
  fxRate: string | null;
  fxSource: FxSource | null;
  baseAmount: string | null;
  notes: string | null;
  revision: number;
  updatedAt: Date;
}

/* ---------------------------------------------------------------- positions & totals */

export interface AccountPosition {
  account: FinanceAccount;
  snapshot: Snapshot;
  /** The latest snapshot is from an earlier date than the one asked for. */
  carried: boolean;
  /** Has a base value in the base currency asked for. */
  converted: boolean;
}

/**
 * Each account's latest snapshot on or before `date` — the account's balance as last recorded.
 * Accounts closed before `date`, not counted in net worth, or without any snapshot yet are left out.
 */
export function positionsAt(
  accounts: readonly FinanceAccount[],
  snapshots: readonly Snapshot[],
  date: string,
  baseCurrency: string,
): AccountPosition[] {
  const latest = new Map<string, Snapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.valuationDate > date) continue;
    const current = latest.get(snapshot.accountId);
    if (!current || snapshot.valuationDate > current.valuationDate) {
      latest.set(snapshot.accountId, snapshot);
    }
  }
  const positions: AccountPosition[] = [];
  for (const account of accounts) {
    if (!account.includeInNetWorth) continue;
    if (account.closedOn !== null && account.closedOn < date) continue;
    const snapshot = latest.get(account.id);
    if (!snapshot) continue;
    positions.push({
      account,
      snapshot,
      carried: snapshot.valuationDate < date,
      converted: snapshot.baseAmount !== null && snapshot.baseCurrency === baseCurrency,
    });
  }
  return positions;
}

export interface Totals {
  assets: Dec;
  liabilities: Dec;
  netWorth: Dec;
  /** Positions without a base value: excluded from the totals above. */
  unconverted: AccountPosition[];
}

export function totalsOf(positions: readonly AccountPosition[]): Totals {
  let assets = ZERO;
  let liabilities = ZERO;
  const unconverted: AccountPosition[] = [];
  for (const position of positions) {
    if (!position.converted) {
      unconverted.push(position);
      continue;
    }
    const value = dec(position.snapshot.baseAmount!);
    if (position.account.kind === "asset") assets = add(assets, value);
    else liabilities = add(liabilities, value);
  }
  return { assets, liabilities, netWorth: sub(assets, liabilities), unconverted };
}

export interface Breakdown {
  key: string;
  /** Base value (converted positions only). */
  value: Dec;
  accountCount: number;
}

/** Asset value by category, largest first. */
export function byCategory(positions: readonly AccountPosition[]): Breakdown[] {
  return group(
    positions.filter((p) => p.converted && p.account.kind === "asset"),
    (p) => p.account.assetCategory ?? "other",
  );
}

/** Net base value by provider (assets − liabilities), largest first. */
export function byProvider(positions: readonly AccountPosition[]): Breakdown[] {
  return group(
    positions.filter((p) => p.converted),
    (p) => p.account.providerId,
  );
}

function group(positions: readonly AccountPosition[], keyOf: (p: AccountPosition) => string) {
  const map = new Map<string, Breakdown>();
  for (const p of positions) {
    const key = keyOf(p);
    const entry = map.get(key) ?? { key, value: ZERO, accountCount: 0 };
    const value = dec(p.snapshot.baseAmount!);
    entry.value = p.account.kind === "asset" ? add(entry.value, value) : sub(entry.value, value);
    entry.accountCount += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => compare(b.value, a.value));
}

/** Original-currency sums (assets and liabilities apart), whether converted or not. */
export function byCurrency(
  positions: readonly AccountPosition[],
): { currency: string; assets: Dec; liabilities: Dec }[] {
  const map = new Map<string, { currency: string; assets: Dec; liabilities: Dec }>();
  for (const p of positions) {
    const entry = map.get(p.snapshot.currency) ?? {
      currency: p.snapshot.currency,
      assets: ZERO,
      liabilities: ZERO,
    };
    const amount = dec(p.snapshot.amount);
    if (p.account.kind === "asset") entry.assets = add(entry.assets, amount);
    else entry.liabilities = add(entry.liabilities, amount);
    map.set(p.snapshot.currency, entry);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/* ---------------------------------------------------------------- history */

export interface HistoryPoint {
  date: string;
  assets: Dec;
  liabilities: Dec;
  netWorth: Dec;
  /** Accounts with a snapshot on exactly this date. */
  valued: number;
  /** Accounts counted with an earlier snapshot (carried forward). */
  carried: number;
  /** Accounts left out for want of an FX rate. */
  unconverted: number;
}

/**
 * One point per date on which anything was recorded — never a fabricated daily series. Each point
 * values every account at its latest snapshot on or before that date (disclosed as `carried`).
 */
export function netWorthHistory(
  accounts: readonly FinanceAccount[],
  snapshots: readonly Snapshot[],
  baseCurrency: string,
  from: string | null,
): HistoryPoint[] {
  const dates = [...new Set(snapshots.map((s) => s.valuationDate))].sort();
  return dates
    .filter((date) => from === null || date >= from)
    .map((date) => {
      const positions = positionsAt(accounts, snapshots, date, baseCurrency);
      const totals = totalsOf(positions);
      return {
        date,
        assets: totals.assets,
        liabilities: totals.liabilities,
        netWorth: totals.netWorth,
        valued: positions.filter((p) => !p.carried).length,
        carried: positions.filter((p) => p.carried).length,
        unconverted: totals.unconverted.length,
      };
    });
}

/* ---------------------------------------------------------------- change: balance vs FX */

export interface ChangeBreakdown {
  total: Dec;
  /** Balance moves valued at the earlier rate. */
  balance: Dec;
  /** Rate moves on the later balance (incl. rounding of stored values). */
  fx: Dec;
  /** Accounts counted only at the later date (new) minus those counted only earlier. */
  accounts: Dec;
}

/**
 * Splits the net-worth change between two dates. Per account counted (and converted) at both:
 * balance effect = (amount₂ − amount₁) × rate₁, FX effect = (value₂ − value₁) − balance effect.
 * Liabilities count negatively. total = balance + fx + accounts, exactly.
 */
export function changeBetween(
  before: readonly AccountPosition[],
  after: readonly AccountPosition[],
  baseCurrency: string,
): ChangeBreakdown {
  const precision = currencyPrecision(baseCurrency);
  const earlier = new Map(before.filter((p) => p.converted).map((p) => [p.account.id, p]));
  let balance = ZERO;
  let fx = ZERO;
  let accounts = ZERO;
  const sign = (p: AccountPosition, value: Dec) =>
    p.account.kind === "asset" ? value : { units: -value.units, scale: value.scale };

  for (const p of after.filter((x) => x.converted)) {
    const q = earlier.get(p.account.id);
    const value2 = dec(p.snapshot.baseAmount!);
    if (!q) {
      accounts = add(accounts, sign(p, value2));
      continue;
    }
    earlier.delete(p.account.id);
    const value1 = dec(q.snapshot.baseAmount!);
    const delta = sub(value2, value1);
    const balanceEffect = round(
      mul(sub(dec(p.snapshot.amount), dec(q.snapshot.amount)), dec(q.snapshot.fxRate!)),
      precision,
    );
    balance = add(balance, sign(p, balanceEffect));
    fx = add(fx, sign(p, sub(delta, balanceEffect)));
  }
  for (const q of earlier.values()) {
    accounts = sub(accounts, sign(q, dec(q.snapshot.baseAmount!)));
  }
  return { total: sum([balance, fx, accounts]), balance, fx, accounts };
}

/* ---------------------------------------------------------------- dates */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date "YYYY-MM-DD" (date-only: no time zone involved). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const historyRanges = ["30d", "90d", "1y", "all"] as const;
export type HistoryRange = (typeof historyRanges)[number];

export function rangeStart(range: HistoryRange, today: string): string | null {
  if (range === "all") return null;
  return addDays(today, -({ "30d": 29, "90d": 89, "1y": 364 } as const)[range]);
}

/* ---------------------------------------------------------------- inputs */

const name = z.string().trim().min(1).max(80);
const notes = z.string().trim().max(500).nullable();
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, { message: "Unknown currency code" });

export const createProviderInput = z.object({
  name,
  providerType: z.enum(providerTypes),
  country: z.string().trim().max(60).nullable().optional(),
  notes: notes.optional(),
});
export const updateProviderInput = z.object({
  id: z.uuid(),
  patch: z
    .object({
      name,
      providerType: z.enum(providerTypes),
      country: z.string().trim().max(60).nullable(),
      notes,
    })
    .partial(),
});
export const idInput = z.object({ id: z.uuid() });
export const moveInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) });
export const archiveInput = z.object({ id: z.uuid(), archived: z.boolean() });

const accountFields = z.object({
  providerId: z.uuid(),
  name,
  kind: z.enum(accountKinds),
  accountType: z.enum(accountTypes),
  assetCategory: z.enum(assetCategories).nullable(),
  currency: currencyCode,
  includeInNetWorth: z.boolean(),
  notes,
});

/** Liabilities have no asset category; assets need one; types must match the kind. */
function accountShapeOk(a: {
  kind?: AccountKind;
  accountType?: AccountType;
  assetCategory?: AssetCategory | null;
}) {
  if (a.kind === "liability") {
    return (
      (a.assetCategory ?? null) === null &&
      (a.accountType === undefined ||
        (liabilityAccountTypes as readonly string[]).includes(a.accountType))
    );
  }
  if (a.kind === "asset") {
    return (
      a.assetCategory != null &&
      (a.accountType === undefined ||
        (assetAccountTypes as readonly string[]).includes(a.accountType))
    );
  }
  return true;
}

export const createAccountInput = accountFields
  .partial({ notes: true, includeInNetWorth: true, assetCategory: true })
  .refine(accountShapeOk, { message: "Account type or category does not fit its kind" });
export type CreateAccountInput = z.infer<typeof createAccountInput>;

export const updateAccountInput = z.object({
  id: z.uuid(),
  /** `kind` and `currency` can change only while the account has no snapshots. */
  patch: accountFields.partial(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountInput>;

export const archiveAccountInput = z.object({
  id: z.uuid(),
  archived: z.boolean(),
  /** Last day the account's balance counts (default: its latest snapshot date). */
  closedOn: z.iso.date().nullable().optional(),
});

export const batchEntry = z.object({
  accountId: z.uuid(),
  amount: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(500).nullable().optional(),
});
export const saveBatchInput = z.object({
  valuationDate: z.iso.date(),
  entries: z.array(batchEntry).min(1).max(200),
  /** Rate to the base currency per foreign currency in this batch (missing → unconverted). */
  rates: z.record(z.string(), z.string().trim().max(40)).default({}),
  /** Explicitly replace snapshots that already exist on this date (a correction). */
  overwrite: z.boolean().default(false),
});
export type SaveBatchInput = z.infer<typeof saveBatchInput>;

export const historyInput = z.object({ range: z.enum(historyRanges) });
export const accountHistoryInput = z.object({ id: z.uuid() });
export const batchDraftInput = z.object({ valuationDate: z.iso.date() });
export const updateSettingsInput = z.object({ baseCurrency: currencyCode });

/* ---------------------------------------------------------------- read models */

/** Money as transported: exact decimal strings. */
export type Money = string;

export interface FinanceOverview {
  baseCurrency: string;
  today: string;
  hasAccounts: boolean;
  hasSnapshots: boolean;
  netWorth: Money;
  assets: Money;
  liabilities: Money;
  lastValuationDate: string | null;
  /** Versus the previous recorded valuation date (null without one). */
  change: {
    since: string;
    total: Money;
    balance: Money;
    fx: Money;
    accounts: Money;
  } | null;
  byCategory: { category: AssetCategory; value: Money; accountCount: number }[];
  byProvider: { providerId: string; name: string; value: Money; accountCount: number }[];
  byCurrency: { currency: string; assets: Money; liabilities: Money }[];
  /** Active accounts without any snapshot. */
  missing: { accountId: string; name: string; providerName: string }[];
  /** Counted with a snapshot older than STALE_AFTER_DAYS. */
  stale: { accountId: string; name: string; valuationDate: string }[];
  /** Counted but without a rate to the base currency (excluded from totals). */
  unconverted: { accountId: string; name: string; currency: string; amount: Money }[];
}

export interface HistoryPointView {
  date: string;
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  valued: number;
  carried: number;
  unconverted: number;
}

export interface BatchDraftAccount {
  account: FinanceAccount;
  providerName: string;
  /** The snapshot on this exact date, if one exists (editing = correcting it). */
  existing: Snapshot | null;
  /** The latest earlier snapshot — a hint, not a confirmed balance. */
  previous: Snapshot | null;
}

export interface BatchDraft {
  valuationDate: string;
  baseCurrency: string;
  accounts: BatchDraftAccount[];
  /** Saved default rates (prefill only) per currency. */
  defaultRates: Record<string, string>;
}

export const toMoney = (value: Dec, currency: string) =>
  toFixed(value, currencyPrecision(currency));

/** Today's date "YYYY-MM-DD" in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface AccountHistory {
  account: FinanceAccount;
  providerName: string;
  baseCurrency: string;
  /** Newest first, in the original currency with the rate and value recorded at the time. */
  snapshots: Snapshot[];
}

export interface FinanceStructure {
  baseCurrency: string;
  baseLocked: boolean;
  providers: FinanceProvider[];
  accounts: FinanceAccount[];
  /** Latest snapshot per account. */
  latest: Record<string, Snapshot>;
}
