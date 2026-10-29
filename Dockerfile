# Personal OS — container image (ADR 0026). Two targets share one build:
#   runner  the Next.js server (standalone output), small, runs as the unprivileged `node` user
#   tools   the full workspace with all dependencies, for one-off jobs: migrations
#           (`pnpm db:migrate`) and checks (`pnpm db:integrity`)
# Used by deploy/compose.yaml; see docs/deployment.md.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- Dependencies (cached until package.json or the lockfile change) --------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `build_ca` (optional BuildKit secret): a CA certificate for networks that intercept TLS, e.g. a
# corporate proxy. Not stored in the image. Without it nothing changes.
RUN --mount=type=secret,id=build_ca,required=false \
    --mount=type=cache,id=pnpm,target=/pnpm/store \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    pnpm install --frozen-lockfile

# --- Build -------------------------------------------------------------------------------------
FROM deps AS build
COPY . .
# public/ holds no files yet, and Git does not keep empty folders, so a fresh clone or ZIP has
# none; the runner stage copies it, so make sure it exists.
RUN mkdir -p public
# No secrets at build time: the environment is read when the server starts (src/shared/config).
RUN NEXT_OUTPUT=standalone pnpm build

# --- One-off jobs: migrations and checks -------------------------------------------------------
# Binaries are called directly (not through pnpm), so a job never needs the network at run time.
#   migrate:   drizzle-kit migrate                 (the default command)
#   integrity: tsx scripts/db-integrity.ts
FROM build AS tools
ENV NODE_ENV=production PATH=/app/node_modules/.bin:$PATH
USER node
CMD ["drizzle-kit", "migrate"]

# --- The app server ----------------------------------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node docker/worker.sh ./docker/worker.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
