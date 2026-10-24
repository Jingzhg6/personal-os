# 0002 — Next.js 16 without Cache Components

**Context.** The approved proposal said Next.js 15; the current stable release is 16.4, which
the scaffold uses. Next 16 introduces Cache Components (`cacheComponents: true` in the
scaffold), where any request-time read (cookies, session) must sit behind `<Suspense>` and
static shells are prerendered.

**Decision.** Use Next.js 16 with the classic dynamic rendering model (Cache Components and
partial prefetching **off**).

**Why.** Every page except login is per-user and authenticated; there is almost no static
content to prerender. Interactive views (lists, matrix, Kanban, Gantt) fetch via tRPC +
TanStack Query on the client. Cache Components would add Suspense boundaries and
`use cache: private` plumbing around every session/locale read for little benefit.

**Revisit** if the dashboard's first paint becomes slow; Cache Components can be enabled per
route later.

Note: Next 16 renamed `middleware.ts` to `proxy.ts`; the auth redirect lives in `src/proxy.ts`.
