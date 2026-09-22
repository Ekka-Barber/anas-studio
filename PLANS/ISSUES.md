# Open issues

Recorded by the orchestrator during execution. An issue stays here until it is
closed with evidence. Nothing in this file authorizes paid provisioning, a
provider change or a relaxed limit.

## I01 — WITHDRAWN: the Worker does not exceed the Workers size limit

**Status:** withdrawn 2026-09-22, same day it was raised. **Package:** P00.
**No owner decision is required and none was ever warranted.**

I01 previously claimed the Worker was ~2.5 MiB over a 3 MiB Workers Free
ceiling and escalated a roughly $5/month commercial decision to the owner. That
claim was wrong, and the error was the orchestrator's.

**What the limit actually is.** Cloudflare's current published limit is **64 MiB
measured uncompressed, identical on the Free and Paid plans**. The limits page
states plainly that "There is no compressed size limit. Only the uncompressed
bundle size counts," and that "The `Total Upload` value is your uncompressed
bundle size." The gzip figure wrangler prints beside it is informational and is
not an enforced ceiling. Confirmed against three sections of
`developers.cloudflare.com/workers/platform/limits/` (worker size, worker
startup time, and the Free/Paid tables).

**What the measurement actually shows.** Reproduced from a clean container
build: `Total Upload: 25320.88 KiB / gzip: 5607.12 KiB`. The number that is
enforced is 25320.88 KiB = **24.73 MiB uncompressed, against a 64 MiB limit** —
about 39% of the budget, with 39 MiB of headroom. Wrangler raised no size error
and no size warning. The deployment fits on the Free plan.

**Root cause of the error.** The 3 MiB / 10 MiB gzipped figures are a
superseded version of this limit. The orchestrator carried them as assumed
knowledge, then verified the measurement twice — the builder's esbuild
reproduction and an independent `wrangler deploy --dry-run` — while never
verifying the limit those measurements were being compared against. Measuring
the numerator carefully does not validate the denominator. A figure that gates a
purchase or an architecture change must be cited from the vendor's current
documentation before it is escalated, not recalled.

**Consequence.** Nothing about the runtime changed; only the verdict did. P00's
hosted half is unblocked and proceeds on the Free plan. No plan was purchased,
no deployment was made, and D01/D02 never needed reopening. The real Free-plan
gates for this spike remain what the plan always said they were: the **10 ms
CPU limit per invocation**, and the **1 second Worker startup time** limit,
which is enforced at deploy time as error 10021 and which large bundles do
affect. Both are measured by deploying, which is exactly what P00 task 2 does.

Everything local is unaffected and already proven; see I02 for what that covers.
The stale limit is still written into product code and docs — see I07.

## I02 — P00 local half passed; hosted half unproven

**Status:** open — hosted half not yet run. **Package:** P00. No longer blocked:
I01 was withdrawn, so task 2 may proceed on the Free plan.

Proven locally against PostgreSQL 17.6: native Payload admin login/logout,
collection CRUD, a versioned Lexical record, the bounded scheduled job
completing through the Worker `scheduled` handler and writing to the database,
`/api/health` coexisting with Payload's `/api/[...slug]` catch-all, no Sharp and
no native binary in the built artifact, transaction rollback, read-after-write
across pooled connections, and 20 concurrent pooler connections against a
reported ceiling of 60. Evidence is in `artifacts/acceptance/P00/` and
`docs/runtime-spike.md`.

Unproven and still required for P00 acceptance: deployment itself, hosted cold
and warm request behaviour, scheduled CPU, Hyperdrive reaching the Supabase
pooler from a deployed Worker, a real private R2 upload/read with unauthorized
denial, real Cron Trigger delivery, and hosted migrations over the separate
credential. None of it has been attempted yet.

## I03 — `pnpm test` currently runs zero unit tests

**Status:** open. **Package:** P00 follow-up.

`pnpm test` passes with `--passWithNoTests`, so that gate and its CI step are
vacuous today. `isLocalDatabaseUrl` and `assertLocalTestDatabase` in
`src/lib/env.ts` and the constant-time `secretsMatch` guard real safety
properties and deserve tests. `tests/unit/` was outside the builder's allowlist,
so this is a bounded follow-up task, not a defect in delivered work.

## I04 — CI does not run `pnpm preview:worker`

**Status:** open, orchestrator ruling recorded. **Package:** P00.

VERIFICATION.md:16 says Linux CI runs `pnpm build:worker` and
`pnpm preview:worker`. The workflow runs the build but not the preview. The
builder's reasoning is accepted: `wrangler dev` will not start the `HYPERDRIVE`
binding without a local connection string, and a preview against an unmigrated
database asserts nothing while still reporting green — a vacuous check is worse
than an absent one, because it reads as coverage. A meaningful CI preview needs
a PostgreSQL service container, applied migrations and a real smoke request.
That is bounded work and belongs with I03 rather than being faked now. The
deviation is recorded in the workflow and in `docs/runtime-spike.md`.

## I05 — `pnpm build:worker` cannot run on Windows

**Status:** open, environmental. **Package:** P00.

OpenNext fails on this workstation with `EPERM ... syscall: 'symlink'` and warns
that it is not Windows-compatible. The Linux container and CI both build it
cleanly. Consequence: the local `pnpm check` gate is red on Windows for that one
script, and Worker artifacts must be produced in the container or in CI.

## I06 — scheduled job rows now accumulate

**Status:** open, by design for P00. **Package:** P04/P06 operations.

`deleteJobOnComplete: false` was set so job completion is durable and auditable;
Payload's default deletes a successful job row instantly, which is what hid the
scheduled-job result and produced a permanently null health field. At the `*/15`
trigger that retains about 96 rows a day. Pruning belongs with the operations
work in a later package and is noted in the code and in `docs/runtime-spike.md`.

## I07 — the superseded Worker size limit is written into product code and docs

**Status:** RESOLVED 2026-09-22, audited and accepted. **Package:** P00.
Fixed by a `sonnet-worker` dispatch; the orchestrator audited the diff before
acceptance. The worker independently fetched the Cloudflare limits page rather
than trusting the brief, and independently re-ran `wrangler deploy --dry-run`
(`Total Upload: 25320.88 KiB`, exit 0). `pnpm check:budgets` now passes with
`worker upload: 25320.9 KiB (limit 65536.0 KiB)`.

Audit findings: only the four allowlisted paths changed; the evidence file's
recorded byte counts, commands and results are byte-identical with a dated
correction appended after them; the removal of the now-unused `statSync` import
was verified safe, because the public-JS walk uses `readdirSync(withFileTypes)`
dirents rather than stat. One honest flag from the worker, accepted as accurate:
`publicJsGzipBytes` measured 0.0 KiB because the container build produced no
matching `.next/static/chunks` files, so that half of the budget gate is not yet
exercised. That is pre-existing and belongs with I03/I04, not with this fix.

**Original finding below, kept for the record.**

The 3 MiB figure withdrawn in I01 is not only in the issue log; it was written
into shipped files, where it will fail a build for the wrong reason:

- `scripts/check-budgets.mjs:23` — `WORKER_GZIP_LIMIT_BYTES = 3 * 1024 * 1024`,
  described as "Workers Free". The script reads the **gzip** figure out of
  `wrangler deploy --dry-run` (line 49) and fails the build above 3 MiB
  (lines 81-84). Cloudflare enforces neither that number nor that dimension, so
  `pnpm check:budgets` currently fails a Worker that deploys perfectly well.
  It should compare the `Total Upload` **uncompressed** figure against 64 MiB.
  A project budget tighter than the vendor limit is legitimate, but it must be
  labelled a project budget, not misattributed to Cloudflare.
- `scripts/check-budgets.mjs:5-6` — the header comment repeats the claim.
- `docs/runtime-spike.md:119-130, 262-263` — states the Free limit is 3 MiB and
  records the spike as failing against it.
- `artifacts/acceptance/P00/worker-bundle.txt` — the same comparison, in the
  interpretation block. This one is an evidence file: its **measurements** are
  accurate and reproduced, and must not be rewritten. Only the interpretation
  is wrong, and it should be corrected by appending a dated correction note
  rather than by editing the recorded figures.

The separate public-JS budget in the same script
(`PUBLIC_JS_GZIP_BUDGET_BYTES = 150 KiB`) is a genuine project target from the
plan and is unaffected.

The orchestrator does not edit product code, so this is dispatched as a bounded
task rather than fixed here.

## I08 — `wrangler secret put` creates and deploys a stub Worker

**Status:** open, operational note. **Package:** P00. **Raised:** 2026-09-22.

Setting a secret on a Worker name that does not exist yet does not fail. Wrangler
creates an empty Worker to hold the secret and deploys it. That is how
`anas-studio` came to be live on the account before any deploy was authorized:
the secret calls were not classified as a deployment, but their side effect was
one.

Verified harmless in this instance. The stub carries `PAYLOAD_SECRET` and
`JOBS_SECRET` and no application code; `/`, `/admin`, `/admin/create-first-user`,
`/api/health` and `/api/users/first-register` all return 404. The first real
deploy overwrites it.

Worth remembering for any future account: "set the secrets first, deploy after"
is not a no-op ordering. It publishes a name.

## I09 — the build mirrors `.env` onto local disk in `.open-next/`

**Status:** open, contained. **Package:** P00. **Raised:** 2026-09-22.

`.open-next/cloudflare/next-env.mjs` and `.open-next/server-functions/default/.env`
contain every variable present at build time — on this workstation that means the
Cloudflare API token, the Supabase database password, the Resend key and the rest
of `.env`, written in cleartext to the build directory.

**The deployed Worker does not carry them.** Verified directly rather than
assumed: a clean container build using distinctive random markers for
`PAYLOAD_SECRET`, `JOBS_SECRET` and `DATABASE_URL` produced an upload artifact
(`wrangler deploy --dry-run --outdir`) containing **zero** occurrences of any
marker. Runtime values reach the Worker through Worker secrets and bindings, not
through the bundle. A first attempt at this test gave a false positive because
the throwaway secret used for the build was 32 zeros, which is byte-identical to
OpenTelemetry's `INVALID_TRACEID` constant; a degenerate marker is not a test.

Containment, both verified: `/.open-next/` is gitignored (`.gitignore:24`), and
`.github/workflows/ci.yml` has no `upload-artifact` step, so the directory is
never published. The standing constraint is therefore: **never publish
`.open-next/` as a CI artifact, a release asset, or a container image layer.**

Consequence worth keeping: the build only needs *a* value for `PAYLOAD_SECRET`,
never the real one. Building with a throwaway and supplying the real value as a
Worker secret is both sufficient and safer, and is what the deployed build does.

## I10 — `payload run` exits silently when a script imports the config

**Status:** open, upstream tooling defect. **Package:** P00 follow-up.

`payload run <script>` where the script dynamically `import()`s
`src/payload.config.ts` — the same pattern `payload migrate` uses internally —
calls `process.exit(0)` mid-import: no error, no rejection, no exception.
Confirmed with explicit `unhandledRejection`, `uncaughtException` and `exit`
listeners. Found while seeding the owner user; worked around by driving Payload's
native `POST /api/users/first-register` instead. Not fixed — `src/` was outside
the task allowlist, and the workaround uses a native endpoint rather than adding
a script.

## I11 — P00 FINDING: Hyperdrive never connects to the Supabase transaction pooler

**Status:** open, needs an owner decision. **Package:** P00. **Raised:** 2026-09-22.

The Worker deployed and runs. Every route that does **not** touch the database
is healthy; every route that does hangs until the client gives up.

| Route | Result |
|---|---|
| `/` | 200 in 0.58 s |
| `/admin` | 200 in 0.47 s, 55 KiB |
| `/api/health` | no response, client timeout at 45 s |
| `/admin/create-first-user` | no response, client timeout at 45 s |

So the bundle, the isolate, the assets and the admin render are all fine. The
database path is not.

**What was ruled out, by measurement rather than reasoning.** The Hyperdrive
origin username is correct: `postgres.amqcphsmnopandhoxzsr`, byte-compared
against the expected `postgres.<project-ref>`. The credentials themselves work —
connecting to the same host and port 6543 from the workstation with the same
username and password succeeds and sees all 14 `cms` tables. The Worker emits no
log through `wrangler tail`, because the invocation never completes. And during
an in-flight request, `pg_stat_activity` shows only the workstation's own
Supavisor backends: **no Hyperdrive connection ever arrives at Supabase.**

**Most likely cause, with vendor support.** Cloudflare's Supabase guidance says
to use the **Direct connection** as the Hyperdrive origin rather than a pooled
connection string, because Hyperdrive performs connection pooling itself. This
configuration points Hyperdrive at Supabase's **transaction pooler on 6543**, so
a pooler is stacked underneath a pooler. This is stated as a strong hypothesis,
not a proven root cause: proving it requires changing the origin, which is a
shared-resource change the owner must authorize.

**This is a plan-level finding, not an implementation slip.** ARCHITECTURE.md:40
assigns P00 the job of verifying "transaction/pooler compatibility", and D26
states that runtime traffic uses "the Hyperdrive binding aimed at the transaction
pooler". P00 has now tested that topology and it does not work. That is the spike
doing its job.

**Proposed fix, requiring owner approval.** Repoint the Hyperdrive origin to the
Supabase **session pooler on 5432** — the endpoint migrations already use
successfully. Consequence for D26: the runtime and migration paths would then
share a host and port, so the separation D26 asked for would rest on distinct
roles and credentials, which is P03's work, rather than on distinct endpoints.
D26 should be amended deliberately rather than quietly eroded.

Not attempted: purchasing anything, switching provider, or disabling Hyperdrive
and connecting the Worker straight to Supabase.

## I12 — P00 VERDICT: the application exceeds the Workers Free CPU limit

**Status:** open, escalated to the owner. **Package:** P00. **Raised:** 2026-09-22.

This is the failure mode ARCHITECTURE and DECISIONS named as the primary
expected one, and it is now measured rather than predicted.

**Measured on the deployed Worker, Free account, from Cloudflare's own
`workersInvocationsAdaptive` analytics.** A run of 40 sequential requests to the
**public route only** — not the admin — produced:

| Metric | Value | Free limit |
|---|---|---|
| CPU p50 | **20.5 ms** | 10 ms |
| CPU p75 | 25.4 ms | 10 ms |
| CPU p99 | 453 ms | 10 ms |
| HTTP results | 40 × 200, zero 1102 | — |

Mixed traffic including the admin measured worse: p50 54.5 ms, p99 645 ms.

**Why nothing failed despite being over the limit.** Cloudflare documents burst
tolerance: an isolate allows a Worker that "infrequently runs over" its limit,
and terminates one that "starts hitting the limit consistently". Forty requests
is infrequent. The 200s are the grace window, not a pass. Under sustained
traffic this returns error 1102 / `exceededCpu`.

**The cost is structural, not content.** The public route is P00's near-empty
placeholder page, and the Next build marks it `○ (Static) prerendered`. It still
costs 20.5 ms, because OpenNext routes requests through the Next.js server
pipeline inside the Worker. Real public pages with real content and data will
cost more, not less. No trimming of *our* code addresses a floor set by the
adapter's request path.

**Account state, verified.** No Workers Paid subscription exists. The only
subscription on the account is `r2_paid` at **0 USD**, the free-tier R2
entitlement created when R2 was enabled. The Worker's `usage_model` is
`standard`, which is the current naming and does not imply a paid plan.

**What passed, so the scope of the failure is clear.** Deployment succeeded.
Worker startup time is **20 ms against a 1 second limit**. Upload is 24.73 MiB
against 64 MiB. Hyperdrive reaches Supabase after I11 with 218 ms database
latency. Public route, admin shell, `/api/health` and the Payload catch-all all
return 200. `POST /api/users/first-register` is refused 403 and
`GET /api/payload-jobs/run` without a bearer is refused 401. The only thing
standing between this architecture and a working Free deployment is CPU.

**Decision required from the owner.** Per DECISIONS.md:65 a failed free-tier
spike blocks dependent work and is escalated, never bypassed by silently buying
a plan, switching provider or downgrading the runtime. Nothing has been
purchased. The options, with the orchestrator's assessment:

1. **Workers Paid, ~$5/month.** Raises CPU to 30 s by default. Measured p99 of
   453 ms fits with three orders of magnitude to spare. Solves it outright and
   changes no architecture. This is E07, arriving earlier than planned.
2. **Cut the per-request CPU floor.** Requires serving public pages as genuine
   static assets that bypass the Worker pipeline entirely, rather than through
   OpenNext's server handler. This is real engineering against an adapter
   default, with an unproven outcome, and P01's public pages would be built
   twice if it fails.
3. **Reopen D01/D02.** Contradicts the printed offer's Payload requirement.

Option 1 is recommended. Option 2 is worth measuring *only* if the owner wants
to stay on Free as a hard constraint, and it should be its own bounded spike
with its own pass criterion, not folded silently into P01.

## I12 AMENDMENT — the recommendation is withdrawn; Free is a hard requirement

**Raised:** 2026-09-22, same day, after an independent external audit and a
direct statement of the owner's budget constraint.

Two things changed the ruling above.

**The owner's constraint is $0, not "prefer free".** Hosting must cost nothing
through development and through the first three to six months of production.
That is an acceptance requirement, not a preference. Option 1 above is therefore
withdrawn as a recommendation. Nothing was purchased.

**The "structural floor" claim was not established.** An independent audit
(OpenAI Codex, thread 01a0c995) re-ran the measurement on the unchanged
deployment and recorded **14 ms median, 23 ms maximum** across its own 40
requests, against the 20.5 ms p50 recorded above. 20.5 ms is an observation, not
a floor. More importantly the audit found a documented adapter feature this
spike never tried: OpenNext supports **cache interception**, which short-circuits
a request before it reaches the Next.js server — precisely the cost measured.
`open-next.config.ts` enables neither it nor an incremental cache, and its
comment declining them conflates public-page caching with database query
caching. Those are different concerns: serving a build-time placeholder from
cache does not cache an authorization check or an inventory read.

The orchestrator verified the measurement and asserted the interpretation. That
is the same failure as I01, in a different costume, and it is now the second
time in one package that a conclusion outran its evidence.

**Two further facts the audit surfaced that this ledger did not have.** A real
cron delivery consumed **91 ms CPU** and completed. Raw invocation logs also
contain a historical scheduled invocation lasting **600.692 seconds**, ending in
a socket exception; that is unexplained and must be explained before acceptance.
Scheduled work will not be fixed by any amount of public-route caching.

**Revised position.** Option 2 is now the active path and is dispatched as a
bounded task: enable cache interception and the static-assets incremental cache,
redeploy, re-measure. The pass criterion is the public route under 10 ms CPU
with `/admin` and `/api/health` provably not served from cache. If it fails,
the finding is that this deployment arrangement — Payload and Next.js in one
Worker — cannot meet the constraint, which reopens *where Payload runs*, not
whether the owner pays.

## I13 — external audit findings against P00 evidence and code

**Status:** open, dispatched to a worker. **Package:** P00. **Raised:** 2026-09-22.

Independent audit findings, each re-verified against source by the orchestrator
before being recorded here. None was found by the orchestrator's own audit.

| # | Finding | State |
|---|---|---|
| a | `scripts/check-budgets.mjs:81` excludes any absolute path containing `/app/`. The container's repo root **is** `/app`, so every chunk is excluded and the gate reports **0.0 KiB** against a real ~131.6 KiB gzip. A green gate measuring nothing. | dispatched |
| b | `docs/runtime-spike.md:84` states `SET` outside a transaction does not survive the pool. Its own transcript, `pooler-probe.txt:13`, records that it **did**. The doc contradicts its evidence. | dispatched |
| c | `pooler-probe.mjs:46` derives the transaction-pooler port from `DATABASE_URL`, now 5432, so both branches test the same endpoint. A rerun proves nothing. | dispatched |
| d | `worker-entry.ts:58` calls `openNextWorker.fetch` **in-process**. The scheduled handler never crosses the public internet, so the `SITE_URL` comment in `wrangler.jsonc` — and the claim in commit `ed18fca` — are wrong. | dispatched |
| e | `worker-entry.ts` checks only `response.ok`. Payload returns 200 while individual jobs fail, so a "successful" cron run does not mean successful work. | dispatched |
| f | `mayRunJobs` (`src/payload/jobs.ts`) falls through to `Boolean(req.user)`: any authenticated user may run the job sweep, with no role check. Role separation is P03's, but this must be recorded as deliberately open until then, not assumed closed. | open, P03 |
| g | `resolveMigrationConnectionString()` has no callers in product code. It documents an intention; it enforces nothing. D26's separation rests on operator discipline alone. | open |
| h | `EXECUTION-STATUS.md` said `blocked_local` while I12 described a live deployment. The ledger contradicted itself. | fixed below |

Items f and g are not defects to fix inside P00; they are corrections to what
P00 may claim to have proven. Recorded so acceptance does not overstate them.

## I14 — the public JavaScript budget measured the wrong thing twice

**Status:** RESOLVED, audited. **Package:** P00. **Raised and closed:** 2026-09-22.

`scripts/check-budgets.mjs` has now produced a wrong number in both directions,
and each time it looked authoritative.

| Version | Reported | Reality |
|---|---|---|
| Original | **0.0 KiB** | every chunk excluded — the absolute path always contained `/app/`, the container's repo root |
| First fix | **980.4 KiB** | sums all 63 chunks, including the 1.19 MB Payload admin bundle a public visitor never downloads |
| Truth, measured | **170.3 KiB** | the 7 scripts `.next/server/app/index.html` actually references |

**Resolution.** The gate now parses `.next/server/app/index.html` and gzips only
the chunks the homepage actually references. It exits non-zero if that file is
missing or if a referenced chunk is absent, rather than falling back to any
default. Measured, and reproduced independently by the orchestrator:

```
public JS gzip:        131.6 KiB  (budget 150.0 KiB, 6 homepage scripts, 1 nomodule polyfill excluded)
```

**This passes.** The orchestrator's brief predicted a fail at ~170 KiB and was
wrong: 170.3 KiB counted the `nomodule` legacy polyfill, which no modern browser
fetches. The worker excluded it, said so in its log line, cross-checked every
chunk with `gzip -c | wc -c`, and reported plainly that the result contradicted
the brief's expectation instead of bending to it. That is the correct behaviour
and it is recorded here because the opposite behaviour is what produced I01.

The lesson is not about a path filter. A check that cannot fail is not a check,
and neither is one that fails on a quantity nobody experiences. Both earlier
versions would have been reported as evidence.

**Carried to P01 as a risk, not a defect.** 131.6 KiB of a 150 KiB budget is
spent on a page with no content. About 18 KiB of margin remains for the real
homepage, its fonts, its interactivity and any client component P01 adds. The
budget will be hit early. P01 must either plan for it or revisit the number
deliberately — not discover it as a surprise CI failure.

**Trivial follow-up:** `readdirSync` is now an unused import in
`scripts/check-budgets.mjs`. ESLint does not flag it and CI is unaffected; fold
the removal into the next worker task rather than spending a dispatch on it.

## I13 audit result — worker diff reviewed, 2026-09-22

Reviewed independently rather than accepted on report. The safety classifier
timed out on this subagent, so this audit is the only review its diff received.

- **(a) budget gate** — fix directionally right, measurement still wrong. See I14.
- **(b) doc contradiction** — corrected properly. `docs/runtime-spike.md` now
  matches `pooler-probe.txt:13` and cites it, and the same wrong claim repeated
  further down the file was also caught and fixed. The operative rule is
  preserved with its real justification: a later request may land on a different
  backend, which is why `SET LOCAL` is still required.
- **(c) probe port** — hardcoded to 6543 with the reason in a comment. Correct.
- **(d) `SITE_URL` comment** — rewritten to describe the in-process call. Verified
  against `worker-entry.ts:58`. The false claim in commit `ed18fca` stands in
  history and is corrected here rather than rewritten.
- **(e) silent job failures** — accepted, and **verified at the source**. The
  worker read `payload/dist/queues/operations/runJobs/index.js:442` rather than
  recalling the field's meaning; `remainingJobsFromQueried` does increment only
  when a job's task result is `status: 'error'`. The throw is correct.
- **(f, g)** — unchanged, correctly left as P03/open.
- **task 4, cache interception** — `open-next.config.ts` now uses the documented
  SSG recipe. The worker fetched the OpenNext caching page live and cross-checked
  both `enableCacheInterception` and the `static-assets-incremental-cache` module
  against the installed 1.20.6 package before using them. Local preview shows
  `/` returning `x-opennext-cache: HIT`, `/api/health` still reaching the
  database (`latencyMs: 23`, `cache-control: no-store`), and `/admin` carrying
  `private, no-cache, no-store` with **no** `x-opennext-cache` header at all.
  No authenticated content is cached.

**What this does not prove.** Miniflare does not model Cloudflare's CPU
accounting. A local cache HIT is not a CPU measurement. The pass criterion —
public route under 10 ms CPU on the real edge — is untested until the owner
deploys and the orchestrator re-measures. The worker said so plainly rather
than implying success, which is the behaviour the brief asked for.

## I15 — cache interception cuts public-route CPU by 8.5x; the public route now fits Free

**Status:** measured. **Package:** P00. **Raised:** 2026-09-22.

Deployed with `enableCacheInterception: true` and the static-assets incremental
cache. Two clean runs of 40 requests each to the public route only, no admin or
health traffic in the window. 80 sent, 80 × 200, 76 recorded by adaptive
sampling. Same method, same dataset and same limit as the I12 measurement.

| Metric | Before (I12) | After | Free limit |
|---|---|---|---|
| CPU p50 | 20.5 ms | **2.4 ms** | 10 ms |
| CPU p75 | 25.4 ms | **4.3 ms** | 10 ms |
| CPU p99 | 453 ms | **31.1 ms** | 10 ms |
| Startup | 20 ms | 22 ms | 1000 ms |

**I12's core claim is now disproven by measurement.** There was no structural
OpenNext CPU floor. The 20.5 ms was the cost of routing a prerendered page
through the Next.js server, and a documented adapter option removes it. The
orchestrator asserted a floor from a single observation and escalated a purchase
on it. That is the third time in this package a conclusion outran its evidence —
I01, I12, and the budget-gate prediction in I14 — and the pattern is identical
each time: the measurement was verified, the interpretation was not.

**No security regression, verified on the real edge and not only in preview.**
`/` returns `x-opennext-cache: HIT`. `/admin` carries
`private, no-cache, no-store, must-revalidate` and **no** cache header at all.
`/api/health` is `no-store` and still reaches the database.

**What this does not settle.**

- **p99 is still 31.1 ms, over the limit.** The typical request now fits with
  margin; roughly one in a hundred does not. Cloudflare's documented tolerance
  for a Worker that infrequently runs over plausibly covers that, which is a
  materially different position from p50 being over — but it is tolerance, not
  compliance, and it must not be written up as a pass.
- **The scheduled path is untouched and is now the binding constraint.** A real
  cron delivery measured **91 ms**. Cache interception cannot help it: the job
  sweep runs the full Next pipeline by design. Every 15 minutes, indefinitely,
  is not "infrequently over".
- The 600.692 second scheduled invocation in the raw logs is still unexplained.

**Consequence for the owner's $0 constraint.** The public website — the part
real visitors touch — now fits Workers Free. The remaining exposure is the
background job sweep, which is a much smaller problem with more options
(reduce its work, move it off the Worker, or lengthen its interval) than
"the whole architecture is too expensive". P00 is not accepted; the question
has narrowed from the product to one cron handler.

## I16 — Payload password login costs 615 ms CPU, 61x the Workers Free limit

**Status:** open, owner decision. **Package:** P00. **Raised:** 2026-09-22.

Measured from `workersInvocationsAdaptive` on isolated windows with no other
traffic. Values converted from microseconds.

| Path | CPU | Free limit | Over by |
|---|---|---|---|
| Public route (after cache interception) | 2.4 ms | 10 ms | fits |
| Cron delivery | **52.2 ms** | 10 ms | 5x |
| **Password login** | **614.7 ms** | 10 ms | **61x** |

**Root cause, read from the installed package, not recalled.**
`payload/dist/auth/strategies/local/generatePasswordSaltHash.js` hardcodes
`currentPasswordHashIterations = 600000`, and `authenticate.js` runs
`crypto.pbkdf2(password, salt, 600000, 32, 'sha256')` on every login. That is
the OWASP recommendation for PBKDF2-SHA256. It is a deliberate Payload security
constant, not a defect, and not something our code can trim.

**Scope, stated precisely so it is not over-read.** Only password login pays
this. Session validation is JWT and cheap. Public visitors never trigger it.
The site has one owner, so real frequency is a handful of invocations per day.
Cloudflare recorded all ten attempts as `status=success` with zero errors — the
burst tolerance again, not compliance.

**This is the owner's decision, not an agent's tuning knob.** Lowering the
iteration count would weaken password hashing below the OWASP recommendation.
No agent should do that silently to make a CPU number look better. The honest
options are: rely on burst tolerance for genuinely rare admin logins; move
authentication off the Worker; or accept the iteration count as the security
floor it is and revisit where the admin runs.

**Correction to I15.** The cron figure recorded there as 91 ms measures 52.2 ms
on an isolated organic delivery. Both exceed the limit; the earlier number was
taken from a window that was not isolated. Recorded rather than quietly
replaced.

## I17 — the seeded owner cannot log in, and the cause is not reachable

**Status:** open, blocked on the owner. **Package:** P00. **Raised:** 2026-09-22.

Login to the live Worker as `p00-owner@example.invalid` returns HTTP 401 with
Payload's generic "invalid email or password". Three careful attempts across
two agents; Payload's default lockout is 5 attempts per 10 minutes, so no
further attempts were made.

**It is a real credential mismatch, not a swallowed runtime error.** The 614.7 ms
CPU in I16 proves PBKDF2 ran to completion and the comparison failed.
`authenticate.js` ends in `catch (ignore) { return null }`, which would have
turned a thrown error into the same generic 401 — that possibility is excluded
by the measurement, not by assumption.

Also excluded, with evidence: shell quoting corruption of the password (the
payload was written to a file by Node and its sha256 checked); lockout (Payload
returns a distinct `LockedAuth` error); a missing user (`first-register` returns
403, so the row exists); and `PAYLOAD_SECRET` mismatch (verification uses only
the per-user `salt` and `hash`, never the secret — read from `authenticate.js`).

**Why it is unresolved.** Confirming it needs a read of `cms.users` to compare
the stored hash parameters and the login counters. Direct database reads are
refused by the agent tooling boundary `[Production Reads]`, for the worker and
the orchestrator alike. Neither worked around it, which is correct behaviour.
The owner must run the query, or grant the permission.

**Blocks:** the private R2 round trip with unauthorized denial, authenticated
hosted CRUD including delete, and the real cron content write — all three need
an authenticated session. These are P00 acceptance criteria and none of them
has been proven.

## I18 — the cron CPU fix is blocked by a bundling failure, not by design

**Status:** open. **Package:** P00. **Raised:** 2026-09-22.

The architecturally correct fix for the cron's CPU cost (I16, 52.2 ms against a
10 ms limit) is to stop routing the job sweep through the Next.js pipeline and
call Payload's Local API directly — `handleSchedules()` then `jobs.run()`,
mirroring `payload/dist/queues/endpoints/run.js`. A worker implemented it;
`pnpm typecheck`, `pnpm lint` and `pnpm build:worker` all passed.

`wrangler deploy --dry-run` then failed with three real esbuild errors:

```
No matching export in ".../file-type/core.js" for import "fileTypeFromFile"
```

from Payload's own upload endpoints (`checkFileRestrictions.js`, `getFile.js`),
which are unconditionally reachable because `RuntimeProbeMedia` declares
`upload: {...}`. Next.js and Turbopack tolerate the import; wrangler's esbuild
pass over `worker-entry.ts` is a separate bundle and does not.

The fix needs a build alias in `wrangler.jsonc`, for which there is precedent —
`next.config.ts` already aliases `drizzle-kit/api` for the same class of
problem. That was outside the worker's write scope, so it correctly reverted
both files (`worker-entry.ts`, `src/lib/db.ts`) rather than half-landing a
change, and re-verified the tree clean.

**This is a tractable build problem, not evidence that the cron cost is
irreducible.** Whoever picks it up should add the alias and re-measure, not
conclude from I16 that the sweep must stay expensive.

**Related, unfixed:** `src/lib/db.ts` sets `connectionTimeoutMillis` and
`idleTimeoutMillis` but no `statement_timeout`. That is the best explanation for
the 600.692 second scheduled invocation in the raw logs — a hung query on a
stale pooled socket, which Supabase's own documentation names as a failure mode
for serverless runtimes. Cloudflare's scheduled ceiling is 15 minutes, so its
limit did not fire. The exact terminating limit was not confirmed and is
recorded as an open gap rather than asserted.

## Resolved

**R01 — migration connection pointed at the pooled port.** `DATABASE_URL` is the
migration and CLI connection and was set to the transaction pooler on 6543,
which contradicts D26 and cannot carry named prepared statements. The builder
correctly refused to edit `.env` and reported it instead. The orchestrator
repointed it to the session endpoint on 5432 on 2026-09-22; the pooler probe had
already confirmed that endpoint accepts named prepared statements.
