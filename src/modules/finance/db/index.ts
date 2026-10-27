import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "@/shared/auth/schema";
import { primaryId, sortKey, timestamps } from "@/shared/db/columns";

/*
 * Personal finance (M9.5, ADR 0019). Self-contained: depends only on users. Money and rates are
 * `numeric` (exact). Ownership is enforced by composite keys (id, user_id) — a row can only point
 * at rows of the same user — and a snapshot's key also carries the account's currency, so history
 * and its account can never disagree on the currency.
 */

const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const currency = (column: string) => char(column, { length: 3 }).notNull();
const MONEY = { precision: 24, scale: 6 } as const;

/** The user's reporting currency (defaults to EUR; not hard-coded anywhere else). */
export const financeSettings = pgTable(
  "finance_settings",
  {
    userId: userId().primaryKey(),
    baseCurrency: currency("base_currency").default("EUR"),
    ...timestamps(),
  },
  (t) => [check("finance_settings_base_format", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`)],
);

/** Where money is held: a bank, an e-wallet, cash, a broker, … */
export const financeProviders = pgTable(
  "finance_providers",
  {
    id: primaryId(),
    userId: userId(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    country: text("country"),
    notes: text("notes"),
    sortKey: sortKey(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("finance_providers_id_user_uq").on(t.id, t.userId),
    index("finance_providers_user_idx").on(t.userId, t.sortKey),
    check("finance_providers_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "finance_providers_type_valid",
      sql`${t.providerType} in ('bank', 'ewallet', 'cash', 'broker', 'other')`,
    ),
  ],
);

/** One balance holder in one currency: an asset (has a category) or a liability (owed). */
export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: primaryId(),
    userId: userId(),
    providerId: uuid("provider_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    accountType: text("account_type").notNull(),
    assetCategory: text("asset_category"),
    currencyCode: currency("currency_code"),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    notes: text("notes"),
    sortKey: sortKey(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Date-only: balances count up to and including this day once the account is archived. */
    closedOn: date("closed_on"),
    ...timestamps(),
  },
  (t) => [
    unique("finance_accounts_id_user_uq").on(t.id, t.userId),
    unique("finance_accounts_id_user_currency_uq").on(t.id, t.userId, t.currencyCode),
    // NO ACTION: an institution with accounts cannot be deleted (archive it instead).
    foreignKey({
      columns: [t.providerId, t.userId],
      foreignColumns: [financeProviders.id, financeProviders.userId],
      name: "finance_accounts_provider_fk",
    }),
    index("finance_accounts_provider_idx").on(t.providerId, t.sortKey),
    check("finance_accounts_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("finance_accounts_kind_valid", sql`${t.kind} in ('asset', 'liability')`),
    check(
      "finance_accounts_type_valid",
      sql`${t.accountType} in ('current', 'savings', 'investment', 'ewallet', 'cash', 'credit_card', 'loan', 'other')`,
    ),
    check(
      "finance_accounts_category_shape",
      sql`(${t.kind} = 'asset' and ${t.assetCategory} in ('cash', 'bank_deposit', 'ewallet', 'savings', 'investment', 'other'))
       or (${t.kind} = 'liability' and ${t.assetCategory} is null)`,
    ),
    check("finance_accounts_currency_format", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "finance_accounts_closed_only_archived",
      sql`${t.closedOn} is null or ${t.archivedAt} is not null`,
    ),
  ],
);

/**
 * The balance of one account on one date — immutable valuation data: the original amount and
 * currency, the base currency, the rate used and the converted value. No rate → no value
 * (unconverted), never an implicit 1. One snapshot per account and date; corrections bump
 * `revision`.
 */
export const financeSnapshots = pgTable(
  "finance_snapshots",
  {
    id: primaryId(),
    userId: userId(),
    accountId: uuid("account_id").notNull(),
    valuationDate: date("valuation_date").notNull(),
    /** Original currency; liabilities as the positive amount owed. */
    amount: numeric("amount", MONEY).notNull(),
    currencyCode: currency("currency_code"),
    baseCurrency: currency("base_currency"),
    fxRate: numeric("fx_rate", { precision: 20, scale: 10 }),
    fxSource: text("fx_source"),
    /** amount × fx_rate, rounded to the base currency's precision when recorded. */
    baseAmount: numeric("base_amount", MONEY),
    notes: text("notes"),
    revision: integer("revision").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    unique("finance_snapshots_account_date_uq").on(t.accountId, t.valuationDate),
    // Same user and same currency as the account; NO ACTION keeps history from being orphaned
    // and an account's currency from changing under it.
    foreignKey({
      columns: [t.accountId, t.userId, t.currencyCode],
      foreignColumns: [financeAccounts.id, financeAccounts.userId, financeAccounts.currencyCode],
      name: "finance_snapshots_account_fk",
    }),
    index("finance_snapshots_user_date_idx").on(t.userId, t.valuationDate),
    check("finance_snapshots_amount_nonnegative", sql`${t.amount} >= 0`),
    check("finance_snapshots_rate_positive", sql`${t.fxRate} is null or ${t.fxRate} > 0`),
    check(
      "finance_snapshots_valuation_shape",
      sql`(${t.fxRate} is null and ${t.fxSource} is null and ${t.baseAmount} is null)
       or (${t.fxRate} is not null and ${t.fxSource} in ('identity', 'manual') and ${t.baseAmount} is not null)`,
    ),
    check(
      "finance_snapshots_identity_rate",
      sql`${t.currencyCode} <> ${t.baseCurrency} or (${t.fxRate} = 1 and ${t.fxSource} = 'identity')`,
    ),
    check("finance_snapshots_base_format", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
    check("finance_snapshots_revision_positive", sql`${t.revision} >= 1`),
  ],
);

/**
 * The last rate the user entered per currency — only to pre-fill the next snapshot. Snapshots copy
 * their rate; changing a default never revalues history.
 */
export const financeFxDefaults = pgTable(
  "finance_fx_defaults",
  {
    userId: userId(),
    currencyCode: currency("currency_code"),
    baseCurrency: currency("base_currency"),
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.currencyCode, t.baseCurrency] }),
    check("finance_fx_defaults_rate_positive", sql`${t.rate} > 0`),
  ],
);
