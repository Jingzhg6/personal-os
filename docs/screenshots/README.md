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

## M6 — Character & XP (`m6/`)

Historical: these show M6's area-derived attributes, replaced in M6.1. The M6 capture script
(`e2e/screenshots/m6.shots.ts`) is in the `m6-character-xp` branch history.

All XP shown was produced by real completions, reopenings, a completed → cancelled change, a
milestone un-completed and a deleted completed task, made through the app's API.

| File                         | Page                          | Shows                                                                                       |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `01-character-overview.png`  | `/character`                  | Level, total XP, progress to the next level, radar, attributes with levels and source areas |
| `02-recent-xp.png`           | `/character` (scrolled)       | 最近获得 (with 已撤销 grants struck through) and 最近撤销                                   |
| `03-attributes-radar.png`    | `/character`                  | Radar tooltip on hover (attribute level and XP)                                             |
| `04-xp-history.png`          | `/character/xp`               | Full ledger with grants and reversals, filters, and the XP rules                            |
| `05-xp-reversals.png`        | `/character/xp?kind=reversal` | Reversals only: reopened task, cancelled task, milestone un-completed                       |
| `06-area-mapping.png`        | `/character`                  | 领域与属性 dialog: which attribute each area credits                                        |
| `07-character-dark.png`      | `/character` (dark)           | Dark theme, desktop                                                                         |
| `08-mobile-character.png`    | `/character` (phone)          | Phone layout: level card and radar                                                          |
| `09-mobile-history-dark.png` | `/character/xp` (phone, dark) | Phone, dark: XP history                                                                     |

## M6.1 — Personal development model (`m6-1/`)

Data made through the app's API only: attributes created / archived, tasks with an area **and**
development contributions, completions and one reopen. Total 205 XP, of which 170 XP credited to
development attributes (two admin tasks earn overall XP only).

| File                                    | Page                          | Shows                                                                                     |
| --------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `01-character-overview.png`             | `/character`                  | Level and overall XP with "其中 … 计入成长能力", dynamic radar, 成长能力 list             |
| `02-dynamic-radar.png`                  | `/character`                  | Radar of the user's current attributes incl. the custom "Python", hover tooltip           |
| `03-attribute-settings.png`             | `/character/attributes`       | 成长能力设置: emoji, name, color, order, 在雷达图显示, 停用; archived section             |
| `04-task-contribution.png`              | `/tasks?task=…`               | Task in area 工作 contributing to Python only; attribute picker open                      |
| `05-task-multiple-contributions.png`    | `/tasks?task=…`               | Task in area 学习 contributing to 法语 (主要) and 阅读 (少量): 30 XP → 法语 +23 · 阅读 +7 |
| `06-xp-history.png`                     | `/character/xp`               | Per-entry split, "仅计入总经验" entries, a reversal, the rules incl. the split rule       |
| `07-character-dark.png`                 | `/character` (dark)           | Dark theme, desktop                                                                       |
| `08-mobile-character.png`               | `/character` (phone)          | Phone layout                                                                              |
| `09-mobile-task-contributions-dark.png` | `/tasks?task=…` (phone, dark) | Phone, dark: task detail with contributions (due time now wraps below the date)           |

## M6.2 — Growth RPG & real-world rewards (`m6-2/`)

Data made through the app's API only: a custom "Python" attribute, 110 growth tasks (with
development contributions) interleaved with ordinary tasks (Active XP only), six rewards, a few
redemptions, Lv 5 and Lv 10 level rewards claimed and a Lv 15 reward added. Result: Lv 17 实践者,
lifetime Level XP 3,300, Active XP 3,900, Growth XP 2,717.

| File                       | Page                    | Shows                                                                                         |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `01-character-level.png`   | `/character`            | Level 17, growth stage 实践者 (Lv 11–20), lifetime Level XP, progress, distance to next stage |
| `02-action-vs-growth.png`  | `/character/xp`         | Every entry earns 行动 XP; growth tasks add attribute credits and 升级 XP                     |
| `03-level-xp-balance.png`  | `/character` (element)  | Active / Level XP each with 累计 vs 可用, Growth XP total                                     |
| `04-growth-attributes.png` | `/character` (scrolled) | Radar and 成长能力 list with per-attribute levels                                             |
| `05-level-reward.png`      | `/rewards?tab=level`    | Level rewards: 已领取, 免费领取 (reached), 提前领取 (846 XP), locked beyond the next stage    |
| `06-early-claim.png`       | `/rewards?tab=level`    | Early-claim confirmation: cost = missing Level XP; lifetime and level unchanged               |
| `07-reward-store.png`      | `/rewards`              | Reward store: value, real cost, Active vs Level price, Active-only and one-time rewards       |
| `08-mixed-payment.png`     | `/rewards`              | Redeem dialog, custom split 300 Active + 40 Level, live preview of balances after             |
| `09-reward-history.png`    | `/rewards?tab=history`  | Redemptions, early claim and free level rewards; spendable reduced, lifetime unchanged        |
| `10-mobile-rewards.png`    | `/rewards` (phone)      | Phone layout: balances, tabs, reward cards                                                    |
| `11-dark-character.png`    | `/character` (dark)     | Dark theme, desktop                                                                           |

## M7 — Personal RPG dashboard (`m7/`)

Data made through the app's API only: a custom "Python" attribute, 6 rounds of growth tasks with
development contributions interleaved with ordinary tasks, five rewards (one redeemed with Level
XP), the Lv 5 level reward claimed, then an ordinary task, a completed-and-reopened run and a task
growing two attributes. Result: Lv 9 探索者. All XP is earned at capture time, so the trend shows
one (real) day of data.

| File                       | Page            | Shows                                                                                        |
| -------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `01-dashboard-desktop.png` | `/`             | Full dashboard: character header, three XP cards, growth, focus, rewards, week, activity     |
| `02-growth-radar.png`      | `/` (element)   | 我的成长能力: radar, 最近成长最快 (7 天), trend with tooltip (Growth, Level and Active XP)   |
| `03-reward-section.png`    | `/` (element)   | 当前成长重点, 下一个等级奖励 (early claim available), 奖励商店 preview with prices           |
| `04-mobile-dashboard.png`  | `/` (phone)     | iPhone 13: character → XP → growth → focus → rewards → week → activity, no horizontal scroll |
| `05-dark-dashboard.png`    | `/` (dark)      | Dark theme, desktop, charts included                                                         |
| `06-empty-dashboard.png`   | `/` (new user)  | Empty states: no growth yet, no rewards, no activity                                         |
| `07-week-and-activity.png` | `/` (element)   | 本周 summary and 最近活动 (ordinary, growth, reversal entries)                               |
| `08-tablet-dashboard.png`  | `/` (iPad Mini) | Tablet portrait                                                                              |

## M8 — Personal development system (`m8/`)

Data made through the app's API only: two custom attributes (SQL, 专注力), a vision, five goals
(two active with high priority, one active, one paused, one archived), tasks created from goals and
one existing task linked, completions, a project linked to the SQL goal, English and cardio tasks
that make those the fastest-growing attributes, and the chosen focus 法语 · SQL · 专注力.

| File                         | Page                              | Shows                                                                                   |
| ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `01-development-desktop.png` | `/development`                    | Vision, 我的成长重点 next to 最近成长最快, goal cards (已完成 X / Y 项行动), attributes |
| `02-development-dark.png`    | `/development` (dark)             | Dark theme                                                                              |
| `03-development-mobile.png`  | `/development` (phone)            | iPhone 13, single column, no horizontal scroll                                          |
| `04-goal-detail.png`         | `/development/goals/[id]`         | Status actions, 行动进展 with the formula, linked actions, create-task form, attributes |
| `05-attribute-detail.png`    | `/development/attributes/[id]`    | Lifetime / 30-day Growth XP, 90-day trend, goals, open tasks, recent records, sources   |
| `06-goal-linked-tasks.png`   | `/development/goals/[id]?task=…`  | A linked task's panel: contributions from the goal, and its 成长目标                    |
| `07-empty-state.png`         | `/development` (new user)         | Empty states for vision, focus, recent growth and goals                                 |
| `08-focus-selection.png`     | `/development` (dialog)           | Choosing the focus: 3 / 3 selected, the rest disabled                                   |
| `09-dashboard-focus.png`     | `/` (element)                     | M7 dashboard card: chosen focus added above the measured focus, link to 成长规划        |
| `10-goal-detail-mobile.png`  | `/development/goals/[id]` (phone) | Goal detail on a phone                                                                  |

## M9 — Growth planning & goal attribution (`m9/`)

Data made through the app's API only: three goals (法语达到 B1, 成为数据分析师, 掌握 Python),
growth plans with tasks created in them, completions, an unlinked 法国旅游准备 task that grows
法语 without serving a goal, a task shared by two goals and allocated 60 / 40, a shared task still
待分配, and a partial allocation (专注力 50 %).

| File                          | Page                              | Shows                                                                                   |
| ----------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `01-development-overview.png` | `/development`                    | Goal cards with goal-specific XP (本目标近 30 天) and plan counts, 成长计划 by activity |
| `02-goal-detail.png`          | `/development/goals/[id]`         | Evidence row, plans with their actions, other actions, attribute context                |
| `03-goal-plans.png`           | `/development/goals/[id]`         | Two plans expanded: actions, attributed XP per task, plan controls                      |
| `04-attribution-editor.png`   | `/development/goals/[id]` dialog  | 成长归属 of a task shared by two goals: 60 % / 40 % → 18 / 12 XP                        |
| `05-partial-attribution.png`  | `/development/goals/[id]` dialog  | 法语 100 %, 专注力 50 % — 8 XP stays 未归属                                             |
| `06-goal-statistics.png`      | `/development/goals/[id]`         | 实际行动, 本目标成长经验 by attribute, 过去 30 天, 未归属                               |
| `07-mobile-goal-detail.png`   | `/development/goals/[id]` (phone) | iPhone 13; task titles wrap, chips and controls stay together                           |
| `08-dark-goal-detail.png`     | `/development/goals/[id]` (dark)  | Dark theme                                                                              |
| `09-empty-state.png`          | `/development/goals/[id]`         | New goal: no plans, no actions, zero evidence                                           |
| `10-dashboard-regression.png` | `/`                               | M7 dashboard after M9 data: unchanged figures                                           |

## M9.5 — Personal finance (`m9-5/`)

Data made through the app's API only: five institutions (BNP Paribas, 中国银行, 支付宝, Trade
Republic, 现金), eight accounts in EUR, CNY and USD including a credit card, and six recorded
dates over five months with typed CNY rates. The USD account has no balance yet.

| File                         | Page                        | Shows                                                                                  |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `01-overview.png`            | `/finance`                  | Net worth, assets, liabilities, change split (余额 / 汇率), warning, chart, breakdowns |
| `02-accounts.png`            | `/finance/accounts`         | Institutions with their accounts, locked base currency, latest balance per account     |
| `03-snapshot-missing-fx.png` | `/finance/snapshot`         | Batch entry: previous values as hints, USD amount without a rate (未换算), totals      |
| `04-account-history.png`     | `/finance/accounts/[id]`    | CNY account: original amounts, the rate of each date, value in EUR, revision           |
| `05-empty-state.png`         | `/finance` (new user)       | Empty state with the three first steps                                                 |
| `06-mobile-overview.png`     | `/finance` (phone)          | iPhone 13, full page                                                                   |
| `07-mobile-snapshot.png`     | `/finance/snapshot` (phone) | iPhone 13; compact pinned total and save button                                        |
| `08-dark-overview.png`       | `/finance` (dark)           | Dark theme                                                                             |

## M10 — Automation engine (`m10/`)

Re-captured in M10.1 (rule list, detail and health card changed: "等待后台 worker" badge,
finished one-time schedules, failed-event count).

Data made through the app's API only: five rules (follow-up on important tasks, notification after
a balance batch, a monthly schedule, a disabled goal rule, and a rule whose project was deleted),
then real task completions (one re-completed), a finance batch and the resulting executions. No
worker is configured, so the scheduler is reported as not running.

| File                        | Page                         | Shows                                                                              |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `01-rules.png`              | `/automation`                | Rules with trigger → actions, switches, last result, next run; runtime status card |
| `02-rule-builder.png`       | `/automation/new`            | Guided builder: trigger, condition, two actions, summary, saved disabled           |
| `03-rule-history.png`       | `/automation/[id]`           | Summary and history: successes, condition skips, a duplicate ignored               |
| `04-failed-execution.png`   | `/automation/[id]`           | Partial failure: action 1 done, action 2 failed (project deleted), not retryable   |
| `05-schedule-runtime.png`   | `/automation/new` (schedule) | Schedule fields, time zone, DST rule, and the "no worker" warning                  |
| `06-notifications.png`      | `/automation/notifications`  | In-app notifications from rules, unread                                            |
| `07-empty-state.png`        | `/automation` (new user)     | Empty state and runtime status                                                     |
| `08-mobile-rules.png`       | `/automation` (phone)        | iPhone 13, full page                                                               |
| `09-mobile-rule-detail.png` | `/automation/[id]` (phone)   | iPhone 13, rule detail and history                                                 |
| `10-dark-rule-detail.png`   | `/automation/[id]` (dark)    | Dark theme                                                                         |

## M10.5 — 自制力 / Discipline (`m10-5/`)

Data made through the app's API: planned tasks completed early, on time and late, a task marked
failed, an overdue task penalised by 立即检查 (no worker configured), and a task completed,
reopened and completed again. Planning times were backdated three days in `tasks.planned_at` (the
only direct write, as a deadline cannot be "planned in advance" within one run).

| File                            | Page                                      | Shows                                                                          |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `01-discipline-page.png`        | `/development/attributes/[id]`            | Score, level, worker state, fixed rules, scoring history with reasons and nets |
| `02-development-attributes.png` | `/development`                            | Growth attribute cards; 自制力 shows its score and fixed rules                 |
| `03-character-radar.png`        | `/character`                              | Radar and attribute list including 自制力 (分, not XP); XP figures unchanged   |
| `04-settings-locked.png`        | `/character/attributes`                   | 自制力 locked as a system attribute; only radar visibility and order           |
| `05-task-failed.png`            | `/tasks?task=`                            | Task panel: status 已失败, 自制力 −5 (任务失败), failure time                  |
| `06-mobile-discipline.png`      | `/development/attributes/[id]` (phone)    | iPhone 13                                                                      |
| `07-dark-discipline.png`        | `/development/attributes/[id]` (dark)     | Dark theme                                                                     |
| `08-empty.png`                  | `/development/attributes/[id]` (new user) | 0 分, empty history, rules, worker notice                                      |

## Phase 1 integration (`phase1-integration/`)

One account, with data made through the app's API, on the integrated branch (M0–M10.6, no AI).

| File                    | Page                    | Shows                                                                      |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `01-dashboard.png`      | `/`                     | Level, XP currencies, radar, trend, focus, rewards, this week, activity    |
| `02-tasks.png`          | `/tasks`                | Task list with urgency, importance, blocked, project, area and due markers |
| `03-project.png`        | `/projects/[id]`        | Project page: progress, milestone, blocked dependency                      |
| `04-gantt.png`          | `/projects/gantt`       | The same tasks on the Gantt chart, with the dependency arrow               |
| `05-development.png`    | `/development`          | Growth: recent growth from completed tasks, the goal                       |
| `06-finance.png`        | `/finance`              | Net worth in CNY from a recorded snapshot                                  |
| `07-mobile-matrix.png`  | `/tasks/matrix` (phone) | iPhone 13: matrix, uncategorised tray, no horizontal overflow              |
| `08-dark-character.png` | `/character` (dark)     | Dark theme: level, XP, radar with 自制力                                   |

## Recurring tasks (`recurring-tasks/`)

Series made through the app's API; instances created by completing and skipping.

| File                   | Page                       | Shows                                                                                   |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `01-task-list.png`     | `/tasks`                   | Open occurrences as ordinary tasks with the ↻ marker; completed and skipped ones folded |
| `02-panel-summary.png` | `/tasks?task=` (newest)    | 重复: 每月最后一天 · 按固定日程, position, next three dates, 跳过本次 / 停止重复        |
| `03-panel-edit.png`    | `/tasks?task=`             | The rule editor: frequency, interval, weekdays, end, mode with its explanation          |
| `04-matrix.png`        | `/tasks/matrix`            | The next 整理周报 occurrence in 重要且紧急, with project, due time and ↻ marker         |
| `05-mobile-panel.png`  | `/tasks?task=` (phone)     | iPhone 13, the 重复 section                                                             |
| `06-dark-panel.png`    | `/tasks?task=` (old, dark) | Dark theme; an earlier occurrence, marked as history (edit on the newest)               |

## Settings (`settings/`)

A demo user with a three-task project; settings changed in the UI, then the views that follow them.

| File                        | Page                     | Shows                                                                                         |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `01-settings.png`           | `/settings`              | 通用: 个人资料 (display name, read-only e-mail) and 时区与日期 (UTC, 星期一) with their hints |
| `02-time-zone-edit.png`     | `/settings`              | Asia/Shanghai chosen: local-time preview, 使用浏览器时区, the note on fixed zones; 星期日     |
| `03-gantt-weeks-sunday.png` | `/projects/gantt`        | Week scale labelled on Sundays (10/18, 10/25, …) after saving 星期日                          |
| `04-weekday-picker.png`     | `/tasks?task=`           | The recurrence editor's weekday buttons starting with 日                                      |
| `05-mobile-settings.png`    | `/settings` (phone)      | iPhone 13, the 时区与日期 card, no horizontal overflow                                        |
| `06-dark-settings.png`      | `/settings` (dark theme) | Dark theme                                                                                    |

## JSON export (`json-export/`)

A demo user with a project and two tasks exports the data from 设置 › 通用.

| File                   | Page                     | Shows                                                                              |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `01-export-card.png`   | `/settings`              | 导出数据 card: what is included, what is not (no passwords or sessions), 导出 JSON |
| `02-export-done.png`   | `/settings`              | After a real download: 上次导出 with the file name and record count (toast closed) |
| `03-export-failed.png` | `/settings`              | The server answering 500 (intercepted): 导出失败，请稍后再试。, nothing saved      |
| `04-mobile-export.png` | `/settings` (phone)      | iPhone 13 after a real download: button and 上次导出, no horizontal overflow       |
| `05-dark-export.png`   | `/settings` (dark theme) | Dark theme                                                                         |

## Docker deployment (`docker-deployment/`)

Captured from the **containers** (`deploy/compose.yaml` on port 3100 with the worker configured).
Playwright reused that server, so every page was served by the app, database and worker containers.

| File                        | Page               | Shows                                                                                       |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `01-dashboard.png`          | `/`                | The dashboard after registration in the container (Active XP +15 from a completed task)     |
| `02-tasks-recurring.png`    | `/tasks`           | 晨间复盘's next occurrence (↻, 明天), created in the container when the first was completed |
| `03-automation-worker.png`  | `/automation`      | 计划调度 运行中: worker heartbeat; the one-time rule 成功, 一次性计划已执行完毕             |
| `04-rule-run-by-worker.png` | `/automation/[id]` | 执行记录: 成功, 按计划时间, 1 / 1 个动作完成, run by the worker container                   |
| `05-settings-export.png`    | `/settings`        | JSON export downloaded from the container: 上次导出 … (32 条记录)                           |
| `06-mobile-dashboard.png`   | `/` (phone)        | iPhone 13, no horizontal overflow                                                           |
