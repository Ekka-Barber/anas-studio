# Node admin target (I19/D27 part 1). Builds natively on whatever platform
# runs `docker build` — this machine's amd64 for the local proof, the Oracle
# VM's arm64 in production (part 2). No cross-compilation flags here.
FROM node:24-bookworm-slim AS base
RUN corepack enable

# ---- deps: install once with the frozen lockfile ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ---- build: compile the standalone Next.js server ----
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Throwaway values, scoped to this one RUN step only — they do not become
# image ENV and do not persist into the runtime stage below, which starts
# fresh from `base` and copies only the compiled `.next/standalone` output.
# `next build` needs them because `payload.config.ts` / `src/lib/db.ts` /
# `src/payload/storage.ts` read required env while collecting page data.
# RUNTIME_TARGET=node here is what makes `next build` select
# `@payloadcms/storage-s3` (see next.config.ts's Turbopack alias) so the code
# that actually ships is the code the runtime container runs.
RUN RUNTIME_TARGET=node \
    PAYLOAD_SECRET=docker-build-throwaway \
    ADMIN_URL=http://localhost:3000 \
    CMS_DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    R2_ENDPOINT=https://build-throwaway.r2.cloudflarestorage.com \
    R2_ACCESS_KEY_ID=docker-build-throwaway \
    R2_SECRET_ACCESS_KEY=docker-build-throwaway \
    R2_BUCKET_NAME=docker-build-throwaway \
    pnpm build

# ---- runtime: standalone server only, non-root, no build tooling ----
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV RUNTIME_TARGET=node
ENV PORT=3000
# Docker sets HOSTNAME to the container ID for every container, and Next's
# standalone server does `process.env.HOSTNAME || '0.0.0.0'` — so without
# this override it binds only to the container's own bridge IP, not to
# 127.0.0.1. Published-port access from outside the container still worked
# either way (Docker's port DNAT targets the bridge IP directly), but the
# in-container HEALTHCHECK below connects over loopback and needs this.
ENV HOSTNAME=0.0.0.0
# Standalone output omits static assets by design; Next.js requires copying
# them in separately (there is no `public/` directory in this repo yet).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
# node:24-bookworm-slim has no curl. `/api/health` calling `getPayloadClient()`
# is also what starts Payload's `autoRun` cron timer on the node target (see
# src/lib/payload.ts) — after `--restart unless-stopped` brings the container
# back up with nobody visiting the admin, this HEALTHCHECK is what makes that
# first request happen, not a person.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Next.js only evaluates `payload.config.ts` (and therefore `requireEnv`) on
# the first request that reaches a Payload route, not at server startup — so
# a container missing real secrets would otherwise listen on 3000 and only
# fail later. Check the same required-env list up front, so a misconfigured
# container refuses to start at all instead of serving a broken admin.
CMD ["sh", "-c", "for v in PAYLOAD_SECRET ADMIN_URL CMS_DATABASE_URL R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME; do eval val=\\${$v}; if [ -z \"$val\" ]; then echo \"Missing required environment variable: $v\" >&2; exit 1; fi; done; exec node server.js"]
