# 0008 — Eisenhower matrix (M3)

**The matrix is a view, not a model.** A task's quadrant is derived from the existing
`is_urgent` / `is_important` flags (`matrixPlacement` in the tasks domain). There is no matrix
table, column or copy of the task. Moving a card is an ordinary `tasks.update` of the two flags,
so the list, the matrix, the scoped views and later the dashboard always agree.

**Unsorted means "not decided".** A task is placed in a quadrant only when both flags are set.
If either is `null`, it sits in the 未分类 tray. Moving a card back to 未分类 clears both flags.
That is why the flags are nullable booleans (ADR 0006).

**What the matrix shows.** Open tasks (backlog / unstarted / started) at every level. Subtasks
carry their own flags and show their parent. Within a quadrant, cards are ordered by due date,
then priority. Search and filters from M2 apply; the status filter can widen the set.

**Interaction.** Pointer drag from anywhere on the card (dnd-kit, 5 px activation so clicks still
work). Keyboard drag from the card's handle, with Chinese screen-reader announcements. Each card
also has a 「移到」 menu listing the five placements, the reliable route for keyboard and
touch users. Each quadrant has a compact Quick Add that pre-sets its flags. Clicking a card
opens the same URL-addressable detail panel as the task list (`useTaskPanel`).

**Layout.** 2 × 2 quadrants with 紧急 / 不紧急 column headings and the 未分类 tray beside them
on wide screens. On narrow screens everything stacks, with 未分类 first (it is the inbox).
Vertical axis labels were tried and removed: vertical CJK text was hard to read and repeated the
quadrant titles.

**Deferred.** Manual ordering inside a quadrant (cards mix tasks from different parents, so
fractional keys are not comparable); the matrix summary on the dashboard (M7).
