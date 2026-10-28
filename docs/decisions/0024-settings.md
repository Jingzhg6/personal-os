# 0024 — Settings: display name, time zone and week start

- Status: Accepted (Phase 1, settings)
- Date: 2026-10-28

## Context

`user_settings` (`locale`, `time_zone`, `week_starts_on`) has existed since M0 (ADR 0004). The time
zone was detected from the browser at sign-up and could not be changed afterwards. The week start
was read only by the dashboard and could not be changed at all. The 通用 tab held just the theme.

Several modules already read these values:

- tasks: "today", recurrence;
- character: 自制力 deadlines;
- the dashboard;
- development;
- finance;
- automation.

Two of them fix a zone when something is created: recurring series (ADR 0023) and schedule rules
(ADR 0020 §8).

## Decision

1. **The 通用 tab** has three cards: 个人资料 (display name; the sign-in e-mail is shown, not
   editable), 时区与日期 (time zone and week start) and 外观 (theme, per device as before). No
   new table and no migration.
2. **Display name.** `settings.updateProfile` updates `users.name` for `ctx.userId` only. The
   name is trimmed and must be 1–100 characters. Better Auth has no cookie cache, so the session
   reads the new name on the next request.
3. **Time zone.**
   - Any IANA zone the browser lists, plus `UTC`, grouped by region and labelled with the
     current UTC offset. The browser's zone is offered when it differs from the saved one, and
     the local time in the chosen zone is previewed.
   - Validated with `Intl` on the server, as before. While no zone is set, the server uses
     `UTC`.
   - Saving refetches every query and refreshes the server render, so "today", overdue and the
     dashboard periods follow at once.
4. **What a new zone does not change.**
   - Recurring series and schedule rules keep the zone they were created with, so changing the
     settings zone never moves a schedule.
   - The schedule editor shows that fixed zone. Before this ADR it showed the settings zone,
     or the browser's when unset, which could differ from the zone the server runs the rule in.
   - Existing dates are calendar dates and do not shift (ADR 0004).
5. **Week start** (0 = Sunday … 6 = Saturday) is read in one place on the client:
   `PreferencesProvider`, filled by the app layout from the stored settings. It applies to:
   - the dashboard's 本周 (already);
   - the Gantt week scale and the start of its window;
   - the order of the weekday pickers in the recurrence and schedule editors.

   It does **not** change RRULE `WKST` (Monday): this keeps the meaning of existing every-N-weeks
   series.

## Consequences

- No migration; settings stay one row per user, created at registration.
- Changing the time zone is safe for stored schedules. To move a series or rule to the new zone,
  the user re-creates it.
- Not included: changing the e-mail or password, a language switch (ADR 0015), notification
  preferences, and per-module defaults. None of these is in the Phase 1 plan.
