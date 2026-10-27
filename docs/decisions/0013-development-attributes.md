# 0013 — Personal development model: areas organise, development attributes grow (M6.1)

Supersedes the attribute part of ADR 0012 (the ledger, rules, levels and idempotency stand).

**Problem.** M6 derived a task's attribute from its area (学习, 工作, 健身 …). That records
_what kind of work I did_, not _what I am becoming_. Areas answer "which part of my life is this
in?"; growth answers "what ability does this develop?". A bike ride is in 健康 and grows 有氧; a
French novel is in 学习 and grows 法语 and 阅读; replying to the bank is in 行政事务 and grows
nothing.

**Development attributes are user data.** `development_attributes`: create, rename, emoji,
color, reorder, archive (keeps history, leaves radar and pickers), show/hide on the radar,
delete only while it has no XP. Five examples are seeded (法语, 英语, 阅读, 力量, 有氧) with a
translatable `system_key` until renamed; nothing in the code depends on them.

**Contributions belong to the task.** `task_development_contributions` (tasks module, like tags)
lists the attributes a task grows with a weight (主要 3 · 一般 2 · 少量 1). They are independent
of the area. `task.completed` carries them; the character module still only consumes events.

**Overall XP vs attribute XP.** The XP rule is unchanged and computes one amount per completion:
the ledger row (overall XP, counted once). That amount is then split by weight across the task's
contributions into `xp_attribute_credits` (largest-remainder rounding, parts add up exactly):
20 XP with 法语 3 / 阅读 2 → 法语 +12, 阅读 +8; overall stays 20. Attribute XP is the sum of credits.
Credits are only written with a newly inserted ledger row, so the ledger's idempotency covers
them; a reversal copies the original credits negated, even if the task's contributions changed
since. Users choose _what_ a task grows and the relative weights, never the amount.

**Every completion still earns overall XP** (M6 rule, unchanged); only tasks with contributions
grow attributes. This is a deliberate, visible tension: overall XP measures "things done",
attribute XP measures "growth". See "Open question" below.

**M6 compatibility (migrations 0007 / 0008).** The ledger is not modified. The six M6
area-derived attributes are copied with the same ids into `development_attributes` as archived
`legacy.*` attributes (labels "学习（M6 旧属性）" …), so `xp_ledger.attribute_id` stays valid;
each M6 ledger row with an attribute gets one credit of the same amount (materialising what it
recorded). Then `attributes` and `attribute_areas` are dropped. Reopening a task completed under
M6 reverses its legacy credit. New XP never uses areas. Verified on a database migrated to 0006
with M6 data: ledger byte-identical, totals unchanged.

**Open question for after M6.1.** Should overall XP keep rewarding every completion (activity),
or only development (growth)? Today the level reflects activity; attributes reflect growth. A
later milestone could rename the level to an "activity level", weight it by development XP, or
make overall XP opt-in per area — a product decision, not made here.
