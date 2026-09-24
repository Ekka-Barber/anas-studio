# Execution status

What has actually been run and accepted, not what is planned. Orchestrator per D28; one writer at a time under `.anasaq-execution.lock`. Preparation, account existence and passing structural checks never close a runtime, payment, rights, launch, training or support gate. Earlier detail (P00 measurements, the Oracle VM episode, audits) is in Git history before 2026-09-24.

## Current state (2026-09-24)

| Field | Value |
|---|---|
| Branch | `agent/p00-runtime-spike` |
| Last commit | `c98b091` (P01 part 1) |
| P00 | Public runtime proven on hosted Workers Free (I21 monitored until launch). D29 swap built and audited, awaiting the owner's commit approval: Payload and the Oracle VM target removed, local Supabase stack with `staff` and `app_server`, Worker upload 25,338 → 5,494 KiB. |
| P01 | Part 1 committed (`c98b091`); `/started` design pending. Design is paused by the owner. |
| Lock | Held by the orchestrator for the P00 D29 swap. |
| Hosted resources | Worker `anas-studio` (test), R2 `anas-studio-media-test` (private), Hyperdrive `anasaq-cms` (caching off), D1 `anas-studio-tag-cache`, Supabase Free project `amqcphsmnopandhoxzsr` (ap-south-1). No deploys until P11 (local-first). |

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

## Package ledger

| Package | Status | Evidence |
|---|---|---|
| P00 | public runtime accepted and committed; D29 swap audited, awaiting commit | `artifacts/acceptance/P00/`, `docs/runtime-spike.md` (rewritten by the swap) |
| P01 | part 1 committed (`c98b091`); remaining rooms wait for design | `artifacts/acceptance/P01/` |
| P02–P12 | not_started | — |

## Next work, in order

1. Commit the P00 D29 swap with the owner's approval.
2. P02 (reader) needs public UI and waits for design to reopen. Starting P03 (staff auth, RLS, admin shell) before P02 changes the package order and needs the owner's approval.
