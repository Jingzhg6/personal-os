import type { DbExecutor } from "@/shared/db/types";
import { defaultTimeZone } from "@/shared/i18n/config";
import { DomainError } from "@/shared/lib/errors";
import { getUserSettings } from "@/modules/settings/server";

import {
  byCategory,
  byCurrency,
  byProvider,
  changeBetween,
  daysBetween,
  netWorthHistory,
  positionsAt,
  rangeStart,
  STALE_AFTER_DAYS,
  todayIn,
  toMoney,
  totalsOf,
  type AccountHistory,
  type AssetCategory,
  type FinanceOverview,
  type FinanceStructure,
  type HistoryPointView,
  type HistoryRange,
  type Snapshot,
} from "../domain";
import { listSnapshots } from "./snapshots";
import { getBaseCurrency, listAccounts, listProviders } from "./structure";

/*
 * Read side. Everything is derived from recorded snapshots with the domain's exact arithmetic;
 * nothing is interpolated or filled in. "Today" is the user's local date (settings time zone).
 */

async function today(db: DbExecutor, userId: string) {
  const settings = await getUserSettings(db, userId);
  return todayIn(settings.timeZone ?? defaultTimeZone);
}

async function load(db: DbExecutor, userId: string) {
  const [baseCurrency, providers, accounts, snapshots, date] = await Promise.all([
    getBaseCurrency(db, userId),
    listProviders(db, userId),
    listAccounts(db, userId),
    listSnapshots(db, userId),
    today(db, userId),
  ]);
  return { baseCurrency, providers, accounts, snapshots, today: date };
}

export async function getFinanceStructure(
  db: DbExecutor,
  userId: string,
): Promise<FinanceStructure> {
  const { baseCurrency, providers, accounts, snapshots } = await load(db, userId);
  const latest: Record<string, Snapshot> = {};
  for (const s of snapshots) {
    if (!latest[s.accountId] || s.valuationDate > latest[s.accountId]!.valuationDate) {
      latest[s.accountId] = s;
    }
  }
  return { baseCurrency, baseLocked: snapshots.length > 0, providers, accounts, latest };
}

export async function getFinanceOverview(db: DbExecutor, userId: string): Promise<FinanceOverview> {
  const { baseCurrency, providers, accounts, snapshots, today: date } = await load(db, userId);
  const money = (value: Parameters<typeof toMoney>[0]) => toMoney(value, baseCurrency);
  const positions = positionsAt(accounts, snapshots, date, baseCurrency);
  const totals = totalsOf(positions);
  const dates = [...new Set(snapshots.map((s) => s.valuationDate))].filter((d) => d <= date).sort();
  const last = dates.at(-1) ?? null;
  const previous = dates.at(-2) ?? null;
  const providerName = new Map(providers.map((p) => [p.id, p.name]));

  let change: FinanceOverview["change"] = null;
  if (last && previous) {
    const split = changeBetween(
      positionsAt(accounts, snapshots, previous, baseCurrency),
      positionsAt(accounts, snapshots, last, baseCurrency),
      baseCurrency,
    );
    change = {
      since: previous,
      total: money(split.total),
      balance: money(split.balance),
      fx: money(split.fx),
      accounts: money(split.accounts),
    };
  }

  const valued = new Set(snapshots.map((s) => s.accountId));
  return {
    baseCurrency,
    today: date,
    hasAccounts: accounts.length > 0,
    hasSnapshots: snapshots.length > 0,
    netWorth: money(totals.netWorth),
    assets: money(totals.assets),
    liabilities: money(totals.liabilities),
    lastValuationDate: last,
    change,
    byCategory: byCategory(positions).map((b) => ({
      category: b.key as AssetCategory,
      value: money(b.value),
      accountCount: b.accountCount,
    })),
    byProvider: byProvider(positions).map((b) => ({
      providerId: b.key,
      name: providerName.get(b.key) ?? "",
      value: money(b.value),
      accountCount: b.accountCount,
    })),
    byCurrency: byCurrency(positions).map((c) => ({
      currency: c.currency,
      assets: toMoney(c.assets, c.currency),
      liabilities: toMoney(c.liabilities, c.currency),
    })),
    missing: accounts
      .filter((a) => !a.archivedAt && a.includeInNetWorth && !valued.has(a.id))
      .map((a) => ({
        accountId: a.id,
        name: a.name,
        providerName: providerName.get(a.providerId) ?? "",
      })),
    stale: positions
      .filter((p) => daysBetween(p.snapshot.valuationDate, date) > STALE_AFTER_DAYS)
      .map((p) => ({
        accountId: p.account.id,
        name: p.account.name,
        valuationDate: p.snapshot.valuationDate,
      })),
    unconverted: totals.unconverted.map((p) => ({
      accountId: p.account.id,
      name: p.account.name,
      currency: p.snapshot.currency,
      amount: p.snapshot.amount,
    })),
  };
}

export async function getFinanceHistory(
  db: DbExecutor,
  userId: string,
  range: HistoryRange,
): Promise<{ baseCurrency: string; range: HistoryRange; points: HistoryPointView[] }> {
  const { baseCurrency, accounts, snapshots, today: date } = await load(db, userId);
  const points = netWorthHistory(
    accounts,
    snapshots.filter((s) => s.valuationDate <= date),
    baseCurrency,
    rangeStart(range, date),
  );
  return {
    baseCurrency,
    range,
    points: points.map((p) => ({
      date: p.date,
      assets: toMoney(p.assets, baseCurrency),
      liabilities: toMoney(p.liabilities, baseCurrency),
      netWorth: toMoney(p.netWorth, baseCurrency),
      valued: p.valued,
      carried: p.carried,
      unconverted: p.unconverted,
    })),
  };
}

export async function getAccountHistory(
  db: DbExecutor,
  userId: string,
  accountId: string,
): Promise<AccountHistory> {
  const [baseCurrency, providers, accounts] = await Promise.all([
    getBaseCurrency(db, userId),
    listProviders(db, userId),
    listAccounts(db, userId),
  ]);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new DomainError("not_found", "finance.account_not_found");
  const snapshots = await listSnapshots(db, userId, accountId);
  return {
    account,
    providerName: providers.find((p) => p.id === account.providerId)?.name ?? "",
    baseCurrency,
    snapshots: [...snapshots].reverse(),
  };
}
