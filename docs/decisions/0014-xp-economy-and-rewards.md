# 0014 — XP economy: Active, Growth and Level XP; real-world rewards

Supersedes the level rule of 0012 and the open question at the end of 0013.

**Decision.** XP has four layers, each answering one question:

| Layer         | Question                         | Source                                                                       | Lifetime                   | Spendable                    |
| ------------- | -------------------------------- | ---------------------------------------------------------------------------- | -------------------------- | ---------------------------- |
| **Active XP** | How much did I do?               | `xp_ledger.amount` — every completion (rules of 0012)                        | sum of the ledger          | lifetime − spent; low value  |
| **Growth XP** | Which abilities grew?            | `xp_attribute_credits.amount` — split by weight (0013)                       | per attribute, never spent | —                            |
| **Level XP**  | How far has the character grown? | `xp_attribute_credits.level_xp` = `calculateLevelXpFromGrowth(growth)` (1:1) | decides the level          | lifetime − spent; high value |
| **Rewards**   | What do I treat myself to?       | user-defined `rewards` / `level_rewards`, `reward_ledger`                    | —                          | —                            |

- A task without development contributions earns Active XP only: no Growth, no Level XP, so it
  never raises the level. Busywork is still counted, but only growth makes the character grow.
- **The level is a function of lifetime Level XP only** (`getLevelFromLevelXp`). Spending reads
  `reward_ledger`, which the level never reads, so spending can never lower the level.
- Reversals (reopen / cancel, 0012) are corrections, not spending: they reduce lifetime values
  (including Level XP, through negated credits). Spendable can therefore go below zero after a
  reversal; redemption then simply requires enough balance again. No reward debt is recorded.
- Level curve (`character/domain/levels.ts`): Lv n → n+1 needs `round(100 × 1.08^(n−1))`.
  Attributes use the same curve on their Growth XP. Growth stages (`stages.ts`): 启程者 1–5,
  探索者 6–10, 实践者 11–20, 精进者 21–30, 塑造者 31–40, 卓越者 41–50, 大师 51–60, 传奇 61+.
- Exchange rate (`REWARD_XP_RATES`, `character/domain/economy.ts`): 1 Active XP = 1 purchasing
  unit, 1 Level XP = 5. Changing the rate changes prices, never history: each ledger row keeps
  what was actually spent.

**Reward pricing.** A reward stores its `value` in purchasing units plus which currencies it
accepts (`pay_with_active`, `pay_with_level`). Costs are derived (`ceil(value / rate)`), so the
Active and Level price can never disagree. `calculateRewardPurchase` (pure, domain) turns a
strategy — 优先行动经验, 优先升级经验 or a custom split — into amounts; the server recomputes it,
never trusting client amounts.

**Level rewards.** One per (user, level). Reaching the level makes it free to claim, once.
Claiming early costs spendable Level XP equal to the Level XP still missing to that level, and
is allowed up to the end of the next growth stage (`maxEarlyClaimLevel`; Lv 17 → up to Lv 20,
not Lv 30). An early claim is final: reaching the level later does not refund it or allow a
second claim.

**Spending safety.** `reward_ledger` is append-only (trigger, like `xp_ledger`). Every spend
runs in one transaction under a per-user advisory lock, re-reads balances, and is idempotent by
`(user, idempotency_key)` (the dialog generates one key per attempt). A unique index allows one
claim per level reward. Titles are snapshotted as the user's own name or as a `title_key` for
seeded rewards — never a translated label.

**Legacy.** M6 history is kept. Credits written before M6.2 have `level_xp = NULL`, read as 1:1
for normal attributes and 0 for archived `legacy.*` attributes (area-derived M6 credits). Those
are activity, not chosen growth, so they don't inflate the new level; existing users' levels
are recomputed from Level XP and may be lower than in M6. Their Active XP is unchanged.

**Not in M6.2.** Refunds (`reward_refunded` exists in the schema only), reward debt, AI — no AI
may ever write to either ledger.
