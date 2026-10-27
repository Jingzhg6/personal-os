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

## M3 — Eisenhower matrix (`m3/`)

| File                   | Page                    | Shows                                                                                                                                                                |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-matrix.png`        | `/tasks/matrix`         | Four quadrants (重要且紧急 / 重要不紧急 / 紧急不重要 / 不紧急不重要) with 紧急 / 不紧急 headings, the 未分类 tray, a subtask with its parent, per-quadrant Quick Add |
| `02-dragging.png`      | `/tasks/matrix`         | Pointer drag in progress: floating card preview over 重要不紧急, highlighted drop zone, faded source card                                                            |
| `03-move-menu.png`     | `/tasks/matrix`         | The 「移到」 menu on a card (keyboard / touch alternative to dragging), current placement checked                                                                    |
| `04-detail-panel.png`  | `/tasks/matrix?task=…`  | The shared task detail panel opened from a card; matrix reflows beside it                                                                                            |
| `05-filtered-dark.png` | `/tasks/matrix?area=…`  | Matrix filtered to one area in dark mode; empty quadrants show drop hints                                                                                            |
| `06-mobile.png`        | `/tasks/matrix` (phone) | Stacked layout on a phone with 未分类 first                                                                                                                          |

## M4 — Projects (`m4/`)

| File                       | Page                                      | Shows                                                                                                             |
| -------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `01-projects.png`          | `/projects`                               | Project cards: status, area, progress bar and counts, target date (overdue in red), overdue tasks, next milestone |
| `02-new-project.png`       | `/projects`                               | 新建项目 dialog: name, area, status, start / target dates, priority, colour                                       |
| `03-project-tasks.png`     | `/projects/[id]`                          | Project header with progress; 任务 tab = the shared task list filtered to the project, with milestone chips       |
| `04-project-board.png`     | `/projects/[id]?view=board`               | The project's Kanban board: one column per status, per-column Quick Add, horizontally scrollable                  |
| `05-milestones.png`        | `/projects/[id]?view=milestones`          | Milestones with due dates, completion, per-milestone progress and 查看任务 links                                  |
| `06-kanban-panel.png`      | `/projects/kanban?task=…`                 | Global board with project chips; the shared detail panel showing the 项目 and 里程碑 fields                       |
| `07-mobile-board-dark.png` | `/projects/[id]?view=board` (phone, dark) | Project page on a phone in dark mode; board columns snap horizontally                                             |

## M5 — Dependencies & Gantt (`m5/`)

| File                        | Page                                      | Shows                                                                                                                                                   |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-gantt.png`              | `/projects/gantt`                         | Week scale: project groups with date spans and milestone diamonds, bars by status, today line, dependency arrows (red = conflict), overdue bar outlined |
| `02-gantt-dependencies.png` | `/projects/gantt?task=…`                  | Bar clicked: shared detail panel with 依赖 — 前置任务 (with a date-conflict warning) and 后续任务                                                       |
| `03-add-dependency.png`     | `/projects/gantt?task=…`                  | Adding a prerequisite: task search picker                                                                                                               |
| `04-project-gantt-day.png`  | `/projects/[id]?view=gantt&zoom=day`      | The project page's 甘特图 tab at day scale                                                                                                              |
| `05-gantt-month.png`        | `/projects/gantt?zoom=month` (full page)  | Month scale; short bars labelled beside them; 未排期 list expanded                                                                                      |
| `06-tasks-blocked.png`      | `/tasks`                                  | Task list with 受阻 markers on tasks waiting for open prerequisites                                                                                     |
| `07-mobile-gantt-dark.png`  | `/projects/[id]?view=gantt` (phone, dark) | Phone layout: task names pinned, timeline scrolled to today                                                                                             |
