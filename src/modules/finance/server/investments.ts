import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";

import { financeInvestments } from "../db";
import {
  add,
  amountProblem,
  dec,
  toMoney,
  ZERO,
  type createInvestmentInput,
  type FinanceInvestment,
  type FinanceOverview,
  type InvestmentKind,
  type updateInvestmentInput,
} from "../domain";
import { getBaseCurrency } from "./structure";

/*
 * Investments: what was bought (cost), when, and — if the user enters it — what it is worth now.
 * Recorded in the base currency of the day they are entered. Kept apart from accounts, so a
 * holding is counted once: as an investment, not also as a broker account balance.
 */

type Row = typeof financeInvestments.$inferSelect;

/** "12.50000000" → "12.5" */
const trimZeros = (value: string) =>
  value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;

/** Amounts at the currency's precision and quantities without trailing zeros, as entered. */
const view = (r: Row): FinanceInvestment => ({
  id: r.id,
  name: r.name,
  kind: r.kind as InvestmentKind,
  costAmount: toMoney(dec(r.costAmount), r.currencyCode),
  currency: r.currencyCode,
  purchaseDate: r.purchaseDate,
  quantity: r.quantity === null ? null : trimZeros(r.quantity),
  currentValue: r.currentValue === null ? null : toMoney(dec(r.currentValue), r.currencyCode),
  notes: r.notes,
});

function checkAmount(value: string | null | undefined, currency: string) {
  if (value == null) return;
  if (amountProblem(value, currency)) throw new DomainError("invalid", "finance.invalid_amount");
}

function checkQuantity(value: string | null | undefined) {
  if (value == null) return;
  if (amountProblem(value, "XXX") === "invalid" || !(Number(value) > 0)) {
    throw new DomainError("invalid", "finance.invalid_quantity");
  }
}

const blankToNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim();

export async function listInvestments(db: DbExecutor, userId: string) {
  const rows = await db
    .select()
    .from(financeInvestments)
    .where(eq(financeInvestments.userId, userId))
    .orderBy(asc(financeInvestments.purchaseDate), asc(financeInvestments.createdAt));
  return rows.map(view);
}

async function owned(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.investment_not_found");
  return row;
}

export async function createInvestment(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof createInvestmentInput>,
) {
  const currency = await getBaseCurrency(db, userId);
  const quantity = blankToNull(input.quantity) ?? null;
  const currentValue = blankToNull(input.currentValue) ?? null;
  checkAmount(input.costAmount, currency);
  checkAmount(currentValue, currency);
  checkQuantity(quantity);
  const [row] = await db
    .insert(financeInvestments)
    .values({
      userId,
      name: input.name,
      kind: input.kind,
      costAmount: input.costAmount,
      currencyCode: currency,
      purchaseDate: input.purchaseDate,
      quantity,
      currentValue,
      notes: blankToNull(input.notes) ?? null,
    })
    .returning();
  return view(row!);
}

export async function updateInvestment(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateInvestmentInput>,
) {
  const row = await owned(db, userId, id);
  const quantity = blankToNull(patch.quantity);
  const currentValue = blankToNull(patch.currentValue);
  checkAmount(patch.costAmount, row.currencyCode);
  checkAmount(currentValue, row.currencyCode);
  checkQuantity(quantity);
  const [updated] = await db
    .update(financeInvestments)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.costAmount !== undefined && { costAmount: patch.costAmount }),
      ...(patch.purchaseDate !== undefined && { purchaseDate: patch.purchaseDate }),
      ...(quantity !== undefined && { quantity }),
      ...(currentValue !== undefined && { currentValue }),
      ...(patch.notes !== undefined && { notes: blankToNull(patch.notes) }),
      updatedAt: new Date(),
    })
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)))
    .returning();
  return view(updated!);
}

export async function deleteInvestment(db: DbExecutor, userId: string, id: string) {
  await owned(db, userId, id);
  await db
    .delete(financeInvestments)
    .where(and(eq(financeInvestments.id, id), eq(financeInvestments.userId, userId)));
}

/** Totals in the base currency; value is the entered current value, else the cost. */
export function investmentTotals(
  investments: readonly FinanceInvestment[],
  baseCurrency: string,
): FinanceOverview["investments"] & { valueDec: ReturnType<typeof dec> } {
  let cost = ZERO;
  let value = ZERO;
  let count = 0;
  let unvalued = 0;
  let otherCurrency = 0;
  for (const i of investments) {
    if (i.currency !== baseCurrency) {
      otherCurrency += 1;
      continue;
    }
    count += 1;
    cost = add(cost, dec(i.costAmount));
    if (i.currentValue == null) unvalued += 1;
    value = add(value, dec(i.currentValue ?? i.costAmount));
  }
  return {
    count,
    cost: toMoney(cost, baseCurrency),
    value: toMoney(value, baseCurrency),
    unvalued,
    otherCurrency,
    valueDec: value,
  };
}
