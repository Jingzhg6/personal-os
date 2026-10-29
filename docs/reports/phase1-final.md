# Phase 1 — final integration and acceptance

- **Branch:** `phase1-final`
- **Base:** `3db5f1e` (`docker-deployment`, approved)
- **Date:** 2026-10-29
- **Verdict: Phase 1 passes final acceptance** for running on one machine with Docker.
  - The production deployment to the internet has **not** been done. It needs the manual steps and
    checklist below.
  - Nothing was merged into `main`, deployed, bought or published. AI stays frozen.

## 1. Integration of the stages

The five stage branches form one linear history: each is an ancestor of the next. Integrating
them in dependency order therefore needs **no merge commits and no rewritten history**. All
branches stay as they are on `origin`.

| Order | Branch               | Commit      | Contents                                                      |
| ----- | -------------------- | ----------- | ------------------------------------------------------------- |
| 1     | `phase1-integration` | `08450c1`   | M0–M10.6 integrated and verified; `db:integrity`              |
| 2     | `recurring-tasks`    | `6738986`   | recurring tasks (ADR 0023), migration `0016_task_recurrences` |
| 3     | `settings`           | `a70c358`   | display name, time zone, week start (ADR 0024)                |
| 4     | `json-export`        | `e0b8c93`   | personal data export (ADR 0025)                               |
| 5     | `docker-deployment`  | `3db5f1e`   | Docker Compose deployment (ADR 0026)                          |
| 6     | **`phase1-final`**   | this branch | final fixes and acceptance (below)                            |

- `origin/main` (`93b2f68`) is an ancestor of this branch: the 23 stage commits up to `3db5f1e`, plus this stage's commit, are not on `main` yet.
- The AI branches (`m11-ai-advisor`, `m11-1-real-provider-verification`) are **not** in this
  history. No AI code, configuration, dependency or migration is on this branch: a search for
  advisor or AI code finds only Postgres advisory locks.

## 2. Migrations and migration history

- Migrations are `0000`–`0016`, contiguous: 17 SQL files, 17 snapshots, 17 journal entries.
- On every database built by this code, the applied history **equals** the files, compared by
  hash: dev, `personal_os_verify`, the new clean `personal_os_final`, the new clean
  `personal_os_final_test`, and the Docker volume.
- **Fixed in this stage:** `db:integrity` used to compare only counts (`applied ≥ journal`).
  That hid a migration applied from another branch. It now compares hashes, and fails both on
  pending migrations and on applied migrations this code does not contain.
- **The old test database** (`personal_os_test`) still carries the frozen AI branch's migration
  and its `ai_proposals` and `ai_requests` tables, from the M11 work. The new check reports this
  as `FAIL applied migrations not in this code: 1`; all data invariants pass there.
  - It was **not** reset or edited, because migrations are forward-only and databases are never
    reset.
  - Every test also passed on a new clean test database (below).
  - Recreating `personal_os_test` is optional and the owner's decision. Tests migrate it
    automatically.
- **Recorded for later:** the AI migration's journal timestamp (`1793192016916`) is older than
  `0016_task_recurrences` (`1793216616727`). Drizzle applies only migrations newer than the last
  applied one, so reviving AI with its old file would skip it silently. Its migration must be
  regenerated with a new number and timestamp (architecture §8, M11).

## 3. Changes in this stage

No new features, and no application code under `src/` changed.

| Change                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/db-integrity.ts`: migration history by hash | finds pending and foreign migrations (above)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `e2e/worker-mode.ts`; automation and 自制力 tests    | the two tests that failed in Docker expected "no worker". The expected worker state is now declared (`E2E_AUTOMATION_WORKER`, default `off`) and asserted exactly. Test 10 has one version per deployment: **no worker** (endpoint off, the rule waits, a manual check runs it once) and **worker running** (endpoint refuses without the secret, the worker runs it by itself exactly once, a manual check finds nothing). Each runs where it applies, and the other is skipped with that reason. |
| `.gitattributes`                                     | `*.sh` and `Dockerfile` keep LF on Windows checkouts, so `worker.sh` cannot break under `core.autocrlf`                                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/deployment.md`                                 | Windows review (§6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| README, architecture                                 | worker mode for e2e; the new integrity check; the AI migration rule                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 4. Test results

All runs are on the final code.

| Check                                                                            | Result                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean database: create, migrate, integrity                                       | ✅ `personal_os_final`: 17/17 migrations, 41/41 checks                                                                                                              |
| `pnpm check` (lint, types, format, i18n, all Vitest)                             | ✅ **467/467** on the default test database and ✅ **467/467** on the new clean test database                                                                       |
| `pnpm build`                                                                     | ✅                                                                                                                                                                  |
| `pnpm test:e2e` (host, no worker)                                                | ✅ **126 passed**, 1 skipped (the worker-running variant), 0 failed, on the default test database and again on the clean one                                        |
| `pnpm db:integrity`                                                              | ✅ 41/41: dev, `personal_os_verify`, `personal_os_final`, `personal_os_final_test`, Docker volume. ⚠️ `personal_os_test`: 40/41, the foreign AI migration only (§2) |
| E2E against the **containers**, worker running (`E2E_AUTOMATION_WORKER=running`) | ✅ **126 passed**, 1 skipped (the no-worker variant), 0 failed. Before the fix: 2 failed.                                                                           |
| E2E against the **containers**, worker off                                       | ✅ **126 passed**, 1 skipped (the worker-running variant), 0 failed                                                                                                 |

## 5. Docker on the final code

Docker 29.9.2 and Compose v5.6.1, with the daemon started in this sandbox.
`docker compose … build --no-cache` took 150 s; the sandbox needs the optional `build_ca` secret
(ADR 0026).

| Check                                             | Result                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh start (empty volume)                        | ✅ 19 s: db healthy → migrate `Exited (0)` → app healthy → worker up; health `{"status":"ok"}`; integrity 41/41                                                              |
| Recurring task                                    | ✅ completing a daily task created the next one (10-30)                                                                                                                      |
| Automation                                        | ✅ a one-time rule ran at the worker's `09:04:54Z` tick (`"executed":1`), and its notification exists. The e2e worker test passed (run by the worker in 54 s, exactly once). |
| JSON export                                       | ✅ 200, `no-store`, 31 records, version 1, no credential keys                                                                                                                |
| Persistence                                       | ✅ `40\|602\|484\|33\|33\|17` (users, tasks, XP, snapshots, executions, migrations) identical after `restart` and after `down` + `up`; the user stays signed in              |
| Crash                                             | ✅ `kill -9` of the server: Docker restarted it (`RestartCount=1`), health ok                                                                                                |
| Backup and restore (new guide commands, verbatim) | ✅ the dump was a valid `PGDMP` file (275 KB). All 602 tasks were deleted, then restored with `pg_restore` (exit 0); counts identical; integrity 41/41                       |
| Placeholder secret                                | ✅ refused: `✖ BETTER_AUTH_SECRET still has the example value…`                                                                                                              |
| Exposure                                          | ✅ app on `127.0.0.1` only; database not published; the app and jobs run as `node`                                                                                           |

The verification stacks, volumes and secret files were removed afterwards. The development
volume `personal-os_pgdata` was not touched.

Screenshots: the six container screenshots in `docs/screenshots/docker-deployment/` still show
the final UI, because no UI code changed since they were taken.

## 6. Windows review of the deployment guide

Problems found and fixed in `docs/deployment.md`:

| Problem                                                                                                                                 | Fix                                                                                                                                  | Verified                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Backup used `> file` and restore used `< file`. Windows PowerShell 5.1 re-encodes `>` output as UTF-16 (a corrupt dump) and has no `<`. | `pg_dump -f` inside the container, plus `docker compose cp` in both directions                                                       | ✅ (Linux, same Docker CLI)  |
| `sh -c '… "$POSTGRES_USER" …'`: PowerShell 5.1 mangles embedded double quotes                                                           | no inner quotes (`$POSTGRES_USER` is expanded in the container)                                                                      | ✅                           |
| No `openssl` on Windows; the PowerShell one-liner was unverified                                                                        | random secrets through Docker (`docker run --rm node:22-alpine node -e …`), identical everywhere; `openssl` kept for macOS and Linux | ✅                           |
| `.env` saved by Notepad with CRLF                                                                                                       | Compose reads CRLF `.env` correctly                                                                                                  | ✅ (tested with a CRLF file) |
| Hidden extensions (`.env.txt`)                                                                                                          | open with `notepad .env` from the same PowerShell; troubleshooting entry with `dir -Force`                                           | ⚠️ not run on Windows        |
| `worker.sh` with CRLF after `git clone` on Windows                                                                                      | `.gitattributes` keeps LF                                                                                                            | ✅ (rule in the repository)  |
| Paths with spaces; WSL 2; starting Docker Desktop at login                                                                              | added to the guide                                                                                                                   | ⚠️ not run on Windows        |

Every command is now marked ✅ (run here on Linux with real Docker, same Compose file) or ⚠️
(Windows-only, not run on a real Windows machine).

## 7. What the owner still has to do

1. Install Docker Desktop on the computer that will run Personal OS (on Windows, accept WSL 2).
2. Follow `docs/deployment.md` §一–三:
   - `cd deploy`;
   - `cp .env.example .env`;
   - generate three secrets;
   - edit `.env`;
   - `docker compose up -d --build`.
3. Register your account, set `AUTH_ALLOW_SIGNUP=false`, and run `docker compose up -d`.
4. Make backups (JSON export plus the `pg_dump` commands in §五) and keep them on another device.
5. Optional: recreate the old test database `personal_os_test` to remove the AI leftovers (§2).
6. Decide when to merge `phase1-final` into `main` (not done).

## 8. Checklist before a production deployment (not done)

- [ ] A server or NAS you control, with Docker, automatic security updates and a non-root user.
- [ ] A domain name, and **HTTPS** through a reverse proxy (Caddy or Nginx) in front of `app`.
- [ ] `BETTER_AUTH_URL=https://<domain>`. The app keeps listening on `127.0.0.1` behind the proxy.
- [ ] Firewall: only 80 and 443 open (plus SSH, restricted). The database stays unpublished.
- [ ] New random values for `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET` and
      `AUTOMATION_WORKER_SECRET`, never reused from testing. `deploy/.env` readable only by its
      owner.
- [ ] `AUTH_ALLOW_SIGNUP=false` once your account exists.
- [ ] **Automatic, off-site backups** (scheduled `pg_dump` plus copying elsewhere), and one
      restore actually tested.
- [ ] Monitoring of `/api/health` and disk space; `docker compose logs` checked after updates.
- [ ] Update procedure: back up → pull new code → `docker compose up -d --build` → check
      `docker compose ps` and health.
- [ ] Run `db:integrity` in the `tools` container after the first start and after updates
      (`docker compose run --rm migrate tsx scripts/db-integrity.ts`).
- [ ] AI Advisor stays off (frozen). Reviving it needs its own review, a new migration (§2) and
      a cost decision.

## 8a. Fix after acceptance: Docker build from a fresh download

- **Symptom:** the first Windows installation from the `phase1-final` ZIP failed at
  `COPY --from=build /app/public ./public` with `"/app/public": not found`.
- **Cause:**
  - `public/` holds no files, and Git does not store empty folders, so a clone or ZIP has no
    `public/`.
  - All earlier image builds used the working copy, where the empty folder existed. That is why
    they did not show the problem.
- **Fix:** the `Dockerfile` build stage runs `mkdir -p public`.
- **Verified:** I reproduced the failure from a clean copy of `a569811` (`git archive`, the same
  content as the GitHub ZIP). With the fix, `docker compose up -d --build` from that clean copy
  built and started in 135 s: migrate `Exited (0)`, app and db healthy, health ok, login 200,
  worker ticking.
- **Lesson for future checks:** build images from a clean export of the commit, not from a
  working copy.

## 9. Known limitations

- Single machine, single app instance. No HTTPS, reverse proxy or automatic backups in the
  repository.
- The `tools` image is about 2 GB, and the first build takes minutes. No published images, so
  users build locally.
- Windows-specific steps were reviewed, but not run on a real Windows machine (marked ⚠️).
- E2E tests depend on the worker state of the deployment under test. `E2E_AUTOMATION_WORKER`
  must match it (default `off`); a mismatch fails loudly, it is never ignored.
- The old local test database keeps the frozen AI migration until the owner recreates it.
- Outside Phase 1's scope: data import, reminders, calendar sync and file attachments (Phase 2+).
  AI is frozen.
