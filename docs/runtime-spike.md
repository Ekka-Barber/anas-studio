# P00 runtime spike — local evidence

What this document is: the recorded result of the **local half** of the P00
exact-runtime spike. It states what was executed, what was measured, and what
each measurement does and does not prove.

**Withdrawn by D29, not failed:** the Payload admin login, CRUD, upload and
native-job criteria, and the Oracle VM admin target (I19 part 1). A custom
Supabase admin replaces them (`PLANS/ARCHITECTURE.md`). Everything below that
is still true of the current Worker — the public route, ISR caching, the
revalidate gate, the transaction-pooler findings, the R2/no-Sharp proof and
the bundle-size measurement — is kept. Payload- and VM-specific narrative is
cut; `docs/admin-vm.md` no longer exists.

What it is not: a hosted result. Nothing here was deployed. Every claim about
production behaviour on Cloudflare — cold start, warm latency, the real
compressed upload size, Hyperdrive against the actual Supabase pooler from a
Worker — is explicitly listed as unproven at the end. Hosted re-measurement
against the D29 Worker belongs to P10.

Raw evidence lives beside this document:

- `artifacts/acceptance/P00/commands.txt` — every command, its exit code, its result
- `artifacts/acceptance/P00/pooler-probe.txt` — the Supabase pooler probe
- `artifacts/acceptance/P00/worker-bundle.txt` — bundle size and the no-Sharp proof
- `artifacts/acceptance/P00/runtime-requests.txt` — recorded HTTP transcript
- `artifacts/acceptance/P00/screenshots/` — the public route
- `artifacts/acceptance/P00/playwright-report/` — the end-to-end run
- `artifacts/acceptance/P00/d29-swap/` — the D29 teardown/wiring evidence

## What ran, and where

Two hosts were used, deliberately:

- **Windows host** — install, lint, typecheck, unit tests, the frozen/copy
  checks, `next build`, and the Playwright run.
- **Linux container** (`node:24-bookworm-slim`) — `pnpm build:worker` and
  `pnpm preview:worker`, against a second container running `postgres:17-alpine`.

`pnpm build:worker` **fails on Windows** and this is an environment limitation,
not a code defect. OpenNext prints `WARN OpenNext is not fully compatible with
Windows` and then fails while copying traced files:

```
Error: EPERM: operation not permitted, symlink
  'node_modules\.pnpm\@next+env@16.3.5\node_modules\@next\env'
  -> '.open-next\server-functions\default\node_modules\.pnpm\next@16.3.5_...\node_modules\@next\env'
  errno: -4048, code: 'EPERM', syscall: 'symlink'
```

Windows refuses symlink creation without Developer Mode or elevation. The same
command exits 0 on Linux. This is one concrete reason the plan requires a Linux
CI to build the real OpenNext artifact, and `.github/workflows/ci.yml` does
exactly that.

## Database: pooler findings and what they force

Full probe output: `artifacts/acceptance/P00/pooler-probe.txt`.

| Observation | Value |
| --- | --- |
| Transaction pooler | port 6543, `application_name = Supavisor`, server 17.6 |
| `max_connections` reported by the pooler | 60 |
| Named prepared statement on the pooler | **rejected** (`prepared statement "..." already exists`) |
| Unnamed parameterised query on the pooler | accepted |
| Named prepared statement on the 5432 session endpoint | accepted |
| `SET` outside a transaction | survived on the same pooled connection (`pooler-probe.txt:13`); the operative rule is unchanged — never rely on session state across requests, since a later request can land on a different backend |
| `SET LOCAL` inside a transaction | honoured inside, gone after commit |
| Transaction rollback | effective (`relation ... does not exist` after rollback) |
| Read-after-write across pooled connections | visible immediately |
| Concurrent connections opened | 20, no failure |

What this forces, and where it is enforced:

1. **Runtime traffic never uses named prepared statements.** `src/lib/db.ts`
   configures node-postgres with no statement name, so it uses the unnamed
   extended query protocol — the only thing a transaction-mode pooler supports.
2. **Migrations use a different endpoint and different credentials** (D26).
   Migration DDL is exactly the workload the pooler rejects, so migrations run
   over `DATABASE_URL`, a separate non-pooled connection, and never over the
   Hyperdrive path.
3. **No session state may be assumed between requests.** `SET` survived on the
   connection that issued it (see the table above), but a transaction-mode
   pooler does not guarantee the same backend across separate requests, so
   anything session-scoped still has to be `SET LOCAL` inside the transaction
   that needs it.
4. **The isolate holds no meaningful pool.** `src/lib/db.ts` opens one
   `pg.Client` per call and always ends it; the pool that matters is
   Hyperdrive's. Hyperdrive query caching is disabled on the configuration so
   the health probe and future authorization/inventory reads always reach
   PostgreSQL.

## Worker bundle size

Measured from the built artifact, not estimated from dependencies. Method and
raw numbers: `artifacts/acceptance/P00/worker-bundle.txt`.

Cloudflare's Worker size limit is **64 MiB, measured on the uncompressed
bundle, identical on the Free and Paid plans**. There is no compressed size
limit; gzip figures are informational only, not a gate
(`developers.cloudflare.com/workers/platform/limits/`, verified 2026-09-22).
`wrangler deploy --dry-run` reports the authoritative uncompressed figure as
`Total Upload`. The pre-D29 Payload build measured **25,338 KiB** (`Total
Upload: 25320.88 KiB`); the D29 swap evidence
(`artifacts/acceptance/P00/d29-swap/commands.txt`) records the current figure
against that baseline.

The surviving Free-plan risks are **not** bundle size:

- **Worker startup time: 1 second**, enforced at deploy time as error 10021
  and reported as `startup_time_ms`. Larger bundles and expensive global-scope
  initialization increase startup time, so this bundle's size is still a
  relevant input to that gate, just not the gate itself.
- **CPU time: 10 ms per invocation on the Free plan.** Neither risk is
  resolved by a dry run; both are measured by an actual deploy.

## No Sharp, no native image resize

Proved against the built artifact (`artifacts/acceptance/P00/worker-bundle.txt`):

- `find .open-next -name "*.node"` returns nothing — the artifact contains no
  compiled native module at all.
- `next.config.ts` sets `images: { unoptimized: true }`, so Next's image
  optimizer — the only remaining code path that would reach a native resizer —
  is off by configuration rather than by luck (D15).

## Route precedence and the public/health split

`GET /api/health` → `200`, `cache-control: no-store`, `x-robots-tag: noindex`,
body `{"ok":true,"data":{"status":"ok",...}}`, reached through `app_server`
via `src/lib/db.ts` and `public.health()` (D26/D29). `GET /` →
`<html lang="ar" dir="rtl">`. The health response carries no hostname,
credential or stack trace; the end-to-end test asserts that its body contains
neither `postgres` nor `HYPERDRIVE`.

## Commands and exit codes

Re-run in full against the final tree on 2026-09-22 (pre-D29); the D29 swap's
own commands and exit codes are in
`artifacts/acceptance/P00/d29-swap/commands.txt`.

| Command | Host | Exit |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Windows | 0 |
| `pnpm lint` | Windows | 0 |
| `pnpm typecheck` | Windows | 0 |
| `pnpm test` | Windows | 0 |
| `pnpm check:frozen` | Windows | 0 (59 files under `deploy/` unchanged) |
| `pnpm check:copy` | Windows | 0 (19 source files) |
| `pnpm build` | Windows | 0 |
| `pnpm build:worker` | Windows | **1** — EPERM on symlink, see above |
| `pnpm build` | Linux container | 0 |
| `pnpm build:worker` | Linux container | 0 — real `.open-next/worker.js` |
| `pnpm test:db` | Windows | **1**, by design — `TEST_ENV must be exactly "local"` |
| `TEST_ENV=local pnpm test:db` | Windows | **1**, by design — `DATABASE_URL does not point at a local PostgreSQL host` |

The last two are the guard working: database tests are destructive, and the
configured `DATABASE_URL` is a hosted endpoint. The check runs in
`vitest.config.ts` before any test file is collected, and the refusal never
prints the URL.

## Still unproven — everything hosted

None of the following is established by anything in this document, and none of
it may be treated as passing because the local half passed. Hosted
re-measurement against the current, D29 Worker is P10's job.

1. **Deployment itself, against this Worker.** The pre-D29 measurements above
   include a `wrangler deploy --dry-run` (no upload) and a since-superseded
   real deploy attempt; neither proves cold start, warm latency, or CPU time
   for the current code.
2. **Cold start and warm request latency on Workers**, with sample counts, and
   measured against the current published Free limits. Local `wrangler dev`
   numbers are not a substitute.
3. **Hyperdrive against the real Supabase pooler from a deployed Worker.** The
   pooler was probed from Node over the network, and the binding was exercised
   only against a local container through wrangler's local simulation.
4. **Real R2.** Uploads round-tripped through wrangler's local object store,
   not a hosted bucket, and private-bucket access control has not been proved
   against r2.dev.
5. **Everything gated on credentials this run did not have.** Missing hosted
   credentials or authorization is an external blocker, never a local pass.

Additional open items:

- `pnpm build:worker` cannot run on the Windows host (EPERM on symlink); the
  Linux path is the only one proven.
