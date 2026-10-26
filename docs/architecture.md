# Personal OS — Architecture

Status: **approved** (M0). This document is the stable reference for all later milestones.
Changes to it are made deliberately and recorded in [`docs/decisions/`](./decisions).

---

## 1. Product principles

- **Capture once, use everywhere.** Every entity (task, project, event, activity) is stored once.
  Views (list, Eisenhower matrix, Kanban, Gantt, dashboard, skill pages, calendar) are different
  _queries and layouts_ over the same rows — never copies.
- **Plan ≠ schedule ≠ reality.** A _Task_ is what needs doing; a _Schedule Block_ is when I intend
  to do it; a _Calendar Event_ is what occupies time; an _Activity_ is what actually happened.
- **Explainable progression.** XP is an append-only ledger; every point has a reason.
- **The AI never silently changes data.** It reads and proposes; the user accepts.
- **Chinese first, never hard-coded.** zh-CN is the default UI language; all UI text goes through
  translation keys; user content is never translated.

## 2. Areas, modules and navigation

Three concepts that are deliberately kept separate:

| Concept        | What it is                                             | Where it lives            | Example                                                             |
| -------------- | ------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------- |
| **Module**     | A functional capability that owns tables, logic and UI | `src/modules/<module>`    | `tasks`, `projects`, `calendar`, `learning`, `fitness`, `character` |
| **Navigation** | What the user sees: sections → items → views           | `src/shell/navigation.ts` | Section _工作_ with items _工作_ and _业务_                         |
| **Area**       | User-defined data used to categorise tasks/projects    | `areas` table (M1)        | "法语", "公司 A", "家庭"                                            |

Rules:

- A navigation item is rendered by exactly one module, but a module can power many items
  (e.g. _全部任务_, _工作_, _行政任务_, _重要截止日期_ are all views of `tasks`).
- Navigation is **not generated from area rows**. Work, Business and Administration are first-class
  navigation sections, so the information architecture can evolve independently of the data.
- A navigation item may later be _scoped_ (e.g. the _工作_ view shows tasks in the areas the user
  assigns to it). Scoping is a view filter, not a data model constraint.
- Areas stay flexible underneath: renaming, merging or adding an area never changes the navigation.

## 3. Technology stack

| Concern          | Choice                                                                               |
| ---------------- | ------------------------------------------------------------------------------------ |
| Language         | TypeScript (strict)                                                                  |
| Framework        | Next.js 16 (App Router, Turbopack), React 19                                         |
| API              | tRPC v11 + Zod 4, superjson                                                          |
| Client data      | TanStack Query (via `@trpc/tanstack-react-query`)                                    |
| Database         | PostgreSQL 16                                                                        |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL migrations committed in `drizzle/`)                   |
| Auth             | Better Auth (email + password; Drizzle adapter)                                      |
| i18n             | next-intl (no locale prefix in URLs)                                                 |
| UI               | Tailwind CSS v4, hand-owned primitives in `src/shared/ui`, lucide icons, next-themes |
| Fonts            | Geist (bundled via npm, no Google Fonts fetch) + system CJK fonts                    |
| Tests            | Vitest (unit, DOM, real-Postgres integration), Playwright (E2E)                      |
| Tooling          | ESLint (boundaries + no-literal-string), Prettier, GitHub Actions                    |
| Planned          | dnd-kit (M2+), ECharts (M6+), Tiptap (M1+), `rrule` (M8), pg-boss (Phase 2)          |

## 4. Application architecture

A **modular monolith**: one deployable app, strict internal boundaries.

```
src/app      Next.js routing only: thin pages that compose shell + modules
src/shell    Application chrome: layout, sidebar, navigation config, auth screens, providers
src/server   Server composition root: auth instance, tRPC root router, event-bus wiring, i18n request
src/modules  One folder per module (domain / db / server / ui)
src/shared   Framework-level building blocks used by everyone (db client, events, i18n, trpc, ui)
```

### 4.1 Module layout and public entry points

```
src/modules/<module>/
  domain/   Pure types, rules and Zod schemas. No React, no DB, no Next.   → @/modules/<m>/domain
  db/       Drizzle tables owned by the module.                            → @/modules/<m>/db
  server/   Repositories, services/use cases, tRPC router, event handlers. → @/modules/<m>/server
  ui/       React components (client or server).                           → @/modules/<m>/ui
```

Only those four `index.ts` files are importable from outside the module. Everything else is private.

### 4.2 Dependency rules (enforced by ESLint)

| From ↓ may import →  | shared          | modules (public)  | server     | shell | app |
| -------------------- | --------------- | ----------------- | ---------- | ----- | --- |
| `shared`             | ✓               | ✗                 | types only | ✗     | ✗   |
| `modules/<m>`        | ✓               | ✓                 | ✗          | ✗     | ✗   |
| `modules/<m>/domain` | ✓ (not db/trpc) | ✓                 | ✗          | ✗     | ✗   |
| `modules/<m>/ui`     | ✓               | ✓ (not server/db) | ✗          | ✗     | ✗   |
| `server`             | ✓               | ✓                 | ✓          | ✗     | ✗   |
| `shell`              | ✓               | ✓ (not server/db) | types only | ✓     | ✗   |
| `app`                | ✓               | ✓                 | ✓          | ✓     | ✓   |

Modules never call each other's internals. Cross-module reactions go through **domain events**.

### 4.3 Request flow

```
Browser ─ tRPC (HTTP batch) ─▶ /api/trpc ─▶ module router (Zod input, protectedProcedure)
                                              └▶ service / repository (Drizzle, scoped by ctx.userId)
                                                    └▶ bus.publish(event, { db: tx })
                                                          └▶ other modules' handlers (same transaction)
Server Components ─ getServerApi() ─▶ same routers, no HTTP round trip
```

- **Authorization**: every user-owned query is scoped by `ctx.userId` from `protectedProcedure`.
  `src/proxy.ts` only does an optimistic cookie check for redirects; the real check is in the
  `(app)` layout (`requireUser`) and in every procedure.
- **Validation**: Zod schemas live in `domain/` and are shared by the router and the UI forms.

### 4.4 Domain events

- `src/shared/events` defines `DomainEventMap`; each module augments it with its own events.
- Handlers are registered in `src/server/event-bus.ts` (composition root).
- Phase 1 delivery is **in-process and synchronous**: handlers receive the publisher's `db`
  executor, so they run in the same transaction (e.g. _task completed → XP ledger entry_
  commits or rolls back together). A failing handler fails the publish.
- Phase 2 adds a **transactional outbox + pg-boss** for side effects that leave the process
  (calendar push, AI analysis), behind the same `subscribe` API.

Current events:

| Event             | Published by                                                                 | Subscribers today                                        |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| `user.registered` | Better Auth hook                                                             | settings (defaults), areas (seed), tasks (seed statuses) |
| `task.created`    | tasks service                                                                | — (XP, analytics later)                                  |
| `task.completed`  | tasks service, when a task enters the _completed_ category                   | — (XP in M6)                                             |
| `task.reopened`   | tasks service, when a completed task leaves that category (reopen or cancel) | — (XP reversal in M6)                                    |
| `task.deleted`    | tasks service, when a task (and its subtree, `taskIds`) moves to the Trash   | — (analytics / XP reversal later)                        |
| `task.restored`   | tasks service, when tasks come back from the Trash                           | —                                                        |

`task.completed` carries the facts XP rules need (priority, urgent/important flags, area,
estimate, completion time), so subscribers never have to query the tasks module.

### 4.5 Internationalisation

- Locales: `zh-CN` (default, source of truth), `en`, `fr`. Configured in `src/shared/i18n/config.ts`.
- Messages: `messages/<locale>/<namespace>.json`; namespaces are listed in config.
- Resolution per request (`src/server/i18n/request.ts`): signed-in user's `user_settings.locale`
  → `NEXT_LOCALE` cookie → `zh-CN`. URLs carry no locale prefix.
- Missing keys in `en`/`fr` fall back to zh-CN at runtime. CI fails on keys that exist in
  `en`/`fr` but not in zh-CN, on invalid ICU syntax, and on mismatched placeholders.
- Types: message keys are type-checked (next-intl `AppConfig` augmentation).
- Lint: `i18next/no-literal-string` rejects literal JSX text and literal `aria-label`, `title`,
  `placeholder`, `alt`, `label` attributes in `.tsx` files.
- Stored values are **stable identifiers** (`"in_progress"`, `"zh-CN"`); labels are resolved
  at the UI layer (`t(\`task.status.${status}\`)`). Seeded configurable rows use the
_system-key pattern_: `system_key`set and`name`null ⇒ translated label; user-renamed ⇒`name`.
- History entries (e.g. XP reasons) store `reason_key` + `params`, never rendered text, so they
  re-render in whichever language is active.
- Dates and numbers are formatted with named formats (`src/shared/i18n/formats.ts`) in the
  user's timezone.

### 4.6 Design system

- Semantic tokens defined once in `src/app/globals.css` (`--surface`, `--muted-foreground`,
  `--primary`, `--xp`, …) with light and dark values; components use only semantic utilities.
- Dark mode: class-based via next-themes (light / dark / system), per device.
- Primitives in `src/shared/ui` (Button, Input, Label, Select, Card, Badge, PageHeader,
  ConfirmDialog, Dialog, Popover, Toast, ColorPicker, RichTextEditor), styled with `cva` + `cn`. New primitives
  are added there, not inside modules.
- User-selectable colours are stored as palette ids (`gray`, `blue`, …, `src/shared/lib/colors.ts`)
  and mapped to classes in `src/shared/ui/color.tsx`, so they adapt to both themes.

## 5. Data model

### 5.1 Conventions

- Primary keys: **UUIDv7** generated by the app (`newId()`), time-sortable.
- Every user-owned table has `user_id` → `users.id` (cascade) and `created_at`/`updated_at`
  (`timestamptz`). Soft delete via `deleted_at` where users expect a Trash.
- Enums are stable lowercase identifiers stored as `text` with a check (or a Postgres enum when
  the set is closed). Display labels never reach the database.
- Timestamps are `timestamptz`; calendar dates without time (due dates) are `date`.
- Each module owns its tables in `src/modules/<m>/db`; `src/server/db-schema.ts` aggregates them
  for drizzle-kit and Better Auth.

### 5.2 Implemented (M0–M2)

| Table                                            | Owner       | Notes                                                              |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------ |
| `users`, `sessions`, `accounts`, `verifications` | shared/auth | Better Auth models                                                 |
| `user_settings`                                  | settings    | `locale`, `time_zone`, `week_starts_on`                            |
| `areas`                                          | areas       | system-key pattern; `color`/`icon` ids; `sort_key`                 |
| `task_statuses`                                  | tasks       | fixed `category`; system-key pattern; unique per user + system key |
| `tags`                                           | tasks       | unique per user, case-insensitive (`lower(name)`)                  |
| `tasks`                                          | tasks       | see below                                                          |
| `task_tags`                                      | tasks       | composite PK; cascades from both sides                             |
| `task_views`                                     | tasks       | (M2) area scope of the 工作 / 业务 / 行政任务 / 个人生活 views     |

`tasks` (M1): `id, user_id, title, description (jsonb, Tiptap), area_id → areas (set null),
parent_task_id → tasks (cascade), status_id → task_statuses (restrict), priority 0–4,
is_urgent?, is_important?, start_date?, due_date?, due_time?, estimated_minutes?, sort_key,
completed_at, cancelled_at, deleted_at, created_at, updated_at` plus (M2) `description_text`
(plain text of the description, maintained by the service, for search), with check constraints for
priority range, positive estimate, `due_time` requiring `due_date`, non-blank title and no
self-parenting.

Rules enforced in the service layer (`src/modules/tasks/server/service.ts`):

- Every read and write is scoped by `user_id`; referenced areas, tags, statuses and parent tasks
  must belong to the same user (otherwise `NOT_FOUND`).
- `completed_at` / `cancelled_at` are derived from the status _category_
  (`statusTransition` in the domain), never set by clients.
- Complete → first status of the _completed_ category; reopen → first _unstarted_ status.
- Each category keeps at least one status; deleting a status in use requires a replacement in
  the same category.
- Delete is soft and recursive: the task and its subtree share one `deleted_at`, which is how the
  Trash knows what was deleted together. Restore brings back that batch; a task whose parent is
  still deleted comes back at the top level. Purge / empty Trash are hard deletes.
- Reordering (`moveTask`) takes the two neighbours around the drop position and computes a key
  between them; neighbours must share the task's parent. `setTaskParent` rejects cycles.
- `sort_key` columns use `COLLATE "C"` (fractional-index keys are case-sensitive).
- New users get default areas and statuses via `user.registered`; accounts that existed before
  M1 were backfilled by migration `0002`.

### 5.2.1 Task views (M2)

Every task screen is a query over the same `tasks` table (`listTasks`, `src/modules/tasks/server/repository.ts`):

| Screen                            | Query                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| 全部任务 `/tasks`                 | top-level tasks, user filters/sort/search                                                     |
| 工作 / 业务 / 行政任务 / 个人生活 | top-level tasks in the view's areas (`task_views`, default: the seeded area of the same name) |
| 重要截止日期 `/admin/deadlines`   | open tasks **and subtasks** with a due date, sorted and grouped by due date                   |
| Search (any screen)               | title or description substring at any level (`pg_trgm` GIN indexes), shows the parent         |
| 回收站 `/tasks/trash`             | roots of each deletion batch                                                                  |

Filters, sort and search live in the URL (`?q=&status=&priority=&area=&tag=&urgent=&important=&due=&sort=`),
parsed by `readListParams` / `writeListParams` in the domain, so every view is shareable.
"Today" for due-date filters is sent by the client in the user's timezone.

### 5.3 Phase 1 (planned, M3–M8)

```
tasks (additive)   + project_id?, milestone_id? (M4), recurrence_id? (M8), actual_minutes? (Phase 2)
task_dependencies  blocking_task_id, blocked_task_id, type(finish_to_start)   -- cycle-checked in service
task_recurrences   id, user_id, rrule, mode(fixed|after_completion), timezone, next_due_at, ended_at
projects           id, user_id, name, description, area_id?, status(planned|active|paused|completed|cancelled),
                   priority, start_date, target_date, completed_at, color, icon, sort_key, deleted_at
milestones         id, project_id, name, date, completed_at, sort_key
characters         user_id, name, avatar
attributes         id, user_id, system_key?, name?, color, icon, sort_key
xp_rules           id, user_id, event_type, conditions(jsonb), target_type, target_id, amount(jsonb), daily_cap?, enabled
xp_ledger          id, user_id, target_type, target_id, amount, source_type, source_id, rule_id?, reversal_of?,
                   reason_key, reason_params(jsonb), occurred_at   UNIQUE(source_type, source_id, rule_id, reversal_of)
xp_totals          cache rebuilt from the ledger
```

Key decisions: `priority` is independent of `is_urgent`/`is_important` (null = not yet sorted
into the matrix); project progress is computed, never stored by hand; ordering uses fractional
`sort_key`s.

### 5.4 Phase 2: calendar (designed, not built)

Phase 2 starts with the internal chain **Task → Schedule Block → Calendar Event**:

```
schedule_blocks     id, user_id, task_id, start_at, end_at, status(planned|done|skipped|moved)
calendar_events     id, user_id, calendar_id?, source(internal|google|microsoft|caldav), external_id?,
                    title, start_at, end_at, all_day, etag?, raw(jsonb)?
calendar_links      id, schedule_block_id | milestone_id | task_id(deadline), calendar_event_id,
                    origin(app|external), last_synced_hash, last_synced_at, state(ok|conflict|orphaned)
```

External providers are added **incrementally**, behind a `CalendarProvider` interface
(`listCalendars`, `listChanges(syncToken)`, `createEvent`, `updateEvent`, `deleteEvent`):

1. Internal calendar view of schedule blocks (no provider).
2. **Read-only import** (Google first): `calendar_accounts`, `calendars`, imported events.
3. **Controlled two-way sync** per user-chosen rules (schedule blocks / deadlines / milestones /
   selected tasks / manual only). Safeguards: app-created events are tagged with a private
   marker; the app never deletes events it did not create; content hashes + etags prevent loops;
   conflicts go to a review queue; all sync runs as idempotent background jobs.
4. Outlook (Microsoft Graph), then iCloud via CalDAV (polling only).

### 5.5 Phase 2: learning, skills, activities (designed, not built)

```
activities   id, user_id, kind, started_at, ended_at, duration_minutes, task_id?, skill_id?, area_id?,
             project_id?, source(timer|manual|schedule_block|calendar_event), source_ref_id?
             UNIQUE(source, source_ref_id)    -- one activity per source: no double counting
skills       id, user_id, name, attribute_id?, parent_skill_id?, target_hours?, notes
task_skills / project_skills
goals        id, user_id, title, kind(binary|metric|time), target_value, unit, period, links…
```

The 10,000-hour metric is presented as gamification, not as a measure of mastery.

### 5.6 Phase 3: fitness (deliberately not committed)

Fitness will be designed in Phase 3. The only commitments now are the extension points:

- A workout **is an Activity** (time, area, XP) with a fitness-owned detail table.
- Body metrics are a time series keyed by a metric identifier (`metric_key`, value, unit,
  measured_at) so new metrics need no migration.
- Fitness logic subscribes to events and emits its own (`fitness.workout_logged`, …).
  No fitness tables or logic exist before Phase 3.

## 6. How the concepts relate

```
            Area ◄───────────────┐  (categorisation only)
             ▲                   │
   Goal ─► Project ─► Milestone  │
             ▲                   │
   Skill ◄─► Task ◄── subtasks / dependencies / tags
     │        │
     │        ├──► Schedule Block ◄─ link ─► Calendar Event ◄── external calendars
     │        │     (when I intend)          (what occupies time)
     ▼        ▼            │                       │ classified
          Activity ◄───────┴───────────────────────┘
       (what actually happened; workout = activity + details)
             │
   domain events ─► XP ledger ─► attribute & skill levels ─► Character
             │
   Analytics (read models) ─► AI Coach (read-only + suggestions the user accepts)
```

The same `tasks` row appears in All Tasks, the Eisenhower Matrix, the project list, Kanban,
Gantt, the dashboard, area-scoped views (Work, Admin…) and, once scheduled, the calendar.

## 7. Testing strategy

| Layer                                                       | Tool                           | Location              | Runs against                                |
| ----------------------------------------------------------- | ------------------------------ | --------------------- | ------------------------------------------- |
| Unit (domain rules, i18n catalogues, navigation, event bus) | Vitest `unit`                  | `src/**/*.test.ts`    | Node                                        |
| Components                                                  | Vitest `dom` + Testing Library | `src/**/*.test.tsx`   | jsdom                                       |
| Integration (repositories, routers, auth, events)           | Vitest `db`                    | `src/**/*.db.test.ts` | real PostgreSQL test DB, truncated per test |
| End-to-end                                                  | Playwright                     | `e2e/`                | production build + test DB                  |

Every module ships domain unit tests and DB integration tests for its repository/router.

## 8. Roadmap

**Phase 1**

- **M0 Foundations** ✅: tooling, DB, auth, i18n, shell, boundaries, design tokens, event bus, tests, CI.
- **M1 Areas & task core** ✅: areas, configurable statuses, tags, task schema/API/service, Quick Add, detail panel, subtasks, rich-text descriptions, domain events.
- **M2 Task views** ✅: filtering, sorting, search, drag reorder (pointer + keyboard), keyboard navigation, Trash, re-parenting, area-scoped views (工作 / 业务 / 行政任务 / 个人生活) and 重要截止日期.
- **M3 Eisenhower matrix.**
- **M4 Projects**: CRUD, list, Kanban, milestones, progress.
- **M5 Dependencies & basic Gantt.**
- **M6 Character & XP**: attributes, rules, ledger with reversals, levels, radar, history.
- **M7 Dashboard.**
- **M8 Recurring tasks, settings polish, JSON export, deployment (Dockerfile), E2E sweep, polish.**

**Phase 2**: activities & timer → skills & learning → goals → schedule blocks + internal
calendar → Google read-only import → controlled two-way sync → Outlook → CalDAV → skill XP → notes & documents.

**Phase 3**: fitness, nutrition & sleep, analytics read models, AI coach.

## 9. Decision log

See [`docs/decisions/`](./decisions).
