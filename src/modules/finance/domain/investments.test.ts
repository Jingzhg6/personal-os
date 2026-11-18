import { describe, expect, it } from "vitest";

import {
  computePortfolio,
  div,
  dec,
  replayHolding,
  toFixed,
  type AccountRecord,
  type HoldingRecord,
  type TransactionRecord,
} from ".";

let n = 0;
const tx = (t: Partial<TransactionRecord> & Pick<TransactionRecord, "kind" | "amount">) =>
  ({
    id: `t${++n}`,
    accountId: "a",
    holdingId: "h",
    tradeDate: "2026-01-01",
    quantity: null,
    unitPrice: null,
    fee: "0",
    currency: "EUR",
    notes: null,
    opening: false,
    createdAt: new Date(n * 1000),
    ...t,
  }) as TransactionRecord;

const account: AccountRecord = {
  id: "a",
  name: "券商 A",
  institution: null,
  accountType: "brokerage",
  currency: "EUR",
  notes: null,
  legacy: false,
  archivedAt: null,
};
const holding = (patch: Partial<HoldingRecord> = {}): HoldingRecord => ({
  id: "h",
  accountId: "a",
  name: "ETF",
  kind: "etf",
  ticker: null,
  currency: "EUR",
  notes: null,
  currentPrice: null,
  priceDate: null,
  currentValue: null,
  ...patch,
});

describe("decimal division", () => {
  it("rounds half away from zero", () => {
    expect(toFixed(div(dec("10"), dec("3"), 4))).toBe("3.3333");
    expect(toFixed(div(dec("-2"), dec("3"), 2))).toBe("-0.67");
    expect(() => div(dec("1"), dec("0"))).toThrow();
  });
});

describe("investment replay (average cost)", () => {
  it("buys add cost, a sell realises against the average cost, dividends and fees count", () => {
    const r = replayHolding([
      tx({ kind: "buy", tradeDate: "2026-01-01", quantity: "10", amount: "1000", fee: "5" }),
      tx({ kind: "buy", tradeDate: "2026-02-01", quantity: "10", amount: "1200", fee: "5" }),
      // Average cost 110.5 per unit; selling 5 for 700 − 3 fee realises 697 − 552.5.
      tx({ kind: "sell", tradeDate: "2026-03-01", quantity: "5", amount: "700", fee: "3" }),
      tx({ kind: "dividend", tradeDate: "2026-04-01", amount: "20" }),
      tx({ kind: "fee", tradeDate: "2026-04-02", amount: "2" }),
    ]);
    expect(toFixed(r.units!)).toBe("15");
    expect(toFixed(r.cost, 2)).toBe("1657.50");
    expect(toFixed(r.invested, 2)).toBe("2210.00");
    expect(toFixed(r.realized, 2)).toBe("162.50");
    expect(r.problem).toBeNull();
  });

  it("flags a sell beyond the units held or without known units", () => {
    expect(
      replayHolding([
        tx({ kind: "buy", quantity: "1", amount: "10" }),
        tx({ kind: "sell", tradeDate: "2026-02-01", quantity: "2", amount: "30" }),
      ]).problem,
    ).toBe("sell_exceeds_units");
    expect(
      replayHolding([
        tx({ kind: "buy", amount: "10" }),
        tx({ kind: "sell", tradeDate: "2026-02-01", quantity: "1", amount: "30" }),
      ]).problem,
    ).toBe("sell_without_units");
  });
});

describe("portfolio", () => {
  it("values by price, else by a manual value, else at cost (estimated), per currency", () => {
    const buys = [tx({ kind: "buy", quantity: "10", amount: "1000" })];
    const priced = computePortfolio([account], [holding({ currentPrice: "120" })], buys);
    expect(priced.accounts[0]!.holdings[0]).toMatchObject({
      valuation: "price",
      marketValue: "1200.000000",
      unrealized: "200.000000",
      averagePrice: "100.00000000",
    });
    const manual = computePortfolio([account], [holding({ currentValue: "900" })], buys);
    expect(manual.accounts[0]!.holdings[0]).toMatchObject({
      valuation: "manual",
      unrealized: "-100.000000",
    });
    const atCost = computePortfolio([account], [holding()], buys);
    expect(atCost.accounts[0]!.holdings[0]).toMatchObject({
      valuation: "cost",
      marketValue: "1000.000000",
      unrealized: null,
    });
    expect(atCost.totals[0]).toMatchObject({
      currency: "EUR",
      estimated: 1,
      returnRatio: "0.000000",
    });
  });

  it("tracks cash only once deposits are recorded; opening rows never move cash", () => {
    const opening = [tx({ kind: "buy", quantity: "10", amount: "1000", opening: true })];
    expect(computePortfolio([account], [holding()], opening).accounts[0]!.cash).toBeNull();
    const withCash = computePortfolio(
      [account],
      [holding({ currentPrice: "110" })],
      [
        ...opening,
        tx({ kind: "deposit", holdingId: null, amount: "5000" }),
        tx({ kind: "buy", quantity: "10", amount: "1000", fee: "1" }),
        tx({ kind: "withdrawal", holdingId: null, amount: "500" }),
      ],
    );
    const a = withCash.accounts[0]!;
    expect(a.cash).toBe("3499.000000");
    expect(a.holdingsValue).toBe("2200.000000");
    expect(a.value).toBe("5699.000000");
  });

  it("never adds different currencies together", () => {
    const usd = { ...account, id: "u", currency: "USD" };
    const p = computePortfolio(
      [account, usd],
      [holding(), holding({ id: "h2", accountId: "u", currency: "USD" })],
      [
        tx({ kind: "buy", amount: "100" }),
        tx({ kind: "buy", accountId: "u", holdingId: "h2", amount: "50", currency: "USD" }),
      ],
    );
    expect(p.totals.map((x) => [x.currency, x.invested])).toEqual([
      ["EUR", "100.000000"],
      ["USD", "50.000000"],
    ]);
  });
});
