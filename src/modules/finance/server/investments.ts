import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import {
  financeInvestmentAccounts,
  financeInvestments,
  financeInvestmentTransactions,
} from "../db";
import {
  amountProblem,
  computePortfolio,
  dec,
  mul,
  replayHolding,
  round,
  toFixed,
  currencyPrecision,
  type AccountRecord,
  type archiveInvestmentAccountInput,
  type createHoldingInput,
  type createTransactionInput,
  type FinanceOverview,
  type HoldingRecord,
  type InvestmentAccountType,
  type InvestmentKind,
  type investmentAccountInput,
  type Portfolio,
  type TransactionKind,
  type TransactionRecord,
  type updateHoldingInput,
  type updateInvestmentAccountInput,
  type updateTransactionInput,
} from "../domain";

/*
 * Investments (V3, ADR 0029): accounts, holdings and transactions, every query scoped to the
 * user. Figures are computed by the domain from the transactions; every write that could make
 * them inconsistent (a sell of more units than held) is checked inside the same database
 * transaction and rolled back.
 */

type AccountRow = typeof financeInvestmentAccounts.$inferSelect;
type HoldingRow = typeof financeInvestments.$inferSelect;
type TransactionRow = typeof financeInvestmentTransactions.$inferSelect;

/** "12.50000000" → "12.5" */
const trimZeros = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const optional = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim();

const accountRecord = (r: AccountRow): AccountRecord => ({
  id: r.id,
  name: r.name,
  institution: r.institution,
  accountType: r.accountType as InvestmentAccountType,
  currency: r.currencyCode,
  notes: r.notes,
  legacy: r.legacy,
  archivedAt: r.archivedAt,
});
const holdingRecord = (r: HoldingRow): HoldingRecord => ({
  id: r.id,
  accountId: r.accountId!,
  name: r.name,
  kind: r.kind as InvestmentKind,
  ticker: r.ticker,
  currency: r.currencyCode,
  notes: r.notes,
  currentPrice: r.currentPrice === null ? null : trimZeros(r.currentPrice),
  priceDate: r.priceDate,
  currentValue:
    r.currentValue === null
      ? null
      : toFixed(dec(r.currentValue), currencyPrecision(r.currencyCode)),
});
const transactionRecord = (r: TransactionRow): TransactionRecord => {
  const digits = currencyPrecision(r.currencyCode);
  return {
    id: r.id,
    accountId: r.accountId,
    holdingId: r.holdingId,
    kind: r.kind as TransactionKind,
    tradeDate: r.tradeDate,
    quantity: r.quantity === null ? null : trimZeros(r.quantity),
    unitPrice: r.unitPrice === null ? null : trimZeros(r.unitPrice),
    amount: toFixed(dec(r.amount), digits),
    fee: toFixed(dec(r.fee), digits),
    currency: r.currencyCode,
    notes: r.notes,
    opening: r.opening,
    createdAt: r.createdAt,
  };
};

export async function getPortfolio(db: DbExecutor, userId: string): Promise<Portfolio> {
  const [accounts, holdings, transactions] = await Promise.all([
    db
      .select()
      .from(financeInvestmentAccounts)
      .where(eq(financeInvestmentAccounts.userId, userId))
      .orderBy(asc(financeInvestmentAccounts.createdAt), asc(financeInvestmentAccounts.id)),
    db
      .select()
      .from(financeInvestments)
      .where(eq(financeInvestments.userId, userId))
      .orderBy(asc(financeInvestments.createdAt), asc(financeInvestments.id)),
    db
      .select()
      .from(financeInvestmentTransactions)
      .where(eq(financeInvestmentTransactions.userId, userId)),
  ]);
  return computePortfolio(
    accounts.map(accountRecord),
    holdings.filter((h) => h.accountId !== null).map(holdingRecord),
    transactions.map(transactionRecord),
  );
}

/** What the asset overview adds: accounts in the base currency; others are counted, not added. */
export function portfolioSummary(
  portfolio: Portfolio,
  baseCurrency: string,
): FinanceOverview["investments"] {
  const base = portfolio.totals.find((t) => t.currency === baseCurrency);
  const precision = currencyPrecision(baseCurrency);
  const money = (value: string | undefined) => toFixed(dec(value ?? "0"), precision);
  return {
    count: portfolio.accounts
      .filter((a) => a.currency === baseCurrency)
      .reduce((n, a) => n + a.holdings.length, 0),
    cost: money(base?.costBasis),
    value: money(base?.value),
    unvalued: base?.estimated ?? 0,
    otherCurrency: portfolio.accounts.filter(
      (a) => a.currency !== baseCurrency && (a.holdings.length > 0 || a.cash !== null),
    ).length,
  };
}

/* ------------------------------------------------------------------------------ accounts */

async function ownedAccount(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financeInvestmentAccounts)
    .where(and(eq(financeInvestmentAccounts.id, id), eq(financeInvestmentAccounts.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.investment_account_not_found");
  return row;
}

export async function createInvestmentAccount(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof investmentAccountInput>,
) {
  const [row] = await db
    .insert(financeInvestmentAccounts)
    .values({
      userId,
      name: input.name,
      institution: optional(input.institution) ?? null,
      accountType: input.accountType,
      currencyCode: input.currency,
      notes: optional(input.notes) ?? null,
    })
    .returning();
  return accountRecord(row!);
}

export async function updateInvestmentAccount(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateInvestmentAccountInput>,
) {
  return db.transaction(async (tx) => {
    const row = await ownedAccount(tx, userId, id);
    if (patch.currency && patch.currency !== row.currencyCode) {
      const [used] = await tx
        .select({ id: financeInvestments.id })
        .from(financeInvestments)
        .where(eq(financeInvestments.accountId, id))
        .limit(1);
      const [traded] = await tx
        .select({ id: financeInvestmentTransactions.id })
        .from(financeInvestmentTransactions)
        .where(eq(financeInvestmentTransactions.accountId, id))
        .limit(1);
      if (used || traded) throw new DomainError("conflict", "finance.investment_account_in_use");
    }
    const [updated] = await tx
      .update(financeInvestmentAccounts)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.institution !== undefined && { institution: optional(patch.institution) }),
        ...(patch.accountType !== undefined && { accountType: patch.accountType }),
        ...(patch.currency !== undefined && { currencyCode: patch.currency }),
        ...(patch.notes !== undefined && { notes: optional(patch.notes) }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(financeInvestmentAccounts.id, id), eq(financeInvestmentAccounts.userId, userId)),
      )
      .returning();
    return accountRecord(updated!);
  });
}

export async function setInvestmentAccountArchived(
  db: DbExecutor,
  userId: string,
  { id, archived }: z.infer<typeof archiveInvestmentAccountInput>,
) {
  await ownedAccount(db, userId, id);
  await db
    .update(financeInvestmentAccounts)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(financeInvestmentAccounts.id, id), eq(financeInvestmentAccounts.userId, userId)));
}

/* ------------------------------------------------------------------------------ holdings */

async function ownedHolding(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.investment_not_found");
  return row;
}

function checkMoney(value: string | null | undefined, currency: string) {
  if (value == null) return;
  if (amountProblem(value, currency)) throw new DomainError("invalid", "finance.invalid_amount");
}

export async function createHolding(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof createHoldingInput>,
) {
  const account = await ownedAccount(db, userId, input.accountId);
  if (account.archivedAt) throw new DomainError("invalid", "finance.investment_account_archived");
  const currentValue = optional(input.currentValue) ?? null;
  checkMoney(currentValue, account.currencyCode);
  const [row] = await db
    .insert(financeInvestments)
    .values({
      userId,
      accountId: account.id,
      name: input.name,
      kind: input.kind,
      ticker: optional(input.ticker) ?? null,
      currencyCode: account.currencyCode,
      notes: optional(input.notes) ?? null,
      currentPrice: optional(input.currentPrice) ?? null,
      priceDate: input.priceDate ?? null,
      currentValue,
    })
    .returning();
  return holdingRecord(row!);
}

export async function updateHolding(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateHoldingInput>,
) {
  const row = await ownedHolding(db, userId, id);
  const currentValue = optional(patch.currentValue);
  checkMoney(currentValue, row.currencyCode);
  const [updated] = await db
    .update(financeInvestments)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.ticker !== undefined && { ticker: optional(patch.ticker) }),
      ...(patch.notes !== undefined && { notes: optional(patch.notes) }),
      ...(patch.currentPrice !== undefined && { currentPrice: optional(patch.currentPrice) }),
      ...(patch.priceDate !== undefined && { priceDate: patch.priceDate }),
      ...(currentValue !== undefined && { currentValue }),
      updatedAt: new Date(),
    })
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)))
    .returning();
  return holdingRecord(updated!);
}

/** Deletes a holding with its transactions (the UI asks first). */
export async function deleteHolding(db: DbExecutor, userId: string, id: string) {
  await ownedHolding(db, userId, id);
  await db
    .delete(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)));
}

/* -------------------------------------------------------------------------- transactions */

interface TransactionValues {
  holdingId: string | null;
  kind: TransactionKind;
  tradeDate: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  fee: string | null;
  notes: string | null;
}

/** Checks a transaction against its account and fills in the amount of a trade. */
async function prepare(
  db: DbExecutor,
  userId: string,
  account: AccountRow,
  values: TransactionValues,
) {
  const { kind, holdingId } = values;
  if ((kind === "buy" || kind === "sell") && !holdingId)
    throw new DomainError("invalid", "finance.transaction_needs_holding");
  if (kind === "deposit" || kind === "withdrawal") values.holdingId = null;
  if (values.holdingId) {
    const holding = await ownedHolding(db, userId, values.holdingId);
    if (holding.accountId !== account.id)
      throw new DomainError("invalid", "finance.holding_other_account");
  }
  if (kind === "sell" && !values.quantity)
    throw new DomainError("invalid", "finance.sell_needs_quantity");
  for (const q of [values.quantity, values.unitPrice])
    if (q !== null && !(Number(q) > 0))
      throw new DomainError("invalid", "finance.invalid_quantity");
  let amount = values.amount;
  if (amount === null && values.quantity && values.unitPrice)
    amount = toFixed(
      round(
        mul(dec(values.quantity), dec(values.unitPrice)),
        currencyPrecision(account.currencyCode),
      ),
    );
  if (amount === null) throw new DomainError("invalid", "finance.transaction_needs_amount");
  checkMoney(amount, account.currencyCode);
  checkMoney(values.fee, account.currencyCode);
  return { ...values, amount, fee: values.fee ?? "0" };
}

/** Re-checks the holdings a write touched; an impossible history rolls the write back. */
async function assertConsistent(db: DbExecutor, userId: string, holdingIds: (string | null)[]) {
  const ids = [...new Set(holdingIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(financeInvestmentTransactions)
    .where(
      and(
        eq(financeInvestmentTransactions.userId, userId),
        inArray(financeInvestmentTransactions.holdingId, ids),
      ),
    );
  for (const id of ids) {
    const problem = replayHolding(
      rows.filter((r) => r.holdingId === id).map(transactionRecord),
    ).problem;
    if (problem) throw new DomainError("invalid", `finance.${problem}`);
  }
}

export async function createTransaction(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof createTransactionInput>,
) {
  return db.transaction(async (tx) => {
    const account = await ownedAccount(tx, userId, input.accountId);
    if (account.archivedAt) throw new DomainError("invalid", "finance.investment_account_archived");
    const values = await prepare(tx, userId, account, {
      holdingId: input.holdingId ?? null,
      kind: input.kind,
      tradeDate: input.tradeDate,
      quantity: optional(input.quantity) ?? null,
      unitPrice: optional(input.unitPrice) ?? null,
      amount: optional(input.amount) ?? null,
      fee: optional(input.fee) ?? null,
      notes: optional(input.notes) ?? null,
    });
    const [row] = await tx
      .insert(financeInvestmentTransactions)
      .values({ userId, accountId: account.id, currencyCode: account.currencyCode, ...values })
      .returning();
    await assertConsistent(tx, userId, [row!.holdingId]);
    return transactionRecord(row!);
  });
}

export async function updateTransaction(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateTransactionInput>,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(financeInvestmentTransactions)
      .where(
        and(
          eq(financeInvestmentTransactions.id, id),
          eq(financeInvestmentTransactions.userId, userId),
        ),
      );
    if (!row) throw new DomainError("not_found", "finance.transaction_not_found");
    const account = await ownedAccount(tx, userId, row.accountId);
    // The stored row as the API shows it (amounts at the currency's precision).
    const current = transactionRecord(row);
    const pick = <T>(next: T | undefined, value: T) => (next === undefined ? value : next);
    const values = await prepare(tx, userId, account, {
      holdingId: pick(patch.holdingId, current.holdingId),
      kind: pick(patch.kind, current.kind),
      tradeDate: pick(patch.tradeDate, current.tradeDate),
      quantity: pick(optional(patch.quantity), current.quantity),
      unitPrice: pick(optional(patch.unitPrice), current.unitPrice),
      // A trade's amount is recomputed when only units or price change.
      amount:
        patch.amount !== undefined
          ? (optional(patch.amount) ?? null)
          : patch.quantity !== undefined || patch.unitPrice !== undefined
            ? null
            : current.amount,
      fee: pick(optional(patch.fee), current.fee),
      notes: pick(optional(patch.notes), current.notes),
    });
    const [updated] = await tx
      .update(financeInvestmentTransactions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(financeInvestmentTransactions.id, id))
      .returning();
    await assertConsistent(tx, userId, [row.holdingId, updated!.holdingId]);
    return transactionRecord(updated!);
  });
}

export async function deleteTransaction(db: DbExecutor, userId: string, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(financeInvestmentTransactions)
      .where(
        and(
          eq(financeInvestmentTransactions.id, id),
          eq(financeInvestmentTransactions.userId, userId),
        ),
      )
      .returning();
    if (!row) throw new DomainError("not_found", "finance.transaction_not_found");
    // Removing a buy can leave a later sell without units.
    await assertConsistent(tx, userId, [row.holdingId]);
  });
}
