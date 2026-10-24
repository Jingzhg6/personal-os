# 0004 — UUIDv7 ids, timestamptz everywhere

**Decision.**

- All primary keys are UUIDv7 generated in the application (`newId()`), including Better Auth
  tables (`advanced.database.generateId`).
- Instants are `timestamptz`; date-only values (due dates) are `date`. The user's IANA
  timezone is stored in `user_settings.time_zone` (detected from the browser at sign-up).

**Why.** UUIDv7 is sortable by creation time (good index locality, natural ordering), can be
generated before insert (useful for optimistic UI and future offline support), and does not
leak row counts. Date-only due dates do not shift when travelling across timezones.
