# 0006 — Task model (M1)

**Context.** M1 creates the Task entity that the Eisenhower matrix (M3), projects and Kanban
(M4), Gantt (M5), dashboard (M7) and calendar (Phase 2) will all read. It must not need to be
duplicated or reshaped per view.

**Decisions.**

- **One table, many views.** Views are queries over `tasks`; later milestones only _add_
  nullable columns (`project_id`, `milestone_id`, `recurrence_id`). No view-specific copies.
- **Status = user-defined row + fixed category.** Users name, colour and order statuses; logic
  depends only on the category (`backlog | unstarted | started | completed | cancelled`).
  Kanban (M4) will use statuses as columns; completion, XP and progress use categories.
- **Completion is derived, not set.** `completed_at` / `cancelled_at` follow the category via
  the pure `statusTransition` function, which also decides the domain event.
- **`task.reopened` means "no longer completed"**, including completed → cancelled, so M6 can
  reverse XP for any loss of completion.
- **Urgent / important are nullable booleans**, independent from `priority`. `null` means "not
  yet sorted into the matrix" (M3 shows these in an unsorted tray).
- **Subtasks are tasks** (`parent_task_id`). They are created under a parent in M1;
  re-parenting (and its cycle check) arrives with drag-and-drop in M2.
- **Rich text is stored as ProseMirror JSON** (`jsonb`, ≤ 100 KB) and only rendered through
  the editor schema — never as HTML.
- **Quick Add syntax is language-neutral**: `#tag`, `@area`, `!1–!4` (full-width variants
  accepted for Chinese IMEs). Natural-language dates are not parsed: they are language-specific
  and will be designed separately.
- **Areas are matched by their displayed label** in Quick Add, so `@学习` works in Chinese and
  `@Learning` will work once English area labels exist.
- **Colours and area icons are stored as ids** from fixed sets, never CSS values or icon names
  from a library.
- **Errors**: services throw `DomainError(kind, code)`; tRPC maps `kind` to an HTTP-like code and
  exposes `code` as `domainCode`, which the UI translates via `errors.<code>`.
