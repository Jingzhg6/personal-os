# 0018 — Growth plans and goal attribution

Builds on ADR 0017 (development system), 0014 (XP economy) and 0013 (attributes).

## 1. Why goal attribution exists

M8 showed a goal's "recent XP" as the growth of its attributes in general. That answers "is 法语
growing?", not "is _this goal_ moving?". With a task 学习法语 linked to 法语 B1 (+20) and a task
法国旅游准备 that grows 法语 but serves no goal (+20), M8 reported 40 for the goal. The goal earned 20.

## 2. Why goal XP is not attribute XP

An attribute is shared by many tasks and goals; a goal is one chosen outcome. Goal XP must come
only from tasks the user tied to that goal, and only from the part of their growth the user
assigned to it. The attribute's overall growth is still shown — labelled as the attribute's.

## 3. Model: allocation, not duplication

One new table, no new XP:

```
development_goal_allocations (goal_id, task_id, attribute_id, share 1–100 %)
  FK (goal_id, task_id) → development_goal_tasks   ON DELETE CASCADE   -- only for linked tasks
  CHECK share between 1 and 100                                         -- no negative / over 100
  TRIGGER Σ share per (task_id, attribute_id) ≤ 100                     -- across all goals
```

A goal's Growth XP is computed at read time from the character module's existing credits:

```
net(task, attribute)  = Σ xp_attribute_credits.amount of the task's ledger entries (grants − reversals)
goal part             = trunc(net × share / 100)           -- towards zero: reversals cancel exactly
未归属                 = net − Σ goal parts                 -- never negative, parts never exceed net
```

So the same XP can be split (60 % / 40 %) but never counted twice: across all goals, the parts of
one (task, attribute) add up to at most its net Growth XP. The XP ledger, credits, levels, rewards
and every M6–M8 figure are untouched — attribution is read/planning metadata.

**Why not a table keyed to `task_development_contributions`?** Contributions are replaced
(delete + insert) on every task edit, which would wipe allocations, and past credits keep their
attribute even after contributions change. Keying on (task, attribute) survives both. **Why
percentages?** XP arrives later (on completion) and can be reversed; a share is valid before, after
and across those changes, and the XP shown is always derived from the ledger.

## 4. Goals do not generate XP

Unchanged from ADR 0017: XP comes only from completing tasks under the M6.2 rules. Creating,
completing or archiving goals and plans, linking tasks or editing allocations writes nothing to
`xp_ledger`, `xp_attribute_credits` or `reward_ledger` (tested). No events are emitted for
planning changes.

## 5. Plans are not tasks

`development_plans` (goal, title, description, status, order) group existing tasks via
`development_plan_tasks`. A plan has no due date, no completion rule and no XP. Completing a plan
completes nothing; tasks stay independent. A plan's task is always one of its goal's tasks: the
link table carries `goal_id` with composite keys to both the plan and the goal ↔ task link, so
unlinking a task from the goal removes it from the goal's plans. Plans have no project links
(goals already have them) and no route of their own — they expand inline on the goal page.

## 6. Tasks remain the single source of truth

"Create task in plan" calls the tasks module's own `createTask` (through the goal's create-task
command) and links the result; it is an ordinary task in every view. Goals and plans only
reference tasks.

## 7. Defaults and history

- Linking a task to a goal that is its **only** goal allocates 100 % of the task's growth in the
  **goal's attributes** (other attributes stay 未归属 until the user includes them).
- Linking a task that already serves another goal allocates **nothing**: the goal page marks it
  待分配 and the user decides. The system never guesses a split.
- Migration 0011 applies the same rule to M8 links: single-goal tasks get 100 % for the goal's
  attributes they contribute to or were credited in; tasks linked to several goals stay
  unallocated. The ledger is not rewritten.

## 8. Several goals sharing one task

Each (task, attribute) is one pie: goal A 60 %, goal B 40 %, or A 50 % and the rest 未归属. The
editor (成长归属) shows every goal of the task side by side with the resulting XP, refuses totals
above 100 % (client, server and database), and keeps archived goals' shares read-only but counted.

## 9. Progress stays explainable

The goal page shows separate evidence, each with its source: actions (已完成 X / Y), attributed
Growth XP by attribute, the last 30 days (completed actions, attributed XP), and 未归属 XP of the
linked tasks. No percentage of goal completion is derived from XP.

## 10. No AI

Nothing here calls a model. The deterministic data — goals, plans, links, shares — is what a later
advisor may read and suggest changes to; the user confirms, existing commands apply them.
