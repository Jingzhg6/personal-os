import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createSeededUser } from "@/test/factories";

import { createAppEventBus } from "./event-bus";
import { appRouter } from "./trpc/root";

/*
 * V3 (ADR 0029) through the real routers: investment accounts, holdings and transactions (figures
 * computed from the transactions, kept consistent, per currency, added once to net worth), the
 * saved navigation layout, and project progress counting subtasks.
 */

const { db, close } = createTestDb();
const bus = createAppEventBus();
const caller = createCallerFactory(appRouter);
const TODAY = "2026-11-18";

async function setup() {
  const user = await createSeededUser(db);
  const api = caller({ db, bus, userId: user.id, resHeaders: null });
  await api.settings.update({ timeZone: "UTC" });
  await api.finance.setBaseCurrency({ baseCurrency: "EUR" });
  return { user, api };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("investment accounts, holdings and transactions", () => {
  it("computes holdings from transactions and adds base-currency accounts to net worth", async () => {
    const { api } = await setup();
    const inv = api.finance.investments;
    const broker = await inv.accounts.create({
      name: "券商 A",
      institution: "某券商",
      accountType: "brokerage",
      currency: "EUR",
    });
    const etf = await inv.holdings.create({ accountId: broker.id, name: "ETF", kind: "etf" });
    await inv.transactions.create({
      accountId: broker.id,
      kind: "deposit",
      tradeDate: "2026-01-01",
      amount: "5000",
    });
    await inv.transactions.create({
      accountId: broker.id,
      holdingId: etf.id,
      kind: "buy",
      tradeDate: "2026-01-02",
      quantity: "10",
      unitPrice: "100",
      fee: "5",
    });
    const sell = await inv.transactions.create({
      accountId: broker.id,
      holdingId: etf.id,
      kind: "sell",
      tradeDate: "2026-03-01",
      quantity: "4",
      unitPrice: "120",
      fee: "2",
    });
    expect(sell.amount).toBe("480.00"); // quantity × unit price

    let portfolio = await inv.portfolio();
    let holding = portfolio.accounts[0]!.holdings[0]!;
    // Average cost 100.5; 4 sold for 478 net → realised 76; 6 left at cost 603.
    expect(holding).toMatchObject({
      units: "6.00000000",
      costBasis: "603.000000",
      realized: "76.000000",
      valuation: "cost",
      unrealized: null,
    });
    expect(portfolio.accounts[0]!.cash).toBe("4473.000000");

    await inv.holdings.update({ id: etf.id, patch: { currentPrice: "130", priceDate: TODAY } });
    portfolio = await inv.portfolio();
    holding = portfolio.accounts[0]!.holdings[0]!;
    expect(holding).toMatchObject({ valuation: "price", marketValue: "780.000000" });
    expect(holding.unrealized).toBe("177.000000");
    expect(portfolio.totals[0]).toMatchObject({ currency: "EUR", value: "5253.000000" });

    const overview = await api.finance.overview();
    expect(overview.investments).toMatchObject({ value: "5253.00", cost: "603.00", unvalued: 0 });
    expect(overview.assets).toBe("5253.00");

    // Edit and delete keep holdings consistent.
    await inv.transactions.update({ id: sell.id, patch: { quantity: "5" } });
    expect((await inv.portfolio()).accounts[0]!.holdings[0]!.units).toBe("5.00000000");
    await inv.transactions.delete({ id: sell.id });
    expect((await inv.portfolio()).accounts[0]!.holdings[0]!.units).toBe("10.00000000");
  });

  it("refuses a sell beyond the units held, and keeps currencies apart", async () => {
    const { api } = await setup();
    const inv = api.finance.investments;
    const usd = await inv.accounts.create({
      name: "US",
      accountType: "brokerage",
      currency: "USD",
    });
    const stock = await inv.holdings.create({ accountId: usd.id, name: "AAPL", kind: "stock" });
    const buy = await inv.transactions.create({
      accountId: usd.id,
      holdingId: stock.id,
      kind: "buy",
      tradeDate: "2026-01-02",
      quantity: "2",
      unitPrice: "100",
    });
    await expect(
      inv.transactions.create({
        accountId: usd.id,
        holdingId: stock.id,
        kind: "sell",
        tradeDate: "2026-01-03",
        quantity: "3",
        unitPrice: "100",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Deleting the buy under a later sell is refused too (rolled back).
    await inv.transactions.create({
      accountId: usd.id,
      holdingId: stock.id,
      kind: "sell",
      tradeDate: "2026-01-04",
      quantity: "1",
      unitPrice: "150",
    });
    await expect(inv.transactions.delete({ id: buy.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // Currency is locked once the account is used; USD is not added to EUR totals.
    await expect(
      inv.accounts.update({ id: usd.id, patch: { currency: "EUR" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const overview = await api.finance.overview();
    expect(overview.investments).toMatchObject({ value: "0.00", otherCurrency: 1 });
    expect((await inv.portfolio()).totals.map((x) => x.currency)).toEqual(["USD"]);
  });

  it("archives accounts and scopes everything to the user", async () => {
    const a = await setup();
    const b = await setup();
    const account = await a.api.finance.investments.accounts.create({
      name: "平台",
      accountType: "platform",
      currency: "EUR",
    });
    const holding = await a.api.finance.investments.holdings.create({
      accountId: account.id,
      name: "基金",
      kind: "fund",
    });
    expect((await b.api.finance.investments.portfolio()).accounts).toEqual([]);
    await expect(
      b.api.finance.investments.holdings.create({
        accountId: account.id,
        name: "x",
        kind: "other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.api.finance.investments.transactions.create({
        accountId: account.id,
        kind: "deposit",
        tradeDate: TODAY,
        amount: "1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      b.api.finance.investments.holdings.delete({ id: holding.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await a.api.finance.investments.accounts.setArchived({ id: account.id, archived: true });
    await expect(
      a.api.finance.investments.transactions.create({
        accountId: account.id,
        kind: "deposit",
        tradeDate: TODAY,
        amount: "1",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await a.api.finance.investments.portfolio()).accounts[0]!.archivedAt).not.toBeNull();
  });
});

describe("navigation layout", () => {
  it("is saved per user and reset with null", async () => {
    const a = await setup();
    const b = await setup();
    const layout = { sections: ["finance", "overview"], items: { overview: ["productivity"] } };
    await a.api.settings.update({ navLayout: layout });
    expect((await a.api.settings.get()).navLayout).toEqual(layout);
    expect((await b.api.settings.get()).navLayout).toBeNull();
    await expect(
      a.api.settings.update({ navLayout: { sections: ["<script>"], items: {} } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await a.api.settings.update({ navLayout: null });
    expect((await a.api.settings.get()).navLayout).toBeNull();
  });
});

describe("project progress", () => {
  it("counts the project's tasks and their subtasks", async () => {
    const { api } = await setup();
    const project = await api.projects.create({ name: "搬家" });
    const parent = await api.tasks.create({ title: "打包", projectId: project.id });
    const sub = await api.tasks.create({ title: "书", parentTaskId: parent.id });
    await api.tasks.create({ title: "衣服", parentTaskId: parent.id });
    await api.tasks.complete({ id: sub.id });
    const [listed] = await api.projects.list({ today: TODAY });
    expect(listed!.progress).toMatchObject({ total: 3, completed: 1 });
  });
});
