import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { type z } from "zod";

import type { DbExecutor } from "@/shared/db/types";
import { DomainError } from "@/shared/lib/errors";
import { keyAfter, keyForMove } from "@/shared/lib/order";

import { financeAccounts, financeProviders, financeSettings, financeSnapshots } from "../db";
import {
  createAccountInput,
  type createProviderInput,
  DEFAULT_BASE_CURRENCY,
  type updateAccountInput,
  type updateProviderInput,
  type AccountKind,
  type AccountType,
  type AssetCategory,
  type FinanceAccount,
  type FinanceProvider,
  type ProviderType,
} from "../domain";

/*
 * Institutions and accounts. Every query is scoped by user id; the database repeats the check
 * with composite keys. Nothing with history is ever deleted: institutions and accounts are
 * archived, and their snapshots stay.
 */

type ProviderRow = typeof financeProviders.$inferSelect;
type AccountRow = typeof financeAccounts.$inferSelect;

/* ---------------------------------------------------------------- settings */

export async function getBaseCurrency(db: DbExecutor, userId: string): Promise<string> {
  const [row] = await db
    .select({ baseCurrency: financeSettings.baseCurrency })
    .from(financeSettings)
    .where(eq(financeSettings.userId, userId));
  return row?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
}

/**
 * The base currency can change only before the first snapshot: snapshots store values in the base
 * currency of their day, and mixing bases would make totals meaningless.
 */
export async function setBaseCurrency(db: DbExecutor, userId: string, baseCurrency: string) {
  const [any] = await db
    .select({ id: financeSnapshots.id })
    .from(financeSnapshots)
    .where(eq(financeSnapshots.userId, userId))
    .limit(1);
  if (any && (await getBaseCurrency(db, userId)) !== baseCurrency) {
    throw new DomainError("conflict", "finance.base_locked");
  }
  await db
    .insert(financeSettings)
    .values({ userId, baseCurrency })
    .onConflictDoUpdate({
      target: financeSettings.userId,
      set: { baseCurrency, updatedAt: new Date() },
    });
  return baseCurrency;
}

/* ---------------------------------------------------------------- providers */

function toProvider(row: ProviderRow): FinanceProvider {
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType as ProviderType,
    country: row.country,
    notes: row.notes,
    sortKey: row.sortKey,
    archivedAt: row.archivedAt,
  };
}

export async function listProviders(db: DbExecutor, userId: string): Promise<FinanceProvider[]> {
  const rows = await db
    .select()
    .from(financeProviders)
    .where(eq(financeProviders.userId, userId))
    .orderBy(asc(financeProviders.sortKey), asc(financeProviders.id));
  return rows.map(toProvider);
}

async function getOwnedProvider(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financeProviders)
    .where(and(eq(financeProviders.id, id), eq(financeProviders.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.provider_not_found");
  return row;
}

export async function createProvider(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof createProviderInput>,
): Promise<FinanceProvider> {
  const last = await listProviders(db, userId);
  const [row] = await db
    .insert(financeProviders)
    .values({
      userId,
      name: input.name,
      providerType: input.providerType,
      country: input.country || null,
      notes: input.notes || null,
      sortKey: keyAfter(last.at(-1)?.sortKey ?? null),
    })
    .returning();
  return toProvider(row!);
}

export async function updateProvider(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateProviderInput>,
): Promise<FinanceProvider> {
  await getOwnedProvider(db, userId, id);
  const [row] = await db
    .update(financeProviders)
    .set({
      ...patch,
      ...(patch.country !== undefined ? { country: patch.country || null } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(financeProviders.id, id), eq(financeProviders.userId, userId)))
    .returning();
  return toProvider(row!);
}

export async function moveProvider(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: "up" | "down",
) {
  await getOwnedProvider(db, userId, id);
  const siblings = (await listProviders(db, userId)).filter((p) => !p.archivedAt);
  const index = siblings.findIndex((p) => p.id === id);
  if (index < 0) return;
  const key = keyForMove(
    siblings.map((p) => p.sortKey),
    index,
    direction,
  );
  if (key) {
    await db
      .update(financeProviders)
      .set({ sortKey: key })
      .where(and(eq(financeProviders.id, id), eq(financeProviders.userId, userId)));
  }
}

/**
 * Archiving an institution also archives its active accounts (each closed on its latest snapshot
 * date); history stays. Restoring the institution does not reopen accounts.
 */
export function setProviderArchived(db: DbExecutor, userId: string, id: string, archived: boolean) {
  return db.transaction(async (tx) => {
    await getOwnedProvider(tx, userId, id);
    await tx
      .update(financeProviders)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(financeProviders.id, id), eq(financeProviders.userId, userId)));
    if (archived) {
      const open = await tx
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(
          and(
            eq(financeAccounts.providerId, id),
            eq(financeAccounts.userId, userId),
            isNull(financeAccounts.archivedAt),
          ),
        );
      for (const account of open) await archiveAccount(tx, userId, account.id, null);
    }
  });
}

/** Only an institution without accounts can be deleted (the foreign key insists too). */
export async function deleteProvider(db: DbExecutor, userId: string, id: string) {
  await getOwnedProvider(db, userId, id);
  const [account] = await db
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(and(eq(financeAccounts.providerId, id), eq(financeAccounts.userId, userId)))
    .limit(1);
  if (account) throw new DomainError("conflict", "finance.provider_has_accounts");
  await db
    .delete(financeProviders)
    .where(and(eq(financeProviders.id, id), eq(financeProviders.userId, userId)));
}

/* ---------------------------------------------------------------- accounts */

function toAccount(row: AccountRow, snapshotCount: number): FinanceAccount {
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    kind: row.kind as AccountKind,
    accountType: row.accountType as AccountType,
    assetCategory: row.assetCategory as AssetCategory | null,
    currency: row.currencyCode,
    includeInNetWorth: row.includeInNetWorth,
    notes: row.notes,
    sortKey: row.sortKey,
    archivedAt: row.archivedAt,
    closedOn: row.closedOn,
    snapshotCount,
  };
}

export async function listAccounts(db: DbExecutor, userId: string): Promise<FinanceAccount[]> {
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, userId))
      .orderBy(asc(financeAccounts.sortKey), asc(financeAccounts.id)),
    db
      .select({ accountId: financeSnapshots.accountId, count: sql<number>`count(*)::int` })
      .from(financeSnapshots)
      .where(eq(financeSnapshots.userId, userId))
      .groupBy(financeSnapshots.accountId),
  ]);
  const countOf = new Map(counts.map((c) => [c.accountId, c.count]));
  return rows.map((row) => toAccount(row, countOf.get(row.id) ?? 0));
}

async function getOwnedAccount(db: DbExecutor, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)));
  if (!row) throw new DomainError("not_found", "finance.account_not_found");
  return row;
}

async function snapshotCount(db: DbExecutor, accountId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(financeSnapshots)
    .where(eq(financeSnapshots.accountId, accountId));
  return row?.count ?? 0;
}

async function assertProviderUsable(db: DbExecutor, userId: string, providerId: string) {
  const provider = await getOwnedProvider(db, userId, providerId);
  if (provider.archivedAt) throw new DomainError("invalid", "finance.provider_archived");
}

export async function createAccount(
  db: DbExecutor,
  userId: string,
  input: z.infer<typeof createAccountInput>,
): Promise<FinanceAccount> {
  await assertProviderUsable(db, userId, input.providerId);
  const siblings = await db
    .select({ sortKey: financeAccounts.sortKey })
    .from(financeAccounts)
    .where(
      and(eq(financeAccounts.providerId, input.providerId), eq(financeAccounts.userId, userId)),
    )
    .orderBy(asc(financeAccounts.sortKey));
  const [row] = await db
    .insert(financeAccounts)
    .values({
      userId,
      providerId: input.providerId,
      name: input.name,
      kind: input.kind,
      accountType: input.accountType,
      assetCategory: input.kind === "asset" ? (input.assetCategory ?? "other") : null,
      currencyCode: input.currency,
      includeInNetWorth: input.includeInNetWorth ?? true,
      notes: input.notes || null,
      sortKey: keyAfter(siblings.at(-1)?.sortKey ?? null),
    })
    .returning();
  return toAccount(row!, 0);
}

/**
 * Editable: name, type, category, inclusion, notes, institution. Currency and asset/liability kind
 * change only while the account has no snapshots — history must keep its meaning (the database's
 * composite key also blocks a currency change under existing snapshots).
 */
export async function updateAccount(
  db: DbExecutor,
  userId: string,
  { id, patch }: z.infer<typeof updateAccountInput>,
): Promise<FinanceAccount> {
  return db.transaction(async (tx) => {
    const row = await getOwnedAccount(tx, userId, id);
    const count = await snapshotCount(tx, id);
    const kindChanges = patch.kind !== undefined && patch.kind !== row.kind;
    const currencyChanges = patch.currency !== undefined && patch.currency !== row.currencyCode;
    if (count > 0 && (kindChanges || currencyChanges)) {
      throw new DomainError("conflict", "finance.account_has_history");
    }
    if (patch.providerId && patch.providerId !== row.providerId) {
      await assertProviderUsable(tx, userId, patch.providerId);
    }
    const kind = (patch.kind ?? row.kind) as AccountKind;
    const assetCategory =
      kind === "liability" ? null : (patch.assetCategory ?? row.assetCategory ?? "other");
    const parsed = createAccountInput.safeParse({
      providerId: patch.providerId ?? row.providerId,
      name: patch.name ?? row.name,
      kind,
      accountType: patch.accountType ?? row.accountType,
      assetCategory,
      currency: patch.currency ?? row.currencyCode,
    });
    if (!parsed.success) throw new DomainError("invalid", "finance.account_shape");
    const { currency, ...rest } = patch;
    const [updated] = await tx
      .update(financeAccounts)
      .set({
        ...rest,
        ...(currency !== undefined ? { currencyCode: currency } : {}),
        assetCategory,
        ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)))
      .returning();
    return toAccount(updated!, count);
  });
}

export async function moveAccount(
  db: DbExecutor,
  userId: string,
  id: string,
  direction: "up" | "down",
) {
  const row = await getOwnedAccount(db, userId, id);
  const siblings = (await listAccounts(db, userId)).filter(
    (a) => a.providerId === row.providerId && !a.archivedAt,
  );
  const index = siblings.findIndex((a) => a.id === id);
  if (index < 0) return;
  const key = keyForMove(
    siblings.map((a) => a.sortKey),
    index,
    direction,
  );
  if (key) {
    await db
      .update(financeAccounts)
      .set({ sortKey: key })
      .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)));
  }
}

/**
 * Archives (closes) an account: it keeps all snapshots and stays in history up to `closedOn`
 * (default: its latest snapshot date), and accepts no new snapshots until reactivated.
 */
export async function archiveAccount(
  db: DbExecutor,
  userId: string,
  id: string,
  closedOn: string | null,
) {
  await getOwnedAccount(db, userId, id);
  const [latest] = await db
    .select({ date: max(financeSnapshots.valuationDate) })
    .from(financeSnapshots)
    .where(eq(financeSnapshots.accountId, id));
  await db
    .update(financeAccounts)
    .set({
      archivedAt: new Date(),
      closedOn: closedOn ?? latest?.date ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)));
}

export async function reactivateAccount(db: DbExecutor, userId: string, id: string) {
  const row = await getOwnedAccount(db, userId, id);
  await assertProviderUsable(db, userId, row.providerId);
  await db
    .update(financeAccounts)
    .set({ archivedAt: null, closedOn: null, updatedAt: new Date() })
    .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)));
}

/** Only an account without snapshots can be deleted; one with history is archived instead. */
export async function deleteAccount(db: DbExecutor, userId: string, id: string) {
  await getOwnedAccount(db, userId, id);
  if ((await snapshotCount(db, id)) > 0) {
    throw new DomainError("conflict", "finance.account_has_history");
  }
  await db
    .delete(financeAccounts)
    .where(and(eq(financeAccounts.id, id), eq(financeAccounts.userId, userId)));
}

/** The user's accounts with the given ids (others' ids match nothing). */
export async function ownedAccounts(db: DbExecutor, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, ids)));
}
