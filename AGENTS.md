<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- Read `docs/architecture.md` before changing structure; record new decisions in `docs/decisions/`.
- Respect module boundaries: import other modules only via `@/modules/<m>/{domain,db,server,ui}`. `pnpm lint` enforces this.
- No hard-coded UI text: every user-facing string is a key in `messages/zh-CN/*.json` (source of truth). User content is never translated.
- Store stable identifiers in the database, never display labels.
- Every user-owned query is scoped by `ctx.userId`.
- One task row powers every view (list, matrix, Kanban, Gantt, dashboard, calendar): never duplicate entities per view.
- Before finishing: `pnpm check` and `pnpm test:e2e`.
