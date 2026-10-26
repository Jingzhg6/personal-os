# Personal OS

A personal operating system: tasks, projects, calendar, learning, fitness and an RPG-style
character, built on one shared data model — **capture once, use everywhere**.

The UI is in Simplified Chinese (简体中文) by default; English and French are supported
through the same translation system.

> **Status: M2 — Task views.** On top of M0–M1 (tasks, areas, statuses, tags): search,
> filters and sorting (shareable via the URL), drag-to-reorder, keyboard shortcuts (press `?`),
> a Trash, re-parenting, the 工作 / 业务 / 行政任务 / 个人生活 views and 重要截止日期. Other
> modules show a “即将推出” placeholder until their milestone. See [`docs/architecture.md`](docs/architecture.md).

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

Open <http://localhost:3000>, create an account at `/register`, and you land on the dashboard.

To close sign-up after creating your own account, set `AUTH_ALLOW_SIGNUP=false` in `.env.local`.

## Commands

| Command                             | What it does                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Start the dev server on <http://localhost:3000>                                                     |
| `pnpm build` / `pnpm start`         | Production build / serve it                                                                         |
| `pnpm db:up` / `pnpm db:down`       | Start / stop PostgreSQL in Docker                                                                   |
| `pnpm db:generate`                  | Generate a SQL migration after changing a schema in `src/modules/*/db`                              |
| `pnpm db:migrate`                   | Apply migrations to the dev database (`DATABASE_URL`)                                               |
| `pnpm db:studio`                    | Browse the database with Drizzle Studio                                                             |
| `pnpm test`                         | All Vitest suites: unit, component (jsdom) and database integration                                 |
| `pnpm test:unit`                    | Unit + component tests only (no database needed)                                                    |
| `pnpm test:db`                      | Database integration tests (uses `TEST_DATABASE_URL`, migrates it automatically)                    |
| `pnpm test:e2e`                     | Builds the app and runs Playwright against it on port 3100 with the test DB                         |
| `pnpm lint`                         | ESLint, including module-boundary and no-hard-coded-text rules                                      |
| `pnpm typecheck`                    | TypeScript                                                                                          |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                            |
| `pnpm i18n:check`                   | Translation coverage per namespace (fails on keys unknown to zh-CN); `--verbose` lists missing keys |
| `pnpm check`                        | Lint + typecheck + format + i18n + all Vitest suites                                                |

First time running E2E tests on a new machine: `pnpm exec playwright install chromium`.

## Environment variables

| Variable             | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `DATABASE_URL`       | Dev database connection string                      |
| `TEST_DATABASE_URL`  | Test database (Vitest `db` project and Playwright)  |
| `BETTER_AUTH_SECRET` | Session signing secret, at least 32 characters      |
| `BETTER_AUTH_URL`    | Public URL of the app, e.g. `http://localhost:3000` |
| `AUTH_ALLOW_SIGNUP`  | `true` / `false` — allow creating new accounts      |

## Project layout

```
docs/                 architecture.md and decision records
drizzle/              generated SQL migrations (committed)
messages/<locale>/    translation catalogues; zh-CN is the source of truth
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
