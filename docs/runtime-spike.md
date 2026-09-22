# P00 runtime spike — local evidence

What this document is: the recorded result of the **local half** of the P00
exact-runtime spike. It states what was executed, what was measured, and what
each measurement does and does not prove.

What it is not: a hosted result. Nothing here was deployed. Every claim about
production behaviour on Cloudflare — cold start, warm latency, scheduled CPU,
the real compressed upload size, cron delivery, Hyperdrive against the actual
Supabase pooler from a Worker — is explicitly listed as unproven at the end.

Raw evidence lives beside this document:

- `artifacts/acceptance/P00/commands.txt` — every command, its exit code, its result
- `artifacts/acceptance/P00/pooler-probe.txt` — the Supabase pooler probe
- `artifacts/acceptance/P00/worker-bundle.txt` — bundle size and the no-Sharp proof
- `artifacts/acceptance/P00/runtime-requests.txt` — recorded HTTP transcript
- `artifacts/acceptance/P00/screenshots/` — admin bootstrap, login, logout, re-login
- `artifacts/acceptance/P00/playwright-report/` — the end-to-end run

## Exact installed versions

Pinned exactly (`save-exact=true`); the lockfile is committed.

| Component | Version |
| --- | --- |
| Node.js (host / Linux container) | 24.19.0 / 24.21.0 |
| pnpm | 10.33.0 |
| next | 16.3.5 |
| react / react-dom | 19.3.0 |
| payload, @payloadcms/{db-postgres,next,richtext-lexical,storage-r2,translations} | 3.90.1 |
| pg | 8.20.0 |
| pg-cloudflare | 1.4.0 |
| graphql | 16.14.2 |
| @opennextjs/cloudflare | 1.20.6 (bundling @opennextjs/aws 4.1.4) |
| wrangler | 4.136.1 |
| workerd | 1.20260921.1 |
| miniflare (local simulation) | 5.20260921.0-alpha |
| esbuild | 0.28.2 |
| typescript | 5.9.3 |
| vitest | 5.0.1 |
| @playwright/test | 1.63.0 |
| eslint / eslint-config-next | 9.39.5 / 16.3.5 |
| PostgreSQL — local container | 17.11 (`postgres:17-alpine`) |
| PostgreSQL — Supabase endpoint probed | 17.6 |
| Worker `compatibility_date` | 2026-09-21, with `nodejs_compat` and `global_fetch_strictly_public` |

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
| `SET` outside a transaction | does not survive across the pool |
| `SET LOCAL` inside a transaction | honoured inside, gone after commit |
| Transaction rollback | effective (`relation ... does not exist` after rollback) |
| Read-after-write across pooled connections | visible immediately |
| Concurrent connections opened | 20, no failure |

What this forces, and where it is enforced:

1. **Runtime traffic never uses named prepared statements.** `src/lib/db.ts`
   configures node-postgres with no statement name, so it uses the unnamed
   extended query protocol — the only thing a transaction-mode pooler supports.
2. **Migrations use a different endpoint and different credentials** (D26).
   Migration DDL is exactly the workload the pooler rejects, so `pnpm migrate`
   runs over `DATABASE_URL`, a separate non-pooled connection, and never over the
   Hyperdrive path. `resolveMigrationConnectionString()` exists so this cannot be
   done accidentally.
3. **No session state may be assumed between requests.** `SET` does not survive
   the pool, so anything session-scoped has to be `SET LOCAL` inside the
   transaction that needs it.
4. **The isolate holds no meaningful pool.** `maxUses: 1` retires a client after
   one checkout and `max: 5` caps the isolate; the pool that matters is
   Hyperdrive's. Hyperdrive query caching is disabled on the configuration so
   authorization and inventory reads always reach PostgreSQL.

## Worker bundle size

Measured from the built artifact, not estimated from dependencies. Method and
raw numbers: `artifacts/acceptance/P00/worker-bundle.txt`.

| Measure | Bytes | |
| --- | --- | --- |
| Bundled script, gzip -9 | 4,906,222 | 4.68 MiB |
| Plus the three `@vercel/og` binary modules (2 wasm + 1 font), gzip -9 | 5,522,276 | **5.27 MiB** |
| `.open-next` directory on disk (not an upload size) | 57,819,480 | 55.1 MiB |

Cloudflare's Worker size limit is **64 MiB, measured on the uncompressed
bundle, identical on the Free and Paid plans**. There is no compressed size
limit; the gzip figures above are informational only, not a gate
(`developers.cloudflare.com/workers/platform/limits/`, verified 2026-09-22).
`wrangler deploy --dry-run` reports the authoritative uncompressed figure as
`Total Upload`, and that has since been run against this exact build:
`Total Upload: 25320.88 KiB / gzip: 5607.12 KiB` — **24.73 MiB against the
64 MiB limit, about 39% of budget**. Wrangler raised no size error. The
deployment fits on the Free plan.

The surviving Free-plan risks are **not** bundle size:

- **Worker startup time: 1 second**, enforced at deploy time as error 10021
  and reported as `startup_time_ms`. Larger bundles and expensive global-scope
  initialization increase startup time, so this bundle's size is still a
  relevant input to that gate, just not the gate itself.
- **CPU time: 10 ms per invocation on the Free plan.** Neither risk is
  resolved by a dry run; both are measured by an actual deploy.

This is no longer treated as an open risk from the local half; the hosted
half still owes the startup-time and CPU numbers above.

## No Sharp, no native image resize

Proved against the built artifact (`artifacts/acceptance/P00/worker-bundle.txt`):

- `find .open-next -name "*.node"` returns nothing — the artifact contains no
  compiled native module at all.
- The `sharp@0.35.4` path inside the artifact contains **0 files**; it is an
  empty directory shell left by Next's file tracer. `sharp` is an optional
  transitive dependency of `next@16.3.5` and is not declared by this project.
- The bundled deploy script contains no `require("sharp")` and no
  `import ... from "sharp"`. The 49 textual occurrences are inert: Next's own
  `serverExternalPackages` list, `@vercel/og`'s `render(satori, resvg, sharp, …)`
  parameter guarded by `if (sharp)`, and Payload's `config.sharp` lookup.
- `src/payload.config.ts` passes no `sharp` key (D15), so `config.sharp` is
  `undefined` and every Payload resize and dimension-probe path is skipped.
- `next.config.ts` sets `images: { unoptimized: true }`, so Next's image
  optimizer — the only remaining code that would reach a native resizer — is off
  by configuration rather than by luck.

## Route precedence: custom API route beside the Payload catch-all

`next build` route table, and live requests against the Worker preview
(`artifacts/acceptance/P00/runtime-requests.txt`):

```
┌ ○ /                        └ ƒ /api/health
├ ƒ /admin/[[...segments]]   ├ ƒ /api/[...slug]
├ ƒ /api/graphql             ├ ƒ /api/graphql-playground
```

- `GET /api/health` → `200`, `cache-control: no-store`, `x-robots-tag: noindex`,
  body `{"ok":true,"data":{"status":"ok",...}}`. The literal segment wins over
  the catch-all.
- `GET /api/users/me` → `200` `{"user":null,"message":"الحساب"}` — same `/api`
  prefix, answered by Payload's REST catch-all, in Arabic.
- `GET /api/runtime-probe` → `403` for an anonymous caller.
- `GET /` → `<html lang="ar" dir="rtl">`.

The health response carries no hostname, credential or stack trace; the
end-to-end test asserts that its body contains neither `postgres` nor
`HYPERDRIVE`.

## The bounded scheduled task, and the defect this spike found

The Worker exposes one `scheduled` handler (`worker-entry.ts`). It refuses to run
without `JOBS_SECRET` or `SITE_URL` rather than sweeping jobs unauthenticated,
and calls `GET /api/payload-jobs/run?limit=5` through the application's own
request pipeline, so a job gets the same bindings and the same connection policy
as a request. There is no second worker and no in-memory timer.

The end-to-end test for this failed, and the cause was a real defect in this
repository's own code, not in the runtime:

- Payload's `jobs.deleteJobOnComplete` defaults to `true`
  (`payload/dist/config/defaults.js`). A job row is **deleted the moment it
  completes successfully**, so only pending and failed jobs survive.
- `src/app/api/health/route.ts` read "last completed job" as the newest row by
  `updatedAt` and returned its `completedAt`. With rows deleted on success that
  value could never be anything but `null` — the endpoint reported "no job has
  ever completed" while jobs were completing normally.
- Database evidence from the failing run: the probe row carried
  `last_scheduled_run_at = 2026-09-22T04:15:10.846Z` and the Worker log recorded
  `INFO: Running 1 jobs.` at the same second. The job ran; the evidence was
  deleted.

Fixed by making completion observable rather than by relaxing the test:
`deleteJobOnComplete: false` in `src/payload/jobs.ts`, and the health endpoint
now selects the newest row that actually has a `completedAt`. Retention is
bounded by the cron cadence — one row per trigger — and pruning is a later
operations task.

Second, related behaviour worth knowing before relying on it: `handleSchedules`
queues a task with `waitUntil` set to the **next** cron slot, and `runJobs` only
picks up jobs whose `waitUntil` has passed. A tick therefore never runs the job
it just queued. On a database that has never scheduled the task, the first
completion can be a full cron period (15 minutes) after the first tick. The
end-to-end test drives ticks across that window instead of assuming promptness,
and requires a completion newer than the one it observed at start, so a
completion left over from a previous run cannot satisfy it.

Verified after the fix, against the Worker preview:

```
$ curl "/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"   -> ok (200)
$ curl /api/health -> {"jobs":{"lastCompletedAt":"2026-09-22T07:31:17.453Z"}}
cms.payload_jobs:   probeHeartbeat  completed_at=2026-09-22 07:31:17.453+00  has_error=f
cms.runtime_probe:  last_scheduled_run_at=2026-09-22 07:31:17.333+00
```

## Commands and exit codes

Re-run in full against the final tree on 2026-09-22. The complete list, with
timestamps and one-line results, is `artifacts/acceptance/P00/commands.txt`.

| Command | Host | Exit |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Windows | 0 |
| `pnpm lint` | Windows | 0 |
| `pnpm typecheck` | Windows | 0 |
| `pnpm test` | Windows | 0 (no test files; see the open items below) |
| `pnpm check:frozen` | Windows | 0 (59 files under `deploy/` unchanged) |
| `pnpm check:copy` | Windows | 0 (19 source files) |
| `pnpm build` | Windows | 0 |
| `pnpm build:worker` | Windows | **1** — EPERM on symlink, see above |
| `pnpm build` | Linux container | 0 |
| `pnpm build:worker` | Linux container | 0 — real `.open-next/worker.js` |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8787 pnpm test:e2e` | Windows → container preview | 0 — 6 passed in 4.5m |
| `pnpm test:db` | Windows | **1**, by design — `TEST_ENV must be exactly "local"` |
| `TEST_ENV=local pnpm test:db` | Windows | **1**, by design — `DATABASE_URL does not point at a local PostgreSQL host` |

The last two are the guard working: database tests are destructive, and the
configured `DATABASE_URL` is a hosted endpoint. The check runs in
`vitest.config.ts` before any test file is collected, and the refusal never
prints the URL.

`wrangler deploy` was not run, and neither was `wrangler deploy --dry-run`:
anything deploy-shaped belongs to the hosted half of P00.

## Hosted half — partial, blocked before any real deploy

Attempted 2026-09-22, task 2 of 2. Full commands and exit codes:
`artifacts/acceptance/P00/commands-hosted.txt`. Summary:

**Done, in order, before the Worker was ever public:**

1. `pnpm migrate` ran from the Windows host against the Supabase session
   endpoint on 5432 (D26, `DATABASE_URL`), exit 0. Confirmed directly with a
   `pg` query afterwards: the `cms` schema and all fourteen expected tables
   exist; `cms.users` had 0 rows immediately after.
2. The single owner (`p00-owner@example.invalid`, synthetic password matching
   this test suite's existing fallback) was created through Payload's native
   `POST /api/users/first-register` endpoint, reached by running `pnpm dev`
   against the same hosted database from `localhost:3000` — never from a
   public URL. A second `first-register` call for a different address was
   refused with `403`, confirming the bootstrap window closes correctly
   against this exact database before the Worker ever goes up. The local dev
   server was stopped immediately after.
3. `wrangler.jsonc`'s `SITE_URL` was repointed at the spike origin
   `https://anas-studio.anas-studio.workers.dev`, with a comment recording why
   and that the production value returns with the custom domain.
4. `pnpm build:worker` succeeded in the `anasaq-bundle` container against the
   synced, edited working tree (not the container's stale pre-existing copy).
   `wrangler deploy --dry-run` against that exact build reported
   `Total Upload: 25320.88 KiB / gzip: 5607.14 KiB` — the same uncompressed
   figure as the local half's `worker-bundle.txt`, confirming this is the same
   build.
5. `PAYLOAD_SECRET` and `JOBS_SECRET` were set as Worker secrets via
   `wrangler secret put`, values piped from the environment, never typed,
   echoed, or written to a file.

**Blocked: the real `wrangler deploy` was never run.** The Bash tool's own
auto-mode permission classifier refused the call with reason
"[Production Deploy]" and stated explicitly that only a Bash permission rule
in the user's own settings — not an instruction inside the dispatched task —
can allow it. No attempt was made to reach the same outcome by another route;
the task's own guidance is explicit that doing so is out of bounds regardless
of how the deploy is authorized in writing. This is reported as a blocker for
the orchestrator/owner to act on directly, not worked around.

**A side effect worth flagging.** `wrangler secret put` against a Worker name
that does not exist yet silently creates and deploys an empty stub to hold the
secrets, and that action was *not* intercepted by the same classifier. The
account is therefore no longer in the "no Workers currently deployed" state
this task started from: a stub named `anas-studio` is live at
`https://anas-studio.anas-studio.workers.dev` right now, holding both secrets
and no Payload code. Verified it exposes nothing: `GET /` returns `404`
(`error code: 1042`) and `GET /admin/create-first-user` returns `404` — there
is no admin surface to reach because there is no application code deployed,
only the secrets. It still means the "no Workers deployed" precondition this
task's dispatch recorded is now stale, and the eventual real deploy will be an
update to this stub rather than a first deployment.

**Consequently still unproven, and not backfilled from anything:**
`startup_time_ms`, cold/warm CPU per invocation (normal and scheduled),
cold/warm wall-clock latency for the public route/admin/`/api/health`,
Hyperdrive reached from an actually-deployed Worker, a real R2 round trip and
denial against `anas-studio-media-test` through the live Worker, and a real
Cron Trigger delivery. `tests/e2e/runtime.spec.ts` was left unmodified —
pointing it at a deployed origin that was never reachable would have been an
unverified guess, which contradicts the instruction that a test change here
must get stricter, never looser.

`pnpm migrate` also surfaced one genuine defect in this repository's own
tooling, unrelated to the runtime: `payload run <script>` with the script
dynamically `import()`-ing `src/payload.config.ts` (the same pattern `payload
migrate` uses internally) silently calls `process.exit(0)` mid-import with no
thrown error, `unhandledRejection`, or `uncaughtException` — confirmed with
explicit listeners on all three. This is why the owner was seeded through
`pnpm dev` and a real HTTP call instead. Root cause not fully isolated; the
symptom is consistent with `@opennextjs/cloudflare`'s `getCloudflareContext()`
raising an unhandled rejection during a nested dynamic import outside a
request or dev-server context, which a bare `payload run` process does not
survive the way `next dev`'s long-lived server does. Not fixed here — `src/`
was out of this task's allowlist, and it is a `payload run` composition
problem, not a defect the runtime spike itself needs to resolve.

## Still unproven — everything hosted

None of the following is established by anything in this document, and none of
it may be treated as passing because the local half passed:

1. **Deployment itself.** No `wrangler deploy`, no upload. The Worker has never
   run on Cloudflare. (A `wrangler deploy --dry-run` has since been run against
   this build — see item 2 — but a dry run performs no upload and proves
   nothing about cold start, warm latency, or CPU time.)
   **Update, 2026-09-22 (hosted-half attempt):** a real `wrangler deploy` was
   attempted and refused, not merely skipped — see "Hosted half — partial,
   blocked before any real deploy" above. Everything this item and item 3
   describe is still unproven for that reason, now confirmed rather than
   assumed.
2. ~~The real bundle size, as reported by Cloudflare at upload.~~ Resolved
   since this document was first written: `wrangler deploy --dry-run` against
   this exact build reports `Total Upload: 25320.88 KiB` uncompressed, against
   the real **64 MiB** Workers size limit (Free and Paid alike, no compressed
   size limit) — see "Worker bundle size" above. The deployment fits.
3. **Cold start and warm request latency on Workers**, with sample counts, and
   **scheduled-invocation CPU time** measured separately, against the current
   published Free limits. Local `wrangler dev` numbers are not a substitute.
4. **Hyperdrive against the real Supabase pooler from a deployed Worker.** The
   pooler was probed from Node over the network, and the binding was exercised
   only against a local container through wrangler's local simulation.
5. **Real R2.** Uploads round-tripped through wrangler's local object store, not
   the `anas-studio-media-test` bucket, and private-bucket access control has not
   been proved against r2.dev.
6. **Real cron delivery.** The `scheduled` handler was invoked through
   `wrangler dev`'s local endpoint, never by Cloudflare's Cron Trigger.
7. ~~Migrations against the hosted database~~ Resolved 2026-09-22: `pnpm
   migrate` ran against the Supabase session endpoint on 5432 (`DATABASE_URL`,
   D26), exit 0, and the `cms` schema plus all fourteen expected tables were
   confirmed to exist directly afterward — see "Hosted half" above and
   `artifacts/acceptance/P00/commands-hosted.txt`. Rollback (`migrate:down`)
   was **not** exercised against the hosted database and remains unproven.
8. **Everything gated on credentials this run did not have.** Missing hosted
   credentials or authorization is an external blocker, never a local pass.

Additional open items from the local half:

- `pnpm test` currently runs **zero** unit tests (`--passWithNoTests`). Lint,
  typecheck and the end-to-end suite are the only automated coverage. The
  safety-critical pure functions — `isLocalDatabaseUrl`/`assertLocalTestDatabase`
  and the constant-time `secretsMatch` in `src/payload/jobs.ts` — deserve unit
  tests; `tests/unit/` was outside this task's file allowlist.
- `pnpm build:worker` cannot run on this Windows host (EPERM on symlink); the
  Linux path is the only one proven.
- The `RuntimeProbe` collection, its media collection and the `probeHeartbeat`
  task are spike scaffolding and are removed once this evidence is retained.
