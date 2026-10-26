# 0007 — Task views, search and Trash (M2)

**Navigation views are stored scopes, not areas.** 工作, 业务, 行政任务 and 个人生活 are
navigation items backed by a `task_views` row (`view_key`, `area_ids[]`). Without a row, a view
uses the seeded area with the same system key. Users can include several areas (or none) without
the navigation changing, which keeps areas flexible underneath the information architecture.
Quick Add inside a scoped view files the task into the view's first area, so it stays visible.

**Search is a substring match backed by `pg_trgm`.** Chinese has no word boundaries, so
Postgres full-text search is unsuitable. `ILIKE '%term%'` (LIKE wildcards escaped) on `title` and
`description_text`, with trigram GIN indexes, handles Chinese, French and English alike at
personal-data scale. `description_text` is a plain-text copy of the rich-text JSON maintained by
the service. Search looks at every level and shows each subtask's parent.

**List state lives in the URL.** Filters, sort and search are URL parameters, read and written
by pure domain functions. Views are shareable and survive reloads, and the panel's `?task=`
coexists with them. Client updates build on the latest requested state, so rapid successive
filter clicks are never lost.

**Drag-and-drop uses dnd-kit with keyboard support** (Space to lift, arrows to move, Space to
drop, Chinese screen-reader announcements). Reordering is only offered in manual sort without
a search. The server takes the neighbours around the drop position, so it also works inside
filtered views.

**Trash = soft delete batches.** A deletion stamps the whole subtree with one `deleted_at`.
The Trash lists the root of each batch; restore brings the batch back (moving it to the top level
if its parent is still deleted). Permanent deletion is explicit (per task or "empty Trash").
There is no automatic purge yet.

**Deferred:** user-defined saved filters (the `task_views` model can grow into them), natural-
language dates in Quick Add, pagination (lists are unpaginated at personal scale).
