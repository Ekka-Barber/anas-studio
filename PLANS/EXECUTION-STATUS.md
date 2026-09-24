# Execution status

What has actually been run and accepted, not what is planned. Orchestrator per D28; one writer at a time under `.anasaq-execution.lock`. Preparation, account existence and passing structural checks never close a runtime, payment, rights, launch, training or support gate. Earlier detail (P00 measurements, the Oracle VM episode, audits) is in Git history before 2026-09-24.

## Current state (2026-09-24)

| Field | Value |
|---|---|
| Branch | `agent/p00-runtime-spike` |
| Last commit | `31f39db` (D28/D29 docs) |
| P00 | Public runtime proven on hosted Workers Free: ISR cache 2–5 ms warm, edits visible 5 s after revalidation, first request on a fresh isolate 19–46 ms (I21, monitored until launch). Payload admin criteria withdrawn by D29. The D29 swap is next after the P01 part 1 commit. |
| P01 | Part 1 in the worktree, uncommitted: rounds 1–2 audited and passing, round 3 edited but not audited, plus the orchestrator's `/started` rework that the owner did not accept. Design is paused by the owner. |
| Lock | Held by the orchestrator, paused on P01 part 1. |
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

## Package ledger

| Package | Status | Evidence |
|---|---|---|
| P00 | public runtime accepted and committed; D29 swap not started | `artifacts/acceptance/P00/`, `docs/runtime-spike.md` (rewritten by the swap) |
| P01 | part 1 building, paused | `artifacts/acceptance/P01/` |
| P02–P12 | not_started | — |

## Next work, in order

1. Audit P01 round 3, decide what stays under D29, and commit P01 part 1 with the owner's approval.
2. P00 D29 swap (WORK-PACKAGES P00): remove Payload and the VM target, add the local Supabase stack.
3. P02 (reader) needs public UI and waits for design to reopen. Starting P03 before P02 would change the package order and needs the owner's approval.
