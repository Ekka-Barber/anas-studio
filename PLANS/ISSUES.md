# Issues

Open items only. Closed items are listed at the end in one line each; their full records are in Git history before 2026-09-24.

## I24 — token discipline

The P01 worker spent about 218M cached input tokens in 10.7 hours: one worker resumed across three audit rounds, 65 polling calls, visual runs hung by I23, 31 full container rebuilds for CSS fixes, and two usage-limit resumes. **Rules (CLAUDE.md, worker briefs):** a fresh bounded worker per round, never resumed; no polling; one screenshot pass at 360 and 1440 per round, the full suite only at acceptance; iterate CSS with `next dev`; end long sessions with a written state.

## I25 — public design direction, paused

The owner rejected the long-scroll rooms and then both open-book prototypes. Direction: the frozen handoff design (`deploy/design/`), improved only with Anas's full texts and real artwork, never a new metaphor. The orchestrator's `/started` rework was not accepted. Design is paused until the owner reopens it. Open owner question: Tabuk imagery (the generated photos do not represent Tabuk; real reference photos and film frames are preferred).

## I28 — hosted Supabase Auth settings must match the local ones

**Package:** P11 (hosted setup). In Supabase, the email section's "enable sign-up" switch (`[auth.email] enable_signup` locally) turns the whole email provider on or off, codes included; new sign-ups are blocked by the global switch (`[auth] enable_signup = false`). P03 lost sign-in to this once locally. On the hosted project: email provider ON, "Allow new users to sign up" OFF, email OTP length 6 and expiry 600 s, TOTP enroll/verify ON, the Arabic magic-link template, Resend as custom SMTP (the built-in sender allows 2 emails per hour), and `service_role` grants applied by the migrations. Verify with the same three refusal checks recorded in `artifacts/acceptance/P03/commands.txt`.

## I29 — media housekeeping in Storage

**Status (2026-09-27, P06 round 3):** resolved by `20260927120000_rebuild_delivery_and_media_sweep.sql` and the `media_sweep` job (`supabase/functions/_shared/media-sweep.ts`, daily pg_cron kick): quarantine parts and ticket rows older than a day are removed, the parts through the Storage API because Storage refuses direct deletes from `storage.objects`. Not covered: orphaned public derivatives (I34 residual). Details in `docs/operations.md` "Media sweep".

**Package:** P06 round 3 (cleanup job), from P05, restated for D32. Supabase Storage has no lifecycle rules, so nothing expires yet: staged parts under `quarantine/` in `media-private` stay when a ticket expires or fails before completion (a failed completion removes its own parts), and so do old `media_upload_tickets` rows. A cleanup job (pg_cron, like the outbox) should remove quarantine objects and ticket rows older than a day. Known limit: an AVIF whose `irot` rotation swaps width and height is refused with a dimension mismatch.

## I31 — Append-only `audit_events` blocks deleting auth users

**Status (2026-09-27, P06 round 3):** resolved: a departed staff member is erased, not deleted. `public.privacy_erase_staff` replaces the address everywhere (auth.users, the Auth log about them, the email outbox) and deletes their identities, sessions, factors and tokens; the Auth user and the append-only trail keep only the id. Runbook: `docs/privacy-data-map.md`. Buyers are guests (D08) and never touch auth.users.

**Package:** P06 (recorded 2026-09-26 from the independent audit, L9). During round 2's local run the worker deleted 710 `auth.users` rows as superuser and found that the append-only `audit_events` trigger refuses to delete any auth user who has audit rows — a deletion a privacy request ("delete my account") must be able to perform. The round 3 privacy runbook must define the path: either the runbook archives/pseudonymizes instead of deleting, or the trigger gains an owner-executable purge procedure with its own audit record. Nothing in the current plan covers it; `docs/operations.md` should state the chosen path once decided.

## I32 — hosted checks the local stack cannot make

**Package:** P11 (hosted setup), from D32. Three facts are only true or false on the hosted project: (1) which header carries the visitor's IP to the `contact` function. The rate-limit key takes `cf-connecting-ip` first (Cloudflare fronts hosted Supabase and replaces any client value), else the LAST `x-forwarded-for` hop, else `local` (`supabase/functions/_shared/rate-limit.ts`). Community reports on hosted Supabase ([supabase#34647](https://github.com/orgs/supabase/discussions/34647)) say `cf-connecting-ip` holds the real address and that a spoofed `x-forwarded-for` gets the real address appended after it; no official statement exists. Probe it at P11 with a throwaway function that echoes the three headers, called with forged `cf-connecting-ip` and `x-forwarded-for` values, then delete it; if Cloudflare's value does not arrive, the last hop must be confirmed as the visitor, not a proxy; (2) whether Storage's public responses carry `X-Content-Type-Options: nosniff` (only checked WebP ever reaches `media-public`, and the bucket accepts `image/webp` only, so a missing header is recorded, not a blocker); (3) the Pages build count per month against the plan's quota, with rebuilds coalesced to at most one per two minutes.

## I33 — the room videos are not in the repository

**Package:** P11 (hosted setup), from D32. The 18 transcoded room films (`public/media/*.mp4`, 55.9 MiB, made by `scripts/prepare-media.mjs` from local sources) are git-ignored, so a Cloudflare Pages build from the repository has none and the reels would 404. Before launch, either commit the transcoded files (each is under Pages' 25 MiB file limit) or upload them to a public Storage bucket and point the manifest at it. Owner's choice; the photos and content are on his machine too (E05).

## I34 — site rebuild delivery is fire-and-forget

**Status (2026-09-27, P06 round 3):** the delivery half is done: `site_build_trigger` keeps the pg_net request id, reads `net._http_response` on the next run, records each answered call as a `site_build` job run, and re-arms a failed call up to five times in a row (then the owner home shows «فاشل» until the next publish). Still open for P11: a Pages build that breaks after the hook answered is visible only in the Pages dashboard; the LOW residuals below.

**Package:** P11 (hosted setup), from the 2026-09-27 local audit of D32. `site_build_trigger` fires the Pages deploy hook through pg_net and stamps `triggered_at` unconditionally: if the hook answers 4xx/5xx or the request fails, the build request is consumed with no retry and no signal — the database says delivered, the public site stays stale, and the only recovery is the next publish. A failed Pages build itself is invisible too (the last good deploy stays live, which is fine, but nobody is told). With the owner, decide the observability: at minimum, check the Pages build history after the first few publishes; better, record the pg_net request id and its outcome, or move the hook call into the `outbox` function where failures already leave a trail. Recommended (cloud audit of `3c4347c`), in round 3 with the I29 sweep, since both are pg_cron + SQL: `site_build_trigger` stores the id `net.http_post` returns; the next run reads `net._http_response` for it (kept about 6 hours), re-arms the request (`triggered_at = null`) when the status is not 2xx or the call timed out, and records each attempt in `finance.job_runs` as `site_build`, so the owner home's job health shows a failing hook with no new service. A failed Pages build (the hook answered, the build broke) stays visible only in the Pages dashboard; the owner checks it after the first publishes. Related residuals from the same audit, all LOW: `media-delete` swallows Storage-removal failures so orphaned public derivatives can outlive their row until the I29 sweep exists, the `contact:email` throttle key is an unsalted sha256 (DB-read-only concern), and the public bearer/401 endpoints answer unthrottled. The original-promotion TOCTOU is closed: signed upload URLs no longer allow upsert, so a verified part cannot be replaced before it is moved (local e2e proof pending).

## I35 — the email job reads as stale on an idle site

**Status (2026-09-27, P06):** resolved by `20260927150000_outbox_due_since.sql`: `finance.outbox_due_since()` is the one due predicate for the owner home and `outbox_kick()`. The home warns «بريد ينتظر الإرسال منذ أكثر من 10 دقائق. تأكد من الجدولة.» only when a row has waited more than 10 minutes and no email run finished in those 10 minutes, and an uncertain row past its 23-hour window no longer wakes the function. Residual for P08: while a Resend quota holds mail back, rows stay due and the job keeps running, so the home shows no warning; quota-delayed mail needs its own signal once receipts exist.

**Package:** P06 (found 2026-09-27 during round 3). Since D32, `outbox_kick()` calls the `outbox` function only while a row is due, so on a quiet hosted site the last `email_outbox` run can be hours old. The owner home still applies M4's 10-minute rule to that job and would show «آخر تشغيل قديم — تأكد من الجدولة» even though nothing is wrong. Locally it never shows, because the Vault values are unset and the e2e runs the job itself. A correct signal is "a row has been due for more than a few minutes and no run followed", which needs a small SQL function the home can call. Decide before P11.

Found while tracing (2026-09-27): `outbox_kick()` counts an `uncertain` row whose first attempt is more than 23 hours old as due, but `outbox_claim` never takes it (it waits for a person's replay), so one stuck row wakes the function and records a run every minute until someone acts. Brief: `artifacts/acceptance/P06/brief-i35-email-due.md` fixes both with one shared predicate.

## I37 — a cold `next dev` after `pnpm build` 404s an admin route

**Status (2026-09-27, P06):** resolved: the dev server Playwright starts builds into `.next/e2e` (`NEXT_DIST_DIR`, read by `next.config.ts`), emptied before every start, and `pnpm build` removes that folder too; `tsconfig.json` lists its type folders so `next dev` does not rewrite it. The manual `.next` deletion is no longer needed. Not reproduced: with the old configuration, `pnpm build` and then the spec on a cold server passed 19/19, so the old cause (build leftovers or a stale dev cache) stays unproven; a fresh, separate folder rules out both.

**Package:** P06 (found 2026-09-27 during the step 4 acceptance). After `pnpm build` (the static export), a cold `next dev` answered the public 404 for `/admin/content/site_settings/edit?id=site` when a run reached that route late: `owner-operations.spec.ts` alone failed its settings test three times cold, while the same test passes on a warm server, the full suite passes (earlier specs reach the edit route first), and with `.next` deleted the spec passed 19/19 cold. Production is unaffected: the export ships that page as a file. Fix: give the e2e dev server its own dist dir so a build never shares state with it (for example `distDir: process.env.NEXT_DIST_DIR ?? '.next'` in `next.config.ts`, `NEXT_DIST_DIR=.next-e2e` in the Playwright web server command, and the folder git-ignored). Until then, delete `.next` before an e2e run that follows a build.

## Small UI items for when design reopens

- No favicon, so every page logs one 404 for `/favicon.ico`.
- `src/app/(public)/error.tsx` styles its button inline instead of through the CSS Module.

## Closed

- I04, I05, I08, I09, I21, I23, I30 — the Worker preview in CI, the Windows OpenNext symlink error, `wrangler secret put` creating a stub Worker, `.env` mirrored into `.open-next/`, Worker CPU on fresh isolates, OpenNext's segment-prefetch loop and the Worker cron's CPU: moot with D32 (no Worker; static files on Pages, server work in Supabase). The old Worker, Hyperdrive and R2/D1 resources are the owner's to delete once the Pages site works. `prefetch={false}` stays until a hosted check turns it back on.

- I01 — withdrawn: the Worker never exceeded the enforced size limit.
- I02 — P00 hosted half: the public route was proven; the admin half was withdrawn by D29.
- I06, I10, I16, I17, I18 — Payload job rows, `payload run`, PBKDF2 login CPU, seeded-owner login and cron bundling: gone with Payload (D29).
- I07 — the superseded 3 MiB limit was removed from code and docs (`07cbc49`, `9f64d2a`).
- I11, I12, I14, I15 — P00 pooler connection, CPU and budget findings: resolved or measured in P00 and committed.
- I13 — external audit of P00: fixes accepted; its two open items (Payload job-sweep role check, unenforced migration-connection helper) are superseded by D29's roles and `supabase/migrations/`.
- I19, I22 — the Oracle VM admin (proposed D27) and its impact analysis: withdrawn by D29; the VM files are removed in the P00 D29 swap.
- I20 — public route measured with real data and on-demand ISR; accepted and committed.
- I26 — owner questioned Payload: resolved by D29.
- I03 — unit tests for the environment and secret guards: `tests/unit/env.test.ts` (P00 D29 swap).
- I27 — unmatched URLs showed Next's English 404: `src/app/global-not-found.tsx` renders the Arabic page with status 404 (P00 D29 swap).
- R01 — the migration connection now uses the session endpoint on 5432.
