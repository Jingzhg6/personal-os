# Milestone screenshots

Real screenshots of the running app, captured at the end of each milestone by
`pnpm screenshots` (Playwright, `e2e/screenshots/<milestone>.shots.ts`). Each run registers a
fresh demo account and creates demo data through the app's own API. Nothing here is a mockup.

Desktop shots are 1440 × 900; phone shots use the Pixel 7 profile (touch, no hover).

## M2 — Task views (`m2/`)

| File                     | Page                   | Shows                                                                                                                                     |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `01-all-tasks.png`       | `/tasks`               | All tasks: Quick Add, search, sort, filter chips, row metadata (flags, tags, area, due, priority, subtask progress), drag handle on hover |
| `02-filter-priority.png` | `/tasks?priority=3,4`  | Filter menu open with two priorities selected; active filter chip and "清除筛选"; state kept in the URL                                   |
| `03-search.png`          | `/tasks?q=听力`        | Search across titles and descriptions; a completed subtask shown with "属于「父任务」"                                                    |
| `04-detail-panel.png`    | `/tasks?task=…`        | Detail panel next to the list: 上级任务, properties, tags, rich-text description, subtasks with drag handle                               |
| `05-work-view.png`       | `/work`                | Scoped navigation view: "包含领域" bar with 编辑领域, tasks of the 工作 area only                                                         |
| `06-deadlines.png`       | `/admin/deadlines`     | Open tasks and subtasks grouped into 已逾期 / 今天 / 明天 / 未来 7 天 / 以后                                                              |
| `07-trash.png`           | `/tasks/trash`         | Trash with deletion batches (one with a subtask), restore, permanent delete, empty                                                        |
| `08-mobile-dark.png`     | `/tasks` (phone, dark) | Responsive layout on a phone in dark mode; drag handles visible on touch screens                                                          |
