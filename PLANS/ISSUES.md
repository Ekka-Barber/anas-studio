# Issues

Open items only. Closed items are listed at the end in one line each; their full records are in Git history before 2026-09-24.

## I04 — CI builds the Worker but does not preview it

**Package:** P10. A preview without a migrated database asserts nothing while reporting green. A meaningful CI preview needs the local Supabase stack (or a Postgres service), applied migrations and a real smoke request.

## I05 — `pnpm build:worker` cannot run on Windows

**Environmental.** OpenNext fails with `EPERM ... syscall: 'symlink'`. Build Worker artifacts in the Linux container or CI; use `next dev` on Windows.

## I08 — `wrangler secret put` creates and deploys a stub Worker

**Operational.** Setting a secret on a Worker name that does not exist yet creates and deploys an empty Worker. That is how `anas-studio` became live before any authorized deploy (verified harmless: no code, every route 404). "Set the secrets first" is not a no-op ordering: it publishes a name.

## I09 — the build mirrors `.env` into `.open-next/`

**Standing constraint.** `.open-next/` contains every variable present at build time in cleartext. The deployed Worker does not carry them (verified with random markers). `.open-next/` is gitignored and CI has no artifact upload. **Never publish `.open-next/` as a CI artifact, release asset or image layer.** Build with throwaway values and supply real ones as Worker secrets.

## I21 — cache hits on a fresh isolate cost 19–46 ms CPU

**Launch gate (owner decision 2026-09-23, option A: wait and measure).** A low-traffic site mostly hits fresh isolates, and the first request cost more than the 10 ms Free limit in the P00 measurement (Payload-era upload of 25,338 KiB). The D29 swap cut the upload to 5,494 KiB; P10 re-measures hosted. Before launch and after the first week of real traffic, read `exceededCpu`/`exceededResources` from Worker analytics; if any appear on public routes, the owner chooses static pages or Workers Paid with that data.

## I23 — segment prefetches get the full page and the router loops

**Blocks launch of any page with `next/link` prefetch on.** Next 16 sends segment prefetches (`next-router-segment-prefetch: /_tree`); OpenNext's cache interceptor (`@opennextjs/aws` 4.1.4, `getBodyForAppRouter`) returned the full-page RSC instead of the segment, and the router re-prefetched forever (about 39 requests per second from one tab). The segment data exists in the build and the cache entry, so the lookup fails at request time. **Mitigation in P01:** `prefetch={false}` on every public `Link`. **Open:** fix the interceptor path (or upstream) or keep prefetch off as policy; verify hosted either way.

## I24 — token discipline

The P01 worker spent about 218M cached input tokens in 10.7 hours: one worker resumed across three audit rounds, 65 polling calls, visual runs hung by I23, 31 full container rebuilds for CSS fixes, and two usage-limit resumes. **Rules (CLAUDE.md, worker briefs):** a fresh bounded worker per round, never resumed; no polling; one screenshot pass at 360 and 1440 per round, the full suite only at acceptance; iterate CSS with `next dev`; end long sessions with a written state.

## I25 — public design direction, paused

The owner rejected the long-scroll rooms and then both open-book prototypes. Direction: the frozen handoff design (`deploy/design/`), improved only with Anas's full texts and real artwork, never a new metaphor. The orchestrator's `/started` rework was not accepted. Design is paused until the owner reopens it. Open owner question: Tabuk imagery (the generated photos do not represent Tabuk; real reference photos and film frames are preferred).

## I28 — hosted Supabase Auth settings must match the local ones

**Package:** P11 (hosted setup). In Supabase, the email section's "enable sign-up" switch (`[auth.email] enable_signup` locally) turns the whole email provider on or off, codes included; new sign-ups are blocked by the global switch (`[auth] enable_signup = false`). P03 lost sign-in to this once locally. On the hosted project: email provider ON, "Allow new users to sign up" OFF, email OTP length 6 and expiry 600 s, TOTP enroll/verify ON, the Arabic magic-link template, Resend as custom SMTP (the built-in sender allows 2 emails per hour), and `service_role` grants applied by the migrations. Verify with the same three refusal checks recorded in `artifacts/acceptance/P03/commands.txt`.

## I29 — hosted media origin and R2 housekeeping

**Package:** P11 (hosted setup), from P05. The public derivative bucket `anas-studio-media-public-test` (binding `MEDIA_PUBLIC`) does not exist yet; the owner creates it with a custom domain of its own (not the site origin), sets `NEXT_PUBLIC_MEDIA_ORIGIN` to it at build time (it is inlined into the server and admin bundles), and adds a response-header rule for `X-Content-Type-Options: nosniff` on that domain, because R2 custom domains do not add it. Housekeeping has no job yet: an R2 lifecycle rule should expire `quarantine/` in the private bucket after 1 day. Originals of tickets that expired or failed, and old `media_upload_tickets` rows, stay until a P06 cleanup job removes them. Known limit: an AVIF whose `irot` rotation swaps width and height is refused with a dimension mismatch.

## I30 — P06 cron CPU cost on Workers Free unmeasured

**Package:** P06 (from the 2026-09-26 round 2 audit), hosted measurement with I21. The every-minute cron runs through the full OpenNext handler (wrangler.jsonc ~:105, worker-entry.ts ~:98-110). I21 measured 19–46 ms CPU for public routes on a fresh isolate against the 10 ms Free limit, and no measurement exists for the cron path. The `build:worker` attempt on Windows fails on symlink creation (EPERM without Developer Mode/admin — recorded in `artifacts/acceptance/P06/commands.txt`), so the Linux pass owns both the build and the hosted measurement. The owner home now flags stale job runs (UI fix applied).

## I31 — Append-only `audit_events` blocks deleting auth users

**Package:** P06 (recorded 2026-09-26 from the independent audit, L9). During round 1's local run the worker deleted 710 `auth.users` rows as superuser and found that the append-only `audit_events` trigger refuses to delete any auth user who has audit rows — a deletion a privacy request ("delete my account") must be able to perform. The round 3 privacy runbook must define the path: either the runbook archives/pseudonymizes instead of deleting, or the trigger gains an owner-executable purge procedure with its own audit record. Nothing in the current plan covers it; `docs/operations.md` should state the chosen path once decided.

## Small UI items for when design reopens

- No favicon, so every page logs one 404 for `/favicon.ico`.
- `src/app/(public)/error.tsx` styles its button inline instead of through the CSS Module.

## Closed

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
