# 0025 — Personal data export: one JSON file, built on request

- Status: Accepted (Phase 1, JSON export)
- Date: 2026-10-28

## Context

Phase 1 plans a JSON export (roadmap "M8 … JSON export"), so a user can keep a backup of
everything they entered and move it elsewhere later. The data spans every module:

- tasks and their link tables;
- areas;
- projects;
- the character ledgers;
- development;
- rewards;
- finance;
- automation.

Some link tables have no `user_id` of their own.

## Decision

1. **A read-only module, `data-export`.** Like the dashboard (ADR 0016), it owns no tables and no
   rules. It reads other modules' tables through their public `db` entry points. It does not live
   in `settings`: `tasks` and `automation` already depend on `settings`, and the export depends on
   every module.
2. **On request only.** `POST /api/export` builds the file for the session user and sends it as an
   attachment. The response is marked `Cache-Control: no-store`. Nothing is stored, queued,
   e-mailed or uploaded.
   - POST, not GET: with the SameSite=Lax session cookie, a link, a prefetch or another site
     cannot trigger it.
   - Signed out gets 401; other methods get 405.
   - A failure gets 500 with no detail. The server logs only the error name.
3. **Entry point.** The 导出数据 card on 设置 › 通用. It says what is and is not included. It
   reports success (toast, plus 上次导出 with the file name and record count) or failure (toast;
   nothing is saved). The browser saves the file through a temporary link, which works on phones
   too.
4. **One consistent snapshot.** Every table is read in one `REPEATABLE READ`, read-only
   transaction.
5. **Shape (version 1):**
   - `format: "personal-os-export"`, `version`, `generatedAt` (UTC), `timeZone`;
   - `conventions`: how values are written, stated in the file itself;
   - `excluded`: what is left out, and why;
   - `counts`: rows per table;
   - `user`: id, name, e-mail, verified flag, image and timestamps;
   - `data`, grouped by owning module: `settings`, `areas`, `tasks`, `projects`, `character`,
     `development`, `rewards`, `finance`, `automation`.

   Inside `data`:
   - Every row has all its columns, under camelCase names, so ids and references survive as they
     are.
   - Soft-deleted, archived, cancelled and failed records are included, with their timestamps.
   - So are history and ledger rows (XP, attribute credits, 自制力, rewards, snapshot revisions,
     automation executions).

6. **Values are written as stored:**
   - instants in ISO 8601 UTC;
   - dates as `YYYY-MM-DD` (no zone);
   - times as `HH:MM:SS`;
   - money and FX rates as exact decimal strings (amounts with 6 decimals, rates with 10);
   - `null` for "not set or unknown". A missing FX rate or base value stays `null`, never 0 or 1.
   - A row that was never created (for example the finance settings while the default applies) is
     `null`, and an empty table is `[]`.
7. **Scope and secrets.**
   - Every query filters on the session user's id. Link tables without `user_id` (task tags,
     contributions, goal links and allocations, plan tasks) are joined to their owning task, goal
     or plan.
   - Never exported: `accounts` (password hash, provider tokens), `sessions`, `verifications`, the
     internal automation event queue (each processed event is already in `executions`), and the
     system-wide worker heartbeat.
   - Before returning, the document is scanned for credential-like keys (`password`, `token`,
     `secret`, `credential`, `apiKey`, `privateKey`). If one is found, the export fails instead of
     sending.
8. **Kept complete by a test.** A test compares the latest migration snapshot's tables with the
   exported and excluded lists. A future table therefore fails CI until it is exported or excluded
   on purpose.

## Consequences

- One file per request, built in memory. Fine for personal volumes; very large histories would
  call for streaming.
- No import yet. Version 1 is the contract an import (or another tool) can rely on. Adding a
  field keeps the version; renaming or changing a meaning bumps it.
- Uploaded files do not exist yet, so the export has no attachments.
