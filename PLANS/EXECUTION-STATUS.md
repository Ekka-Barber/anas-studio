# Execution status

What has actually been run and accepted, not what is planned. Orchestrator per D28; one writer at a time under `.anasaq-execution.lock`. Preparation, account existence and passing structural checks never close a runtime, payment, rights, launch, training or support gate. Earlier detail (P00 measurements, the Oracle VM episode, audits) is in Git history before 2026-09-24.

## Current state (2026-09-26)

| Field | Value |
|---|---|
| Branch | `sync/local-2026-09-26` on origin. `agent/p00-runtime-spike` on origin is stale at `4942011` and is not the working line. |
| Last product commit | `a324577`: independent-audit fix pass 1 (verification audit of it: NEEDS WORK — 7 resolved, rest partial/regressions), followed by fix pass 2 (this commit) addressing that verification. Last audited commit `79d8cf6` (P05). `d5c7ceb` moved the worker to GLM-5.3 (D30). |
| P00 | Public runtime proven on hosted Workers Free (I21 monitored until launch). D29 swap committed (`6f09321`); Worker upload 25,338 → 5,494 KiB. |
| P03 | Committed (`4322ccc`). |
| P04 | Complete: part 1 `ff67889`, part 2 `4ffc78f`. |
| P05 | Committed (`79d8cf6`). |
| P06 | Rounds 1 and 2 committed in `9b6d1e5`; audit fix pass 1 in `a324577`; fix pass 2 (M5 desktop tables, L5 schema/loader split, L1 real Resend bounce vocabulary, M1 SQL CHECK, race proof, IDN emails, evidence) in this commit. Independent verification pending. Round 3 not started. |
| P01 | Part 1 committed (`c98b091`); `/started` design pending. Design is paused by the owner. |
| Lock | Held by the coordinator for P06 (see the 2026-09-26 process note below). |
| Hosted resources | Worker `anas-studio` (test), R2 `anas-studio-media-test` (private), Hyperdrive `anasaq-cms` (caching off), D1 `anas-studio-tag-cache`, Supabase Free project `amqcphsmnopandhoxzsr` (ap-south-1). No deploys until P11 (local-first). |

## Process note, 2026-09-26 (owner-authorized)

The two audit-fix passes (`a324577` and this commit) were written by the ZCode
(GLM-5.3) coordinator session dispatching four parallel sub-agents per pass
with disjoint, enumerated file ownership — one agent per file, no overlaps —
plus coordinator-owned seam fixes and this ledger. This deviates from
CLAUDE.md's single-writer spawn rule (D28) and was explicitly ordered by the
owner ("make sure to run sub-agents 4 at a time... no more than one agent
work in one file at the same time"). Models: coordinator ZCode GLM-5.3;
sub-agents general-purpose on the session model; no glm-worker process was
involved. The CLI orchestrator's `.anasaq-execution.lock` (status: P06 round
2, building) was left untouched — it belongs to the CLI session, which will
reconcile on resume.

Migration `20260926120000` was edited in place under the same version during
both fix passes. This is safe: it has only ever been applied to the resettable
local database (P06 is local-only, no deploy per the lock), and the hosted
project receives migrations only at P11. The local DB is reset after each
edit; the hosted first-apply will get the final version.

## Owner decisions, 2026-09-24

- D29 approved: custom Supabase admin at `/admin` in the same app; Payload removed; the Oracle VM withdrawn.
- Admin UI uses the site's main theme colors and design tokens.
- Staff sign-in is passwordless: Supabase email code, and Google sign-in once a Google OAuth client exists. Owner step-up (TOTP) stays only for refunds, role changes and invites (D13).
- Clean the repository before going further: remove stale docs, files and code.
- Design work is paused; the frozen handoff design stays the reference when it resumes (I25).

## P01 round 3 audit (orchestrator, 2026-09-24)

- `pnpm lint`, `typecheck`, `test` (5 files, 34 tests), `check:copy` and `check:frozen` exit 0.
- Code read of every round 3 edit. Fix 1: the thura grid shows 7 photos with no orphan, and the lead photo matches the portrait source. Fix 2: the next-room link gets section rhythm. Fix 3: `prefetch={false}` on the error and not-found links. Fix 4: the reel reload stays unconditional, with the measured reason documented in `VideoReel.tsx`.
- One `next dev` pass of `/shelf` and an unknown URL at 360 and 1440. No horizontal overflow; zero RSC requests in 3 s idle (the I23 loop is gone); unknown URL returns 404.
- Findings: I27 (default English 404 for unmatched URLs, missing favicon, inline-styled error button). None blocks a part 1 checkpoint commit.
- Under D29 everything in P01 part 1 stays: it reads `content/initial-content.json` and touches no Payload code. `sharp` is a devDependency used only by the offline `scripts/prepare-media.mjs`, not by the app. The P00 swap must confirm it stays out of the Worker bundle.
- `/started` holds the orchestrator's handoff-composition rework. The owner did not accept it, and the earlier worker version was overwritten, so the commit records it as "design pending", not accepted.

## P00 D29 swap audit (orchestrator, 2026-09-24)

- Orchestrator: `supabase/config.toml` (sign-up off, email code, TOTP, Google wired and off), migration `20260924130000_staff_and_app_server.sql` and local-only `seed.sql`. SQL checks pass: deny-by-default grants, own-row/owner-all staff reads, last-owner guard (deactivate, demote, delete), revocation on next query, `app_server` EXECUTE-only.
- Worker (fresh `sonnet-worker` after a 429 stop that wrote nothing): Payload, the VM target and the probe removed; `db.ts`/health on `app_server`; worker-entry keeps only the revalidate gate; env tests (I03); docs rewritten.
- Orchestrator fixes: pg client timeouts; I27 global 404.
- Evidence: `artifacts/acceptance/P00/d29-swap/` (commands.txt, migration checks, 404 screenshot). All checks exit 0; 48 unit tests; Linux Worker upload 5,494 KiB; no secret key, sharp or Payload in the upload. One unexplained, non-reproducing health 503 is recorded.

## P03 audit (orchestrator, 2026-09-25)

- Orchestrator: migration (audit_events, staff_directory, service_role grants), auth config and Arabic code email, `staff-admin` Edge Function and its TOTP-freshness check with unit tests.
- Worker (`sonnet-worker`, `claude-sonnet-5` on every call): admin shell (sign-in by email code, security/TOTP, team with step-up dialog), browser client, `db:env` and `bootstrap:owner` scripts, real-JWT integration tests, e2e.
- Defects found and fixed: two in the orchestrator's own files (missing service_role grants; email provider switched off) and three in worker output (admin page overflow, a wrong e2e expectation, parallel DB tests). Details in `artifacts/acceptance/P03/commands.txt`.
- Results: static checks and build exit 0; 53 unit and 11 integration tests; 5 e2e; 13 SQL checks; admin screenshots at 360 and 1440 without overflow. Google sign-in and hosted auth settings remain open (I28).

## P04 part 1 audit (orchestrator, 2026-09-25)

- Orchestrator: migration (versions, live copy, publishing functions for `app_server`, `publish_due()` on pg_cron, revalidation through pg_net with Vault values) and local Vault seed.
- Worker (`sonnet-worker`): collection configs and Zod field model, database-backed loaders with cache tags, server-side publish module, idempotent local importer, CI with the local stack, tests.
- Fixed by the orchestrator: the old verbatim test broke typecheck/build; the publish module skipped validation when it could not read the draft (now fails closed). Accepted: CI uses the official `supabase/setup-cli`, SHA verified against its v3.0.1 tag.
- Results: static checks and build 0; 65 unit, 28 integration, 23 e2e; 24 SQL checks; the scheduled-publish chain proven end to end on `next dev`. Production-cache revalidation stays for P10. Evidence: `artifacts/acceptance/P04/`.

## P04 part 2 audit (orchestrator, 2026-09-25)

- Orchestrator: rich-text allowlist and safe renderer, `/api/preview` (staff token and role checked, httpOnly cookie, draft mode), draft reads in the loaders, `/started` data wiring (art keyed by year, hidden reels honoured).
- Worker round 1: content screens, generic form, Lexical editor, publish bar, version history, server actions. It wrote `vitest.config.ts` outside the allowlist (reverted; the cause was an import style in the orchestrator's own file). Its e2e tests fell short of the brief and left test content live.
- Worker round 2 (fresh): e2e rewritten to the brief; duplicate React key in the form fixed.
- Results: static checks and build 0; 71 unit, 28 integration, 26 e2e. One unexplained, non-recurring e2e timeout is recorded. Evidence: `artifacts/acceptance/P04/`.

## P05 round 1 audit (orchestrator, 2026-09-26)

- Orchestrator: migration `20260926090000_media_library.sql` (media table with RLS; anon reads only id and derivatives of media a published document uses; server-owned tickets; claim, complete and delete functions for `app_server`; where-used over live, scheduled and latest versions; folder rename).
- Worker (`glm-worker`, GLM-5.3, first run under D30; 29 minutes): ticket, part upload and completion routes, magic-byte and dimension checks from bounded reads (`image-size`; `file-type` was dropped in the round 2 audit because it breaks the Worker bundle), promotion to the public bucket, the local `/media` stand-in with nosniff and a sandbox CSP, media references in the loaders and `Picture`, the publish check for missing media, tests and docs.
- Fixed by the orchestrator: a second completion could delete the first one's objects, and a part could be swapped between check and promotion (fix: a one-time claim, and each derivative verified and promoted from the same bytes); md5 stored as `{}`; an oversized range read; an unmeasured CPU claim. Hosted media origin and R2 housekeeping are recorded as I29.
- Results: `pnpm check` 0 (104 unit); `test:db` 0 (46); media and CMS e2e 8 passed on `next dev`. Evidence: `artifacts/acceptance/P05/commands.txt`.

## P05 round 2 audit and acceptance (orchestrator, 2026-09-26)

- Worker (`glm-worker`, 51 minutes): the library screen (folders, search, paging, details, where-used, guarded delete), the upload dialog (`react-easy-crop`, canvas WebP at 360/720/1200/1800 without upscaling, a new ticket on retry), the image picker in collection forms, the browser e2e proof and screenshots. It caught a wrong URL shape in the orchestrator's brief.
- Fixed by the orchestrator: the details column squeezed the grid to one column inside the reading-width admin page (details now sit above the grid and take focus); the next upload inherited the previous image's alt and rights; delete was enabled before where-used loaded; `file-type` broke the Linux Worker bundle (it imports `strtok3`), so `image-size` now does the type check alone.
- Results: `pnpm check` 0 (109 unit); `test:db` 0 (46); media, CMS and auth e2e 13 passed; screenshots at 360 and 1440 without overflow; Linux `build:worker` and dry-run 0, 10,460 KiB upload (P04 commit 9,653 KiB, so P05 adds 8%), no Sharp, no secret key. Every P05 proof item is mapped in `artifacts/acceptance/P05/commands.txt`. Open: I29 (hosted media origin and R2 housekeeping, P11); upload CPU and the grown Worker's startup, with I21 at P10.

## P06 round 1 audit (orchestrator, 2026-09-26)

- Orchestrator: migration `20260926120000_contacts_and_email.sql` (inbox table with RLS for owner and operations; private `finance` schema with the outbox, delivery events, suppressions, throttles and job runs; `contact_submit`, `outbox_claim`/`outbox_result`, `email_event_record` for `app_server`; `outbox_attention`/`outbox_replay`/`job_runs_latest` for staff).
- Worker (`glm-worker`, 64 minutes): the contact API (Turnstile, honeypot, throttles), the email adapter (Resend, Mailpit locally, plain text with bidi isolates), the outbox dispatcher, the Svix-verified Resend webhook, the jobs endpoint and Worker cron trigger, tests and `docs/operations.md`.
- Incident: the first local e2e run called the real Resend API with the key in `.env` (`next dev` loads it). Resend refused all ~31 requests (unverified sender); no email was delivered and all recipients were test addresses. Fixed in code: real email only from a production build with a non-local `SITE_URL`; regression tests added.
- Also fixed: the webhook acknowledged failed writes (lost bounces); malformed event fields could fail every redelivery.
- Results: `pnpm check` 0 (152 unit); `test:db` 0 (78); e2e 20 passed on `next dev` with no real provider call. Evidence: `artifacts/acceptance/P06/commands.txt`.

## Package ledger

| Package | Status | Evidence |
|---|---|---|
| P00 | public runtime accepted; D29 swap audited and committed `6f09321` | `artifacts/acceptance/P00/`, `docs/runtime-spike.md` (rewritten by the swap) |
| P01 | part 1 committed (`c98b091`); remaining rooms wait for design | `artifacts/acceptance/P01/` |
| P02 | not_started; waits for design | — |
| P03 | accepted, committed `4322ccc` | `artifacts/acceptance/P03/` |
| P04 | accepted, committed `ff67889` and `4ffc78f` | `artifacts/acceptance/P04/` |
| P05 | accepted, committed `79d8cf6` | `artifacts/acceptance/P05/` |
| P06 | building: rounds 1–2 committed unaudited in `9b6d1e5` (round 1 audited by the orchestrator; round 2 not audited); round 3 not started; independent-audit fixes applied 2026-09-26 | `artifacts/acceptance/P06/` |
| P07–P12 | not_started | — |

## Next work, in order

1. Independent verification audit of the fix-pass-2 commit (the cloud reviewer), apply any follow-ups, then re-capture round 2 evidence from a production build.
2. P06 round 3: backups (destination and key holder need the owner's decision), the privacy-request runbook (I31's auth-user deletion blocker), notify routes, commerce settings, docs/costs.md; then the Linux Worker build and the phase 2 gate walk-through.
3. Commit P06 with the owner's approval.
