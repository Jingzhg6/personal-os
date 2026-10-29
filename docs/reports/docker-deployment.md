# Phase 1 — Docker deployment preparation: report

- **Branch:** `docker-deployment`
- **Base:** `e0b8c93` (`json-export`, approved)
- **Decisions:** ADR 0026
- **Guide:** [`docs/deployment.md`](../deployment.md), in Chinese, for non-developers.
- **Scope:** local development and Docker verification only.
  - **No production deployment:** no server, no domain, nothing on the internet, no paid service.
  - Nothing was merged; AI stays frozen.

## Three ways to run

|                                | Files                                                                                      | Status                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| **Local development**          | root `docker-compose.yml` (database only, project `personal-os`), `.env.local`, `pnpm dev` | unchanged                                                  |
| **Docker on one machine**      | `Dockerfile`, `deploy/compose.yaml` (project `personal-os-deploy`), `deploy/.env`          | **built and verified in real containers**                  |
| **Production on the internet** | needs a server, a domain, HTTPS and off-site backups                                       | **not done**; the manual steps are listed in the guide §七 |

## What was there

- `pnpm build` / `pnpm start` ran the app.
- `drizzle-kit migrate` ran the migrations (forward only).
- The automation worker was `pnpm automation:worker`, a `tsx` loop calling
  `POST /api/automation/tick` with `AUTOMATION_WORKER_SECRET`. It drives scheduled rules, the
  自制力 overdue sweep and pending events.
- Docker ran only the development database.

## What was built

| Part                  | Details                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`          | Base `node:22-alpine`, multi-stage, frozen lockfile. Target **`runner`**: Next.js standalone server, user `node`, port 3000, `HEALTHCHECK` on `/api/health`, 339 MB. Target **`tools`**: full workspace for `drizzle-kit migrate` (default command) and `tsx scripts/db-integrity.ts`, 1.99 GB. Optional `build_ca` BuildKit secret for TLS-intercepting networks (not stored in the image).                |
| `.dockerignore`       | No `.env*` (except examples), `node_modules`, `.next`, `.git`, test output or screenshots in the build context.                                                                                                                                                                                                                                                                                             |
| `deploy/compose.yaml` | Order: **db** (Postgres 16, volume `pgdata`, `pg_isready`) → **migrate** (one-off, must exit 0) → **app** (`/api/health`, `127.0.0.1:${APP_PORT}` only) → **worker** (tick every 60 s, idle with a message without a secret). db, app and worker restart `unless-stopped`; the app gets 20 s for a graceful stop. Missing required values stop Compose with a clear message. The database is not published. |
| `deploy/.env.example` | Placeholders only (`change-me…`), with the rules for each value. The root `.env.example` now says it is for development.                                                                                                                                                                                                                                                                                    |
| `GET /api/health`     | `{"status":"ok"}` after a `select 1`, else 503. Public; reveals nothing about users.                                                                                                                                                                                                                                                                                                                        |
| `docker/worker.sh`    | The worker loop (busybox `wget`, no extra dependencies).                                                                                                                                                                                                                                                                                                                                                    |
| Startup validation    | `src/instrumentation.ts` validates the environment once when the server starts. `BETTER_AUTH_SECRET` and `AUTOMATION_WORKER_SECRET` may not keep the `change-me` example values or be shorter than 32 characters. An empty worker secret means "not configured".                                                                                                                                            |
| Build without secrets | `getSession` reads the request headers before creating the auth instance, so `next build` needs no runtime environment.                                                                                                                                                                                                                                                                                     |
| Docs                  | ADR 0026; `docs/deployment.md` (Chinese: install, configure, start, daily use, backup and restore, troubleshooting, production checklist); README section and status; architecture §5.2.12 and roadmap.                                                                                                                                                                                                     |

## Problems found by running real containers (all fixed)

1. **The build needed runtime secrets.** `next build` failed in the image ("Invalid environment
   variables") because `getSession` created the auth instance before `headers()`. On developer
   machines `.env.local` had hidden this. Fixed by reading the headers first.
2. **The migration job needed the network.** The `tools` image ran `pnpm` as user `node`. pnpm had
   been fetched under root's cache, so corepack tried to download it at run time and failed. Fixed:
   jobs call `node_modules/.bin` directly, with no pnpm and no network at run time.
3. **The deployment shared the development database's volume.** Both Compose projects were named
   `personal-os`, so the deployment attached to the existing development volume
   `personal-os_pgdata` (created 2026-10-24) and failed authentication.
   - Nothing was written to it.
   - The volume was kept: `down` without `-v`.
   - The deployment is now project `personal-os-deploy`, with its own volume.
4. **The worker showed "unhealthy".** It inherited the image's web health check. Disabled for that
   service.
5. **A placeholder secret was refused, but silently.** The health check failed with no reason in
   the log. Startup validation now prints, for example:
   `✖ BETTER_AUTH_SECRET still has the example value; generate one with: openssl rand -hex 32`.

## Docker verification (Docker 29.9.2, Compose v5.6.1)

The Docker daemon was not running in this session's container; it was started locally
(`dockerd`). Images came from Docker Hub (`postgres:16-alpine`, `node:22-alpine`).

This sandbox intercepts TLS. Builds therefore used the optional `build_ca` secret with the sandbox
CA, through a verification-only override file that is not committed. With that secret alone,
`docker compose … build --no-cache` succeeded on the default network. On a normal network the
documented `docker compose up -d --build` needs nothing extra.

Verification used `APP_PORT=3100` and freshly generated random secrets. The env files are not in
the repository.

| Check                                                                                     | Result                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start order                                                                               | db healthy → migrate `Exited (0)` → app healthy → worker up. With a broken migration (first attempt), the app correctly **did not start**.                                                                                                                         |
| Fresh install (`down -v` of the verification stack, then `up -d --build`)                 | ✅ 18 s with the build cache; 17 migrations applied; `/api/health` `{"status":"ok"}`; `/login` 200; `/` signed out → 307 to `/login`; database not published (`:0`).                                                                                               |
| Migrations on later starts                                                                | ✅ migrate runs on every `up` and exits 0 (no-op).                                                                                                                                                                                                                 |
| Integrity inside the container                                                            | ✅ `tsx scripts/db-integrity.ts` in `tools`: 40/40 on the fresh database (0 users) and 40/40 after both e2e runs (29 users).                                                                                                                                       |
| **Full e2e suite against the containers** (Playwright reusing the container on port 3100) | Worker **off**: ✅ **126/126**. Worker **on**: 108 passed, 2 failed (and their 2 serial follow-ups skipped) only because those tests expect the e2e default of no worker. The pages correctly said "计划调度运行中（最近一次：07:29）" and "后台 worker 正在运行". |
| Recurring tasks                                                                           | ✅ completing a daily task created the next instance (due 10-30) in the container; `recurring-tasks.spec` passed against the containers.                                                                                                                           |
| Automation worker                                                                         | ✅ a one-time rule due at 07:36 UTC: the worker tick at `07:36:29Z` reported `"executed":1`; the notification "容器里的定时规则已执行" exists and `lastTriggeredAt 07:36:29`. Screenshots 03–04 show the same through the UI.                                      |
| JSON export                                                                               | ✅ `POST /api/export` from the container: 200, `attachment; filename="personal-os-export-2026-10-29.json"`, `no-store`, 31 records, valid version-1 JSON, no credential keys; `data-export.spec` passed against the containers.                                    |
| Persistence                                                                               | ✅ users, tasks, executions, snapshots and migrations were `14\|186\|2\|10\|17` before, after `docker compose restart`, and after `down` + `up` (volume kept). The signed-in user still saw the same 2 tasks.                                                      |
| Crash recovery                                                                            | ✅ `kill -9` of the server process from the host: Docker restarted it (`RestartCount=1`), health ok again. (`docker kill` counts as a manual stop, so `unless-stopped` does not restart it — expected Docker behaviour.)                                           |
| Backup and restore (guide commands)                                                       | ✅ `pg_dump -Fc` (228 KB); then all 392 tasks were deleted to simulate a loss; `pg_restore --clean --if-exists` restored everything (`29\|392\|313\|21\|15` before and after); health ok, integrity 40/40.                                                         |
| Placeholder secret                                                                        | ✅ the server refuses to serve; the log names the variable and how to generate one.                                                                                                                                                                                |
| Exposure                                                                                  | App on `127.0.0.1` only; database not published; the app and the one-off jobs run as the unprivileged `node` user.                                                                                                                                                 |

Cleanup: the verification stack, its volume and the verification env files were removed. The
development volume `personal-os_pgdata` was never deleted.

## Required acceptance (host)

| Command             | Result                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm check`        | ✅ exit 0. 45 files, **467 passed** (465 before; +2 environment tests)                      |
| `pnpm build`        | ✅ exit 0 (`/api/health` added)                                                             |
| `pnpm test:e2e`     | ✅ exit 0. **126 passed** of 126                                                            |
| `pnpm db:integrity` | ✅ 40/40 on the dev database, the test database and a freshly migrated `personal_os_verify` |

## Screenshots (from the containers)

`docs/screenshots/docker-deployment/`, captured by `e2e/screenshots/docker-deployment.shots.ts`
while Playwright reused the container on port 3100:

1. `01-dashboard.png`
2. `02-tasks-recurring.png`: the next occurrence was made in the container.
3. `03-automation-worker.png`: 计划调度 运行中, and the rule 成功.
4. `04-rule-run-by-worker.png`: the execution record of the worker's run.
5. `05-settings-export.png`: 上次导出, 32 条记录.
6. `06-mobile-dashboard.png` (phone)

All six were reviewed. Terminal evidence is quoted in the table above.

## Still to do by hand

- Install Docker Desktop (or Docker Engine) on the machine that will run it.
- Create `deploy/.env` from `deploy/.env.example` with three random values, as the guide shows.
- After registering, set `AUTH_ALLOW_SIGNUP=false` and run `docker compose up -d` again.
- Keep backups (JSON export and `pg_dump`) somewhere other than this machine.
- **For the internet** (not done): a server, a domain, HTTPS through a reverse proxy, a firewall,
  automatic off-site backups, and `BETTER_AUTH_URL=https://…`. Review before doing it.

## Known limitations

- The `tools` image is about 2 GB (all dependencies), because it reuses the development migration
  path. The first build takes several minutes.
- Single machine, single app instance. No HTTPS, no reverse proxy, no automatic backups.
- No published images: users build locally (`--build`).
- The Windows PowerShell secret command in the guide was not run here (Linux sandbox).
- The local development `docker-compose.yml` is unchanged (project `personal-os`). The deployment
  is deliberately a separate project and volume.
