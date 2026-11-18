# 0029 — V3: project-centric views, navigation layout, investment accounts

Status: accepted (2026-11, branch `v3`, migration `0018_v3_projects_investments`, additive)

## Navigation

- Default groups: 概览 · 任务 · 工作与事务 · 个人成长与生活 · 财务 · 资料与记录 · 系统与自动化.
  任务 now holds 全部项目, 全部任务, 四象限矩阵, 甘特图, 日程规划, 看板, 重要截止日期, 回收站.
- Users reorder groups, and pages within a group, in an explicit "调整顺序" mode (dnd-kit, drag
  handles, keyboard). In that mode pages are plain rows, not links, so a drag never navigates.
  The order is saved per user in `user_settings.nav_layout` (jsonb, null = default) and merged
  with the default, so pages added later still appear and pages never move between groups.
  Collapsed groups stay a per-browser preference.

## Projects as the organising layer

- Hierarchy stays Area → Project → Task → Subtask with the existing columns; a subtask has no
  project of its own and belongs to its parent's project. Nothing is copied per view.
- **Progress** = completed items / items, where items are the project's tasks _and their
  subtasks_, each counted once; cancelled, failed and deleted items (and subtasks of deleted
  tasks) are left out. Computed in SQL from the tasks table; never entered by hand.
- **Kanban** (`/projects/kanban`): projects of the chosen area as cards (status, progress,
  completed / total, deadline), each expanding into the existing status board of its tasks; an
  area's tasks without a project get their own collapsible board.
- **Matrix** (`/tasks/matrix?view=projects`): project cards with progress and the quadrant
  distribution of their open tasks (and subtasks); expanded, the tasks grouped by quadrant.
  Projects carry no urgent/important flags of their own; the view never changes a task's flags.
- **Gantt**: project → task → subtask rows, each collapsible, expand/collapse all. A project's
  bar spans its tasks' and subtasks' dates (its own start/target dates only without them); no
  summary task records. Completed items stay hidden by default; recurring series as in V2.

## Investments

- `finance_investment_accounts` (name, institution, type, currency, notes, archive). Holdings
  (`finance_investments`, the V2 table, kept) gain an account, ticker and a manual price with
  its date. `finance_investment_transactions` records buy / sell / dividend / deposit /
  withdrawal / fee, each editable and deletable.
- Figures are computed from transactions with exact decimals, average-cost method: units, cost
  basis, average price, realised P/L (sells net of fees against average cost, dividends, fees),
  unrealised P/L, return = (realised + unrealised) / invested. A write that would make a holding
  impossible (selling more than held, or deleting the buy under a sale) is rolled back.
- Valuation: units × manual price ("手动价格 · date"); else a value entered by hand; else at
  cost, always labelled "按成本估算" and excluded from unrealised P/L. No prices are fetched.
- Currencies are never mixed: totals are per currency; the asset overview adds only accounts in
  the base currency and counts the others.
- Account cash is shown once a deposit or withdrawal is recorded (buys alone would show a
  misleading negative balance).
- **Migration from V2**: one "原有投资" account (`legacy`) per user and currency; each V2 record
  gets that account and an `opening` buy transaction with its V2 cost, units and date (opening
  rows never move cash). Its V2 "current value" stays as the manual valuation, so the V2 totals
  are unchanged. No V2 column is dropped; `cost_amount` and `purchase_date` become optional.
