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
- `ANALYTICS_TOKEN` / `CLOUDFLARE_ZONE_ID` — the Cloudflare GraphQL
  Analytics API token and zone for the owner statistics (P06). Unset (the
  local default) means `/admin/stats` honestly says «غير متاح»; no network
  call is made. Set both as Worker secrets before the launch build; the live
  account proof is gate E11 (P11).

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

## Content (P04)

The four rooms, the site nav/footer and other public copy are no longer
served from `content/initial-content.json` at request time — that file is
only a fixture. Public pages and `Header`/`Footer` are async server
components that read `published_documents` through the Data API
(`src/lib/content.ts`), validated by the same Zod field model
(`src/admin/collections/`, `src/admin/fields.ts`) the publish action and the
admin form use. Because room pages are statically generated, `pnpm build`
needs real published rows to fetch, not just a running stack:

```sh
pnpm db:reset
pnpm db:import           # imports content/initial-content.json, skips already-published docs
pnpm db:env
pnpm build
```

`db:import` connects with `DATABASE_URL` (the local `postgres` superuser, not
`app_server`) and calls `content_go_live()` directly, bypassing the
actor-checked `publish_version()` path — a one-time bootstrap import has no
real staff actor. Re-running it is a no-op unless `--force` is passed. Staff
publish drafts afterwards through `src/lib/publish.ts` (`publishDocument`,
`scheduleDocument`, `cancelSchedule`, `archiveDocument`), which verifies the
caller's staff token, validates the draft with `schemaFor()`, and revalidates
`content:<collection>` / `content:<collection>:<docId>` tags on success.

```sh
TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db
```

also runs `tests/integration/{content,publish}.test.ts` — the public loaders
against the imported fixture, RLS on `content_versions`/`content_documents`,
and `publishDocument`/`scheduleDocument`/`archiveDocument` end to end
(success, `FORBIDDEN` for non-editors, `INVALID` drafts, stale-`seq` 409s).

### Editing content (P04 part 2)

Signed-in owners and editors see a "المحتوى" link in `/admin`'s nav, leading
to `/admin/content`: the four collections (`rooms`, `site_settings`, `posts`,
`taxonomies`). `/admin/content/[collection]` lists its documents — the four
fixed rooms and the one `site_settings` document always appear even before
they have been edited; `posts` and `taxonomies` add a "جديد" control that
creates a new document id (a generated uuid for posts, a typed slug for
taxonomies).

`/admin/content/[collection]/[docId]` renders one field per the collection's
config (`src/admin/fields.ts`, `src/admin/collections/`), including the
Lexical rich-text editor for `posts.body` (only the nodes `src/admin/richtext.ts`
allowlists). "حفظ" appends the next `content_versions` row; a save based on a
document someone else changed since it was opened fails with a conflict
message and keeps the typed text — reload to see the newer version. Once the
saved draft validates, "نشر" publishes it; a document can also be scheduled
for a future Riyadh time, unscheduled, and (for `posts`/`taxonomies`) archived.
"معاينة" opens the draft on the live site through the existing preview cookie
(`src/app/api/preview/`), for rooms and `site_settings` only. "سجل النسخ" lists
every saved version and can restore an older one as a new version.

## Media library (P05)

Images live in two R2 buckets, not Supabase Storage, and no server-side
processing ever touches them (D15: no Sharp, no Cloudflare Images, no WASM
codec in `src/`; Sharp is a devDependency for tests and scripts only):

- `R2` (private): `originals/<id>` — the uploaded original, never served — and
  `quarantine/<id>/<width>.webp`, where derivatives wait until
  `POST /api/media/complete` verifies every part (magic bytes, type,
  dimensions, exact byte counts) before promotion.
- `MEDIA_PUBLIC` (public): `m/<id>/<width>.webp` — the verified derivatives.

Locally both are wrangler's simulated buckets, so `pnpm dev` exercises the
same binding path as the Worker. The `MEDIA_PUBLIC` bucket
(`anas-studio-media-public-test`) does not exist in Cloudflare yet; the
owner's P11 deploy step creates it. No `wrangler` remote command is used
before that.

`GET /media/<...>` is a local stand-in for the production media origin: it
serves only `m/<uuid>/<width>.webp` from `MEDIA_PUBLIC`, with `nosniff` and a
sandboxing CSP. When `NEXT_PUBLIC_MEDIA_ORIGIN` is set (the custom domain on
the public bucket, configured in P11), the route stops answering — production
serves media from that isolated origin instead. The variable is read through
the literal `process.env.NEXT_PUBLIC_MEDIA_ORIGIN` access
(`MEDIA_ORIGIN` in `src/lib/media-ref.ts`), so Next inlines it **at build
time** in both server and client bundles: unset at build, the local stand-in
`/media` route is what the build serves. A production build must therefore be
made with the real origin set.

Uploads go through `POST /api/media/upload` (a 5-minute server-owned ticket,
then `PUT ?ticket=<uuid>&part=<original|wNNN>` per part) and
`POST /api/media/complete`; the ticket id becomes the media id. Public pages
resolve media ids to derivatives through `src/lib/content.ts`, and publishing
a document that references a deleted library image is refused. Staff-facing
rules are in `docs/media-rights.md`.

## Contact form, jobs and local email (P06)

`pnpm db:env` also writes the local-only values the contact form and the
email outbox need into `.env.local`:

- `JOBS_SECRET` and `TOKEN_HASH_PEPPER` — fixed local strings (local only);
  the pepper salts the form's hashed caller key, the secret guards
  `POST /api/jobs/run`.
- `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` — Cloudflare's
  documented always-pass test secret
  (developers.cloudflare.com/turnstile/troubleshooting/testing). Locally the
  Turnstile check accepts only the dummy token `XXXX.DUMMY.TOKEN.XXXX`. A
  test secret is refused outright in production.
- `EMAIL_DEV_MAILPIT_URL=http://127.0.0.1:54324` — with no
  `RESEND_API_KEY`, outbound mail goes to the local stack's Mailpit
  (http://127.0.0.1:54324 in the browser), never to a real provider. A
  non-loopback URL or production `NODE_ENV` is refused.
- `EMAIL_FROM` — the display address local mail is sent from.
- `RESEND_WEBHOOK_SECRET` — the Svix `whsec_…` form of a fixed local string,
  so tests can sign real webhook signatures.

Run the outbox by hand (the Worker's cron trigger does this in production):

```sh
curl -X POST -H "authorization: Bearer $JOBS_SECRET" localhost:3000/api/jobs/run
```

The reply is counts only (`{claimed, accepted, retry, permanent,
uncertain}`). Delivery events, suppression and the replay rules are in
`docs/operations.md`.

The P06 round 2 admin screens — the owner home (`/admin`), the inbox
(`/admin/inbox`), email problems (`/admin/email`), statistics
(`/admin/stats`, owner only, via `GET /api/admin/stats`) and settings
(`/admin/settings`, owner only) — are client components under
`AdminShell`; the browser reads data under RLS, and the statistics route
verifies the staff token and owner role server-side before its cache.


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
