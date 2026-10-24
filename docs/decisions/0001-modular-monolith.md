# 0001 — Modular monolith with lint-enforced boundaries

**Context.** The app will grow to many domains (tasks, projects, calendar, learning, fitness,
character, analytics, AI). One deployable keeps operations simple for a personal product, but
without boundaries it becomes a tangle.

**Decision.**

- One Next.js app. Code is split into `app` (routing), `shell` (chrome), `server` (composition
  root), `modules/<m>` (domain/db/server/ui) and `shared`.
- A module is importable only through `@/modules/<m>/{domain,db,server,ui}`.
- Cross-module reactions use domain events (`src/shared/events`), wired in `src/server/event-bus.ts`.
- Boundaries are enforced with ESLint's built-in `no-restricted-imports` (regex patterns per
  folder), not a plugin.

**Why not `eslint-plugin-boundaries`.** It was evaluated in M0; its v7 selector/policy API
added configuration weight without catching anything the explicit patterns do not. The
explicit patterns are short, readable and were verified against deliberate violations.

**Consequences.** Inside a module use relative imports; across modules use the public entry
points. Server-only code is never reachable from `ui/` entry points.
