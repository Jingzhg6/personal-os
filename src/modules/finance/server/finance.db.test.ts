import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { users } from "@/shared/auth/schema";
import { createEventBus } from "@/shared/events/bus";
import { createCallerFactory } from "@/shared/trpc/init";
import { createTestDb, resetDb } from "@/test/db";
import { createUser } from "@/test/factories";

import { financeAccounts, financeFxDefaults, financeProviders, financeSnapshots } from "../db";
import { financeRouter } from "./router";

const { db, close } = createTestDb();

async function setup() {
  const user = await createUser(db);
  const ctx = { db, bus: createEventBus(), userId: user.id, resHeaders: null };
  return { user, api: createCallerFactory(financeRouter)(ctx) };
}

type Api = Awaited<ReturnType<typeof setup>>["api"];

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ cause: { code } });

/** BNP (EUR current + Livret A), Bank of China (CNY), a credit card. */
async function seed(api: Api) {
  const bnp = await api.providers.create({
    name: "BNP Paribas",
    providerType: "bank",
    country: "FR",
  });
  const boc = await api.providers.create({ name: "Bank of China", providerType: "bank" });
  const current = await api.accounts.create({
    providerId: bnp.id,
    name: "Compte courant",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "EUR",
  });
  const livret = await api.accounts.create({
    providerId: bnp.id,
    name: "Livret A",
    kind: "asset",
    accountType: "savings",
    assetCategory: "savings",
    currency: "EUR",
  });
  const cny = await api.accounts.create({
    providerId: boc.id,
    name: "活期",
    kind: "asset",
    accountType: "current",
    assetCategory: "bank_deposit",
    currency: "cny",
  });
  const card = await api.accounts.create({
    providerId: bnp.id,
    name: "Visa",
    kind: "liability",
    accountType: "credit_card",
    assetCategory: null,
    currency: "EUR",
  });
  return { bnp, boc, current, livret, cny, card };
}

beforeEach(() => resetDb(db));
afterAll(() => close());

describe("providers and accounts", () => {
  it("creates an institution with several accounts in several currencies", async () => {
    const { api } = await setup();
    const { bnp, cny } = await seed(api);
    const structure = await api.structure();
    expect(structure.baseCurrency).toBe("EUR");
    expect(structure.providers.map((p) => p.name)).toEqual(["BNP Paribas", "Bank of China"]);
    expect(structure.accounts.filter((a) => a.providerId === bnp.id).map((a) => a.name)).toEqual([
      "Compte courant",
      "Livret A",
      "Visa",
    ]);
    expect(cny.currency).toBe("CNY");
  });

  it("validates account shapes and currencies", async () => {
    const { api } = await setup();
    const { bnp } = await seed(api);
    const base = { providerId: bnp.id, name: "x", currency: "EUR" } as const;
    await expect(
      api.accounts.create({
        ...base,
        kind: "liability",
        accountType: "credit_card",
        assetCategory: "cash",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.accounts.create({ ...base, kind: "asset", accountType: "loan", assetCategory: "cash" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      api.accounts.create({
        ...base,
        kind: "asset",
        accountType: "cash",
        assetCategory: "cash",
        currency: "XYZ",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renames, reorders and edits accounts; currency and kind are locked once history exists", async () => {
    const { api } = await setup();
    const { current, livret, cny } = await seed(api);
    await api.accounts.update({
      id: livret.id,
      patch: { name: "Livret A (BNP)", includeInNetWorth: false },
    });
    await api.accounts.move({ id: livret.id, direction: "up" });
    // No history yet: currency may change.
    await api.accounts.update({ id: cny.id, patch: { currency: "USD" } });
    await api.accounts.update({ id: cny.id, patch: { currency: "CNY" } });

    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1500.00" }],
    });
    await rejects(
      api.accounts.update({ id: current.id, patch: { currency: "USD" } }),
      "finance.account_has_history",
    );
    await rejects(
      api.accounts.update({ id: current.id, patch: { kind: "liability", accountType: "loan" } }),
      "finance.account_has_history",
    );
    await rejects(api.accounts.delete({ id: current.id }), "finance.account_has_history");
    // The database refuses it too.
    await expect(
      db
        .update(financeAccounts)
        .set({ currencyCode: "USD" })
        .where(eq(financeAccounts.id, current.id)),
    ).rejects.toThrow();

    const accounts = (await api.structure()).accounts;
    expect(accounts.find((a) => a.id === livret.id)).toMatchObject({
      name: "Livret A (BNP)",
      includeInNetWorth: false,
    });
    expect(
      accounts
        .filter((a) => a.providerId === current.providerId)
        .map((a) => a.name)
        .slice(0, 2),
    ).toEqual(["Livret A (BNP)", "Compte courant"]);
  });

  it("archives accounts and institutions without losing history; deleting is only for empty ones", async () => {
    const { api } = await setup();
    const { bnp, boc, current, livret, cny } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-09-01",
      entries: [
        { accountId: current.id, amount: "1000.00" },
        { accountId: livret.id, amount: "5000.00" },
      ],
    });
    await api.accounts.setArchived({ id: livret.id, archived: true });
    let structure = await api.structure();
    expect(structure.accounts.find((a) => a.id === livret.id)).toMatchObject({
      closedOn: "2026-09-01",
    });
    expect((await api.accounts.history({ id: livret.id })).snapshots).toHaveLength(1);
    await rejects(
      api.snapshots.saveBatch({
        valuationDate: "2026-10-01",
        entries: [{ accountId: livret.id, amount: "1" }],
      }),
      "finance.account_archived",
    );
    // Archived accounts still count in history up to their closing date.
    const history = await api.history({ range: "all" });
    expect(history.points.map((p) => p.netWorth)).toEqual(["6000.00"]);

    await api.accounts.setArchived({ id: livret.id, archived: false });
    expect((await api.structure()).accounts.find((a) => a.id === livret.id)?.closedOn).toBeNull();

    await rejects(api.providers.delete({ id: bnp.id }), "finance.provider_has_accounts");
    await api.accounts.delete({ id: cny.id }); // no history: may be deleted
    await api.providers.delete({ id: boc.id });

    await api.providers.setArchived({ id: bnp.id, archived: true });
    structure = await api.structure();
    expect(structure.accounts.every((a) => a.archivedAt !== null)).toBe(true);
    await rejects(
      api.accounts.create({
        providerId: bnp.id,
        name: "new",
        kind: "asset",
        accountType: "cash",
        assetCategory: "cash",
        currency: "EUR",
      }),
      "finance.provider_archived",
    );
    expect(await db.select().from(financeSnapshots)).toHaveLength(2);
  });
});

describe("snapshots and valuation", () => {
  it("values EUR and CNY with the batch rate, subtracts liabilities, and stores the rate used", async () => {
    const { api } = await setup();
    const { current, livret, cny, card } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [
        { accountId: current.id, amount: "1500.00" },
        { accountId: livret.id, amount: "8000" },
        { accountId: cny.id, amount: "10000.00" },
        { accountId: card.id, amount: "420.50" },
      ],
      rates: { CNY: "0.1282" },
    });
    const history = await api.accounts.history({ id: cny.id });
    expect(history.snapshots[0]).toMatchObject({
      amount: "10000.00",
      currency: "CNY",
      baseCurrency: "EUR",
      fxRate: "0.1282",
      fxSource: "manual",
      baseAmount: "1282.00",
      revision: 1,
    });
    const overview = await api.overview();
    expect(overview).toMatchObject({
      assets: "10782.00",
      liabilities: "420.50",
      netWorth: "10361.50",
      lastValuationDate: "2026-10-01",
      unconverted: [],
    });
    expect(overview.byCategory.map((c) => [c.category, c.value])).toEqual([
      ["savings", "8000.00"],
      ["bank_deposit", "2782.00"],
    ]);
    expect(overview.byCurrency).toEqual([
      { currency: "CNY", assets: "10000.00", liabilities: "0.00" },
      { currency: "EUR", assets: "9500.00", liabilities: "420.50" },
    ]);
    // The rate is remembered as a default for next time.
    expect(await db.select().from(financeFxDefaults)).toEqual([
      expect.objectContaining({ currencyCode: "CNY", baseCurrency: "EUR" }),
    ]);
  });

  it("leaves a foreign balance unconverted without a rate — never as 1", async () => {
    const { api } = await setup();
    const { current, cny } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [
        { accountId: current.id, amount: "100.00" },
        { accountId: cny.id, amount: "5000.00" },
      ],
    });
    const overview = await api.overview();
    expect(overview.netWorth).toBe("100.00");
    expect(overview.unconverted).toEqual([
      { accountId: cny.id, name: "活期", currency: "CNY", amount: "5000.00" },
    ]);
    const [point] = (await api.history({ range: "all" })).points;
    expect(point).toMatchObject({ netWorth: "100.00", unconverted: 1 });
  });

  it("never revalues history when later rates differ", async () => {
    const { api } = await setup();
    const { cny } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-09-01",
      entries: [{ accountId: cny.id, amount: "10000.00" }],
      rates: { CNY: "0.12" },
    });
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: cny.id, amount: "10000.00" }],
      rates: { CNY: "0.14" },
    });
    const history = await api.history({ range: "all" });
    expect(history.points.map((p) => [p.date, p.netWorth])).toEqual([
      ["2026-09-01", "1200.00"],
      ["2026-10-01", "1400.00"],
    ]);
    const overview = await api.overview();
    expect(overview.change).toEqual({
      since: "2026-09-01",
      total: "200.00",
      balance: "0.00",
      fx: "200.00",
      accounts: "0.00",
    });
  });

  it("refuses duplicates unless the batch is an explicit correction, which bumps the revision", async () => {
    const { api } = await setup();
    const { current } = await seed(api);
    const batch = {
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1500.00" }],
    };
    await api.snapshots.saveBatch(batch);
    await rejects(api.snapshots.saveBatch(batch), "finance.snapshot_exists");
    await api.snapshots.saveBatch({
      ...batch,
      entries: [{ accountId: current.id, amount: "1550.00" }],
      overwrite: true,
    });
    const [snapshot] = (await api.accounts.history({ id: current.id })).snapshots;
    expect(snapshot).toMatchObject({ amount: "1550.00", revision: 2 });
    // The database's unique key holds even if the service were bypassed.
    await expect(
      db.insert(financeSnapshots).values({
        userId: (await db.select().from(financeAccounts))[0]!.userId,
        accountId: current.id,
        valuationDate: "2026-10-01",
        amount: "1",
        currencyCode: "EUR",
        baseCurrency: "EUR",
        fxRate: "1",
        fxSource: "identity",
        baseAmount: "1",
      }),
    ).rejects.toThrow();

    await api.snapshots.delete({ id: snapshot!.id });
    expect((await api.accounts.history({ id: current.id })).snapshots).toEqual([]);
  });

  it("saves a batch atomically: one invalid entry stores nothing", async () => {
    const { api } = await setup();
    const { current, livret, cny } = await seed(api);
    const attempts = [
      {
        entries: [
          { accountId: current.id, amount: "100.00" },
          { accountId: livret.id, amount: "-5" },
        ],
        code: "finance.invalid_amount",
      },
      {
        entries: [
          { accountId: current.id, amount: "100.00" },
          { accountId: livret.id, amount: "1.234" },
        ],
        code: "finance.invalid_amount",
      },
      {
        entries: [
          { accountId: current.id, amount: "1" },
          { accountId: current.id, amount: "2" },
        ],
        code: "finance.duplicate_entry",
      },
      {
        entries: [
          { accountId: current.id, amount: "1" },
          { accountId: crypto.randomUUID(), amount: "2" },
        ],
        code: "finance.account_not_found",
      },
    ];
    for (const { entries, code } of attempts) {
      await rejects(api.snapshots.saveBatch({ valuationDate: "2026-10-01", entries }), code);
    }
    await rejects(
      api.snapshots.saveBatch({
        valuationDate: "2026-10-01",
        entries: [{ accountId: cny.id, amount: "100" }],
        rates: { CNY: "-1" },
      }),
      "finance.invalid_rate",
    );
    await rejects(
      api.snapshots.saveBatch({
        valuationDate: "2999-01-01",
        entries: [{ accountId: current.id, amount: "1" }],
      }),
      "finance.invalid_date",
    );
    expect(await db.select().from(financeSnapshots)).toEqual([]);
  });

  it("records zero balances and keeps assets non-negative at the database", async () => {
    const { api, user } = await setup();
    const { current } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "0" }],
    });
    expect((await api.overview()).netWorth).toBe("0.00");
    await expect(
      db.insert(financeSnapshots).values({
        userId: user.id,
        accountId: current.id,
        valuationDate: "2026-10-02",
        amount: "-1",
        currencyCode: "EUR",
        baseCurrency: "EUR",
        fxRate: "1",
        fxSource: "identity",
        baseAmount: "-1",
      }),
    ).rejects.toThrow();
    // A converted value without a rate is refused too (no silent 1).
    await expect(
      db.insert(financeSnapshots).values({
        userId: user.id,
        accountId: current.id,
        valuationDate: "2026-10-03",
        amount: "1",
        currencyCode: "EUR",
        baseCurrency: "EUR",
        baseAmount: "1",
      }),
    ).rejects.toThrow();
  });

  it("drafts a batch with existing values (corrections) and previous values (hints only)", async () => {
    const { api } = await setup();
    const { current, cny } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-09-01",
      entries: [
        { accountId: current.id, amount: "900.00" },
        { accountId: cny.id, amount: "1000.00" },
      ],
      rates: { CNY: "0.13" },
    });
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1000.00" }],
    });
    const draft = await api.snapshots.draft({ valuationDate: "2026-10-01" });
    expect(draft.defaultRates).toEqual({ CNY: "0.13" });
    const byId = new Map(draft.accounts.map((a) => [a.account.id, a]));
    expect(byId.get(current.id)).toMatchObject({
      existing: { amount: "1000.00" },
      previous: { amount: "900.00", valuationDate: "2026-09-01" },
    });
    expect(byId.get(cny.id)).toMatchObject({ existing: null, previous: { amount: "1000.00" } });
  });

  it("locks the base currency once snapshots exist", async () => {
    const { api } = await setup();
    const { current } = await seed(api);
    await api.setBaseCurrency({ baseCurrency: "CNY" });
    await api.setBaseCurrency({ baseCurrency: "EUR" });
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1" }],
    });
    await rejects(api.setBaseCurrency({ baseCurrency: "CNY" }), "finance.base_locked");
  });

  it("returns a correct empty state", async () => {
    const { api } = await setup();
    expect(await api.overview()).toMatchObject({
      hasAccounts: false,
      hasSnapshots: false,
      netWorth: "0.00",
      lastValuationDate: null,
      change: null,
      byCategory: [],
      missing: [],
    });
    expect((await api.history({ range: "all" })).points).toEqual([]);
  });
});

describe("ownership", () => {
  it("never reads or changes another user's institutions, accounts or snapshots", async () => {
    const owner = await setup();
    const other = await setup();
    const { bnp, current } = await seed(owner.api);
    await owner.api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1500.00" }],
    });
    const [snapshot] = (await owner.api.accounts.history({ id: current.id })).snapshots;
    const api = other.api;

    expect((await api.structure()).providers).toEqual([]);
    expect((await api.overview()).netWorth).toBe("0.00");
    await rejects(
      api.providers.update({ id: bnp.id, patch: { name: "x" } }),
      "finance.provider_not_found",
    );
    await rejects(
      api.providers.setArchived({ id: bnp.id, archived: true }),
      "finance.provider_not_found",
    );
    await rejects(api.providers.delete({ id: bnp.id }), "finance.provider_not_found");
    await rejects(
      api.accounts.create({
        providerId: bnp.id,
        name: "x",
        kind: "asset",
        accountType: "cash",
        assetCategory: "cash",
        currency: "EUR",
      }),
      "finance.provider_not_found",
    );
    await rejects(api.accounts.history({ id: current.id }), "finance.account_not_found");
    await rejects(
      api.accounts.update({ id: current.id, patch: { name: "x" } }),
      "finance.account_not_found",
    );
    await rejects(
      api.accounts.setArchived({ id: current.id, archived: true }),
      "finance.account_not_found",
    );
    await rejects(
      api.snapshots.saveBatch({
        valuationDate: "2026-10-02",
        entries: [{ accountId: current.id, amount: "1" }],
      }),
      "finance.account_not_found",
    );
    await rejects(api.snapshots.delete({ id: snapshot!.id }), "finance.snapshot_not_found");
    expect((await api.snapshots.draft({ valuationDate: "2026-10-01" })).accounts).toEqual([]);

    // The database's composite keys refuse a cross-user reference outright.
    await expect(
      db.insert(financeSnapshots).values({
        userId: other.user.id,
        accountId: current.id,
        valuationDate: "2026-11-01",
        amount: "1",
        currencyCode: "EUR",
        baseCurrency: "EUR",
        fxRate: "1",
        fxSource: "identity",
        baseAmount: "1",
      }),
    ).rejects.toThrow();
    expect((await owner.api.overview()).netWorth).toBe("1500.00");
  });

  it("deleting a user removes their finance data in one cascade", async () => {
    const { api, user } = await setup();
    const { current } = await seed(api);
    await api.snapshots.saveBatch({
      valuationDate: "2026-10-01",
      entries: [{ accountId: current.id, amount: "1" }],
    });
    await db.delete(users).where(eq(users.id, user.id));
    const [count] = (
      await db.execute<{ n: number }>(
        sql`select (select count(*) from finance_providers) + (select count(*) from finance_accounts) + (select count(*) from finance_snapshots) as n`,
      )
    ).rows;
    expect(Number(count!.n)).toBe(0);
    void financeProviders;
  });
});
