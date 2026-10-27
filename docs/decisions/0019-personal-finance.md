# 0019 — Personal finance: manual balance snapshots and net worth

Status: Accepted (M9.5). Independent of ADRs 0012–0018: finance has no XP, no goals, no tasks.

## 1. Scope

A self-contained `finance` module answers three questions from balances the user types in:
_how much do I have, where is it, how has it changed?_ It depends only on `users` (and reads the
settings module's time zone for "today"). It is not on the dashboard and awards no XP.

## 2. Hierarchy

```
finance_settings   (user_id PK, base_currency char(3) default 'EUR')
finance_providers  institution: bank | ewallet | cash | broker | other, country?, notes?, order, archived_at
finance_accounts   provider → account: kind, account_type, asset_category?, currency_code, include_in_net_worth,
                   order, archived_at, closed_on (date)
finance_snapshots  account × valuation_date → amount + valuation (see §4)
finance_fx_defaults (user, currency, base) → last typed rate, for pre-filling only
```

Ownership is enforced twice: every query is scoped by `user_id`, and every reference is a
composite key that includes it — `accounts (provider_id, user_id) → providers (id, user_id)`,
`snapshots (account_id, user_id, currency_code) → accounts (id, user_id, currency_code)`. A row can
never point at another user's row, even through a bug. The references are `NO ACTION`: an
institution with accounts, or an account with snapshots, cannot be deleted; deleting the user
cascades through `user_id`.

We store no account numbers, IBANs, card numbers, credentials or bank connections. There is no
bank API and no import; balances are not logged by the server.

## 3. Assets and liabilities

`kind` is `asset` or `liability`. Assets have an `asset_category` (cash, bank deposit, e-wallet,
savings, investment, other); liabilities have none (CHECK). Account types are restricted per kind
(credit card / loan / other for liabilities). **Every amount is stored as a non-negative number**
(CHECK `amount >= 0`): a credit card owing €420.50 is stored as `420.50`, and the liability total is
subtracted: `net worth = Σ assets − Σ liabilities`. A sign never encodes meaning, so a typo cannot
turn a debt into an asset. Accounts may be excluded from net worth (`include_in_net_worth`).

## 4. Snapshots

A snapshot is _the balance of one account on one date_ (`date`, no time, no time zone), unique per
`(account_id, valuation_date)`. Each stores its own valuation, frozen when recorded:

| column          | meaning                                                               |
| --------------- | --------------------------------------------------------------------- |
| `amount`        | `numeric(24,6)`, original currency, ≤ currency precision (validated)  |
| `currency_code` | the account's currency (part of the FK — cannot disagree with it)     |
| `base_currency` | the base currency at the time                                         |
| `fx_rate`       | `numeric(20,10)`; `1` with source `identity` for the base currency    |
| `fx_source`     | `identity` \| `manual`                                                |
| `base_amount`   | `amount × fx_rate`, rounded half away from zero to the base precision |
| `revision`      | 1, +1 per correction                                                  |

Rate, source and base amount are all null or all set (CHECK). Snapshots are entered in batches
(`/finance/snapshot`): one date, many accounts, blank = skipped. A batch is one transaction under a
per-user advisory lock; any invalid entry (foreign or archived account, duplicate, bad amount or
rate, future date beyond UTC+14) rejects the whole batch. Re-saving a date that already has
snapshots requires `overwrite` (the UI shows "修正" mode); it updates in place and bumps `revision`.
The previous balance is shown as a hint with an explicit 沿用上次 button — never copied
automatically, because an unconfirmed old balance is not a new observation.

## 5. Exact decimals

Money and rates are PostgreSQL `numeric` and travel as strings. Arithmetic uses a small BigInt
fixed-point helper (`domain/decimal.ts`: add, sub, mul, round half away from zero) on both server
and client; floats are used only to draw bars and chart coordinates. `Intl.NumberFormat` formats
the decimal strings directly. No third-party decimal library was needed.

## 6. FX policy and base currency

- The base currency defaults to EUR and is a setting, not a constant. It is **locked once any
  snapshot exists** (`finance.base_locked`): stored base amounts would otherwise mix currencies.
- Rates are typed by the user per batch ("1 CNY = ? EUR"); they are not official market rates and
  the UI says so. No rate service is called.
- **A missing rate is never 1.** A foreign balance without a rate is saved with a null valuation,
  shown as 未换算, listed in the overview's warnings and excluded from totals.
- The last typed rate per currency is kept in `finance_fx_defaults` only to pre-fill the next batch.

## 7. Historical valuation

History is never revalued: each snapshot keeps the rate of its day, and changing a default or
entering a later rate does not touch it. The overview's change versus the previous recorded date is
split exactly (`changeBetween`):

- **余额变化** — Σ (new amount − old amount) × old rate, per continuing account (sign by kind);
- **汇率变化** — Σ new amount × (new rate − old rate);
- **新增/移除账户** — accounts counted on only one of the two dates.

The parts add up to the total change. The UI calls it a _change in net worth_ and states that it is
not a return or investment performance: deposits, withdrawals, valuation changes and FX all move it.

## 8. History and incomplete data

The net-worth history has one point per **recorded** valuation date — no daily series, no
interpolation, no fabricated points. On a date, each account contributes its latest snapshot on or
before it ("carried", counted and disclosed per point); accounts with no snapshot yet contribute
nothing; unconverted balances are excluded and counted. Points with carried or unconverted balances
are drawn hollow and explained. The overview also lists accounts without any snapshot (missing) and
counted balances older than 45 days (stale).

## 9. Archival and currency changes

- Archiving an account sets `archived_at` and `closed_on` (default: its latest snapshot date). Its
  balances count up to and including `closed_on`, never after; its snapshots stay, its history page
  stays, and no new snapshots are accepted (`finance.account_archived`) until it is reactivated.
  Archiving an institution archives its active accounts.
- Accounts and institutions without history may be deleted; with history they may only be archived.
- An account's **currency and kind are locked once it has snapshots** (service check + the
  currency in the snapshot FK). Moving money to a different currency means a new account.

## 10. What is not measured

No transactions, categories of spending, budgets, cash flow, income, taxes, investment returns,
performance, asset allocation advice, or forecasts. No Finance XP and no dashboard card. Net worth
is a sum of what the user recorded, in the rates the user typed — nothing more.
