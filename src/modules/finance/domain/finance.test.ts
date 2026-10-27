import { describe, expect, it } from "vitest";

import {
  add,
  amountProblem,
  changeBetween,
  byCategory,
  byCurrency,
  byProvider,
  currencyPrecision,
  dec,
  isCurrencyCode,
  isIsoDate,
  mul,
  netWorthHistory,
  positionsAt,
  rangeStart,
  rateProblem,
  round,
  sum,
  toFixed,
  totalsOf,
  valuate,
  type FinanceAccount,
  type Snapshot,
} from "./index";

describe("exact decimals", () => {
  it("adds and multiplies without floating-point error", () => {
    expect(toFixed(add(dec("0.1"), dec("0.2")))).toBe("0.3");
    expect(toFixed(sum([dec("1234567890123.45"), dec("0.05"), dec("-0.5")]))).toBe(
      "1234567890123.00",
    );
    expect(toFixed(mul(dec("12345.67"), dec("0.1282")))).toBe("1582.714894");
  });

  it("rounds half away from zero only when asked", () => {
    expect(toFixed(round(dec("1.005"), 2))).toBe("1.01");
    expect(toFixed(round(dec("-1.005"), 2))).toBe("-1.01");
    expect(toFixed(round(dec("1.0049"), 2))).toBe("1.00");
    expect(toFixed(round(dec("2.5"), 0))).toBe("3");
    expect(toFixed(dec("7"), 2)).toBe("7.00");
  });
});

describe("currencies and validation", () => {
  it("knows ISO codes and their precision", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("CNY")).toBe(true);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("eur")).toBe(false);
    expect([currencyPrecision("EUR"), currencyPrecision("JPY"), currencyPrecision("KWD")]).toEqual([
      2, 0, 3,
    ]);
  });

  it("validates balances: non-negative, within the currency's precision", () => {
    expect(amountProblem("0", "EUR")).toBeNull();
    expect(amountProblem("1234.56", "EUR")).toBeNull();
    expect(amountProblem("-1", "EUR")).toBe("negative");
    expect(amountProblem("1.234", "EUR")).toBe("too_precise");
    expect(amountProblem("100.5", "JPY")).toBe("too_precise");
    expect(amountProblem("1,234", "EUR")).toBe("invalid");
    expect(amountProblem("1e5", "EUR")).toBe("invalid");
    expect(amountProblem("1".repeat(16), "EUR")).toBe("too_large");
  });

  it("validates rates: positive, at most 10 decimals", () => {
    expect(rateProblem("0.1282")).toBeNull();
    expect(rateProblem("0")).toBe("not_positive");
    expect(rateProblem("-0.1")).toBe("not_positive");
    expect(rateProblem("0.12345678901")).toBe("too_precise");
    expect(rateProblem("abc")).toBe("invalid");
  });

  it("validates date-only valuation dates", () => {
    expect(isIsoDate("2026-10-31")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(rangeStart("30d", "2026-10-31")).toBe("2026-10-02");
    expect(rangeStart("all", "2026-10-31")).toBeNull();
  });
});

describe("valuation", () => {
  it("uses rate 1 for the base currency and the saved rate otherwise", () => {
    expect(valuate("1500.00", "EUR", "EUR", null)).toEqual({
      fxRate: "1",
      fxSource: "identity",
      baseAmount: "1500.00",
    });
    expect(valuate("10000.00", "CNY", "EUR", "0.1282")).toEqual({
      fxRate: "0.1282",
      fxSource: "manual",
      baseAmount: "1282.00",
    });
    // Rounded to the base currency's cents, half away from zero.
    expect(valuate("33.33", "CNY", "EUR", "0.12345").baseAmount).toBe("4.11");
  });

  it("never treats a missing rate as 1", () => {
    expect(valuate("10000.00", "CNY", "EUR", null)).toEqual({
      fxRate: null,
      fxSource: null,
      baseAmount: null,
    });
    expect(valuate("10000.00", "CNY", "EUR", "  ").baseAmount).toBeNull();
  });

  it("handles zero balances", () => {
    expect(valuate("0", "CNY", "EUR", "0.13").baseAmount).toBe("0.00");
  });
});

/* ---------------------------------------------------------------- fixtures */

let n = 0;
function account(overrides: Partial<FinanceAccount> = {}): FinanceAccount {
  n += 1;
  return {
    id: `a${n}`,
    providerId: "bnp",
    name: `账户 ${n}`,
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "EUR",
    includeInNetWorth: true,
    notes: null,
    sortKey: `a${n}`,
    archivedAt: null,
    closedOn: null,
    snapshotCount: 0,
    ...overrides,
  };
}

function snap(
  a: FinanceAccount,
  valuationDate: string,
  amount: string,
  rate: string | null = null,
): Snapshot {
  const v = valuate(amount, a.currency, "EUR", rate);
  return {
    id: `${a.id}-${valuationDate}`,
    accountId: a.id,
    valuationDate,
    amount,
    currency: a.currency,
    baseCurrency: "EUR",
    fxRate: v.fxRate,
    fxSource: v.fxSource,
    baseAmount: v.baseAmount,
    notes: null,
    revision: 1,
    updatedAt: new Date(0),
  };
}

describe("totals", () => {
  it("adds assets across currencies and providers, subtracts liabilities", () => {
    const current = account();
    const livret = account({ accountType: "savings", assetCategory: "savings" });
    const boc = account({ providerId: "boc", currency: "CNY" });
    const card = account({
      kind: "liability",
      accountType: "credit_card",
      assetCategory: null,
    });
    const snapshots = [
      snap(current, "2026-10-01", "1500.00"),
      snap(livret, "2026-10-01", "8000.00"),
      snap(boc, "2026-10-01", "10000.00", "0.1282"),
      snap(card, "2026-10-01", "420.50"),
    ];
    const positions = positionsAt([current, livret, boc, card], snapshots, "2026-10-01", "EUR");
    const totals = totalsOf(positions);
    expect(toFixed(totals.assets, 2)).toBe("10782.00");
    expect(toFixed(totals.liabilities, 2)).toBe("420.50");
    expect(toFixed(totals.netWorth, 2)).toBe("10361.50");
    expect(byCategory(positions).map((b) => [b.key, toFixed(b.value, 2)])).toEqual([
      ["savings", "8000.00"],
      ["bank_deposit", "2782.00"],
    ]);
    // Net per provider: BNP 1500 + 8000 − 420.50; BOC 1282.
    expect(byProvider(positions).map((b) => [b.key, toFixed(b.value, 2), b.accountCount])).toEqual([
      ["bnp", "9079.50", 3],
      ["boc", "1282.00", 1],
    ]);
    expect(byCurrency(positions).map((c) => [c.currency, toFixed(c.assets, 2)])).toEqual([
      ["CNY", "10000.00"],
      ["EUR", "9500.00"],
    ]);
  });

  it("excludes unconverted balances and accounts left out of net worth", () => {
    const eur = account();
    const cny = account({ currency: "CNY" });
    const excluded = account({ includeInNetWorth: false });
    const positions = positionsAt(
      [eur, cny, excluded],
      [
        snap(eur, "2026-10-01", "100.00"),
        snap(cny, "2026-10-01", "1000.00"),
        snap(excluded, "2026-10-01", "999.00"),
      ],
      "2026-10-01",
      "EUR",
    );
    const totals = totalsOf(positions);
    expect(toFixed(totals.netWorth, 2)).toBe("100.00");
    expect(totals.unconverted.map((p) => p.account.id)).toEqual([cny.id]);
    expect(positions.map((p) => p.account.id)).not.toContain(excluded.id);
  });

  it("is all zero without data", () => {
    const totals = totalsOf([]);
    expect(toFixed(totals.netWorth, 2)).toBe("0.00");
    expect(netWorthHistory([], [], "EUR", null)).toEqual([]);
  });
});

describe("history", () => {
  it("has points only on recorded dates, carrying earlier balances forward and disclosing it", () => {
    const a = account();
    const b = account({ currency: "CNY" });
    const snapshots = [
      snap(a, "2026-09-01", "1000.00"),
      snap(b, "2026-09-01", "10000.00", "0.13"),
      snap(a, "2026-10-01", "1200.00"),
    ];
    const history = netWorthHistory([a, b], snapshots, "EUR", null);
    expect(history.map((p) => [p.date, toFixed(p.netWorth, 2), p.valued, p.carried])).toEqual([
      ["2026-09-01", "2300.00", 2, 0],
      ["2026-10-01", "2500.00", 1, 1],
    ]);
    // A range start keeps carried balances but drops earlier points.
    expect(netWorthHistory([a, b], snapshots, "EUR", "2026-09-15").map((p) => p.date)).toEqual([
      "2026-10-01",
    ]);
  });

  it("stops counting a closed account after its closing date but keeps its past", () => {
    const open = account();
    const closed = account({ archivedAt: new Date(), closedOn: "2026-09-01" });
    const snapshots = [
      snap(open, "2026-09-01", "100.00"),
      snap(closed, "2026-09-01", "50.00"),
      snap(open, "2026-10-01", "100.00"),
    ];
    const history = netWorthHistory([open, closed], snapshots, "EUR", null);
    expect(history.map((p) => toFixed(p.netWorth, 2))).toEqual(["150.00", "100.00"]);
  });

  it("keeps historical values when today's rate would differ", () => {
    const cny = account({ currency: "CNY" });
    const old = snap(cny, "2026-09-01", "10000.00", "0.12");
    const later = snap(cny, "2026-10-01", "10000.00", "0.14");
    const history = netWorthHistory([cny], [old, later], "EUR", null);
    expect(history.map((p) => toFixed(p.netWorth, 2))).toEqual(["1200.00", "1400.00"]);
  });
});

describe("change: balance vs FX", () => {
  it("splits a change into balance, FX and account effects that add up exactly", () => {
    const eur = account();
    const cny = account({ currency: "CNY" });
    const card = account({ kind: "liability", accountType: "credit_card", assetCategory: null });
    const added = account();
    const all = [eur, cny, card, added];
    const snapshots = [
      snap(eur, "2026-09-01", "1000.00"),
      snap(cny, "2026-09-01", "10000.00", "0.12"),
      snap(card, "2026-09-01", "200.00"),
      snap(eur, "2026-10-01", "1100.00"),
      snap(cny, "2026-10-01", "12000.00", "0.13"),
      snap(card, "2026-10-01", "300.00"),
      snap(added, "2026-10-01", "50.00"),
    ];
    const before = positionsAt(all, snapshots, "2026-09-01", "EUR");
    const after = positionsAt(all, snapshots, "2026-10-01", "EUR");
    const change = changeBetween(before, after, "EUR");
    // Balance: +100 (EUR) + 2000 × 0.12 (CNY) − 100 (more debt) = 240.
    expect(toFixed(change.balance, 2)).toBe("240.00");
    // FX: 12000 × (0.13 − 0.12) = 120.
    expect(toFixed(change.fx, 2)).toBe("120.00");
    expect(toFixed(change.accounts, 2)).toBe("50.00");
    const total = totalsOf(after).netWorth;
    const start = totalsOf(before).netWorth;
    expect(toFixed(change.total, 2)).toBe(
      toFixed(add(total, { units: -start.units, scale: start.scale }), 2),
    );
  });
});
