# 0012 — Character XP: an append-only, idempotent ledger fed by domain events (M6)

**Ledger, not counters.** Every XP change is one immutable row in `xp_ledger` with its source
event (`source_event_id`, `source_event_type`), source entity (`source_type`, `source_id`,
title at the time), rule (`rule_key`), signed amount, credited attribute and time. Total XP, the
level, attribute values and the radar are sums over the ledger at read time. A trigger rejects
UPDATE and direct DELETE; rows disappear only with their user.

**Idempotent in the database, not only in code.** Three unique indexes, all inserts
`ON CONFLICT DO NOTHING`:

1. `(source_event_id, rule_key)` — a redelivered event (same id) adds nothing;
2. `(user_id, rule_key, source_type, source_id, cycle)` for grants — a completion is granted once
   per cycle even if a second, different event arrives for it; the cycle is the number of
   reversals so far, so complete → reopen → complete grants again, legitimately;
3. `reversal_of` for reversals — a grant is reversed at most once.
   This holds even without the row locks from ADR 0011 (tested by delivering the same event to the
   handler repeatedly, concurrently, and with a new id).

**Rules are code, defined once** (`character/domain/rules.ts`): each rule names the event that
grants (`task.completed`, `project.completed`, `milestone.completed`) and the event that
reverses (`task.reopened`, `project.reopened`, the new `milestone.reopened`). A reversal negates
the grant it cancels instead of recomputing, so it always matches. Completed → cancelled already
publishes `*.reopened`, so it reverses through the same rule — no special case. A new module
joins by publishing events and adding a rule; the ledger and the UI do not change. Amounts:
task 10 + 5 × priority (+5 important), subtask 5; milestone 30; project 100 + 25 × priority.

**What XP means.** XP records that something was completed, not that it still exists:
deleting, restoring or purging a completed task, or deleting a project or milestone, neither
reverses nor regrants. Only a completion reversal (reopen / cancel) creates a reversal.

**Attributes are separate from the ledger.** Six seeded attributes (学习, 工作, 健身, 业务, 行政,
生活) are records of their own; `attribute_areas` maps an area to the attribute its completed
items credit (defaults follow the seeded areas; editable). A grant stores the attribute it
credited, so later re-mapping never rewrites history. Unmapped areas or no area: overall XP only.
The radar is a view of these values.

**Levels** are derived in one place (`character/domain/levels.ts`): level n → n+1 costs n × 100
XP (attributes n × 50).

**Decoupling.** The character module subscribes to events on the bus (inside the publisher's
transaction, so XP commits or rolls back with the completion). It imports no task / project
code — only the event types and the areas module (for the mapping UI). Events gained the fields
XP needs (`title` / `name`, `parentTaskId`, the milestone's `areaId`).

**Not done.** No retroactive XP for completions before M6 (no events were recorded); no
user-editable rules, daily caps or skills (Phase 2); the client refetches character data when
it is shown instead of being invalidated by other modules.
