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

**Correction, 2026-09-23: the 614.7 ms is not PBKDF2.** On production Workers
PBKDF2 at 600,000 iterations throws immediately and never runs (I17). The login
CPU therefore measures everything else a cold Payload request does. Evidence it
is general cold-request cost rather than anything auth-specific: in Workers
Observability, `/api/health` (no password work at all) reaches p50 333 ms and max
725 ms CPU, the four login invocations measure 490 / 614 / 652 ms, and
`/api/users/me` ranges from p50 6 ms to max 262 ms. The public route stays at
p50 3 ms. Cold Payload initialisation has not been isolated or profiled; that is
the open measurement, and it bears on the $0 constraint for every admin and API
request, not only login. The row above is kept as recorded and should be read
as "cold Payload API request", not "password hashing". The measurement was
right; the interpretation attached to it was not checked.

## I17 — the seeded owner cannot log in, and the cause is not reachable

**Status:** root cause confirmed 2026-09-23; fix is an owner decision (I19).
**Package:** P00. **Raised:** 2026-09-22.

**Resolution, 2026-09-23.** The password was never the problem. Production
Cloudflare Workers refuses PBKDF2 above 100,000 iterations, in both
`node:crypto` and WebCrypto. Payload hashes at 600,000, so `crypto.pbkdf2`
fails, `authenticate.js` swallows the error in `catch (ignore)`, and `login.js`
increments the attempt counter and returns the generic 401. The two paragraphs
below that call this "a real credential mismatch" and say the swallowed-error
path is "excluded by the measurement" are wrong. They stand as the record of the
mistake: 614.7 ms of CPU was read as proof that PBKDF2 ran, without checking
what else the invocation did (see the I16 correction).

Evidence, from a throwaway Worker (`pbkdf2-probe`: `compatibility_date`
2026-09-21, `nodejs_compat`) deployed to this account's workers.dev, called with
synthetic inputs, compared byte-for-byte against Node on the owner's machine,
then deleted (API DELETE returned HTTP 200):

| API | Iterations | Result |
|---|---|---|
| `node:crypto.pbkdf2` | 1,000 and 100,000 | identical to Node |
| `node:crypto.pbkdf2` | 100,001 and 600,000 | `Pbkdf2 failed: iteration counts above 100000 not supported (requested N).` |
| WebCrypto `deriveBits` | 1,000 and 100,000 | identical to Node |
| WebCrypto `deriveBits` | 100,001 and 600,000 | throws the same message |

So below the cap workerd and Node agree exactly; there is no divergence in the
bytes, only a hard refusal above 100,000.

Why local tests never saw it: upstream workerd's base
`LimitEnforcer::checkPbkdfIterations` (`src/workerd/io/limit-enforcer.h`)
defaults to `DEFAULT_MAX_PBKDF2_ITERATIONS` = 100,000, and `checkPbkdfLimits`
(`src/workerd/api/crypto/impl.c++`) throws `DOMNotSupportedError`; both the
WebCrypto and Node paths call it. The open-source server used by `wrangler dev`
and Miniflare overrides it (`src/workerd/server/server.c++`: "No limit on the
number of iterations in workerd"). Cloudflare's Web Crypto documentation does
not mention the cap. Every local and container test passes, and only production
fails.

Scope: every path that calls PBKDF2 at 600,000 fails on production. That is
login, `first-register` / create-first-user, password reset, and any create or
update that sets a password (`generatePasswordSaltHash.js` callers:
`login.js`, `resetPassword.js`, `register.js`, `collections/operations/utilities/update.js`).
The seeded owner exists only because it was created in Node.

One trap, recorded so nobody takes it: hashes without the `pbkdf2-sha256-v1:`
prefix are verified on Payload's legacy parameters (25,000 iterations, 512-byte
key). That passes the per-call cap, and `login.js` swallows the failed
opportunistic rehash, so a legacy-format hash would log in. It is a security
downgrade plus about two-thirds of the 600k CPU, because a 512-byte SHA-256 key
is sixteen PBKDF2 blocks. It is not a fix.

Login attempts spent: none since this investigation began. The lockout counter
is where the prior session left it. No further login attempt is useful until
I19 is decided and implemented.

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

## I19 — Payload native password auth cannot run on production Workers as shipped

**Status:** direction decided by the owner on 2026-09-23. The admin and the job
runner move to an Oracle Cloud Always Free Ampere A1 VM, published through
Cloudflare Tunnel; the public site stays on Workers. The plan amendment is not
yet written or approved, and nothing is provisioned. **Package:** P00.
**Raised:** 2026-09-23.

**Proposed D27, awaiting the owner's approval of the wording.** The owner gave
the direction on 2026-09-23. A worker applies the text to `PLANS/DECISIONS.md`
only after approval.

> D27 (2026-09-23) amends D01's "one Workers deployment". The same Next.js and
> Payload codebase is deployed twice.
>
> - The public site runs on Cloudflare Workers Free, as D01 states.
> - The Payload admin, authentication, REST and GraphQL writes, and the native
>   job runner run as a Node server on an Oracle Cloud Always Free Ampere A1 VM
>   in India West (Mumbai), published at `admin.anas.studio` through Cloudflare
>   Tunnel.
>
> There is still one Supabase database. There is still one R2 bucket, reached
> through the binding on the Worker and through the S3 API on the VM. Payload's
> 600,000-iteration password hashing is unchanged.
>
> Reason: production Workers refuses PBKDF2 above 100,000 iterations (I17), and
> cold Payload requests exceed the Free CPU limit (I19).
>
> P00's hosted proofs for login, CRUD, R2 and the scheduled write run against
> the admin origin. Public-route CPU stays proven on the Worker. At E07 (Workers
> Paid before live orders), moving the admin back is a separate decision,
> because nobody has verified whether the PBKDF2 cap still applies on Paid.

Region: India West (Mumbai), `ap-mumbai-1`. The Supabase database is in AWS
`ap-south-1` (Mumbai), and every admin request makes several database round
trips, so the VM sits beside the database rather than beside the user. Oracle
lists one availability domain there, so an "out of host capacity" error means
retrying later, not switching domains. The Tunnel requires the domain to be on
Cloudflare, which puts buying `anas.studio` (D25, previously deferred with E01)
on the critical path.

`PLANS/ARCHITECTURE.md` makes Payload native authentication the only staff
identity, and assumes the admin runs in the same Worker as the site. I17 shows
that native password auth fails on production Workers at every step that hashes
a password: login, first registration, reset, and setting a password. The plan
cannot proceed as written. The iteration count is a security constant, so the
choice belongs to the owner; no agent will change it on its own.

The options, all $0:

1. **Patch Payload to 100,000 iterations**, the most the platform allows, with
   `pnpm patch` and a new hash prefix so old and new hashes never get confused.
   The owner hash is regenerated in Node. This keeps native auth and the plan's
   architecture intact. The cost is hashing at one sixth of the OWASP
   PBKDF2-SHA256 figure. The iteration count only protects against offline
   cracking of a leaked database, and a long, randomly generated owner password
   makes that attack impractical at either count. The planned owner TOTP
   (ARCHITECTURE "Owner MFA") and Payload's lockout still apply. The CPU cost of
   100,000 iterations on Workers has not been measured. It is expected to exceed
   the 10 ms Free limit (roughly 100 ms on the local machine) and rely on burst
   tolerance, but only on rare owner logins.
2. **Replace password auth** with a different Payload auth strategy, such as a
   Cloudflare Access assertion or an emailed login link. This removes PBKDF2
   entirely. It amends ARCHITECTURE's native-auth decision, needs vendor limits
   cited from live documentation before anyone chooses it, and an emailed link
   depends on the deferred E01 email setup.
3. **Move the admin off Workers**, for example by running Payload admin on the
   owner's machine against the same database. This contradicts the plan's
   single-Worker design: native scheduled jobs and the custom admin views run in
   that Worker. It is the largest change, and it leaves P00's hosted
   authenticated CRUD criterion unprovable as written.

~~The orchestrator recommends option 1, together with a generated owner password
of at least 20 random characters.~~ Withdrawn the same day after the measurement
below: the password choice is the small part of the problem.

**Measurement, 2026-09-23: cold and warm CPU per request.** 26 read-only,
unauthenticated requests were sent to the live Worker over about 70 seconds.
None touched login. Each carried a unique `?m=a-NN` tag, and its CPU was read
back from Workers Observability (`$workers.cpuTimeMs`, grouped by URL). 23 of
the 26 appeared in the logs. Cloudflare spread them across four data centres
(MRS, MXP, PRG, LHR) and several instances within each, and every instance warms
separately.

| Request | Warm | Cold (first hit on an instance) |
|---|---|---|
| `/api/users/me`, `/api/users?limit=1` | 5–8 ms | 58–402 ms |
| `/api/health` (Payload plus one query) | 14 ms | 60–314 ms |
| `/admin/login` (admin page render) | 23 ms | 498–678 ms |
| `/` (public) | 3 ms | 11–17 ms |

13 of the 23 logged requests cost more than 50 ms: a burst of 25 requests never
reached a steady warm state. Limits of this measurement: only unauthenticated
pages were measured, and real admin screens with data (lists, the editor, saves)
do more work than the login page. It was one burst from one client.

The rule, from current documentation
(`developers.cloudflare.com/workers/platform/limits/`, read 2026-09-23): Workers
Free allows 10 ms of CPU per HTTP request and 10 ms per Cron Trigger. "Each
isolate [has] built-in flexibility to allow cases where [a] Worker infrequently
runs over [the] configured limit. If [a] Worker starts hitting [the] limit
consistently, execution will be terminated", which returns Error 1102. The
documentation does not define "consistently".

What it means:

- Warm API requests fit. Warm admin rendering is about twice the limit, and cold
  requests are 6–68 times over. At a solo owner's traffic, most admin clicks
  land on a cold instance. An admin inside the Worker on Free therefore depends
  on the flexibility clause for most of its work. If Cloudflare decides that is
  "consistent", the owner sees intermittent Error 1102 in the admin, such as a
  save that fails. Public visitors are unaffected.
- The password option does not change this. Options 1 and 2 leave the admin in
  the Worker.
- The cron at 52.2 ms (I16) is over the limit on every run, which is the pattern
  the documentation says gets terminated. It is the most exposed path.
- The public route stays within or near the limit. Its cold first hits of
  11–17 ms are infrequent by nature.
- Later customer-facing paths (checkout, payment webhooks) inherit the cold cost
  if they boot Payload in the Worker. Keeping Payload out of those request paths
  is a design constraint for P08, not yet recorded in the plan.

**Revised recommendation, 2026-09-23:** option 3 for the $0 window. The public
site stays on Workers, where it fits. The Payload admin runs in Node on the
owner's machine against the same database and R2. Node has no CPU limit and no
PBKDF2 cap, so password hashing stays at 600,000 iterations with no patch. The
costs are no admin editing away from that machine, and a plan amendment to the
single-Worker design. Scheduled jobs also need a home outside the Worker's
per-run 10 ms budget, which is not yet designed. Option 2 does not help, and
option 1 helps only with login. This is a recommendation, not a decision.

**Owner constraint, 2026-09-23:** the admin cannot live on the owner's own
machine, because the site is built for a client (Anas). The admin needs a hosted
home at $0; the only planned spend is the domain.

**Hosting research, 2026-09-23.** Every figure below was read from the vendor's
live page that day. None is recalled.

- **Oracle Cloud Always Free, Ampere A1** (the orchestrator's pick).
  - Resources: 2 OCPUs and 12 GB of memory in total, 200 GB of block storage,
    and 10 TB of outbound data per month, "for the life of the account", in the
    home region.
  - Signup: "most users need a mobile phone number and a credit card … Your
    credit card will not be charged unless you upgrade your account."
  - Risks:
    - Idle reclamation. Instances "may be reclaimed" if, over 7 days, p95 CPU,
      network and (A1 only) memory are all below 20%.
    - Shape capacity. Signup can hit "out of host capacity" errors.
    - Home region. Oracle says to choose it carefully.
    - Maintenance. The VM is a server someone must maintain, and there is no
      SLA.
  - It runs Payload as a normal Node server, which removes the PBKDF2 cap (no
    patch; 600,000 iterations stays) and the per-request CPU limit. It can also
    host the job runner, which moves the cron (I16, I18) off the Worker.
  - Cloudflare Tunnel publishes it on a subdomain with no open ports: "You do
    not need a paid Cloudflare Access plan to publish an application via
    Cloudflare Tunnel." Access seats were not verified.
- **Google Cloud Run** (runner-up).
  - Free each month: 2 million requests, 360,000 GB-seconds and 180,000
    vCPU-seconds, plus 1 GB of North America egress and 0.5 GB of Artifact
    Registry storage.
  - It scales to zero, so every admin session starts cold.
  - It needs a billing account, and "Any usage that exceeds the Free Tier usage
    limits is billed at standard rates."
  - A first uncached load of `/admin/login` transfers about 1 MB (60 KB of HTML
    plus 945 KB of assets, measured on the live Worker).
- **Azure Container Apps.** The free grant has the same shape as Cloud Run
  (180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests per
  subscription per month) and needs a subscription.
- **Ruled out:**
  - Google Colab: bans "file hosting, media serving, or other web service
    offerings"; free sessions run for at most 12 hours.
  - Supabase Edge Functions: 256 MB and 2 s of CPU per request, so not a host
    for a Node server. Supabase remains the database.
  - Vercel Hobby: non-commercial, personal use only. Opening the account in the
    client's name does not change this. Vercel defines commercial use as any
    deployment "used for the purpose of financial gain of anyone involved in any
    part of the production of the project, including a paid employee or
    consultant writing the code". Its examples include processing payments from
    visitors and advertising the sale of a product or service. It also says
    "Circumventing … Vercel's limits or usage guidelines is a violation."
    (`vercel.com/docs/limits/fair-use-guidelines`, read 2026-09-23.)
  - Hugging Face Docker Spaces: need a paid plan.
  - Render Free: sleeps after 15 idle minutes, takes about a minute to wake, and
    says "Do not use them for production applications".
  - Koyeb: no free compute instance.
  - AWS: the free plan closes after 6 months or when credits run out.
  - Azure App Service F1: 60 CPU minutes per day; "Use of free plan for
    production workloads is not supported."
  - Google e2-micro: 1 GB of memory, US regions only, 1 GB of egress.
  - Railway Free: $1 of credit per month and 0.5 GB of memory.
  - Fly.io: no free tier; the 512 MB machine costs about $3.32 per month.
- **Domain.** Cloudflare Registrar sells at cost and does not publish a price
  list; the exact .studio price shows only in the dashboard. A third-party
  tracker (domainoffer.net, 2026-09-05) lists the cheapest .studio renewal in
  the market at $21.55.

Sizing note for part 2. Oracle counts an A1 instance as idle only when CPU,
network *and* memory all stay under 20% for 7 days. A single-owner admin keeps
CPU and network near zero, so memory is what keeps the VM from counting as idle.
At 6 GB, that means at least 1.2 GB in steady use. After the real container is
measured, pick the instance memory so steady-state use sits above 20%. The
first build on the VM should use the swap file from `setup.sh` instead of extra
RAM.

Nothing has been provisioned. Opening an Oracle account needs the owner's phone
and card, so only the owner can do it. Moving the admin off the Worker still
needs the owner-approved plan amendment.

**Blocks:** the three unproven P00 criteria from I17 (private R2 round trip with
unauthorized denial, authenticated hosted CRUD including delete, and a real cron
content write). P00 is not accepted.

## I20 — the "public route fits Free" result was measured on a page with no data

**Status:** open, in progress. **Package:** P00. **Raised:** 2026-09-23.

I15's 2.4 ms p50 is correct for what it measured, but that route
(`src/app/(public)/page.tsx`) is static Arabic text. It reads nothing from
Payload or PostgreSQL. Real public pages will. The closest measured proxy is
`/api/health`, which boots Payload and runs one query plus one `find`. On the
live Worker it measured **14 ms warm** and 60–314 ms cold (I19). So an uncached
page that reads content is over the 10 ms Free limit even when warm. This is the
same failure pattern as I16 and I17: the measurement was sound, but it was taken
as proof of more than it covered.

D27 makes this sharper. The public Worker keeps reading content while the admin
writes it from another deployment, so the Worker needs a cache that the VM can
invalidate. OpenNext's documented design for this
(`opennext.js.org/cloudflare/caching`, read 2026-09-23) has three parts:

- An R2 incremental cache.
- A D1 tag cache, needed for `revalidatePath`/`revalidateTag`.
- A queue, needed only for time-based revalidation.

On-demand revalidation needs no queue. The static-assets cache in use today is
read-only, and it "does not support revalidation".

The free quotas, read the same day, cover a site of this size with room to
spare:

- R2 Standard: 10 GB-month of storage, 1 million Class A operations and
  10 million Class B operations per month.
- D1 on Workers Free: 5 million rows read and 100,000 rows written per day,
  and 5 GB of storage. Queries fail at the cap from 2026-09-01.

The planned proof, P00 on hosted Free:

- Serve a public page that reads one published document through the Payload
  Local API, with on-demand ISR.
- Measure CPU for cache hits and for a revalidation render.
- Show that an authenticated invalidation reaches a visitor within 60 seconds,
  the P02 requirement.

The Worker side of D27 lands in the same change:

- Remove the Cron Trigger and `scheduled` handler. The jobs moved to the VM, and
  the cron was the path over the limit on every run.
- Redirect `/admin` to `ADMIN_URL`.
- Refuse the Payload REST and GraphQL surface on the Worker, so its broken login
  path cannot be reached or used to lock the owner out.

The first hosted deploy attempts on 2026-09-23 failed before anything shipped.
The live Worker was left unchanged. There were two causes, both on the operator
side.

1. The orchestrator's deploy script cut the output off at 30 lines with `head`.
   That closed the pipe and would have killed a real deploy partway through.
2. `opennextjs-cloudflare populateCache remote` writes through a helper Worker
   that runs under workerd in remote mode. Every write returned 500, and the
   wrangler log gave the reason: `TLS peer's certificate is not trusted;
   unable to get local issuer certificate`. The `node:24-bookworm-slim` build
   container had no `ca-certificates` package. Node ships its own CA bundle,
   which is why plain wrangler API calls worked; workerd uses the system store.

Fixed by installing `ca-certificates` (20250419~deb12u1) in the container and
by running populate and deploy as separate steps with full logs.

**Hosted result, 2026-09-23.**

- Deployed Worker version `ef6809b5`.
  - Total Upload: 29616.49 KiB.
  - Cache population wrote 3 entries, and the D1 `revalidations` table was
    created.
  - The synthetic probe document is `629e1159-…`.
- CPU per request, read from Workers Observability grouped by cf-ray:

| Request | CPU |
|---|---|
| Cache hit on a warm isolate (probe page, `/`) | **2–5 ms** (8 of 12 hits) |
| Cache hit, first request on a new isolate | 17–22 ms (4 of 12 hits) |
| First render of the probe page (cache miss, cold Payload) | 503 ms |
| Unknown probe id (cache miss, not-found render) | 496 ms |
| `/api/health` (uncached by design) | 308 ms |
| `POST /api/revalidate` without secret (401) | 118 ms |

- Behaviour on production matched the contract:
  - `/admin/*` returns a 308 to `admin.anas.studio`, with path and query kept.
  - `/api/users/login` and `/api/graphql` return 404.
  - `/api/health` returns 200.
  - `/api/revalidate` without the secret returns 401.
  - An unknown probe returns 404.

What it means:

- The cache works. A warm cache hit costs about the same as the static
  placeholder did, so the public pages themselves fit.
- What does **not** fit is the per-isolate first request, about 20 ms. At this
  site's low traffic, roughly a third of hits land on a fresh isolate. This cost
  exists with or without the cache, and I15's p99 of 31.1 ms was the same
  floor. The obvious suspect is the 29.6 MB bundle's module evaluation, but
  that has not been isolated.
- Two design risks for P01 onward are recorded here and not solved:
  - **Cache misses are attacker-choosable.** Any unknown id or slug renders
    through cold Payload at about 500 ms. Real routes need their parameters
    validated before Payload is touched, or a bounded set of known paths.
  - **`/api/revalidate` costs 118 ms even when it refuses the request**,
    because the Next route loads first. The secret check could move into
    `worker-entry.ts`, ahead of OpenNext.
- **Invalidation proven on hosted, 2026-09-23 13:14Z.** The owner ran the
  script.
  - The probe title was edited in the hosted database, and the page still
    served the old title from cache.
  - `POST /api/revalidate` returned 200.
  - The new title was **visible 5 s later**, against P02's 60 s budget.
  - The next three requests were cache `HIT`s.
  - The revalidation render cost 480 ms of CPU, and the authorized revalidate
    call cost 168 ms.

## I21 — at this site's traffic, most cache hits land on a fresh isolate and cost 19–46 ms

**Status:** open. **Package:** P00. **Raised:** 2026-09-23.

The I20 publish proof ran after the Worker had been idle for about four hours.
Every request in it was served from cache, and every one cost more than the
10 ms Free limit:

| Request | CPU |
|---|---|
| Probe page, cache `HIT` (several isolates) | 19, 21, 25, 30, 46 ms |

The warm 2–5 ms seen earlier happened only inside a burst of requests seconds
apart. A single-owner portfolio site gets few visitors, so most real visitors
will arrive at an isolate that has not served anything yet. For this site the
per-isolate floor is the common case, not the exception.

The first-request cost sits close to the Worker startup time recorded at
deploy (20–22 ms, EXECUTION-STATUS). The hypothesis is that global-scope
evaluation of the 29.6 MB bundle is charged to the first request. This has not
been profiled, and the 30 and 46 ms samples suggest there is more to it than
startup alone.

Why it matters:

- The documentation terminates Workers that exceed the limit "consistently",
  with Error 1102.
- Here, the overrun would be consistent for ordinary public visitors, not only
  for the admin.
- This is the last open CPU exposure on the public path.

Options, none chosen:

1. Profile the first request of a cache hit and cut whatever runs before the
   cache lookup. For example, `worker-entry.ts` could answer cache hits before
   the OpenNext handler loads, and the bundle could be trimmed (I20 added
   4.3 MB).
2. Serve public pages as Workers Static Assets, which run no Worker code, with
   the VM rebuilding them on publish. The cost is publish latency: a rebuild
   takes minutes, not P02's 60 s.
3. Accept Workers Paid ($5/month, 30 s CPU default) earlier than E07 planned.
   That breaks the owner's $0 window, so it is the owner's call.

The recommendation is option 1 first, because it is measurable and costs $0. Part 2's
Dockerfile uses the same slim base, but it runs `next start` rather than
workerd; any image that runs wrangler remote mode needs the package.

## Resolved

**R01 — migration connection pointed at the pooled port.** `DATABASE_URL` is the
migration and CLI connection and was set to the transaction pooler on 6543,
which contradicts D26 and cannot carry named prepared statements. The builder
correctly refused to edit `.env` and reported it instead. The orchestrator
repointed it to the session endpoint on 5432 on 2026-09-22; the pooler probe had
already confirmed that endpoint accepts named prepared statements.
