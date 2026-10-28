# Phase 1 — Settings: report

- **Branch:** `settings`
- **Base:** `6738986` (`recurring-tasks`, approved), on top of `phase1-integration` / `08450c1`
- **Design source:**
  - `docs/architecture.md` §5.2 (`user_settings`: `locale`, `time_zone`, `week_starts_on`);
  - ADR 0004 (time zone stored per user);
  - ADR 0015 (zh-CN only);
  - ADR 0016 (dashboard periods);
  - ADR 0020 §8 and ADR 0023 (zones fixed on schedule rules and recurring series).

  The decisions are recorded in **ADR 0024**.

- Nothing was merged or deployed, AI stays frozen, and the JSON export stage was not started.

## What was there, what was missing

| Setting               | Before                                                      | Now                                                                      |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Theme                 | 通用 tab (per device)                                       | unchanged                                                                |
| Areas, statuses, tags | own tabs                                                    | unchanged                                                                |
| Time zone             | detected once at sign-up; **no way to change it**           | editable, with the browser's zone suggested and the local time previewed |
| Week start            | stored (Monday) and read by the dashboard; **not editable** | editable; also drives the Gantt week scale and the weekday picker order  |
| Display name          | set at sign-up only                                         | editable (`settings.updateProfile`)                                      |
| Language              | zh-CN only (ADR 0015)                                       | unchanged: no switch                                                     |

No new table and no migration.

## What was built

| Part        | Details                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API         | `settings.updateProfile({ name })`: trimmed, 1–100 characters, updates `users.name` for `ctx.userId` only. `settings.get` / `settings.update` as before (IANA zone validated with `Intl`, week start 0–6).                                                                                         |
| Page        | 设置 › 通用 has three cards: 个人资料 (name; e-mail read-only), 时区与日期 (zone list grouped by region with UTC offsets, 当前时间 preview, 使用浏览器时区, note on fixed zones; week start) and 外观. Errors are shown as toasts through `errors.*`, and an empty name is shown inline.           |
| Propagation | Saving refetches every query and refreshes the server render. "Today" comes from the next-intl zone; the week start comes from `PreferencesProvider` in the app layout (`useWeekStartsOn`, `useWeekdayOrder`).                                                                                     |
| Week start  | Dashboard 本周 (as before). The Gantt week labels and window start (`startOfWeek` / `timelineWindow` gained an optional `weekStartsOn`, Monday by default). The order of the weekday buttons in the recurrence and schedule editors.                                                               |
| Fixed zones | Recurring series and schedule rules keep the zone they were created in. The schedule editor showed the settings zone, or the **browser's** zone when unset, while the server used the rule's own zone or UTC. It now shows the zone the server uses: the rule's, then the settings zone, then UTC. |

## Consistency across modules

| Module                            | Reads                       | After a change of zone or week start                                               |
| --------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| Tasks (lists, matrix, due states) | zone (next-intl "today")    | immediately (server re-render + refetch)                                           |
| Recurring tasks                   | series zone (ADR 0023)      | unchanged for existing series; new series take the new zone (tested)               |
| Automation schedules              | rule zone (ADR 0020)        | unchanged, also when the rule is edited (tested); the editor shows the rule's zone |
| 自制力 / overdue sweep            | user zone at check time     | deadlines judged in the new zone from the next check                               |
| Dashboard 本周, growth periods    | zone + week start           | immediately (tested with UTC+14 and week starts Mon / Sun / Sat)                   |
| Development, finance "today"      | zone                        | immediately                                                                        |
| Gantt                             | zone ("today") + week start | immediately                                                                        |

## Tests

| Command                                              | Result                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                         | ✅ exit 0. 42 files, **457 passed** (448 before)                                                                         |
| `pnpm build`                                         | ✅ exit 0                                                                                                                |
| `pnpm test:e2e`                                      | ✅ exit 0. **122 passed** of 122 (117 before), none skipped                                                              |
| `pnpm db:integrity`                                  | ✅ 40/40 on the dev database, the test database after e2e and a freshly migrated `personal_os_verify` (no new migration) |
| `pnpm screenshots e2e/screenshots/settings.shots.ts` | ✅ 6 screenshots                                                                                                         |

New tests:

- `settings/domain/settings.test.ts` (+2): profile name trimmed, empty or overlong refused; weekday order for Monday, Sunday and Saturday starts.
- `tasks/domain/timeline.test.ts` (+1): week start Sunday or Saturday, across a year boundary, and the window start.
- `src/server/settings.db.test.ts` (6): rename only the caller; invalid name and anonymous refused; zone and week start per user and validated; dashboard 本周 in UTC+14 for three week starts; **an existing recurring series keeps Asia/Shanghai after the user moves to Los Angeles**, so at 17:00 UTC its next instance is the Shanghai date, while a new series takes Los Angeles; a schedule rule keeps its zone across an edit.
- `e2e/settings.spec.ts` (+5): rename (inline error, shell updated, persisted); choose and save a zone (dashboard "today" in Kiritimati); week start Sunday (weekday picker starts with 日, dashboard week starts on Sunday); another user's settings untouched; phone width without overflow.

## Screenshots

`docs/screenshots/settings/`:

1. `01-settings.png`
2. `02-time-zone-edit.png`
3. `03-gantt-weeks-sunday.png`
4. `04-weekday-picker.png`
5. `05-mobile-settings.png` (phone)
6. `06-dark-settings.png` (dark)

All six were reviewed. The first capture had a full-page shot that cut the sidebar background, and a
scroll position that hid the page title. Both were re-captured.

## Known limitations

- **Not included:**
  - changing the e-mail or password, or deleting the account (these need verification flows
    outside the Phase 1 plan);
  - notification preferences and per-module defaults;
  - a language switch (zh-CN only, ADR 0015).
- **Fixed zones:** to move an existing recurring series or schedule rule to a new zone, re-create
  it. Nothing is migrated automatically.
- **Week start and RRULE:** every-N-weeks recurrence rules still count weeks from Monday (RRULE
  `WKST`). Only the display order follows the setting.
- **Zone list:** the list comes from the browser (`Intl.supportedValuesOf`). City names are shown
  as IANA identifiers, not translated.
- **Week boundaries:** the XP trend chart's "week" buckets are rolling 7-day windows from the
  period start, not calendar weeks, so they do not use the week start.
