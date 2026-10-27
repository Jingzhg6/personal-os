# Architecture decision records

Short records of decisions that shape the codebase. Add a new numbered file when a decision
changes; never rewrite history — supersede instead.

| #                                                    | Decision                                                      | Status   |
| ---------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [0001](./0001-modular-monolith.md)                   | Modular monolith with lint-enforced boundaries                | Accepted |
| [0002](./0002-nextjs-16-without-cache-components.md) | Next.js 16 without Cache Components                           | Accepted |
| [0003](./0003-i18n.md)                               | i18n: zh-CN source catalogue, no locale in URLs               | Accepted |
| [0004](./0004-ids-and-time.md)                       | UUIDv7 ids, timestamptz everywhere                            | Accepted |
| [0005](./0005-auth.md)                               | Better Auth with email + password                             | Accepted |
| [0006](./0006-task-model.md)                         | Task model: one entity, status categories, derived completion | Accepted |
| [0007](./0007-task-views-and-search.md)              | Task views, search and Trash                                  | Accepted |
| [0008](./0008-eisenhower-matrix.md)                  | Eisenhower matrix is a view of the urgent / important flags   | Accepted |
| [0009](./0009-projects.md)                           | Projects own tasks by reference; progress is computed         | Accepted |
| [0010](./0010-dependencies-and-gantt.md)             | Dependencies are finish-to-start edges; Gantt is a date view  | Accepted |
| [0011](./0011-event-publishing-locks.md)             | Commands that publish events lock their row first             | Accepted |
