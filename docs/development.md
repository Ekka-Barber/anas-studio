# Local development

How to run this repository locally (D29, D32). The site is a static Next.js
export; every server task is a Supabase Edge Function, served locally by the
Supabase CLI stack.

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

`pnpm db:env` (below) writes everything local development needs from the
running local stack: `.env.local` for Next and the tests, and
`supabase/functions/.env` for the Edge Functions. Both are git-ignored,
generated, local-only and safe to regenerate. `.env.example` lists the names
the hosted setup uses, in three groups: the Pages build (public
`NEXT_PUBLIC_*` values only), the Edge Function secrets, and Vault. Never
commit, print, log or paste a real value.

Nothing has a default. `src/lib/env.ts` (re-exporting
`supabase/functions/_shared/env.ts`) throws `MissingEnvError` for a missing
required variable rather than degrading to a fallback, so an unconfigured
feature is unavailable instead of quietly wrong.

- `DATABASE_URL` — the **non-pooled** PostgreSQL connection used by the CLI:
  migrations, imports and tests (D26). Nothing at runtime connects with a
  password.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — the
  public Supabase Data API, used by the build, the browser admin and the
  media URLs (`PLANS/ARCHITECTURE.md` "Three data paths").
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — the public site key the checkout page's
  Turnstile widget uses. `pnpm db:env` writes Cloudflare's documented
  always-pass test site key `1x00000000000000000000AA` (paired with the
  always-pass test secret in `supabase/functions/.env`), so the local widget
  renders and solves itself; a hosted deployment sets the real key
  (developers.cloudflare.com/turnstile/troubleshooting/testing).
- Edge Function values (`supabase/functions/.env` locally, `supabase secrets
  set` hosted): `SITE_URL` (the only origin `contact` accepts; a non-local
  value turns on real email and refuses test secrets), `JOBS_SECRET`,
  `TOKEN_HASH_PEPPER`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`,
  `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `EMAIL_DEV_MAILPIT_URL` (local
  only), and `ANALYTICS_TOKEN` / `CLOUDFLARE_ZONE_ID` for the owner
  statistics (unset locally, so `/admin/stats` honestly says «غير متاح»; the
  live account proof is gate E11). `SUPABASE_URL` and the service-role key
  are provided by Supabase to every function and never set by hand.

## Local database

```sh
pnpm db:start            # supabase start — Postgres, Auth, Storage, Edge runtime, Mailpit, ...
pnpm db:reset            # supabase db reset — rebuilds from supabase/migrations/
```

`supabase/migrations/` is the only migration history; there is no second,
hand-written schema stream. It also creates the two Storage buckets. The seed
(`supabase/seed.sql`) holds no data and no secret; never run
`supabase db push --include-seed` against the hosted project anyway.

The Edge Functions reach the database as `service_role` through the Data API
(D32); server-only SQL functions are granted to `service_role` alone, never to
`anon` or `authenticated`. Migrations run over `DATABASE_URL`, a separate
non-pooled connection.

`pnpm db:demo-catalog` seeds the local demo catalog (D37): three demo products
with their variants, seven city rates, the `DEMO10` coupon, the three demo
policy documents and local commerce settings with checkout enabled. It refuses
any non-loopback `DATABASE_URL` and is idempotent, so a second run writes
nothing.

## Staff admin (P03)

```sh
pnpm db:env              # writes .env.local and supabase/functions/.env from the running local stack
pnpm bootstrap:owner --email owner@example.com --name "الاسم"
```

`db:env` refuses to run against anything but a local `supabase status` API
host, and refuses to overwrite a file it did not generate itself. The Edge
Functions read `supabase/functions/.env` when the stack starts, so after the
first `db:env` restart the stack (`supabase stop && pnpm db:start`) or run
`supabase functions serve` in a second terminal.
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
served from `content/initial-content.json` — that file is only a fixture.
Public pages and `Header`/`Footer` are async server components that read
`published_documents` through the Data API at build time (`src/lib/content.ts`),
validated by the same Zod field model (`src/admin/collections/`,
`src/admin/fields.ts`) the admin form and the publish check use. `pnpm build`
writes the static site to `out/` and needs real published rows to fetch, not
just a running stack; `pnpm dev` renders the same pages on every request:

```sh
pnpm db:reset
pnpm db:import           # imports content/initial-content.json, skips already-published docs
pnpm db:env
pnpm build               # the static export in out/
pnpm check:export        # every page present, no secret in out/
```

`db:import` connects with `DATABASE_URL` (the local `postgres` superuser) and
calls `content_go_live()` directly, bypassing the actor-checked
`publish_version()` path — a one-time bootstrap import has no real staff
actor. Re-running it is a no-op unless `--force` is passed. Staff publish
drafts afterwards through `src/lib/admin-publish.ts` (`publishDocument`,
`scheduleDocument`, `cancelSchedule`, `archiveDocument`): the browser validates
the draft with `schemaFor()` and then calls the SQL function as the signed-in
staff member, which rechecks the role. Publishing records a site rebuild
request; on the hosted project pg_cron then calls the Pages deploy hook
(`site_build_trigger()`, at most once per two minutes). Locally there is no
hook, and `pnpm dev` shows the change at once.

```sh
TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db
```

also runs `tests/integration/{content,publish,static-site}.test.ts` — the
public loaders against the imported fixture, RLS on
`content_versions`/`content_documents`, the admin's publish path end to end
(success and the rebuild request, refusal for operations and anon, `INVALID`
drafts, stale-`seq` conflicts), and the D32 grants, buckets and job
coalescing.

### Editing content (P04 part 2)

Signed-in owners and editors see a "المحتوى" link in `/admin`'s nav, leading
to `/admin/content`: the four collections (`rooms`, `site_settings`, `posts`,
`taxonomies`). `/admin/content/[collection]` lists its documents — the four
fixed rooms and the one `site_settings` document always appear even before
they have been edited; `posts` and `taxonomies` add a "جديد" control that
creates a new document id (a generated uuid for posts, a typed slug for
taxonomies).

`/admin/content/[collection]/edit?id=<docId>` renders one field per the collection's
config (`src/admin/fields.ts`, `src/admin/collections/`), including the
Lexical rich-text editor for `posts.body` (only the nodes `src/admin/richtext.ts`
allowlists). "حفظ" appends the next `content_versions` row; a save based on a
document someone else changed since it was opened fails with a conflict
message and keeps the typed text — reload to see the newer version. Once the
saved draft validates, "نشر" publishes it; a document can also be scheduled
for a future Riyadh time, unscheduled, and (for `posts`/`taxonomies`) archived.
"معاينة" opens `/admin/preview?id=<room>` in a new tab: the latest saved
draft, read under RLS and drawn with the public room's own view component,
for the four built rooms. "سجل النسخ" lists
every saved version and can restore an older one as a new version.

## Media library (P05)

Images live in two Supabase Storage buckets (D32), created by the
migrations, and no server-side processing ever touches them (D15: no Sharp,
no Cloudflare Images, no WASM codec in `src/` or `supabase/functions/`; Sharp
is a devDependency for tests and scripts only):

- `media-private` (no policies, so only the service role reads or writes it):
  `originals/<id>` — the uploaded original, never served — and
  `quarantine/<id>/…`, where the parts wait until `media-complete` verifies
  every one (magic bytes, type, dimensions, exact byte counts).
- `media-public` (public read, `image/webp` only):
  `m/<id>/<width>.webp` — the verified derivatives, served from
  `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/media-public/`, a
  different origin from the site.

The upload runs through the `admin` Edge Function
(`supabase/functions/_shared/admin.ts`): `media-ticket` creates a 5-minute
ticket and one signed upload URL per part, the browser uploads each part
straight to Storage (`uploadToSignedUrl`), and `media-complete` checks and
promotes them; the ticket id becomes the media id. Public pages resolve media
ids to derivatives through `src/lib/content.ts`, and publishing a document
that references a deleted library image is refused. Staff-facing rules are in
`docs/media-rights.md`.

## Contact form, jobs and local email (P06)

`pnpm db:env` writes the local-only values the Edge Functions need into
`supabase/functions/.env` (and the same values into `.env.local`, for the
tests):

- `SITE_URL=http://localhost:3000` — the only origin `contact` accepts.
- `JOBS_SECRET` and `TOKEN_HASH_PEPPER` — fixed local strings (local only);
  the pepper salts the form's hashed caller key, the secret guards the
  `outbox` function.
- `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` — Cloudflare's
  documented always-pass test secret
  (developers.cloudflare.com/turnstile/troubleshooting/testing). It accepts
  any token; the tests send the dummy token `XXXX.DUMMY.TOKEN.XXXX`. A test
  secret is refused outright for a hosted `SITE_URL`.
- `EMAIL_DEV_MAILPIT_URL=http://host.docker.internal:54324` — with no
  `RESEND_API_KEY`, outbound mail goes to the local stack's Mailpit
  (http://127.0.0.1:54324 in the browser; the functions run in Docker, hence
  `host.docker.internal`), never to a real provider. It is refused for a
  hosted `SITE_URL`.
- `EMAIL_FROM` — the display address local mail is sent from.
- `RESEND_WEBHOOK_SECRET` — the Svix `whsec_…` form of a fixed local string,
  so tests can sign real webhook signatures.

The local functions answer at `http://127.0.0.1:54321/functions/v1/<name>`.
On the hosted project pg_cron runs the outbox (`outbox_kick()`, only while an
email is due); locally the Vault values it needs are unset on purpose, so run
it by hand:

```sh
curl -X POST -H "authorization: Bearer $JOBS_SECRET" http://127.0.0.1:54321/functions/v1/outbox
```

The reply is counts only (`{claimed, accepted, retry, permanent,
uncertain}`). Delivery events, suppression and the replay rules are in
`docs/operations.md`.

The P06 round 2 admin screens — the owner home (`/admin`), email problems
(`/admin/email`), statistics (`/admin/stats`, owner only, via the `admin`
function's `stats` action) and settings (`/admin/settings`, owner only) — are
client components under `AdminShell`; the browser reads data under RLS, and
the function verifies the staff token and owner role before its cache. There
is no inbox screen (D31): a contact message arrives as a notice in the
owner's mailbox — locally in Mailpit — with Reply-To set to the visitor.

## Running the application

```sh
pnpm db:start           # the local stack, with the Edge Functions
pnpm dev                # http://localhost:3000
```

`pnpm dev` renders every page on request against the local stack, so a
publish shows at once. The artifact that ships is the static export:

```sh
pnpm build              # writes out/
pnpm check:export       # every page present, no secret bundled
pnpm check:budgets      # initial public JavaScript under 150 KiB gzip
```

`out/` can be served by any static file server for a smoke test; Cloudflare
Pages serves it in production, with `public/_headers` (copied into `out/`)
setting the response headers.

## Tests and checks

```sh
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest unit tests (tests/unit)
pnpm test:db         # vitest integration tests against a real local PostgreSQL
pnpm test:e2e        # playwright against next dev and the local functions
pnpm check:frozen    # re-hashes deploy/ against the recorded manifest
pnpm check:copy      # Latin digits only, no placeholder copy
pnpm check:budgets   # public JavaScript budget, on out/
pnpm check:export    # the static export is complete and holds no secret
pnpm check           # lint + typecheck + check:frozen + check:copy + test
```

`pnpm test:e2e` starts `pnpm dev` itself unless one is already running at
`http://localhost:3000` (the origin the local `contact` function accepts); it
needs the local stack with the functions serving. Its report goes to the
git-ignored `test-results/playwright-report/`; for a package acceptance run, set
`ACCEPTANCE_PACKAGE=P06` (for example) to keep the report under
`artifacts/acceptance/P06/` instead. Accepted reports of other packages are
never touched.

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
  behaviour here instead of recalling them; vendor limits (Pages builds,
  file counts and sizes, and the rest) change, so a figure that gates a
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
- Never commit `.env`, `.env.local`, `supabase/functions/.env`, or any
  credential, and never write one into an evidence file.
- Never seed or reset the hosted Supabase project from a local run.
- Use synthetic data. The local database is disposable and must stay that way.
