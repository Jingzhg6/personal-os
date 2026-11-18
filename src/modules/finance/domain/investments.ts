import { z } from "zod";

import {
  add,
  compare,
  dec,
  div,
  isZero,
  mul,
  round,
  sub,
  toFixed,
  ZERO,
  type Dec,
} from "./decimal";

/*
 * Investments (V3): accounts → holdings → transactions. Everything a holding is worth or has
 * earned is computed here from its transactions, in the account's currency, with exact decimals:
 *
 *  - units and cost basis follow the average-cost method: a buy adds units and cost (amount +
 *    fee); a sell removes units at the average cost and realises (proceeds − fee − cost of the
 *    units sold); dividends (net of fee) are realised income; a fee on a holding is a realised
 *    loss.
 *  - market value = units × the price the user entered; else the value entered by hand (V2
 *    records without units); else the cost basis — "按成本估算", always marked as an estimate.
 *  - unrealised = market value − cost basis, only when the value is not an estimate.
 *  - account cash counts only once a deposit or withdrawal is recorded (otherwise buys alone
 *    would show a misleading negative balance); opening rows (from V2 records) never move cash.
 *
 * Different currencies are never added together: totals are per currency.
 */

export const investmentAccountTypes = [
  "brokerage",
  "retirement",
  "platform",
  "crypto",
  "other",
] as const;
export type InvestmentAccountType = (typeof investmentAccountTypes)[number];

export const investmentKinds = ["stock", "etf", "fund", "bond", "crypto", "other"] as const;
export type InvestmentKind = (typeof investmentKinds)[number];

export const transactionKinds = [
  "buy",
  "sell",
  "dividend",
  "deposit",
  "withdrawal",
  "fee",
] as const;
export type TransactionKind = (typeof transactionKinds)[number];

/** Kinds that need / allow a holding. */
export const holdingTransactionKinds = ["buy", "sell"] as const;
export const accountOnlyTransactionKinds = ["deposit", "withdrawal"] as const;

export type Valuation = "price" | "manual" | "cost";

const text = (max: number) => z.string().trim().max(max);
const name = text(80).min(1);
const optionalText = (max: number) => text(max).nullable().optional();
const decimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, { message: "Not a decimal" })
  .max(40);
const isoDate = z.iso.date();
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);

export const investmentAccountInput = z.object({
  name,
  institution: optionalText(80),
  accountType: z.enum(investmentAccountTypes),
  currency: currencyCode,
  notes: optionalText(500),
});
export const updateInvestmentAccountInput = z.object({
  id: z.uuid(),
  /** The currency can change only while the account has no holdings or transactions. */
  patch: investmentAccountInput.partial(),
});
export const archiveInvestmentAccountInput = z.object({ id: z.uuid(), archived: z.boolean() });

const holdingFields = z.object({
  name,
  kind: z.enum(investmentKinds),
  ticker: optionalText(30),
  notes: optionalText(500),
  /** Latest price per unit, as entered (manual). */
  currentPrice: decimal.nullable().optional(),
  priceDate: isoDate.nullable().optional(),
  /** A value entered by hand, for holdings without units. */
  currentValue: decimal.nullable().optional(),
});
export const createHoldingInput = holdingFields.extend({ accountId: z.uuid() });
export const updateHoldingInput = z.object({ id: z.uuid(), patch: holdingFields.partial() });

const transactionFields = z.object({
  holdingId: z.uuid().nullable().optional(),
  kind: z.enum(transactionKinds),
  tradeDate: isoDate,
  quantity: decimal.nullable().optional(),
  unitPrice: decimal.nullable().optional(),
  /** Gross amount; for a trade it defaults to quantity × unit price. */
  amount: decimal.nullable().optional(),
  fee: decimal.nullable().optional(),
  notes: optionalText(500),
});
export const createTransactionInput = transactionFields.extend({ accountId: z.uuid() });
export const updateTransactionInput = z.object({
  id: z.uuid(),
  patch: transactionFields.partial(),
});

/* ------------------------------------------------------------------------- computation */

export interface AccountRecord {
  id: string;
  name: string;
  institution: string | null;
  accountType: InvestmentAccountType;
  currency: string;
  notes: string | null;
  legacy: boolean;
  archivedAt: Date | null;
}

export interface HoldingRecord {
  id: string;
  accountId: string;
  name: string;
  kind: InvestmentKind;
  ticker: string | null;
  currency: string;
  notes: string | null;
  currentPrice: string | null;
  priceDate: string | null;
  currentValue: string | null;
}

export interface TransactionRecord {
  id: string;
  accountId: string;
  holdingId: string | null;
  kind: TransactionKind;
  tradeDate: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string;
  fee: string;
  currency: string;
  notes: string | null;
  opening: boolean;
  createdAt: Date;
}

export interface HoldingView extends HoldingRecord {
  /** Units held; null when a buy without units makes the count unknown. */
  units: string | null;
  averagePrice: string | null;
  costBasis: string;
  /** Everything ever paid for it (buys + their fees). */
  invested: string;
  marketValue: string;
  valuation: Valuation;
  unrealized: string | null;
  realized: string;
  transactionCount: number;
}

export interface AccountView extends AccountRecord {
  holdings: HoldingView[];
  /** Null while no deposit or withdrawal has been recorded. */
  cash: string | null;
  holdingsValue: string;
  value: string;
  costBasis: string;
  invested: string;
  realized: string;
  unrealized: string;
  /** Holdings valued at cost (estimates). */
  estimated: number;
}

export interface CurrencyTotals {
  currency: string;
  invested: string;
  costBasis: string;
  marketValue: string;
  cash: string;
  value: string;
  realized: string;
  unrealized: string;
  /** (realised + unrealised) / invested, as a decimal string; null without investment. */
  returnRatio: string | null;
  estimated: number;
}

export interface Portfolio {
  accounts: AccountView[];
  transactions: TransactionRecord[];
  totals: CurrencyTotals[];
}

/** Why a set of transactions is inconsistent (a sell larger than the units held, …). */
export type ReplayProblem = "sell_exceeds_units" | "sell_without_units";

const MONEY_SCALE = 6;
const UNIT_SCALE = 8;
const fixed = (value: Dec, scale = MONEY_SCALE) => toFixed(round(value, scale), scale);

const chronological = (a: TransactionRecord, b: TransactionRecord) =>
  a.tradeDate.localeCompare(b.tradeDate) ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  a.id.localeCompare(b.id);

interface Replay {
  units: Dec | null;
  cost: Dec;
  invested: Dec;
  realized: Dec;
  problem: ReplayProblem | null;
}

/** Replays one holding's transactions in date order (average cost). */
export function replayHolding(transactions: readonly TransactionRecord[]): Replay {
  let units: Dec | null = ZERO;
  let cost = ZERO;
  let invested = ZERO;
  let realized = ZERO;
  let problem: ReplayProblem | null = null;
  for (const t of [...transactions].sort(chronological)) {
    const amount = dec(t.amount);
    const fee = dec(t.fee);
    if (t.kind === "buy") {
      units = units && t.quantity ? add(units, dec(t.quantity)) : null;
      cost = add(cost, add(amount, fee));
      invested = add(invested, add(amount, fee));
    } else if (t.kind === "sell") {
      const quantity = dec(t.quantity ?? "0");
      if (!units) {
        problem ??= "sell_without_units";
        continue;
      }
      if (compare(quantity, units) > 0) {
        problem ??= "sell_exceeds_units";
        continue;
      }
      const soldCost = isZero(units) ? ZERO : mul(div(cost, units), quantity);
      realized = add(realized, sub(sub(amount, fee), soldCost));
      cost = sub(cost, soldCost);
      units = sub(units, quantity);
      if (isZero(units)) cost = ZERO;
    } else if (t.kind === "dividend") {
      realized = add(realized, sub(amount, fee));
    } else if (t.kind === "fee") {
      realized = sub(realized, amount);
    }
  }
  return { units, cost, invested, realized, problem };
}

/** Cash effect of one transaction on its account (opening rows have none). */
function cashEffect(t: TransactionRecord): Dec {
  if (t.opening) return ZERO;
  const amount = dec(t.amount);
  const fee = dec(t.fee);
  switch (t.kind) {
    case "deposit":
      return sub(amount, fee);
    case "withdrawal":
      return sub(ZERO, add(amount, fee));
    case "buy":
      return sub(ZERO, add(amount, fee));
    case "sell":
    case "dividend":
      return sub(amount, fee);
    case "fee":
      return sub(ZERO, amount);
  }
}

export function holdingView(
  holding: HoldingRecord,
  transactions: TransactionRecord[],
): HoldingView {
  const r = replayHolding(transactions);
  let valuation: Valuation = "cost";
  let value = r.cost;
  if (holding.currentPrice !== null && r.units) {
    valuation = "price";
    value = mul(r.units, dec(holding.currentPrice));
  } else if (holding.currentValue !== null) {
    valuation = "manual";
    value = dec(holding.currentValue);
  }
  return {
    ...holding,
    units: r.units ? fixed(r.units, UNIT_SCALE) : null,
    averagePrice: r.units && !isZero(r.units) ? fixed(div(r.cost, r.units), UNIT_SCALE) : null,
    costBasis: fixed(r.cost),
    invested: fixed(r.invested),
    marketValue: fixed(value),
    valuation,
    unrealized: valuation === "cost" ? null : fixed(sub(value, r.cost)),
    realized: fixed(r.realized),
    transactionCount: transactions.length,
  };
}

export function computePortfolio(
  accounts: AccountRecord[],
  holdings: HoldingRecord[],
  transactions: TransactionRecord[],
): Portfolio {
  const byHolding = new Map<string, TransactionRecord[]>();
  for (const t of transactions)
    if (t.holdingId) byHolding.set(t.holdingId, [...(byHolding.get(t.holdingId) ?? []), t]);

  const views: AccountView[] = accounts.map((account) => {
    const own = holdings
      .filter((h) => h.accountId === account.id)
      .map((h) => holdingView(h, byHolding.get(h.id) ?? []));
    const accountTransactions = transactions.filter((t) => t.accountId === account.id);
    const cashTracked = accountTransactions.some(
      (t) => (t.kind === "deposit" || t.kind === "withdrawal") && !t.opening,
    );
    const cash = accountTransactions.reduce((total, t) => add(total, cashEffect(t)), ZERO);
    // Account-level dividends and fees (no holding) are realised too.
    const accountRealized = accountTransactions
      .filter((t) => !t.holdingId && (t.kind === "dividend" || t.kind === "fee"))
      .reduce(
        (total, t) =>
          t.kind === "dividend"
            ? add(total, sub(dec(t.amount), dec(t.fee)))
            : sub(total, dec(t.amount)),
        ZERO,
      );
    const total = (pick: (h: HoldingView) => string | null) =>
      own.reduce((s, h) => add(s, dec(pick(h) ?? "0")), ZERO);
    const holdingsValue = total((h) => h.marketValue);
    return {
      ...account,
      holdings: own,
      cash: cashTracked ? fixed(cash) : null,
      holdingsValue: fixed(holdingsValue),
      value: fixed(cashTracked ? add(holdingsValue, cash) : holdingsValue),
      costBasis: fixed(total((h) => h.costBasis)),
      invested: fixed(total((h) => h.invested)),
      realized: fixed(
        add(
          total((h) => h.realized),
          accountRealized,
        ),
      ),
      unrealized: fixed(total((h) => h.unrealized)),
      estimated: own.filter((h) => h.valuation === "cost" && h.units !== "0.00000000").length,
    };
  });

  const currencies = [...new Set(views.map((a) => a.currency))].sort();
  const totals = currencies.map((currency) => {
    const list = views.filter((a) => a.currency === currency);
    const sumOf = (pick: (a: AccountView) => string | null) =>
      list.reduce((s, a) => add(s, dec(pick(a) ?? "0")), ZERO);
    const invested = sumOf((a) => a.invested);
    const realized = sumOf((a) => a.realized);
    const unrealized = sumOf((a) => a.unrealized);
    return {
      currency,
      invested: fixed(invested),
      costBasis: fixed(sumOf((a) => a.costBasis)),
      marketValue: fixed(sumOf((a) => a.holdingsValue)),
      cash: fixed(sumOf((a) => a.cash)),
      value: fixed(sumOf((a) => a.value)),
      realized: fixed(realized),
      unrealized: fixed(unrealized),
      returnRatio: isZero(invested) ? null : fixed(div(add(realized, unrealized), invested), 6),
      estimated: list.reduce((n, a) => n + a.estimated, 0),
    };
  });

  return { accounts: views, transactions: [...transactions].sort(chronological).reverse(), totals };
}
