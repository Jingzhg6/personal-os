# 0011 — Commands that publish events lock their row first

**Context.** M6 turns `task.completed`, `task.reopened`, `project.completed`,
`project.reopened` and `milestone.completed` into XP. The M0–M5 integration audit found that two
concurrent requests for the same change (a double click, a Kanban drop together with a checkbox
click) could both read the old state and both publish the event — 3 `task.completed` for one
completion in the test.

**Decision.** Every command that publishes a domain event takes a row lock (`SELECT … FOR
UPDATE`) on the entity before reading its current state, inside the same transaction that
publishes: task status changes (complete / reopen / set status), task delete and restore,
project updates, milestone completion. The second request then sees the new state and is a no-op
(or fails with not found), so one logical change publishes exactly one event.

**Consequences.** Concurrent writes to the same row are serialised; different rows are not
affected. New event-publishing commands must follow the same pattern; `src/server/
integration.db.test.ts` checks it for the existing ones.
