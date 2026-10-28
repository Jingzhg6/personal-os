# Personal OS

A personal operating system: tasks, projects, calendar, learning, fitness and an RPG-style
character, built on one shared data model — **capture once, use everywhere**.

The UI is in Simplified Chinese (简体中文) only; every string still goes through the
translation catalogue (`messages/zh-CN`).

> **Status: M11 — AI 顾问 (AI advisor).** `/ai` reviews tasks, projects, goals, growth, finance
> completeness and automation health. App-computed facts are shown separately from AI
> interpretations. It also suggests priorities, goal plans, growth contributions and automation
> rules, and answers one-off questions. The AI only proposes: every change is shown first, needs
> your explicit approval, and is executed by the app's own services. AI is off unless configured
> (see "AI advisor"). Previously:
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

## Environment variables

| Variable                   | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Dev database connection string                                                  |
| `TEST_DATABASE_URL`        | Test database (Vitest `db` project and Playwright)                              |
| `BETTER_AUTH_SECRET`       | Session signing secret, at least 32 characters                                  |
| `BETTER_AUTH_URL`          | Public URL of the app, e.g. `http://localhost:3000`                             |
| `AUTH_ALLOW_SIGNUP`        | `true` / `false` — allow creating new accounts                                  |
| `AUTOMATION_WORKER_SECRET` | Optional (M10). Enables the automation worker endpoint; at least 32 characters  |
| `AI_PROVIDER`              | Optional (M11). `off` (default), `anthropic` or `mock` (tests only)             |
| `AI_API_KEY`               | Required for `anthropic`. Server-side only; never sent to the browser or logged |
| `AI_MODEL`                 | Optional. Default `claude-opus-5-5`                                             |
| `AI_BASE_URL`              | Optional. Default `https://api.anthropic.com`                                   |
| `AI_EFFORT`                | Optional. `low` / `medium` (default) / `high`                                   |
| `AI_TIMEOUT_MS`            | Optional. Provider timeout, default 60000 (5000–300000)                         |
| `AI_MAX_OUTPUT_TOKENS`     | Optional. Output budget per call, default 8000 (1000–16000)                     |
| `AI_DAILY_LIMIT`           | Optional. Calls per user per 24 h, default 30 (0 disables calls)                |
| `AI_PER_MINUTE_LIMIT`      | Optional. Calls per user per minute, default 5                                  |

## AI advisor (optional)

AI is **off** unless configured. When it is off, the 「AI 顾问」 pages say so; the review's facts,
which are computed by the app, still work.

```bash
# .env.local (server only — never commit a real key)
AI_PROVIDER=anthropic
AI_API_KEY=<your Anthropic API key>
# optional: AI_MODEL=claude-opus-5-5  AI_DAILY_LIMIT=30  AI_PER_MINUTE_LIMIT=5  AI_TIMEOUT_MS=60000
```

**What it does:**

- Every AI call is started by a button.
- Output is validated, and every id it names must belong to you.
- Changes are applied only after you approve them, through the same services as manual edits.

**What is sent:**

- Ids, titles, dates, statuses and counts of your tasks, projects, goals, attributes and rules.
- Finance completeness counts only (no amounts, balances, currencies, rates or account names).
- Never sent: passwords, sessions, e-mail addresses or ledgers.

**Costs:** each call is billed by the provider. The per-user limits above cap usage. The cost
estimate in the reports (about $0.01–0.23 per call) is an estimate, not a measurement.

**Verification status (M11.1):** no real model call has succeeded yet; no key was available.
Still unverified:

- that the API accepts the schemas;
- Chinese output quality;
- actual token usage and cost;
- latency.

Only the invalid-key error path was checked against the real API. Tests use a mock provider and
fakes.

**Verifying a real key** (M11.1):

- `AI_LIVE_VERIFY=auth pnpm ai:verify` makes one free call with a deliberately invalid key.
- `AI_LIVE_VERIFY=1 pnpm ai:verify` runs the bounded real smoke test against the test database.
  It needs `AI_PROVIDER=anthropic` and `AI_API_KEY` in `.env.local`, and empties the test database.
  - It makes 7 provider calls: 5 billable smoke generations and 2 refused checks.
  - With the adapter's single retry after a 429, 5xx or lost connection, the ceiling is 13 HTTP
    requests.
- Results (status codes, tokens and estimated cost; no content, no key) are written to
  `test-results/ai-live.json`. `pnpm test` never runs these.

**To disable:** set `AI_PROVIDER=off` (or remove it) and restart.

Tests and screenshots use `AI_PROVIDER=mock`, a deterministic stand-in labelled 模拟 in the UI;
its output is not AI. Details: [ADR 0022](docs/decisions/0022-ai-advisor.md) and
[`docs/reports/m11-ai-advisor.md`](docs/reports/m11-ai-advisor.md).

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
