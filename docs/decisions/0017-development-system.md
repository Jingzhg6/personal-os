# 0017 — Development system: a planning layer over tasks and attributes

**Decision.** A new `development` module owns the personal-development planning data: one vision
per user, the chosen focus attributes, development goals, and the links goal ↔ attribute
(weighted), goal ↔ task and goal ↔ project. It owns no XP and no tasks.

```
Vision ─▶ Goals ─▶ Development attributes ◀─ task contributions ◀─ Tasks ─▶ XP rules ─▶ Growth XP
                └────────── goal ↔ task links (references) ─────────┘
```

**Six concepts, never collapsed.**

| Concept               | Question                                         | Owner                   |
| --------------------- | ------------------------------------------------ | ----------------------- |
| Area                  | Where does this belong?                          | areas                   |
| Development attribute | What ability am I developing?                    | character (M6.1)        |
| Development goal      | What meaningful outcome do I consciously choose? | development (M8)        |
| Task                  | What concrete action am I taking?                | tasks — the only source |
| XP                    | What does the economy award for that action?     | character (M6.2)        |
| Reward                | What can I exchange XP for?                      | rewards (M6.2)          |

- An area is a place in life (工作, 学习); an attribute is an ability (法语, SQL). A 工作 task can
  grow SQL; a 学习 task can grow nothing. They stay independent (ADR 0013).
- An attribute is a measurable direction of growth; a goal is a chosen outcome with a status and
  maybe a date ("法语达到 B1"). A goal names one or more attributes with the same 1–3 weights as
  task contributions, and many goals may share an attribute.
- A goal never copies a task. It references existing tasks (and projects); a task can serve zero,
  one or several goals. "Create task from goal" calls the tasks module's own `createTask` and links
  the result in the same transaction — an ordinary task in every view. It may pre-fill the task's
  contributions with the goal's attributes; those stay visible and editable on the task.

**Goals do not generate XP.** XP is awarded only by the existing deterministic rules when a task
is completed; the goal is planning metadata. Linking, unlinking, completing or deleting a goal
writes nothing to `xp_ledger`, `xp_attribute_credits` or `reward_ledger` (tested). Otherwise a goal
would be a second, user-tunable XP source and the economy of ADR 0014 would stop being fair.

**Progress stays explainable.** There is no goal percentage derived from XP: XP measures effort on
an ability, not distance to an outcome. Goal progress is the plain count of linked actions:
`已完成 = completed / (linked − cancelled)`, with the counts shown next to it. Growth XP of the
goal's attributes is shown as evidence ("关联能力近 30 天 +45 XP"), clearly labelled as the
attributes' growth, not the goal's. A weighted percentage may come later only with its own ADR.

**Focus is chosen, recent growth is measured.** `development_focus` stores up to
`MAX_FOCUS_ATTRIBUTES` (3, one constant) attributes the user picked, in order. "最近成长最快" is
computed from Growth XP. The two are shown side by side and never merged: most XP ≠ most important.
The M7 dashboard keeps its deterministic "当前成长重点" card and additionally lists the chosen focus,
linking to `/development`.

**Integrity.** Every command checks that the goal, attribute, task and project belong to the
signed-in user; link tables have composite primary keys (no duplicates). Archived goals keep their
links but accept no new ones; restore makes them active. Tasks in the Trash are hidden from goals and
come back with a restore; purging a task, deleting a project or deleting an attribute removes its
links (FK cascade). Archived or legacy attributes cannot be added to goals or focus.

**No AI at runtime.** Nothing in M8 calls a model. The data model is shaped so a later advisor can
_read_ vision, goals, focus, links and growth and _suggest_ changes — which the user confirms and the
existing commands apply. An advisor never writes XP or rules.
