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

| Event             | Published by                                                                 | Subscribers today                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `user.registered` | Better Auth hook                                                             | settings (defaults), areas (seed), tasks (seed statuses), character (seed attributes), rewards (seed level rewards) |
| `task.created`    | tasks service                                                                | — (XP, analytics later)                                                                                             |
| `task.completed`  | tasks service, when a task enters the _completed_ category                   | character (Active XP; Growth + Level XP if it has contributions)                                                    |
| `task.reopened`   | tasks service, when a completed task leaves that category (reopen or cancel) | character (XP reversal)                                                                                             |
| `task.deleted`    | tasks service, when a task (and its subtree, `taskIds`) moves to the Trash   | — (analytics / XP reversal later)                                                                                   |
| `task.restored`   | tasks service, when tasks come back from the Trash                           | —                                                                                                                   |

`task.completed` carries the facts XP rules need (priority, urgent/important flags, area,
estimate, completion time), so subscribers never have to query the tasks module.

### 4.5 Internationalisation

- One locale: `zh-CN` (ADR 0015; EN/FR removed in M6.2). Configured in `src/shared/i18n/config.ts`;
  `src/server/i18n/request.ts` always serves it. URLs carry no locale prefix.
- Messages: `messages/zh-CN/<namespace>.json`; namespaces are listed in config. CI fails on
  empty values and invalid ICU syntax (`pnpm i18n:check`).
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

### 5.2 Implemented (M0–M6.2)

| Table                                            | Owner       | Notes                                                               |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------- |
| `users`, `sessions`, `accounts`, `verifications` | shared/auth | Better Auth models                                                  |
| `user_settings`                                  | settings    | `locale`, `time_zone`, `week_starts_on`                             |
| `areas`                                          | areas       | system-key pattern; `color`/`icon` ids; `sort_key`                  |
| `task_statuses`                                  | tasks       | fixed `category`; system-key pattern; unique per user + system key  |
| `tags`                                           | tasks       | unique per user, case-insensitive (`lower(name)`)                   |
| `tasks`                                          | tasks       | see below                                                           |
| `task_tags`                                      | tasks       | composite PK; cascades from both sides                              |
| `task_views`                                     | tasks       | (M2) area scope of the 工作 / 业务 / 行政任务 / 个人生活 views      |
| `projects`                                       | projects    | (M4) see below                                                      |
| `milestones`                                     | projects    | (M4) belong to one project; cascade with it                         |
| `task_dependencies`                              | tasks       | (M5) finish-to-start edges; see below                               |
| `development_attributes`                         | character   | (M6.1) user-defined growth directions (法语, 阅读, Python …)        |
| `xp_attribute_credits`                           | character   | (M6.1) append-only split of a ledger entry across attributes        |
| `task_development_contributions`                 | tasks       | (M6.1) which attributes a task grows, with weights 1–3              |
| `xp_ledger`                                      | character   | (M6) append-only XP ledger; see below                               |
| `rewards`                                        | rewards     | (M6.2) user-defined real-world rewards; value + accepted currencies |
| `level_rewards`                                  | rewards     | (M6.2) one reward per level; system-key pattern for seeded ones     |
| `reward_ledger`                                  | rewards     | (M6.2) append-only spending: redemptions and level-reward claims    |
| `development_profiles`                           | development | (M8) one row per user: the free-text vision                         |
| `development_focus`                              | development | (M8) chosen focus attributes, ordered, at most 3                    |
| `development_goals`                              | development | (M8) goals: status, priority 1–3, target date; see below            |
| `development_goal_attributes`                    | development | (M8) goal → attributes, weights 1–3                                 |
| `development_goal_tasks`                         | development | (M8) goal → existing tasks (references)                             |
| `development_goal_projects`                      | development | (M8) goal → existing projects (references)                          |
| `development_goal_allocations`                   | development | (M9) share 1–100 % of a linked task's Growth XP per attribute       |
| `development_plans`                              | development | (M9) growth plans of a goal: status, order                          |
| `development_plan_tasks`                         | development | (M9) plan → existing tasks (always also linked to the goal)         |

`tasks` (M1): `id, user_id, title, description (jsonb, Tiptap), area_id → areas (set null),
parent_task_id → tasks (cascade), status_id → task_statuses (restrict), priority 0–4,
is_urgent?, is_important?, start_date?, due_date?, due_time?, estimated_minutes?, sort_key,
completed_at, cancelled_at, deleted_at, created_at, updated_at` plus (M2) `description_text`
(plain text of the description, maintained by the service, for search), with check constraints for
priority range, positive estimate, `due_time` requiring `due_date`, non-blank title and no
self-parenting.

`projects` (M4): `id, user_id, name, description (jsonb, Tiptap), area_id → areas (set null),
status (planned|active|paused|completed|cancelled), priority 0–4, color, start_date?,
target_date?, completed_at, sort_key, created_at, updated_at`. `milestones` (M4): `id, user_id,
project_id → projects (cascade), name, due_date?, completed_at, sort_key`. `tasks` gained
`project_id → projects (set null)` and `milestone_id → milestones (set null)`, with checks
`tasks_subtasks_have_no_project` (only top-level tasks carry a project; subtasks belong to their
root's project) and `tasks_milestone_needs_project`. Progress (total / completed / overdue) is
counted from the top-level, non-deleted, non-cancelled tasks at read time — never stored.
Deleting a project hard-deletes it and its milestones; its tasks stay and simply lose the
reference (cleared explicitly in the same transaction). See ADR 0009.

`task_dependencies` (M5): `user_id, blocking_task_id → tasks (cascade), blocked_task_id → tasks
(cascade), created_at`, primary key on the pair, check against self-edges. Finish-to-start only:
the blocked task should not start before the blocking task is done. The service rejects cycles
(recursive CTE under a per-user advisory lock); edges to tasks in the Trash are hidden, not
deleted, and come back with a restore. `openBlockerCount` on every task and the 前置 / 后续 lists
in the detail panel are read from this one table. See ADR 0010.

`xp_ledger` (M6): `id, user_id, kind (grant|reversal), amount (signed), rule_key,
source_event_id, source_event_type, source_type (task|project|milestone), source_id (no FK —
history outlives the source), source_title (title at the time), attribute_id? (legacy, see
below), cycle, reversal_of?, created_at`. Append-only: a trigger rejects UPDATE and direct
DELETE (only the user cascade removes rows). Unique indexes make it idempotent: one entry per
(source event, rule), one grant per (rule, source, cycle), one reversal per grant. One row = the
**overall XP** of one completion or reversal, counted once. Total XP and the level are sums over
it at read time. See ADR 0012.

Development model (M6.1, ADR 0013). **Areas organise life** (which part of my life is this
task in?); **development attributes describe growth** (what am I becoming better at?). They are
independent: a task has one area and zero or more `task_development_contributions`
(`task_id, attribute_id, weight 1–3`). On completion, the task's overall XP is split by weight
into `xp_attribute_credits` (`ledger_entry_id, attribute_id, signed amount`, append-only, unique
per entry and attribute); a reversal copies the grant's credits negated. **Attribute XP** = sum
of an attribute's credits; the credits of one entry never exceed its amount, so nothing is
counted twice. Tasks without contributions, projects and milestones earn overall XP only.
`development_attributes` (`system_key?` for seeded examples, `name?`, `icon?`, `color`,
`on_radar`, `archived_at`, `sort_key`) are user data; archiving hides an attribute from the radar
and pickers but keeps its XP. The radar shows active attributes with `on_radar`; it stores
nothing. M6's area-derived attributes survive as archived `legacy.*` attributes with their
original ids; `xp_ledger.attribute_id` keeps what M6 recorded and is no longer written.

XP economy (M6.2, ADR 0014). Four layers: **Active XP** = sum of `xp_ledger.amount` (every
completion); **Growth XP** = credits per attribute (only tasks with contributions);
**Level XP** = `xp_attribute_credits.level_xp` (`calculateLevelXpFromGrowth`, 1:1; NULL on
pre-M6.2 rows ⇒ 1:1, or 0 for `legacy.*`). The level and growth stage are derived from lifetime
Level XP only. **Spendable** Active / Level XP = lifetime − what `reward_ledger` spent; spending
never touches lifetime values or the level. Rewards are priced in purchasing units
(`REWARD_XP_RATES`: Active 1, Level 5); purchases are computed server-side
(`calculateRewardPurchase`), in one transaction under a per-user advisory lock, idempotent by
`(user, idempotency_key)`. Level rewards are free once reached, claimable once, or early for the
missing Level XP up to the end of the next growth stage.

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

| Screen                            | Query                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 四象限矩阵 `/tasks/matrix`        | open tasks **and subtasks**, placed by `matrixPlacement(isUrgent, isImportant)`; moving a card writes the two flags |
| 全部任务 `/tasks`                 | top-level tasks, user filters/sort/search                                                                           |
| 工作 / 业务 / 行政任务 / 个人生活 | top-level tasks in the view's areas (`task_views`, default: the seeded area of the same name)                       |
| 重要截止日期 `/admin/deadlines`   | open tasks **and subtasks** with a due date, sorted and grouped by due date                                         |
| Search (any screen)               | title or description substring at any level (`pg_trgm` GIN indexes), shows the parent                               |
| 回收站 `/tasks/trash`             | roots of each deletion batch                                                                                        |
| 看板 `/projects/kanban`           | (M4) top-level tasks, one column per task status; moving a card sets the status                                     |
| 甘特图 `/projects/gantt`          | (M5) top-level tasks with a start or due date, grouped by project, plus milestones and dependencies among them      |
| 项目 `/projects/[id]` 任务 / 看板 | (M4) the list and the board above, filtered to `project_id` (a first-level subtask matches through its parent)      |

Filters, sort and search live in the URL (`?q=&status=&priority=&area=&tag=&urgent=&important=&due=&sort=`),
parsed by `readListParams` / `writeListParams` in the domain, so every view is shareable.
"Today" for due-date filters is sent by the client in the user's timezone.

The Eisenhower placement is derived in the domain (`src/modules/tasks/domain/eisenhower.ts`):
both flags set ⇒ one of four quadrants, any flag `null` ⇒ 未分类. No matrix-specific column or
table exists.

### 5.2.2 Dashboard (M7, read model only)

The dashboard (`/`, module `dashboard`, ADR 0016) answers "what level am I, what am I developing,
have I grown, how far to the next level, which reward is next" — and owns **no tables and no
rules**. `dashboard.overview` and `dashboard.growth({ period })` are two queries that call the
owning modules' read functions and only arrange the results:

| Shown                              | Source (module → function)                                              |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Level, stage, progress             | character → `getXpTotals` + `getLevelProgress` / `getStageProgress`     |
| Active / Growth / Level XP cards   | character → `getXpTotals`; rewards → `getBalances` (lifetime − spent)   |
| Radar                              | character → `listAttributes` (Growth XP per attribute), `RadarChart` UI |
| 本周, ranking, trend, growth focus | character → `getXpActivity` (ledger + credits grouped by local day)     |
| Completed tasks this week          | tasks → `countCompletedTasks`                                           |
| Recent activity                    | character → `listHistory` (ledger lines; the task stays the source)     |
| Next level reward, store preview   | rewards → `listLevelRewards`, `listRewards`, `calculateRewardPurchase`  |

Periods are local calendar days in the user's timezone (`user_settings.time_zone`, week start
`week_starts_on`); SQL converts the local start date to an instant (`date::timestamp at time zone
tz`) and groups by the local date. The pure helpers in `dashboard/domain` only pick periods,
fill and bucket the trend (day ≤ 92 days, week ≤ 2 years, month beyond), rank attributes and
choose the next level reward. Claiming and redeeming stay on `/rewards`. The old `/dashboard`
address redirects to `/`.

### 5.2.3 Development system (M8, ADR 0017)

`/development` plans personal development: **vision** (one free text) → **goals** (meaningful
outcomes, `active | paused | completed | archived`) → **development attributes** (the abilities,
owned by character) ← **tasks** (the only actions, owned by tasks). Goals reference tasks and
projects; they never copy them and never create XP. Goal progress is the count of linked actions
(`completed / (linked − cancelled)`); growth of the goal's attributes is shown as evidence only.
The chosen focus (≤ 3, `MAX_FOCUS_ATTRIBUTES`) is shown next to — never mixed with — the measured
"最近成长最快". Routes: `/development`, `/development/goals/[id]`, `/development/attributes/[id]`.
Read models compose the owners' reads (`getXpActivity` with an attribute filter,
`getAttributeSources`, `getAttributeLastActivity`, `getTasksByIds`, `listOpenTasksDeveloping`,
`listProjects`); the task panel links goals through the `development` router directly, so the tasks
UI does not import the development UI. The XP trend chart and series (`buildTrend`,
`XpTrendChart`) moved to the character module, shared by the dashboard and attribute pages.

### 5.2.4 Growth plans and goal attribution (M9, ADR 0018)

Vision → goal → **plans** (ways of reaching it, grouping existing tasks) → tasks → XP rules →
credits → **goal evidence**. A goal's Growth XP is no longer its attributes' growth: it is the
allocated part of its linked tasks' credits, `trunc(net(task, attribute) × share / 100)`, with
shares across goals ≤ 100 % (CHECK + trigger) and the remainder shown as 未归属. A task's only goal
gets 100 % of the goal's attributes by default; a task shared by goals is allocated explicitly in
the 成长归属 editor (goal page and task panel). `getTaskGrowth` (character) is the only new XP read;
nothing is written to the ledger. Plans expand inline on `/development/goals/[id]`; the overview
shows them secondarily (with / without recent activity).

### 5.3 Phase 1 (planned, after M9)

```
tasks (additive)   + recurrence_id? (M8), actual_minutes? (Phase 2)
task_recurrences   id, user_id, rrule, mode(fixed|after_completion), timezone, next_due_at, ended_at
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
- **M3 Eisenhower matrix** ✅: quadrants + 未分类 tray derived from the flags, drag-and-drop and a 「移到」 menu, quick add per quadrant, shared detail panel, filters.
- **M4 Projects** ✅: project CRUD and list, project page (任务 / 看板 / 里程碑 / 说明), status Kanban (global and per project), milestones, computed progress, project filter and fields on tasks.
- **M5 Dependencies & basic Gantt** ✅: finish-to-start dependencies with cycle checks, 前置 / 后续 lists and 受阻 markers, Gantt chart (global and per project) with day / week / month scales, milestones, dependency arrows with date-conflict highlighting, drag / keyboard rescheduling.
- **M6.1 Personal development model** ✅: user-defined development attributes, task development contributions (independent of areas), overall XP vs attribute XP (credits), dynamic radar, settings, M6 compatibility.
- **M9 Growth planning & goal attribution** ✅: growth plans grouping existing tasks, goal-specific Growth XP by explicit allocation (no duplication, 未归属 remainder), goal evidence (actions, attributed XP, last 30 days, unattributed), attribution editor; no XP changes, no AI.
- **M8 Personal development system** ✅: vision, development goals (weighted attributes, linked tasks/projects, activity-based progress), chosen focus vs measured growth, attribute pages, goal links in the task panel; no XP from goals, no AI.
- **M6.2 Growth RPG & rewards** ✅: Active / Growth / Level XP, level curve `round(100×1.08^(n−1))`, growth stages, lifetime vs spendable, reward store with mixed payment, level rewards with early claim, append-only reward ledger, zh-CN only.
- **M6 Character & XP** ✅: event → XP rules, append-only idempotent ledger with reversals (incl. new `milestone.reopened`), levels derived from the ledger, attributes credited through areas, radar, XP history, character page.
- **M7 Personal RPG dashboard** ✅: `/` shows level, stage and progress, the three XP currencies (lifetime vs spendable), growth radar, recent growth ranking and trend (7 / 30 / 90 days / all), growth focus, this week, next level reward, reward store preview and recent activity — a read model over the character, rewards and tasks modules.
- **M8 Recurring tasks, settings polish, JSON export, deployment (Dockerfile), E2E sweep, polish.**

**Phase 2**: activities & timer → skills & learning → goals → schedule blocks + internal
calendar → Google read-only import → controlled two-way sync → Outlook → CalDAV → skill XP → notes & documents.

**Phase 3**: fitness, nutrition & sleep, analytics read models, AI coach.

## 9. Decision log

See [`docs/decisions/`](./decisions).
