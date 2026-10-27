# 0016 — The dashboard is a read-only composition of other modules

**Decision.** The authenticated home (`/`) is the `dashboard` module. It owns no tables, no
mutations and no rules about XP, levels, stages, prices or claims. Its server layer calls the read
functions the owning modules export (character: totals, attributes, history, XP activity; rewards:
balances, rewards, level rewards, purchase calculation; tasks: completed-task count; settings:
timezone and week start) and returns two payloads: `dashboard.overview` and the period-dependent
`dashboard.growth`.

**Why.** "One task row powers every view" applies to XP too: the ledger and the reward ledger are
the only sources. A dashboard table or cached counters would be a second truth that can drift
(reversals, spending, archived attributes). Calling the owners keeps every rule in one place — the
dashboard cannot show a level the character page disagrees with.

**Consequences.**

- New read functions live in the owning module (`getXpActivity` in character,
  `countCompletedTasks` in tasks), not in the dashboard. Read functions accept already-loaded
  inputs (`getBalances(db, user, totals)`, `listLevelRewards(db, user, balances)`) so the overview
  does not repeat queries.
- Period figures are aggregated at read time with grouped queries over indexed
  `(user_id, created_at)` columns. If that ever becomes slow, a read model owned by the character
  module (not the dashboard) is the place to add it.
- Claiming and redeeming stay on `/rewards`; the dashboard links there.
- `/dashboard` redirects to `/`.
