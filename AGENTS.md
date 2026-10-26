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

## Milestone process

Work one roadmap milestone (M1, M2, …) at a time, on its own branch. Never merge to `main`,
deploy, or start the next milestone without the owner's explicit approval.

At the end of every milestone:

1. Run the full suite: `pnpm check`, `pnpm test:e2e`, `pnpm build`.
2. Visual check: add `e2e/screenshots/<milestone>.shots.ts` and run `pnpm screenshots`. It starts
   the real app, registers a demo account, seeds data through the app's own API and saves
   3–8 real browser screenshots of the milestone's key pages to `docs/screenshots/<milestone>/`
   (include at least one phone-sized shot, using a mobile device profile). No mockups, and no
   product features added only for screenshots.
3. Review every screenshot; fix layout, overflow, Chinese text, responsive or interaction
   problems before finishing, then re-capture.
4. List the screenshots in `docs/screenshots/README.md`.
5. Report: what was done, new pages, core user flows, key design/architecture decisions, test
   results, screenshot list, known limitations, next milestone. Then stop and wait.
