# Architecture decision records

Short records of decisions that shape the codebase. Add a new numbered file when a decision
changes; never rewrite history — supersede instead.

| #                                                      | Decision                                                                              | Status                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------- |
| [0001](./0001-modular-monolith.md)                     | Modular monolith with lint-enforced boundaries                                        | Accepted                                |
| [0002](./0002-nextjs-16-without-cache-components.md)   | Next.js 16 without Cache Components                                                   | Accepted                                |
| [0003](./0003-i18n.md)                                 | i18n: zh-CN source catalogue, no locale in URLs                                       | Accepted (languages superseded by 0015) |
| [0004](./0004-ids-and-time.md)                         | UUIDv7 ids, timestamptz everywhere                                                    | Accepted                                |
| [0005](./0005-auth.md)                                 | Better Auth with email + password                                                     | Accepted                                |
| [0006](./0006-task-model.md)                           | Task model: one entity, status categories, derived completion                         | Accepted                                |
| [0007](./0007-task-views-and-search.md)                | Task views, search and Trash                                                          | Accepted                                |
| [0008](./0008-eisenhower-matrix.md)                    | Eisenhower matrix is a view of the urgent / important flags                           | Accepted                                |
| [0009](./0009-projects.md)                             | Projects own tasks by reference; progress is computed                                 | Accepted                                |
| [0010](./0010-dependencies-and-gantt.md)               | Dependencies are finish-to-start edges; Gantt is a date view                          | Accepted                                |
| [0011](./0011-event-publishing-locks.md)               | Commands that publish events lock their row first                                     | Accepted                                |
| [0012](./0012-xp-ledger.md)                            | XP: append-only idempotent ledger fed by domain events                                | Accepted                                |
| [0013](./0013-development-attributes.md)               | Areas organise, development attributes grow (supersedes 0012 attributes)              | Accepted                                |
| [0014](./0014-xp-economy-and-rewards.md)               | XP economy: Active / Growth / Level XP, real-world rewards                            | Accepted                                |
| [0015](./0015-zh-cn-only.md)                           | UI is Simplified Chinese only (supersedes 0003 languages)                             | Accepted                                |
| [0016](./0016-dashboard-read-model.md)                 | The dashboard is a read-only composition of other modules, served at `/`              | Accepted                                |
| [0017](./0017-development-system.md)                   | Development system: goals, focus and vision plan; tasks act; XP unchanged             | Accepted                                |
| [0018](./0018-growth-planning-and-goal-attribution.md) | Growth plans; goal XP is an allocation (≤ 100 %) of linked tasks' credits             | Accepted                                |
| [0019](./0019-personal-finance.md)                     | Finance: manual dated balance snapshots, frozen manual FX, net worth                  | Accepted                                |
| [0020](./0020-automation-engine.md)                    | Automation: typed rules, transactional outbox, at-most-once effects, honest scheduler | Accepted                                |
| [0021](./0021-discipline-attribute.md)                 | 自制力: fixed system attribute scored from planned-task outcomes, own ledger          | Accepted                                |
