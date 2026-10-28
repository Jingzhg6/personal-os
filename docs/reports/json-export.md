# Phase 1 — JSON export: report

- **Branch:** `json-export`
- **Base:** `a70c358` (`settings`, approved)
- **Design source:**
  - roadmap "M8 … JSON export";
  - `docs/architecture.md` §4 (module boundaries, `ctx.userId` scoping) and §5 (data model);
  - ADR 0004 (ids and time);
  - ADR 0016 (read-model modules);
  - ADR 0019 (money and FX).

  The decisions are recorded in **ADR 0025**.

- Nothing was merged or deployed, AI stays frozen, and the Docker stage was not started.

## What was built

| Part         | Details                                                                                                                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module       | `src/modules/data-export`: read-only, no tables. The **domain** has the format, version, conventions, exclusions, credential-key guard and file name. The **server** has `exportUserData(db, userId)`, one `REPEATABLE READ` read-only transaction over every owned table. The **UI** has `ExportDataCard`.                  |
| Endpoint     | `POST /api/export`. The session user only: anonymous gets 401, GET gets 405, an error gets 500 with no detail. The file is sent as an attachment (`personal-os-export-YYYY-MM-DD.json`, dated in the user's zone) with `no-store` and `nosniff`, plus the record count in `X-Export-Records`. Nothing is stored or uploaded. |
| Page         | 设置 › 通用 › **导出数据** says what is and is not included and has an 导出 JSON button. Success shows a toast and a lasting 上次导出 line (file and record count); failure shows a toast, nothing is saved and the button can be used again. The settings page got bottom room so a toast never hides the last card.        |
| No migration | —                                                                                                                                                                                                                                                                                                                            |

## File format (version 1)

```text
format        "personal-os-export"
version       1
generatedAt   ISO 8601 UTC
timeZone      the user's zone (null if never set)
conventions   how values are written (in the file itself)
excluded      tables deliberately left out, with the reason
counts        rows per table, e.g. "tasks.tasks": 42
user          id, name, email, emailVerified, image, createdAt, updatedAt
data
  settings     settings
  areas        areas
  tasks        statuses, tags, recurrences, tasks, taskTags, dependencies,
               developmentContributions, views
  projects     projects, milestones
  character    attributes, xpLedger, xpAttributeCredits, disciplineLedger
  development  profile, focus, goals, goalAttributes, goalTasks, goalProjects,
               goalAllocations, plans, planTasks
  rewards      rewards, levelRewards, ledger
  finance      settings, providers, accounts, snapshots, fxDefaults
  automation   rules, executions, effects, notifications
```

Excerpt of a real file, from the screenshot run's demo user:

```json
{
  "format": "personal-os-export",
  "version": 1,
  "generatedAt": "2026-10-28T21:07:13.934Z",
  "timeZone": "UTC",
  "data": {
    "tasks": {
      "tasks": [
        {
          "id": "01a18456-a0de-724f-9a7f-5f1611b17fc5",
          "title": "整理需求",
          "projectId": "01a18456-a0a3-7434-bd19-dde5c212d62c",
          "statusId": "01a18456-9db4-765f-880b-e699bd9cd9df",
          "isUrgent": null,
          "dueDate": "2026-10-30",
          "dueTime": null,
          "completedAt": null,
          "deletedAt": null,
          "plannedAt": "2026-10-28T21:07:12.217Z",
          "recurrenceId": null,
          "createdAt": "2026-10-28T21:07:12.210Z"
        }
      ]
    }
  }
}
```

Excerpt shortened; every column is in the file.

## Values

| Kind                                 | Written as                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Ids and references                   | UUID strings, unchanged, so the file can be re-linked                                               |
| Instants                             | ISO 8601 UTC (`…Z`)                                                                                 |
| Dates and times                      | `YYYY-MM-DD` without zone; due time `HH:MM:SS`                                                      |
| Money, FX rates                      | exact decimal strings as stored (`"1499.990000"`, `"0.1282000000"`); never floats, never rounded    |
| Missing FX                           | `fxRate: null`, `baseAmount: null`: never 0 or 1 (tested)                                           |
| Zero balance                         | `"0.000000"`, distinct from missing                                                                 |
| Snapshot history                     | every valuation date, with `revision` after corrections (tested)                                    |
| Not set                              | `null`; a never-created one-row record (finance settings, vision) is `null`; an empty table is `[]` |
| Deleted, archived, cancelled, failed | included, with their timestamps                                                                     |
| Rich text                            | the stored document (JSON) plus its plain text                                                      |

## Security

- Every query filters on the session user's id. The 7 link tables without `user_id` are joined to
  their owning task, goal or plan.
- Never exported: `accounts` (password hash, provider tokens), `sessions` (tokens, IP, user agent)
  and `verifications`. The `user` block lists its columns explicitly.
- Also not exported: the automation event queue (internal; each processed event is in
  `executions`) and the system-wide worker heartbeat.
- Before sending, the document is scanned for credential-like keys. If any is found, the export
  fails instead of leaking.
- POST plus the SameSite=Lax cookie: a link, a prefetch or another site cannot start an export.
  The file never leaves the user's browser.

## Tests

| Command                                                 | Result                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                            | ✅ exit 0. 44 files, **465 passed** (457 before)                                                                         |
| `pnpm build`                                            | ✅ exit 0 (`ƒ /api/export`)                                                                                              |
| `pnpm test:e2e`                                         | ✅ exit 0. **126 passed** of 126 (122 before), none skipped                                                              |
| `pnpm db:integrity`                                     | ✅ 40/40 on the dev database, the test database after e2e and a freshly migrated `personal_os_verify` (no new migration) |
| `pnpm screenshots e2e/screenshots/json-export.shots.ts` | ✅ 5 screenshots (real downloads on desktop and phone)                                                                   |

New tests:

- `data-export/domain/export.test.ts` (3):
  - the credential-key guard at any depth, with ordinary keys and values ignored;
  - the file name dated in the user's zone (a date boundary across zones);
  - record totals.
- `src/server/data-export.db.test.ts` (5):
  - **Coverage:** the schema's tables (latest migration snapshot) equal the exported plus excluded
    lists, so a new table fails until it is handled.
  - **Completeness:** data made through the real routers in every module. Each section's count
    equals the database count for the user and is non-empty. The JSON round-trips. Ids, links, a
    skipped recurrence instance, the XP ledger, a reward purchase and an automation execution are
    all present. Money is exact, a missing FX rate is null, and a corrected snapshot has revision 2.
  - **Isolation and secrets:** two users each export only their own data. Planted password hash,
    session token, access token, verification value and IP never appear.
  - **Empty account:** sections exist but are empty or null; nothing is fabricated.
  - **Unknown user:** refused.
- `e2e/data-export.spec.ts` (4):
  1. A real download is parsed: format, user, task, a CNY snapshot without rate (`fxRate: null`),
     no credential keys, the toast and 上次导出.
  2. A server failure shows an error toast and no download.
  3. Anonymous POST gives 401 and GET gives 405. The shared e2e user's export contains nothing of
     the test user, and the response is `no-store`.
  4. iPhone 13: the button is reachable, there is no horizontal overflow, and a tap downloads the
     file.

## Screenshots

`docs/screenshots/json-export/`:

1. `01-export-card.png`
2. `02-export-done.png`
3. `03-export-failed.png`
4. `04-mobile-export.png` (phone)
5. `05-dark-export.png` (dark)

All five were reviewed. On the first capture, the success toast covered the 上次导出 line on
desktop and phone. The settings page now has bottom room, and those two shots are taken after
closing the toast.

## Known limitations

- **No import.** Version 1 is the contract a future import or another tool can rely on.
- **Built in memory per request.** This suits personal data volumes; very large histories would
  need streaming.
- **No scheduled or automatic backups**, and no encryption or password on the file. The user keeps
  the downloaded file safe.
- **Not in the file:**
  - attachments: uploaded files do not exist yet;
  - the per-device theme (stored in the browser);
  - the automation event queue (processed events are in `executions`).
- **Default finance settings:** while the default base currency (EUR) applies, `finance.settings`
  is `null`. Each snapshot still carries its own base currency.
- **AI migration:** the frozen AI branch's tables are not on this branch. If AI is resumed, the
  coverage test will require its tables to be exported or excluded.
