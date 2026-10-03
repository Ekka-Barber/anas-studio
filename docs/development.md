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
| Supabase CLI | 2.106.0 | `version:` of the `supabase/setup-cli` step in `.github/workflows/ci.yml` |

`.npmrc` sets `engine-strict=true`, `strict-peer-dependencies=true` and
`save-exact=true`: a wrong Node version, an unresolved peer range or a floating
version fails loudly instead of being silently accepted.

```sh
corepack enable          # activates the pnpm version from packageManager
pnpm install --frozen-lockfile
```

## Environment

`pnpm db:env` (below) writes the values Next, the Edge Functions and the
tests read from the running local stack: `.env.local` for Next and the tests,
and `supabase/functions/.env` for the Edge Functions. `DATABASE_URL` (and
`TEST_ENV` for `pnpm test:db`) are not written: pass them on the command
line, as in the commands below. Both files are git-ignored,
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
  live account proof is gate E11). From P08 the Moyasar values
  `MOYASAR_API_BASE_URL`, `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`,
  `PAYMENTS_MODE` and `FUNCTIONS_PUBLIC_URL` (and `PAYMENTS_TEST_ACCESS_CODE`,
  for a hosted site in test mode only; see "Payments locally (P08)").
  `SUPABASE_URL` and the service-role key
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

`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:demo-catalog`
seeds the local demo catalog (D37): three demo products
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
further members from `/admin/team`. A failed invite can leave an Auth user with
no staff row; the next invite of that address adopts it (docs/operations.md,
"Team invites and admin function errors").

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

The rooms, the book page, the site nav/footer and other public copy are no longer
served from `content/initial-content.json` — that file is only a fixture.
Public pages and `Header`/`Footer` are async server components that read
`published_documents` through the Data API at build time (`src/lib/content.ts`),
validated by the same Zod field model (`src/admin/collections/`,
`src/admin/fields.ts`) the admin form and the publish check use. `pnpm build`
writes the static site to `out/` and needs real published rows to fetch, not
just a running stack; `pnpm dev` renders the same pages on every request:

```sh
pnpm db:reset
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:import   # imports content/initial-content.json, skips already-published docs
pnpm db:env
pnpm build               # the static export in out/
pnpm check:export        # the 59 required files (every public and admin page) present, no secret in out/
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
to `/admin/content`: the six collections (`rooms`, `site_settings`, `posts`,
`taxonomies`, `policies`, and `scenes`, whose one document `gallery` holds the
scenes, C05). `/admin/content/[collection]` lists its documents — the four
fixed rooms, the one `site_settings` document, the four policies and the `gallery` always appear
even before they have been edited; `posts` and `taxonomies` add a "جديد" control that
creates a new document id (a generated uuid for posts, a typed slug for
taxonomies).

`/admin/content/[collection]/edit?id=<docId>` renders one field per the collection's
config (`src/admin/fields.ts`, `src/admin/collections/`), including the
Lexical rich-text editor for `posts.body` (only the nodes `src/admin/richtext.ts`
allowlists). "حفظ" appends the next `content_versions` row; a save based on a
document someone else changed since it was opened fails with a conflict
message and keeps the typed text — reload to see the newer version. Once the
saved draft validates, "نشر" publishes it; a document can also be scheduled
for a future Riyadh time (a year of four digits, in the future), unscheduled,
and (for `posts`/`taxonomies`) archived. A schedule belongs to one version: the
list says «مجدول في <date>», and when a later save exists it adds
«: نسخة N، وهناك تعديلات أحدث غير مجدولة». The publish bar says
«مجدول: نسخة N في <date>.»; when the schedule is behind the latest save it also
says which version will go live and offers «جدولة النسخة M في الموعد نفسه».
A post slug another live post uses is refused at schedule or publish time with
«معرّف المقال مستخدم في مقال منشور آخر؛ غيّره ثم أعد المحاولة.». Unsaved text
is kept as a local copy and offered back in a banner («استرجاع» / «تجاهل»);
the rules are in `docs/operations.md`, "The owner's routine". The admin screens
sit under `src/app/(admin)/admin/(shell)/`, whose layout mounts `AdminShell`
once (nav, focus and the role are kept between screens; the role is read once
and shared through `useStaffRole()`); the sign-in page and the full-width
preview stay outside the group, and the URLs do not change.
"معاينة" opens `/admin/preview?id=<room>` (a journal post:
`/admin/preview?collection=posts&id=<post>`) in a new tab: the latest saved
draft, read under RLS and drawn with the public view component of the room or
the post, for the four built rooms and the posts. The home page and the
scenes have no preview. "سجل النسخ" lists
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
promotes them; the ticket id becomes the media id. A Storage failure other
than a missing part answers 500 from `media-complete`, never 422 (that would
blame the upload). Public pages resolve media ids to derivatives, and to the
image's alt text (`alt_ar`, carried inside the media reference), through
`src/lib/content.ts`; `anon` may read only `id`, `derivatives` and `alt_ar` of a
published image, and the `alt_ar` grant comes with migration
`20260930140000_audit2_fixes.sql`, which must be applied before a build
that reads it. Publishing a document
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

## Payments locally (P08)

Payments run against a local stand-in for Moyasar, never against Moyasar. The
only calls ever made to Moyasar from this repository were one owner-approved
sandbox pass of 2026-10-02 that created, read, listed and cancelled eight test
invoices (no payment; [payments-runbook](payments-runbook.md#what-the-sandbox-answered-2026-10-02),
"What the sandbox answered"); E02 and E03 are open.

**The values.** `pnpm db:env` writes the five payment values into
`supabase/functions/.env` and, for the tests, `.env.local`:
`MOYASAR_API_BASE_URL` (the emulator as the functions' container reaches it,
`http://host.docker.internal:54390/v1`), `MOYASAR_SECRET_KEY` and
`MOYASAR_WEBHOOK_SECRET` (fixed local strings the emulator accepts: they are not
credentials, and the runbook's emulator section names them), `PAYMENTS_MODE`
(`test`) and `FUNCTIONS_PUBLIC_URL` (the stack's API address plus
`/functions/v1`). `PAYMENTS_TEST_ACCESS_CODE` is not written: it exists only for a
hosted site in test mode. `paymentsConfig()` refuses `PAYMENTS_MODE=live` for a
local site, and `pnpm check:export` fails a built export that holds either local
string or any `sk_test_` or `sk_live_` key shape. As for the P06 values, restart
the functions after the first `db:env`.

**The emulator.** `pnpm emulator` starts `tests/support/moyasar-emulator.ts` on
`127.0.0.1:54390` (Node 24 runs the file directly; it refuses to start when
`SITE_URL` names a hosted site). It implements only the documented Moyasar
routes, a stand-in for the hosted invoice page at `/invoices/<id>` (pay, fail,
3-D Secure, back) and the `/__emulator/*` control routes and switches that the
tests and a developer use to pay, refund, void, delay, drop or repeat things.
The routes, the switches, the faults and what the emulator chooses where
Moyasar's documentation is silent are all in
[payments-runbook](payments-runbook.md#the-local-emulator). Playwright starts it
by itself and reuses one that is running;
the database tests that need it start their own.

**Reconciling by hand.** Locally the Vault values that let pg_cron call the
functions are unset, so the payment job does not run by itself. Run it as the
email job (`JOBS_SECRET` from `supabase/functions/.env`, never pasted anywhere):

```sh
curl -X POST -H "authorization: Bearer $JOBS_SECRET" -H "content-type: application/json" \
  -d '{"job":"payments_reconcile"}' http://127.0.0.1:54321/functions/v1/outbox
```

The reply is counts only (`attempts`, `events`, `refunds`, `settled`, `cancelled`,
`errors`, `skipped`). `{"job":"media_sweep"}` runs the media sweep the same way.

**What the P08 rounds learned about the local stack.**

- The edge runtime does not reload `supabase/functions/_shared` on its own. After
  an edit under `supabase/functions`, run
  `docker restart supabase_edge_runtime_ANASAQ.ME` before any test that calls a
  function over HTTP (`pnpm test:db` needs it too). If the functions answer 503
  the container has exited: `docker start supabase_edge_runtime_ANASAQ.ME`.
- If sign-in e2e tests fail with `fetch failed: other side closed`, Mailpit's
  forwarded port (54324) died after a Docker restart while its container still
  runs: `docker restart supabase_inbucket_ANASAQ.ME`.
- After a change to `supabase/config.toml` (the Auth hook lives there), restart
  with `supabase stop` then `supabase start`, never `--no-backup`.
- Test runs add staff, orders and mail every time. Past about 1,000 staff rows the
  team screen (PostgREST's `max_rows`) hides a new invite and `auth.spec.ts`
  fails. Before an acceptance battery, check that every local row is test data,
  then `pnpm db:reset`, both imports (`pnpm db:import` and `pnpm db:demo-catalog`,
  with `DATABASE_URL` as above) and a restart of the edge runtime. Never against
  the hosted project.
- Check free memory before a full e2e run: at about 6 GB free it crashes, 10 GB
  or more is safe. After every e2e run, restore `next-env.d.ts` (the dev server
  rewrites this tracked file: `git restore next-env.d.ts`), and remove
  `.next/e2e` if `pnpm typecheck` then fails on truncated generated types
  (TS1128).
- Mail made by a run counts against the day's sends (`docs/operations.md`, "The
  mail budget"): confirmation and availability mail (priority 2) stops at 50 a
  day, so a spec that waits for one can find the budget spent (the email job's
  last run says `QUOTA_HELD`).

**Running the P08 tests.** The file that proves each rule is in the contract's
test matrix (`PLANS/P08-CONTRACT.md`, section 11).

- **Unit:** `pnpm test`. No stack is needed: the client tests start the emulator
  inside the process.
- **Database:**
  `TEST_ENV=local DATABASE_URL=<DB_URL from supabase status -o json> pnpm exec vitest run --mode db tests/integration/<file>`,
  with the edge runtime up. The files that call the real functions over HTTP
  (`payment-http`, `checkout-http`, `refunds-http`, `orders-http`, `disputes-http`
  and `notify-http`) need it restarted after any `_shared` edit. `payment-http`,
  `checkout-http`, `refunds-http` and `orders-http` start their own emulator on
  port 54390 and stop with a message when the port is busy: stop a running
  `pnpm emulator`, or a Playwright run, first.
- **End to end:** `pnpm exec playwright test tests/e2e/<spec>`. These need the
  emulator, which Playwright starts: `cart-checkout.spec.ts`,
  `checkout-api.spec.ts` and `orders.spec.ts`. These do not: `order-page.spec.ts`
  and `product-availability.spec.ts` (the functions they test are mocked where the
  spec says so, and Cloudflare's Turnstile script is stubbed), and
  `orders-admin.spec.ts`, `orders-money.spec.ts` and the P08 block of
  `store-admin.spec.ts` (the variant form's preorder fields and paid file, the
  sign-ups list and the commerce figures) (the real stack with a real sign-in;
  the money spec mocks the `admin` function's replies). A spec that loads
  Cloudflare's Turnstile test widget needs the network.
- **The journeys spec**, `tests/e2e/orders.spec.ts` (ten journeys at 360 and 1440
  px, no mocks), takes 7 to 11 minutes for both widths, depending on the
  machine's load. Run it in the background with Playwright's own
  `--global-timeout`, and never under a shorter outer cap (a foreground tool's
  10 minute limit, a `timeout` wrapper): Playwright's own global timeout still
  lets the spec's cleanup run, but a killed run skips it and leaves published test
  products, enabled shipping rates, active test staff and the test seller behind.
  `-g "at 360px"` or `-g "at 1440px"` runs one width.

  ```sh
  pnpm exec playwright test tests/e2e/orders.spec.ts --global-timeout=900000 --reporter=list
  ```

  Reset the database first when test rows have piled up. After a killed run,
  retire what it left with `pnpm db:reset`, both imports and an edge runtime
  restart (`pnpm db:demo-catalog` also restores the demo seller the spec replaced).
  The spec's screenshots go to `test-results/screenshots/P08`, or to
  `artifacts/acceptance/P08/screenshots` only for an `ACCEPTANCE_PACKAGE=P08` run.

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
pnpm check:budgets      # initial public JavaScript under 150 KiB gzip; fails on an empty export or a page with no /_next/static script
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
pnpm check:copy      # Latin digits only, no placeholder copy (src, supabase/functions, content, scripts; .ts .tsx .json .mjs)
pnpm check:budgets   # public JavaScript budget, on out/
pnpm check:export    # the static export has all 59 required files and holds no secret
pnpm check           # lint + typecheck + check:frozen + check:copy + test
```

`pnpm test:e2e` starts `pnpm dev` itself unless one is already running at
`http://localhost:3000` (the origin the local `contact` function accepts); it
needs the local stack with the functions serving, and it starts the local
Moyasar emulator (`pnpm emulator`, port 54390) unless one is already running.
Its report goes to the
git-ignored `test-results/playwright-report/`; for a package acceptance run, set
`ACCEPTANCE_PACKAGE=P06` (for example) to keep the report under
`artifacts/acceptance/P06/` instead. Accepted reports of other packages are
never touched.

Spec screenshots follow the same rule: they go to
`artifacts/acceptance/<pkg>/screenshots` only when `ACCEPTANCE_PACKAGE` names
the spec's own package (P05 media, P06 owner-operations, P07
cart-checkout and store-admin's P07 block, P08 orders, order-page, orders-admin,
orders-money, product-availability and store-admin's P08 block, DESIGN-B visual), and to
`test-results/screenshots/<pkg>` otherwise. Another package's acceptance run
(for example AUDIT-1) therefore leaves them under `test-results/`.

The e2e tests that edit content (`cms.spec`, `media.spec`) change live
documents and put them back in `afterEach`. If a run is killed hard, restore
the fixture by hand with
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:import --force`.
The P08 journeys spec cleans up after itself too, and what a killed run leaves
behind is described in "Payments locally (P08)".

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
