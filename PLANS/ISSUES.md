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

## Resolved

**R01 — migration connection pointed at the pooled port.** `DATABASE_URL` is the
migration and CLI connection and was set to the transaction pooler on 6543,
which contradicts D26 and cannot carry named prepared statements. The builder
correctly refused to edit `.env` and reported it instead. The orchestrator
repointed it to the session endpoint on 5432 on 2026-09-22; the pooler probe had
already confirmed that endpoint accepts named prepared statements.
