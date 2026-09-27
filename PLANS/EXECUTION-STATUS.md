# Execution status

What has actually been run and accepted, not what is planned. Orchestrator per D28; one writer at a time under `.anasaq-execution.lock`. Preparation, account existence and passing structural checks never close a runtime, payment, rights, launch, training or support gate. Earlier detail (P00 measurements, the Oracle VM episode, audits) is in Git history before 2026-09-24.

## Current state (2026-09-26)

| Field | Value |
|---|---|
| Branch | `sync/local-2026-09-26` on origin. `agent/p00-runtime-spike` on origin is stale at `4942011` and is not the working line. |
| Last product commit | `00586ea` (cloud audit of `3c4347c`): the rate-limit key takes Cloudflare's `cf-connecting-ip` first and the last `x-forwarded-for` hop only as fallback; signed upload URLs without upsert (closes the I34 TOCTOU); the visitor budget covers nested pages. Before it `3c4347c`, the audit-fix pass on top of D32 (2026-09-27, local): rate-limit caller key takes the last gateway-appended x-forwarded-for hop (was forgeable), pg_net created explicitly, budget/export checks widened (admin shell excluded from the visitor budget), callFunction shape-validated, verify_jwt pinned for the staff functions, new unit coverage (rate-limit, MISSING_PART, admin shell negatives). Before it `fcad3fd` on `claude/keen-mayer-iuyfz0`: D32 (static export on Pages, server work in Supabase Edge Functions and Storage, no tax, launch before payments; see "Owner decisions, 2026-09-26: D32–D34"), after `b284451` (D33, Thmanyah only). Before them `4e0684d`: D31, no admin inbox (`738801c` contact notices with Reply-To to the owner's mailbox, server-only `contacts`, inbox screen removed; `4e0684d` the Email Routing settings step). Before it `87ebd1c`: phone-card labels no longer glued to Latin values (D18, cloud verification of `ed1bc36`); `0086cff`: timezone-independent webhook timestamps + local verification of the cloud pass (db 93, unit 215, e2e 22/22, screenshots reviewed); `bc3b915`…`2325466`: the cloud audit of `efa0e45` (see the process note); `efa0e45` audit fix pass 2; `a324577` fix pass 1. Last audited commit `79d8cf6` (P05). `d5c7ceb` moved the worker to GLM-5.3 (D30). |
| P00 | Public runtime proven on hosted Workers Free, then replaced by D32: the site is a static export on Cloudflare Pages and the Worker is gone (I21 moot). D29 swap committed (`6f09321`). D32 replatform committed (`fcad3fd`); its database, functions and e2e runs are pending local verification. |
| P03 | Committed (`4322ccc`). |
| P04 | Complete: part 1 `ff67889`, part 2 `4ffc78f`. |
| P05 | Committed (`79d8cf6`). |
| P06 | Rounds 1 and 2 committed in `9b6d1e5`; audit fix pass 1 `a324577`; fix pass 2 `efa0e45`; cloud audit of `efa0e45` with 14 fixes in `2325466`…`f5fe74d` (desktop tables, calendar, email filter, webhook timestamps and outage handling, IDN delimiters, quota index, race test, dates in RTL, WhatsApp spellings, evidence). Local verification of those fixes is done (details at the end of `artifacts/acceptance/P06/commands.txt`): `db:reset`/`db:import`, `test:db` 93, `pnpm test` 215, Playwright 22/22, screenshots re-captured and reviewed. One timezone-dependent timestamp test surfaced and was fixed on both sides (route treats zone-naive ISO as UTC; test asserts shape for `Date.parse('1')`). The cloud verification of `ed1bc36` found the re-captured 360 cards still glue labels to Latin values (D13's `:dir(ltr)` is compiled away by Next); fixed in `87ebd1c` and locally verified (owner-operations 17/17 via `localhost:3000`, screenshots re-captured, every card label's computed `::before` serves the isolated label plus trailing space — details at the end of `artifacts/acceptance/P06/commands.txt`). Round 2 is closed (I30 is moot with D32). D31 (owner, 2026-09-26) then removed the admin inbox: `738801c`, `4e0684d`; D32 moved the contact, webhook, jobs and stats endpoints into Edge Functions. D31+D32 are locally verified on the full stack (2026-09-27, `artifacts/acceptance/P06/commands.txt`): test:db 115/115 including the 9 Auth-dependent files, check 216/216 unit after an independent 4-agent audit and its fix pass (forgeable rate-limit IP key fixed to the last x-forwarded-for hop, pg_net created, checks widened, MISSING_PART/shell negatives tested; residuals recorded as I34), build + export + budgets green, e2e 67/67 with the functions reaching Mailpit and the visitor IP passing the gateway, room screenshots in `artifacts/acceptance/P01/screenshots/` showing Thmanyah Serif Display titles. Round 3 not started; its notify routes moved to P08. |
| P01 | Part 1 committed (`c98b091`); `/started` design pending. Design is paused by the owner. |
| Lock | The CLI orchestrator's `.anasaq-execution.lock` (P06 round 2) is on the owner's machine and unknown from the repo. The cloud writer of `2325466`…`f5fe74d`, `87ebd1c` and the D31 commits wrote only while the local session was idle or waiting on its verdict, by owner authorization, and holds nothing after its push. |
| Hosted resources | Supabase Free project `amqcphsmnopandhoxzsr` (ap-south-1). Unused since D32 and the owner's to delete once the Pages site works (irreversible, his own action): Worker `anas-studio` (test), R2 `anas-studio-media-test`, Hyperdrive `anasaq-cms`, D1 `anas-studio-tag-cache`. No deploys until P11 (local-first). |

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

Cloud audit pass (2026-09-26, owner-authorized): the cloud reviewer, which
had audited `9b6d1e5` and `a324577` read-only, was made the writer for one
pass while the local machine stayed idle, so there was still one writer. It
audited `efa0e45`, then fixed what it found in small labeled commits
`2325466`…`f5fe74d` on branch `claude/keen-mayer-iuyfz0` (cut from `efa0e45`)
plus the commit that records this note; the model is named in each commit's
Co-Authored-By trailer. It edited the P06 migration in place once more
(`outbox_claim`'s quota count), under the same resettable-local-only
reasoning as above. It could not run the Supabase stack: the database, e2e
and screenshot items it lists as pending local verification were run after
its push by the local session and all passed (one timezone-dependent test
fixed on top, recorded in `artifacts/acceptance/P06/commands.txt`). The
cloud verification of that local pass (`ed1bc36`) found one more defect in
the cloud's own D13 fix and fixed it in `87ebd1c` (D18, same file).

## Owner decisions, 2026-09-26: D32–D34, static site, Thmanyah only, no tax

- The owner asked why this project struggled on the free Cloudflare tier while his Ekka-Rekaz (100k+ lines) runs on Pages without issues. The difference is the build, not the host: Ekka is static files on Pages with Supabase Edge Functions; this project ran the whole Next server on a Worker (I21, I23, I30). He then asked for "THE BEST PLAN EVER / THE BEST STACK EVER" and approved the D32–D34 plan.
- D33 (`b284451`): Thmanyah is the only font; Lyon deleted from the site, the repo and the frozen reference copies (owner override for those files).
- D32 (`fcad3fd`): Next.js `output: 'export'` to `out/` for Cloudflare Pages; publishing from the admin calls the SQL functions as the signed-in staff member and requests a coalesced Pages rebuild through pg_cron; the draft preview is `/admin/preview`; the Edge Functions `contact`, `resend-webhook`, `outbox` (pg_cron through `outbox_kick()`) and `admin` (media tickets and checks, stats, settings status) over `supabase/functions/_shared/`; Supabase Storage buckets `media-private`/`media-public`; `service_role` replaces `app_server`, which is dropped. Removed: OpenNext, wrangler, Hyperdrive, the R2/D1 bindings, the Worker cron, `src/app/api/**`. I04, I05, I08, I09, I21, I23 and I30 closed as moot; I29 restated for Storage; I32 (hosted checks) and I33 (room videos) opened.
- D34: no tax anywhere; the site launches before payments with the store «قريباً»; E02 blocks paid operation only.
- Flag for Anas: the offer lists Cloudflare R2 for images and files (lines 1556, 1785, 1956). Supabase Storage fills that role now; like D29 for Payload, he is told, and R2 through its S3 API stays a bounded change behind `MediaStore` if he wants it.
- Cloud checks and the pending local list are at the end of `artifacts/acceptance/P06/commands.txt`.

## Owner decision, 2026-09-26: D31, the owner's mailbox is the inbox

- Anas uses his own Gmail; `help@anas.studio` is a Cloudflare Email Routing address forwarding to it (his launch step, no code). Building an email interface in the admin is not worth it.
- Done by the cloud writer after the owner approved the plan: the الوارد screen, its nav link and home count are removed; the contact notice carries Reply-To set to the visitor and no admin link; `public.contacts` is server-only (no API grant, no status/notes/assignment; the P06 migration edited in place, local-only, same precedent as above); settings lists the Email Routing step. Commits `738801c`, `4e0684d` and the one recording this.
- Kept: the contact form and its protections, the outbox, Resend, the bounce webhook and the البريد failed-sends page, because automatic customer mail (receipts, download links, bookings, availability notices, Supabase Auth SMTP) still needs them. Email Routing cannot send.
- Moved: the availability opt-in routes (`notify`, `notify/confirm`, `notify/unsubscribe`) and the notifications collection go from P06 round 3 to P08, where products exist.

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
| P06 | building: rounds 1–2 in `9b6d1e5` (round 1 audited by the orchestrator); fix passes `a324577`/`efa0e45`; cloud audit fixes `2325466`…`f5fe74d` locally verified (db 93, unit 215, e2e 22/22, screenshots reviewed; one TZ-dependent test fixed on top); card-label fix `87ebd1c` locally verified (17/17, computed-content probe, screenshots re-captured); round 2 closed except the Linux build items; D31 no-inbox change `738801c`/`4e0684d` and the D32 replatform pending local verification; round 3 not started | `artifacts/acceptance/P06/` |
| P07–P12 | not_started | — |

## Next work, in order

Work moves to the local machine on 2026-09-27; the cloud session's handoff is `PLANS/HANDOFF.md`.


1. DONE 2026-09-26: owner-operations 17/17 via `PLAYWRIGHT_BASE_URL=http://localhost:3000` (Next 16 dev blocks 127.0.0.1 as a cross-origin dev origin — the admin form never hydrates over 127.0.0.1; details in `artifacts/acceptance/P06/commands.txt`); screenshots re-captured; every card label's computed `::before` serves the isolated label plus trailing space.
2. DONE 2026-09-27 (plus the audit fix pass above). Local note for future runs: an early `supabase stop --no-backup` wiped the imported content (7 loader failures) — the recipe's plain restart keeps volumes; and the import/tests need `DATABASE_URL` from `supabase status -o json`'s DB_URL (it is no longer in any env file).
3. DONE 2026-09-27: local run of `00586ea` on the full stack — test:db 115/115, `pnpm check` (unit 215/215), build, check:export, check:budgets (largest 142.1 KiB), full Playwright 67/67 including media's two no-upsert refusals and the contact bucket keyed by `cf-connecting-ip` (details at the end of `artifacts/acceptance/P06/commands.txt`).
3a. P06 round 3, in this order: (1) DONE 2026-09-27: H2 — routine e2e runs report to the git-ignored `test-results/`, and `ACCEPTANCE_PACKAGE=Pxx` files the report under `artifacts/acceptance/Pxx/`; (2) DONE 2026-09-27: `20260927120000_rebuild_delivery_and_media_sweep.sql` plus the `media_sweep` job (Storage refuses SQL deletes, so the parts go through the Storage API; I35 recorded on the way) — one pg_cron migration for I29 (quarantine objects and ticket rows older than a day) and I34 (the deploy hook's `net._http_response` checked, a failed call re-armed and recorded in `finance.job_runs` as `site_build`); (3) DONE 2026-09-27: commerce settings without tax (D34), built by glm-worker and audited (four orchestrator fixes; clean-reset proof, e2e 69/69); (4) the I31 privacy runbook — buyers are guests (D08), so a customer request touches customers/orders, never `auth.users`; for a departed staff member the path is revoke (already built) and, if erasure is asked, a tombstoned email in `auth.users` instead of deleting the user, which leaves `audit_events` append-only; (5) backups, owner-run and local (D35, owner 2026-09-27): `pnpm backup` on Anas's machine and `pnpm restore-check` into a throwaway local stack, the last run shown on the owner home, no CI workflow, destination or separate key custodian; (6) docs/costs.md with cited prices only (Pages, Supabase, Resend, Email Routing, domain), nothing invented. Then the phase 2 gate walk-through.
4. Commit P06 with the owner's approval.
5. When the owner authorizes hosting (P11): the Pages project, its deploy hook in Vault, the function deploy and secrets, the I32 checks, the I33 video decision; then he deletes the old Worker, Hyperdrive, D1 and R2 resources himself.
