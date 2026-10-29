# 0026 — Docker Compose deployment for one machine

- Status: Accepted (Phase 1, Docker deployment preparation)
- Date: 2026-10-29

## Context

Phase 1 ends with "deployment (Dockerfile)". Until now Docker ran only the development database
(root `docker-compose.yml`, project `personal-os`). The app runs through `pnpm`. Migrations run
through `drizzle-kit migrate`. The automation worker (ADR 0020) is a process that calls
`POST /api/automation/tick` every minute.

## Decision

1. **One Dockerfile, two targets** sharing one build:
   - `runner`: the standalone Next.js server (`NEXT_OUTPUT=standalone`, set only in the image;
     local builds are unchanged). It runs as user `node` and has a `HEALTHCHECK`.
   - `tools`: the whole workspace with all dependencies, for one-off jobs. `drizzle-kit migrate`
     is the default command; `tsx scripts/db-integrity.ts` is the other job. Binaries are called
     directly, not through pnpm, so a job never needs the network at run time.
2. **`deploy/compose.yaml`**, project `personal-os-deploy`, separate from the development
   database's project and volume. Startup order:
   - `db`: Postgres 16 with volume `pgdata` and a `pg_isready` health check;
   - `migrate`: forward-only, runs on every `up` and must exit 0;
   - `app`: health check on `/api/health`;
   - `worker`: a shell loop calling the tick endpoint with `AUTOMATION_WORKER_SECRET`. It stays
     idle with a message when the secret is not set.

   `db`, `app` and `worker` restart `unless-stopped`.

3. **Exposure.** The app is published on `127.0.0.1:${APP_PORT}` only, and the database is not
   published. Production on the internet (TLS, domain, firewall, off-site backups) is a separate,
   manual step. It is documented but not done.
4. **`GET /api/health`.** Public. Answers `{status:"ok"}` when a `select 1` succeeds, otherwise 503. It reveals nothing about users.
5. **Configuration.**
   - `deploy/.env` (from `deploy/.env.example`, placeholders only) holds the database password,
     the auth secret and URL, the port, sign-up and the worker secret.
   - Compose refuses to start without the required values.
   - The server refuses secrets that still begin with `change-me`, or are shorter than 32
     characters. An empty worker secret means "not configured".
6. **Build without secrets.** `getSession` reads the request headers before creating the auth
   instance. Pages are therefore marked per-request before the runtime environment is read, and
   `next build` needs no `DATABASE_URL` or secrets.
7. **Optional `build_ca` BuildKit secret.** For networks that intercept TLS, such as corporate
   proxies, so dependency downloads can trust a local CA. It is never stored in the image.

## Consequences

- One command (`docker compose up -d --build`) starts everything in the right order. Data
  survives `down` and restarts; only `down -v` deletes it, and the guide warns about this.
- The `tools` image is large (about 2 GB, all dependencies), because it reuses the development
  migration path instead of adding a second one.
- Backups are manual: the JSON export (ADR 0025) and `pg_dump` (commands in the guide).
