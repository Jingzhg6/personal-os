# M9.5 — Personal finance: completion report

Branch `m9-5-personal-finance`, based on the accepted M9 commit `6019b58`. Not merged, not
deployed. Design: [ADR 0019](../decisions/0019-personal-finance.md).

## 1. What was built

A self-contained `finance` module (`src/modules/finance/{db,domain,server,ui}`) that records
balances by hand and answers: how much do I have, where is it, and how has it changed?

- Institutions (bank, e-wallet, cash, broker, other) → accounts (asset with a category, or
  liability) in one currency each; ordering, editing, archiving, reactivation, deletion only
  without history.
- Dated balance snapshots entered in one atomic batch per valuation date; corrections bump a
  revision; previous balances are hints with an explicit 沿用上次 button.
- Manual FX per batch, frozen in each snapshot; a missing rate is shown as 未换算 and excluded,
  never treated as 1. Base currency EUR by default, locked once valued.
- Overview: net worth, assets, liabilities, change since the previous recorded date split into
  余额变化 / 汇率变化 / 新增·移除账户, warnings (missing, stale, unconverted), net-worth chart of
  recorded dates (30 天 / 90 天 / 1 年 / 全部), breakdowns by category, institution and currency.
- Account history with original amount, rate, base value and revision.

## 2. New pages

| Route                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `/finance`                | 资产总览 (overview, chart, warnings, breakdowns) |
| `/finance/accounts`       | 账户: institutions, accounts, base currency      |
| `/finance/accounts/[id]`  | One account's recorded balances                  |
| `/finance/snapshot?date=` | 记录余额: batch entry for one valuation date     |

Navigation: new section 财务 with 资产总览 and 账户.

## 3. Core user flows

1. Empty overview → add an institution → add accounts → record the first balances.
2. Record a later date: confirm or re-enter each balance, adjust the pre-filled rate, save.
3. Review the change and whether it came from balances or exchange rates.
4. Close an account: it stops counting after its closing date; its history stays.
5. Correct a date: open it again, change values, save as a correction (revision + 1).

## 4. Key design and architecture decisions

- Database-level ownership: composite FKs include `user_id`; snapshot FK includes the account
  currency, so history and account can never disagree on currency.
- Liabilities stored as positive amounts and subtracted; CHECK `amount >= 0`.
- Exact decimals: `numeric` columns, strings on the wire, BigInt fixed-point helper shared by
  server and client (provisional totals use the same code as the server).
- Historical valuations immutable; defaults table only pre-fills.
- History = recorded dates only, carried balances disclosed, nothing interpolated.
- Change wording: 净资产变化, explicitly "not a return or investment performance".
- Forward-only migration `drizzle/0012_personal_finance.sql`; no existing migration or table
  changed.

## 5. Tests

| Suite                   | Result                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`            | lint, typecheck, format, i18n, 34 files / 333 tests ✅                                                                                                                                           |
| — finance domain (unit) | 16 tests: decimals, validation, valuation, totals, history, closed accounts, FX immutability, change split                                                                                       |
| — finance service (db)  | 15 tests: CRUD, shape, history locks, archive, EUR/CNY + liability, unconverted, FX split, corrections, atomic rollback, DB checks, base lock, empty, cross-user (service and DB), user deletion |
| `pnpm build`            | ✅                                                                                                                                                                                               |
| `pnpm test:e2e`         | 86 / 86 ✅ (76 existing + 10 finance)                                                                                                                                                            |

E2E `e2e/finance.spec.ts`: 1 empty state · 2 institution with several accounts · 3+4 EUR and CNY
balances, liability and net worth · 5 later snapshot, history, change split, account history,
correction · 6 archive keeps history · 7 missing FX surfaced · 8 cross-user denied (API 404 and
not-found page) · 9 phone width · 10 dark mode.

No authentication rate limit or security control was changed.

## 6. Screenshots (`docs/screenshots/m9-5/`)

`01-overview`, `02-accounts`, `03-snapshot-missing-fx`, `04-account-history`, `05-empty-state`,
`06-mobile-overview`, `07-mobile-snapshot`, `08-dark-overview` — see
[the screenshots index](../screenshots/README.md#m95--personal-finance-m9-5). Review fixes: y-axis
fitted to the data (was flattened by a zero baseline) and de-duplicated tick labels; compact pinned
total on phones; clearer missing-rate sentence.

## 7. Known limitations

- Rates are typed by hand; no rate source, no historical rate lookup.
- The base currency cannot change after the first snapshot (by design; no re-basing tool).
- The native date input shows the browser's date format.
- The breadcrumb on `/finance/snapshot` and account pages shows the parent nav item.
- No export of finance data yet; no dashboard card (by request).

## 8. Next

M10 is not started. Waiting for the owner's review and approval.
