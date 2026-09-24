# Issues

Open items only. Closed items are listed at the end in one line each; their full records are in Git history before 2026-09-24.

## I03 — unit tests for the environment and secret guards

**Package:** P00 D29 swap. `pnpm test` now runs the P01 unit tests, but the safety helpers still have none: the local-database guard (`isLocalDatabaseUrl`, `assertLocalTestDatabase` in `src/lib/env.ts`) and the constant-time secret comparison. The swap rewrites `env.ts` for Supabase and adds these tests.

## I04 — CI builds the Worker but does not preview it

**Package:** P00 D29 swap / P10. A preview without a migrated database asserts nothing while reporting green. A meaningful CI preview needs the local Supabase stack (or a Postgres service), applied migrations and a real smoke request.

## I05 — `pnpm build:worker` cannot run on Windows

**Environmental.** OpenNext fails with `EPERM ... syscall: 'symlink'`. Build Worker artifacts in the Linux container or CI; use `next dev` on Windows.

## I08 — `wrangler secret put` creates and deploys a stub Worker

**Operational.** Setting a secret on a Worker name that does not exist yet creates and deploys an empty Worker. That is how `anas-studio` became live before any authorized deploy (verified harmless: no code, every route 404). "Set the secrets first" is not a no-op ordering: it publishes a name.

## I09 — the build mirrors `.env` into `.open-next/`

**Standing constraint.** `.open-next/` contains every variable present at build time in cleartext. The deployed Worker does not carry them (verified with random markers). `.open-next/` is gitignored and CI has no artifact upload. **Never publish `.open-next/` as a CI artifact, release asset or image layer.** Build with throwaway values and supply real ones as Worker secrets.

## I21 — cache hits on a fresh isolate cost 19–46 ms CPU

**Launch gate (owner decision 2026-09-23, option A: wait and measure).** A low-traffic site mostly hits fresh isolates, and the first request cost more than the 10 ms Free limit in the P00 measurement (Payload-era bundle of 29.6 MB). Removing Payload should shrink this; P10 re-measures hosted. Before launch and after the first week of real traffic, read `exceededCpu`/`exceededResources` from Worker analytics; if any appear on public routes, the owner chooses static pages or Workers Paid with that data.

## I23 — segment prefetches get the full page and the router loops

**Blocks launch of any page with `next/link` prefetch on.** Next 16 sends segment prefetches (`next-router-segment-prefetch: /_tree`); OpenNext's cache interceptor (`@opennextjs/aws` 4.1.4, `getBodyForAppRouter`) returned the full-page RSC instead of the segment, and the router re-prefetched forever (about 39 requests per second from one tab). The segment data exists in the build and the cache entry, so the lookup fails at request time. **Mitigation in P01:** `prefetch={false}` on every public `Link`. **Open:** fix the interceptor path (or upstream) or keep prefetch off as policy; verify hosted either way.

## I24 — token discipline

The P01 worker spent about 218M cached input tokens in 10.7 hours: one worker resumed across three audit rounds, 65 polling calls, visual runs hung by I23, 31 full container rebuilds for CSS fixes, and two usage-limit resumes. **Rules (CLAUDE.md, worker briefs):** a fresh bounded worker per round, never resumed; no polling; one screenshot pass at 360 and 1440 per round, the full suite only at acceptance; iterate CSS with `next dev`; end long sessions with a written state.

## I25 — public design direction, paused

The owner rejected the long-scroll rooms and then both open-book prototypes. Direction: the frozen handoff design (`deploy/design/`), improved only with Anas's full texts and real artwork, never a new metaphor. The orchestrator's `/started` rework was not accepted. Design is paused until the owner reopens it. Open owner question: Tabuk imagery (the generated photos do not represent Tabuk; real reference photos and film frames are preferred).

## I27 — unknown URLs show Next's default English 404

**Package:** P00 D29 swap (app root) / P01. Found in the P01 round 3 audit, 2026-09-24. `/no-such-page` returns status 404 but renders Next's built-in English page, not `src/app/(public)/not-found.tsx`. With one root layout per route group and no shared root, a group-level `not-found.tsx` only handles `notFound()` calls inside that group. Fix when the swap reshapes the app root (for example a global not-found page with its own `<html lang="ar" dir="rtl">`), then re-test. Same audit: there is no favicon, so every page logs one 404 for `/favicon.ico`; and `error.tsx` styles its button inline instead of through the CSS Module. These two are small UI items for when design reopens.

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
- R01 — the migration connection now uses the session endpoint on 5432.
