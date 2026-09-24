# Local development

How to run this repository locally (D29).

## Prerequisites

| Tool | Version | Where it is pinned |
| --- | --- | --- |
| Node.js | 24.19.0 | `.node-version`, and `engines.node` (`>=24.9.0 <25`) in `package.json` |
| pnpm | 10.33.0 | `packageManager` in `package.json` |
| Docker | any recent release | runs the Supabase CLI stack |
| Supabase CLI | 2.106.0 | `supabase.toolVersion` (see `supabase/config.toml`) |

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
  migrations and local tooling (D26). It is never used to serve a request.
- `SITE_URL` — the Worker's own origin, so in local preview it must be the
  preview origin (`http://127.0.0.1:8787`), not the production domain.
- `REVALIDATE_SECRET` — bearer secret for `POST /api/revalidate` (I20, D29).
  The Worker checks it; the Supabase admin sends it when a publish-affecting
  save or delete needs the public cache invalidated. Unset on either side
  means no open fallback.
- `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` — the local
  `app_server` URL that wrangler points the `HYPERDRIVE` binding at during
  local development. Never point it at the hosted project.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the
  public Supabase Data API, used by the browser admin and by public Worker
  reads (`PLANS/ARCHITECTURE.md` "Three data paths").

## Local database

```sh
pnpm db:start            # supabase start — Postgres, Auth, Studio, Mailpit, ...
pnpm db:reset            # supabase db reset — rebuilds from supabase/migrations/
```

`supabase/migrations/` is the only migration history; there is no second,
hand-written schema stream. `supabase db reset` also applies `supabase/seed.sql`,
which sets the local-only `app_server` login password
(`app_server_local_only`) — never applied to the hosted project
(`supabase db push --include-seed` must never be used). The hosted
`app_server` password is set by the owner out of band and lives only in the
Hyperdrive configuration.

The Worker's only database login is `app_server`: no RLS bypass, no DDL, no
table grants — EXECUTE on named `public` functions only (D26). Migrations run
over `DATABASE_URL`, a separate non-pooled connection, and never over the
Hyperdrive/transaction-pooler path used by requests — the transaction pooler
rejects named prepared statements, which is what migration DDL uses (see
`docs/runtime-spike.md`).

## Staff admin (P03)

```sh
pnpm db:env              # writes .env.local from the running local stack
pnpm bootstrap:owner --email owner@example.com --name "الاسم"
```

`db:env` refuses to run against anything but a local `supabase status` API
host, and refuses to overwrite an `.env.local` it did not generate itself.
`bootstrap:owner` refuses once any `staff` row exists — after that, invite
further members from `/admin/team`.

Sign in at `/admin/sign-in` with the bootstrapped email; the 6-digit code
arrives at Mailpit, `http://127.0.0.1:54324` (`MAILPIT_URL`), not a real inbox.
Enrol the authenticator app at `/admin/security` before using `/admin/team`:
invite, role change and revoke all require a TOTP code from the last 5 minutes.

```sh
TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db
```

runs `tests/integration/{staff,staff-admin}.test.ts` — RLS and grants through
real JWTs, and the `staff-admin` Edge Function end to end, against the running
local stack (`supabase status`). `tests/e2e/auth.spec.ts` exercises sign-in,
TOTP enrolment and an invite through the browser; it expects `next dev` and
the local stack running, and creates its own owner with the local service key.

## Running the application

`pnpm dev` runs Next.js with the Cloudflare bindings simulated by wrangler, so
`HYPERDRIVE` and `R2` behave as they do in the Worker:

```sh
pnpm dev                # http://localhost:3000
```

To run the artifact that actually ships — the OpenNext Worker — build it
first; `preview:worker` serves an existing build and does not create one.
**`pnpm build:worker` fails on Windows (I05)**: OpenNext is not fully
Windows-compatible and fails while copying traced files (`EPERM` on
`symlink`). Build it on Linux — a container or CI:

```sh
pnpm build
pnpm build:worker
pnpm preview:worker     # http://127.0.0.1:8787
```

`preview:worker` needs `.dev.vars` (at minimum `SITE_URL`) and the Hyperdrive
local connection string in the environment. It also runs
`opennextjs-cloudflare`'s own `populateCache` step first (local target): this
creates the D1 `revalidations` table used by the tag cache in wrangler's local
D1 simulation and uploads the built static/ISR cache entries to the local R2
simulation, before `wrangler dev` starts — see
`node_modules/@opennextjs/cloudflare/dist/cli/commands/{preview,populate-cache}.js`.

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
database. The same applies to `pnpm db:reset`: never run it against the
hosted Supabase project.

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
- Never seed or reset the hosted Supabase project from a local run.
- Use synthetic data. The local database is disposable and must stay that way.
