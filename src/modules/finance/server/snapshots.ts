import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { financeFxDefaults, financeSnapshots } from "../db";
import {
  addDays,
  amountProblem,
  currencyPrecision,
  dec,
  isIsoDate,
  rateProblem,
  toFixed,
  valuate,
  type BatchDraft,
  type FxSource,
  type SaveBatchInput,
  type Snapshot,
} from "../domain";
import { getBaseCurrency, listAccounts, listProviders, ownedAccounts } from "./structure";

/*
 * Balance snapshots. A batch is saved in one transaction under a per-user lock: either every entry
 * is valid and stored, or nothing is. Each snapshot copies the rate it was valued with; the defaults
 * table only pre-fills the next batch.
 */

type SnapshotRow = typeof financeSnapshots.$inferSelect;

/** Trims PostgreSQL's fixed scale back to the currency's precision ("1500.000000" → "1500.00"). */
function money(value: string, currency: string) {
  return toFixed(dec(value), currencyPrecision(currency));
}

function rate(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function toSnapshot(row: SnapshotRow): Snapshot {
  return {
    id: row.id,
    accountId: row.accountId,
    valuationDate: row.valuationDate,
    amount: money(row.amount, row.currencyCode),
    currency: row.currencyCode,
    baseCurrency: row.baseCurrency,
    fxRate: row.fxRate === null ? null : rate(row.fxRate),
    fxSource: row.fxSource as FxSource | null,
    baseAmount: row.baseAmount === null ? null : money(row.baseAmount, row.baseCurrency),
    notes: row.notes,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

export async function listSnapshots(
  db: DbExecutor,
  userId: string,
  accountId?: string,
): Promise<Snapshot[]> {
  const rows = await db
    .select()
    .from(financeSnapshots)
    .where(
      and(
        eq(financeSnapshots.userId, userId),
        accountId ? eq(financeSnapshots.accountId, accountId) : undefined,
      ),
    )
    .orderBy(asc(financeSnapshots.valuationDate), asc(financeSnapshots.accountId));
  return rows.map(toSnapshot);
}

export async function getDefaultRates(db: DbExecutor, userId: string, baseCurrency: string) {
  const rows = await db
    .select({ currency: financeFxDefaults.currencyCode, rate: financeFxDefaults.rate })
    .from(financeFxDefaults)
    .where(
      and(eq(financeFxDefaults.userId, userId), eq(financeFxDefaults.baseCurrency, baseCurrency)),
    );
  return Object.fromEntries(rows.map((r) => [r.currency, rate(r.rate)]));
}

/**
 * The batch form for a date: active accounts (plus any archived one already valued that day),
 * each with the snapshot of that date (a correction) and the latest earlier one (only a hint).
 */
export async function getBatchDraft(
  db: DbExecutor,
  userId: string,
  valuationDate: string,
): Promise<BatchDraft> {
  if (!isIsoDate(valuationDate)) throw new DomainError("invalid", "finance.invalid_date");
  const baseCurrency = await getBaseCurrency(db, userId);
  const [providers, accounts, onDate, earlier, defaultRates] = await Promise.all([
    listProviders(db, userId),
    listAccounts(db, userId),
    db
      .select()
      .from(financeSnapshots)
      .where(
        and(eq(financeSnapshots.userId, userId), eq(financeSnapshots.valuationDate, valuationDate)),
      ),
    db
      .selectDistinctOn([financeSnapshots.accountId])
      .from(financeSnapshots)
      .where(
        and(eq(financeSnapshots.userId, userId), lt(financeSnapshots.valuationDate, valuationDate)),
      )
      .orderBy(financeSnapshots.accountId, desc(financeSnapshots.valuationDate)),
    getDefaultRates(db, userId, baseCurrency),
  ]);
  const existing = new Map(onDate.map((row) => [row.accountId, toSnapshot(row)]));
  const previous = new Map(earlier.map((row) => [row.accountId, toSnapshot(row)]));
  const providerOrder = new Map(providers.map((p, i) => [p.id, i]));
  const providerName = new Map(providers.map((p) => [p.id, p.name]));
  return {
    valuationDate,
    baseCurrency,
    defaultRates,
    accounts: accounts
      .filter((a) => !a.archivedAt || existing.has(a.id))
      .sort(
        (a, b) => (providerOrder.get(a.providerId) ?? 0) - (providerOrder.get(b.providerId) ?? 0),
      )
      .map((account) => ({
        account,
        providerName: providerName.get(account.providerId) ?? "",
        existing: existing.get(account.id) ?? null,
        previous: previous.get(account.id) ?? null,
      })),
  };
}

/** Latest date a snapshot may carry: today anywhere on Earth (UTC+14), date-only. */
export function latestValuationDate(now = new Date()): string {
  return addDays(now.toISOString().slice(0, 10), 1);
}

/**
 * Saves a batch atomically. Every entry must be the user's own active account, a valid non-negative
 * amount in the account's currency precision, and appear once. Foreign currencies are valued with
 * the batch rate, or left unconverted without one. A snapshot that already exists on the date is
 * replaced only when `overwrite` is set (an explicit correction; its revision is bumped).
 */
export function saveBatch(db: DbExecutor, userId: string, input: SaveBatchInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`finance:${userId}`}))`);
    if (!isIsoDate(input.valuationDate) || input.valuationDate > latestValuationDate()) {
      throw new DomainError("invalid", "finance.invalid_date");
    }
    const ids = input.entries.map((e) => e.accountId);
    if (new Set(ids).size !== ids.length)
      throw new DomainError("invalid", "finance.duplicate_entry");
    const accounts = await ownedAccounts(tx, userId, ids);
    if (accounts.length !== ids.length)
      throw new DomainError("not_found", "finance.account_not_found");
    const accountOf = new Map(accounts.map((a) => [a.id, a]));
    const baseCurrency = await getBaseCurrency(tx, userId);

    // Rates: one per foreign currency present; invalid → reject, missing → unconverted.
    const rates = new Map<string, string>();
    for (const [currency, value] of Object.entries(input.rates)) {
      if (value.trim() === "" || currency === baseCurrency) continue;
      if (rateProblem(value)) throw new DomainError("invalid", "finance.invalid_rate");
      rates.set(currency, value.trim());
    }

    const existing = await tx
      .select()
      .from(financeSnapshots)
      .where(
        and(
          eq(financeSnapshots.userId, userId),
          eq(financeSnapshots.valuationDate, input.valuationDate),
          inArray(financeSnapshots.accountId, ids),
        ),
      );
    const existingOf = new Map(existing.map((row) => [row.accountId, row]));
    if (existing.length > 0 && !input.overwrite) {
      throw new DomainError("conflict", "finance.snapshot_exists");
    }

    for (const entry of input.entries) {
      const account = accountOf.get(entry.accountId)!;
      if (account.archivedAt) throw new DomainError("invalid", "finance.account_archived");
      if (amountProblem(entry.amount, account.currencyCode)) {
        throw new DomainError("invalid", "finance.invalid_amount");
      }
      const valuation = valuate(
        entry.amount,
        account.currencyCode,
        baseCurrency,
        rates.get(account.currencyCode) ?? null,
      );
      const values = {
        amount: entry.amount.trim(),
        currencyCode: account.currencyCode,
        baseCurrency,
        fxRate: valuation.fxRate,
        fxSource: valuation.fxSource,
        baseAmount: valuation.baseAmount,
        notes: entry.notes || null,
      };
      const current = existingOf.get(entry.accountId);
      if (current) {
        await tx
          .update(financeSnapshots)
          .set({ ...values, revision: current.revision + 1, updatedAt: new Date() })
          .where(and(eq(financeSnapshots.id, current.id), eq(financeSnapshots.userId, userId)));
      } else {
        await tx.insert(financeSnapshots).values({
          ...values,
          userId,
          accountId: entry.accountId,
          valuationDate: input.valuationDate,
        });
      }
    }

    // Remember the rates for the next batch (defaults only — never applied to history).
    for (const [currency, value] of rates) {
      await tx
        .insert(financeFxDefaults)
        .values({ userId, currencyCode: currency, baseCurrency, rate: value })
        .onConflictDoUpdate({
          target: [
            financeFxDefaults.userId,
            financeFxDefaults.currencyCode,
            financeFxDefaults.baseCurrency,
          ],
          set: { rate: value, updatedAt: new Date() },
        });
    }
    return { saved: input.entries.length, valuationDate: input.valuationDate };
  });
}

/** Removes one wrongly recorded snapshot (a correction). */
export async function deleteSnapshot(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select({ id: financeSnapshots.id })
    .from(financeSnapshots)
    .where(and(eq(financeSnapshots.id, id), eq(financeSnapshots.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.snapshot_not_found");
  await db
    .delete(financeSnapshots)
    .where(and(eq(financeSnapshots.id, id), eq(financeSnapshots.userId, userId)));
}
