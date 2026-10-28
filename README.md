# Personal OS

A personal operating system: tasks, projects, calendar, learning, fitness and an RPG-style
character, built on one shared data model — **capture once, use everywhere**.

The UI is in Simplified Chinese (简体中文) only; every string still goes through the
translation catalogue (`messages/zh-CN`).

> **Status: JSON export** (branch `json-export`). 设置 › 通用 › 导出数据 downloads one JSON file
> with everything the user owns, for backup or a later move:
>
> - tasks with tags, dependencies and recurrences;
> - areas, projects and milestones;
> - attributes and the XP and 自制力 ledgers;
> - goals and plans;
> - rewards;
> - finance accounts and snapshots;
> - automation rules and history;
> - settings.
>
> Ids and history are kept, and values are written exactly as stored. The file contains no
> passwords, sessions or tokens. It is built on request and never uploaded. See ADR 0025 and
> [`docs/reports/json-export.md`](docs/reports/json-export.md).
>
> **Settings** (branch `settings`). 设置 › 通用 now has three cards: the display name, the
> time zone (any IANA zone, with the browser's zone suggested and a local-time preview) and the
> week start, and the theme. "Today", overdue checks, the dashboard, the Gantt week scale and the
> weekday pickers follow them. Recurring series and schedule rules keep the zone they were created
> in. See ADR 0024 and [`docs/reports/settings.md`](docs/reports/settings.md).
>
> **Recurring tasks** (branch `recurring-tasks`). A task can repeat (daily, weekly,
> monthly or yearly; on a fixed schedule or counted from completion). Each occurrence is an
> ordinary task; completing, skipping or failing it creates the next one, exactly once. Set it in
> the task panel's 「重复」 section. See ADR 0023 and
> [`docs/reports/recurring-tasks.md`](docs/reports/recurring-tasks.md).
>
> **Phase 1 integration** (branch `phase1-integration`). M0–M10.6 are integrated and
> verified together (see [`docs/reports/phase1-integration.md`](docs/reports/phase1-integration.md)).
> The AI advisor (M11) is **on hold**: it is kept on its own branches, not included here, and will
> be re-evaluated after deployment and real use. Previously:
>
> **M10.5 — 自制力 (Discipline).** A fixed growth attribute scores how planned tasks are
> carried out: a task whose deadline was set in advance earns +15 early, +10 on time, +3 late;
> −3 while overdue and −5 if marked failed (a new 已失败 status), 0 if cancelled — one net result
> per task, recorded in its own append-only history, never touching XP, levels or rewards. Overdue
> penalties are applied by the automation worker (see "Automation worker"). Previously: M10
> automation rules (`/automation`), M9.5 finance (`/finance`), the M7 dashboard (`/`) and the
> development system (`/development`). See [`docs/architecture.md`](docs/architecture.md) and
> [`docs/screenshots/`](docs/screenshots/README.md).

## Requirements

- Node.js **22+**
- pnpm **10** (`corepack enable` will pick the version pinned in `package.json`)
- Docker (for PostgreSQL), or your own PostgreSQL 16

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env.local
#    then set BETTER_AUTH_SECRET, e.g.:  openssl rand -base64 32

# 3. Start PostgreSQL (dev DB "personal_os" + test DB "personal_os_test" on port 5433)
pnpm db:up

# 4. Create the tables
pnpm db:migrate

# 5. Run the app
pnpm dev
```

Open <http://localhost:3000>, create an account at `/register`, and you land on the dashboard (`/`).

To close sign-up after creating your own account, set `AUTH_ALLOW_SIGNUP=false` in `.env.local`.

## Commands

| Command                             | What it does                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Start the dev server on <http://localhost:3000>                                                       |
| `pnpm build` / `pnpm start`         | Production build / serve it                                                                           |
| `pnpm db:up` / `pnpm db:down`       | Start / stop PostgreSQL in Docker                                                                     |
| `pnpm db:generate`                  | Generate a SQL migration after changing a schema in `src/modules/*/db`                                |
| `pnpm db:migrate`                   | Apply migrations to the dev database (`DATABASE_URL`)                                                 |
| `pnpm db:studio`                    | Browse the database with Drizzle Studio                                                               |
| `pnpm test`                         | All Vitest suites: unit, component (jsdom) and database integration                                   |
| `pnpm test:unit`                    | Unit + component tests only (no database needed)                                                      |
| `pnpm test:db`                      | Database integration tests (uses `TEST_DATABASE_URL`, migrates it automatically)                      |
| `pnpm test:e2e`                     | Builds the app and runs Playwright against it on port 3100 with the test DB                           |
| `pnpm lint`                         | ESLint, including module-boundary and no-hard-coded-text rules                                        |
| `pnpm typecheck`                    | TypeScript                                                                                            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                              |
| `pnpm i18n:check`                   | Translation coverage per namespace (fails on keys unknown to zh-CN); `--verbose` lists missing keys   |
| `pnpm check`                        | Lint + typecheck + format + i18n + all Vitest suites                                                  |
| `pnpm automation:worker`            | Automation worker: calls the tick endpoint every minute (needs `APP_URL`, `AUTOMATION_WORKER_SECRET`) |

First time running E2E tests on a new machine: `pnpm exec playwright install chromium`.

## Database checks

```bash
pnpm db:migrate     # apply pending migrations (forward-only)
pnpm db:integrity   # read-only: pending migrations, unvalidated constraints and 38 invariants;
                    # exits 1 on any violation. Uses DATABASE_URL.
```

The invariants are mostly that every cross-table reference stays within one user, plus domain
invariants (milestone in the task's project, status timestamps, 自制力 nets, XP reversals).

## Environment variables

| Variable                   | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`             | Dev database connection string                                                 |
| `TEST_DATABASE_URL`        | Test database (Vitest `db` project and Playwright)                             |
| `BETTER_AUTH_SECRET`       | Session signing secret, at least 32 characters                                 |
| `BETTER_AUTH_URL`          | Public URL of the app, e.g. `http://localhost:3000`                            |
| `AUTH_ALLOW_SIGNUP`        | `true` / `false` — allow creating new accounts                                 |
| `AUTOMATION_WORKER_SECRET` | Optional (M10). Enables the automation worker endpoint; at least 32 characters |

## Automation worker (scheduled rules)

Event-triggered automation rules run right after the change that triggers them. **Scheduled
rules run only when a worker calls the tick endpoint**; without one they are saved but not
executed, and the app says so (自动化 → 运行状态, and "等待后台 worker" on each scheduled rule).

```bash
# 1. In the app's environment (.env.local or the server's env):
AUTOMATION_WORKER_SECRET=$(openssl rand -hex 24)
# 2. Next to the running app (any machine that can reach it):
APP_URL=http://localhost:3000 AUTOMATION_WORKER_SECRET=<same secret> pnpm automation:worker
#    or from cron, once a minute:
#    * * * * * curl -fsS -X POST -H "Authorization: Bearer <secret>" http://localhost:3000/api/automation/tick
```

The worker runs due schedules, applies 自制力 overdue penalties (M10.5) (misfires: missed occurrences coalesce into the latest one if it is
at most 6 h late, otherwise recorded as missed) and processes pending events, and writes a
heartbeat; the health view reports the scheduler as running only with a heartbeat younger than
5 minutes. Details and guarantees: [ADR 0020](docs/decisions/0020-automation-engine.md).

## Project layout

```
docs/                 architecture.md and decision records
drizzle/              generated SQL migrations (committed)
messages/zh-CN/       translation catalogue (the only UI language)
src/app/              Next.js routes only
src/shell/            app chrome: sidebar, navigation config, auth screens, providers
src/server/           composition root: auth, tRPC root router, event-bus wiring, i18n request config
src/modules/<m>/      a module: domain/ (pure), db/ (tables), server/ (API), ui/ (components)
src/shared/           db client, events, i18n, tRPC, UI primitives
e2e/                  Playwright tests
```

### Adding a module (for later milestones)

1. Create `src/modules/<name>/{domain,db,server,ui}/index.ts`.
2. Tables in `db/` → export them from `src/server/db-schema.ts` → `pnpm db:generate`.
3. Router in `server/` → add it to `src/server/trpc/root.ts`.
4. Event handlers → register them in `src/server/event-bus.ts`.
5. Strings → `messages/zh-CN/<namespace>.json` (add the namespace to `src/shared/i18n/config.ts`
   and `src/shared/i18n/messages.ts`).
6. A real route in `src/app/(app)/…` replaces the placeholder for its navigation item.
