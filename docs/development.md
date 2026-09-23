# Local development

How to run this repository locally. Everything here was exercised while
producing the P00 runtime-spike evidence; nothing in it is aspirational.

## Prerequisites

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Node.js | 24.19.0 | `.node-version`, and `engines.node` (`>=24.9.0 <25`) in `package.json` |
| pnpm | 10.33.0 | `packageManager` in `package.json` |
| Docker | any recent release | used for the disposable local PostgreSQL database |

`.npmrc` sets `engine-strict=true`, `strict-peer-dependencies=true` and
`save-exact=true`: a wrong Node version, an unresolved peer range or a floating
version fails loudly instead of being silently accepted.

```sh
corepack enable          # activates the pnpm version from packageManager
pnpm install --frozen-lockfile
```

## Environment

Copy `.env.example` to `.env` and fill in the values you need. `.env` is
git-ignored and must never be committed, printed into a log, or pasted into an
issue. The same applies to `.dev.vars`, which is where `wrangler dev` reads the
Worker's secrets from.

Nothing has a default. `src/lib/env.ts` throws `MissingEnvError` for a missing
required variable rather than degrading to a fallback, so an unconfigured
feature is unavailable instead of quietly wrong.

What each variable is for:

- `DATABASE_URL` — the **non-pooled** PostgreSQL connection used by the CLI:
  migrations, type generation and local tooling (D26). It is never used to serve
  a request.
- `PAYLOAD_SECRET` — required whenever the Payload config is loaded. `next build`
  loads it while collecting page data, so a build fails without it.
- `SITE_URL` — the Worker's own origin. It is Payload's `serverURL` on that
  target, and it is also the origin the node admin target's revalidation hook
  calls back into (`src/lib/revalidate.ts`), so in local preview it must be the
  preview origin (`http://127.0.0.1:8787`), not the production domain.
- `JOBS_SECRET` — bearer secret for `GET /api/payload-jobs/run`
  (`src/payload/jobs.ts`). I19/D27: the Worker no longer calls this path at all
  (there is no `scheduled` handler, and `worker-entry.ts` refuses `/api/*`
  except `/api/health` and `POST /api/revalidate`) — scheduled jobs run on the
  node admin target's own `autoRun` timer instead. The bearer path still exists
  for a manual/ops trigger against the node admin directly.
- `REVALIDATE_SECRET` — bearer secret for `POST /api/revalidate` (I20/D27). The
  Worker checks it; the node admin target sends it when a RuntimeProbe save or
  delete needs the public cache invalidated. Unset on either side means no open
  fallback — the endpoint does not exist, or the hook logs and skips.
- `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` — the database that
  wrangler points the `HYPERDRIVE` binding at during local development. Set it to
  the local container, never to a hosted database.

## Local database

A disposable PostgreSQL container, thrown away and recreated at will:

```sh
docker run -d --name anasaq-p00-pg \
  -e POSTGRES_USER=<local-user> \
  -e POSTGRES_PASSWORD=<local-password> \
  -e POSTGRES_DB=anasaq_p00 \
  -p 55432:5432 \
  postgres:17-alpine
```

Then, in `.env`:

```
DATABASE_URL=postgres://<local-user>:<local-password>@127.0.0.1:55432/anasaq_p00
TEST_ENV=local
```

The application uses an explicit `cms` schema and UUID primary keys, with
`push: false` — the schema is never mutated at runtime. The first migration
creates the schema itself (`CREATE SCHEMA IF NOT EXISTS "cms"`), because
Payload's experimental `schemaName` option emits fully qualified DDL but not the
schema.

## Migrations

Payload owns migration history. There is no second, hand-written schema stream.

```sh
pnpm migrate            # apply pending migrations (uses DATABASE_URL)
pnpm migrate:create     # generate a new migration from the config
pnpm generate:types     # refresh src/payload-types.ts
pnpm generate:schema    # refresh src/payload-generated.schema.ts
```

Migrations run over `DATABASE_URL`, a separate non-pooled connection, and never
over the Hyperdrive/transaction-pooler path used by requests. This is not a
style preference: the transaction pooler rejects named prepared statements,
which is what migration DDL uses (see `docs/runtime-spike.md`).

## Running the application

`pnpm dev` runs Next.js with the Cloudflare bindings simulated by wrangler, so
`HYPERDRIVE` and `R2` behave as they do in the Worker:

```sh
pnpm dev                # http://localhost:3000
```

To run the artifact that actually ships — the OpenNext Worker — build it first;
`preview:worker` serves an existing build and does not create one:

```sh
pnpm build
pnpm build:worker
pnpm preview:worker     # http://127.0.0.1:8787
```

`preview:worker` needs `.dev.vars` (at minimum `SITE_URL`, `PAYLOAD_SECRET`)
and the Hyperdrive local connection string in the environment. It also runs
`opennextjs-cloudflare`'s own `populateCache` step first (local target): this
creates the D1 `revalidations` table used by the tag cache in wrangler's local
D1 simulation and uploads the built static/ISR cache entries to the local R2
simulation, before `wrangler dev` starts — see
`node_modules/@opennextjs/cloudflare/dist/cli/commands/{preview,populate-cache}.js`.

There is no Worker `scheduled` handler any more (I19/D27): scheduled jobs run
on the node admin target's own `autoRun` timer instead, which only this
repository's Docker image/VM runs.

### Running the preview in a Linux container

The P00 evidence was produced with the build and the preview running in a Linux
container, and Playwright driving it from the host. Reproduce it with:

```sh
docker run -d --name anasaq-build -p 8787:8787 -w /app node:24-bookworm-slim sleep infinity
docker cp . anasaq-build:/app                      # or mount the repository
docker exec -e PAYLOAD_SECRET=<throwaway> anasaq-build sh -c 'cd /app && pnpm install --frozen-lockfile && pnpm build && pnpm build:worker'
docker exec -d \
  -e CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://<local-user>:<local-password>@<pg-container-ip>:5432/anasaq_p00 \
  anasaq-build sh -c 'cd /app && pnpm preview:worker -- --ip 0.0.0.0'
```

`--ip 0.0.0.0` matters: wrangler binds to `localhost` by default, which a
container port mapping cannot reach.

## Tests and checks

```sh
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest unit tests (tests/unit)
pnpm test:db         # vitest integration tests against a real local PostgreSQL
pnpm test:e2e        # playwright against the Worker preview
pnpm check:frozen    # re-hashes deploy/ against the recorded manifest
pnpm check:copy      # Latin digits only, no placeholder copy
pnpm check:budgets   # asset budgets
pnpm check           # lint + typecheck + check:frozen + check:copy + test
```

`pnpm test:e2e` expects a Worker preview to be running, or starts one itself.
Point it at an already-running preview — for example one inside a container —
with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8787 pnpm test:e2e`.

### `pnpm test:db` refuses a non-local database

`vitest.config.ts` calls `assertLocalTestDatabase()` before a single test file is
collected, so the guard cannot be bypassed by a test that forgets to check.
The run fails, with a non-zero exit, unless **both** hold:

1. `TEST_ENV` is exactly `local`; and
2. `DATABASE_URL` parses as a `postgres:`/`postgresql:` URL whose host is one of
   `localhost`, `127.0.0.1`, `::1`, `[::1]`, `host.docker.internal`.

The URL itself is never printed in the failure, because it carries credentials.
Database tests are destructive; this is what keeps them away from a hosted
database.

## Cloudflare MCP servers

`.mcp.json` configures five Cloudflare-hosted MCP servers:

- `cloudflare-docs` — no auth. Look up current Cloudflare platform limits and
  behaviour here instead of recalling them; vendor limits (Worker size,
  startup time, CPU time, and the rest) change, so a figure that gates a
  decision must come from this server or the live docs, never from memory.
- `cloudflare-api` — sends `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`.
- `cloudflare-observability`, `cloudflare-bindings`, `cloudflare-graphql` —
  OAuth; sign in via the client's `/mcp` command on first use.

Two things to know before using `cloudflare-api`:

- `${CLOUDFLARE_API_TOKEN}` is expanded from the **shell environment that
  launches Claude Code**, not from `.env`. Export it in that shell before
  starting the client, or the server starts unauthenticated.
- `.mcp.json` holds only the variable reference. Never paste a token literally
  into `.mcp.json` — it is checked into the repository.

## Things that are not negotiable locally either

- Never edit anything under `deploy/` — those are the frozen design sources, and
  `pnpm check:frozen` fails on any change, addition or removal.
- Never commit `.env`, `.dev.vars`, or any credential, and never write one into
  an evidence file.
- Use synthetic data. The local database is disposable and must stay that way.
