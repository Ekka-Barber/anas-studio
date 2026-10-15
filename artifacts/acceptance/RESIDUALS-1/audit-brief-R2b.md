# RESIDUALS-1, round R2b: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, reads every money and migration line itself, and
rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against `c19354c`: `git diff c19354c` plus the untracked migration
`supabase/migrations/20261015140000_residuals_r2b.sql` (`git status --short`). Not yours: `.claude/launch.json` and
`.claude/settings.json` (the owner's: never open them), `artifacts/ledger/`, and the briefs and records under
`artifacts/acceptance/RESIDUALS-1/` except `brief-R2b.md`, which is the writer's brief with the orchestrator's decided
fixes (7 items). Each item's evidence is its block, by id, in `artifacts/acceptance/FABLE-AUDIT/work/waveA/digest.md`
or `waveC/digest.md`.

The migration creates functions again and adds columns, an index and defaults. Diff every function against its
previous latest definition (find it with `grep -ln` over `supabase/migrations/`, the newest file wins; R1's and R2a's
files, `20261015120000_residuals_r1.sql` and `20261015130000_residuals_r2a.sql`, count): the item's change and nothing
else. One change is the orchestrator's: the `SEQ_TAKEN` row in `supabase/functions/_shared/disputes.ts` (`REFUSALS`)
and its unit test in `tests/unit/admin-disputes.test.ts`; audit it as the writer's.

## What to verify

1. **Each item against its decided fix and its evidence.** The writer's departures and choices, to rule on:
   - item 1: `finance.dispute_place` takes the call's facts and its old four-argument form is dropped; a repeat is the
     same target, amount, direction, day, reason, resolution, decision and items (as a set); the lost-race path uses it
     too. Is any field left out that `dispute_record` stores, or one compared that should not be (a null against a
     null, the items' order, the amount's sign)?
   - item 4: the expiry is the column default of `media_upload_tickets.expires_at`, not set in `media_ticket`. Does any
     path set `expires_at` itself, and does the 30 minutes hold for every ticket a writer can create?
   - item 5: `requestKey` optional, `p_request_key` defaulting to null, a unique index on `(order_id, request_key)`, the
     replay answered under the order lock before the status, five-a-day and quantity checks; the form keeps its key
     while the items and the reason are unchanged and drops it once filed. A key repeated with other items or another
     reason: what does it answer, and is that right?
   - item 6: an unexpired order's item is `{orderId, version, currentHash, nextHash}`; without `currentHash` nothing is
     renewed or replaced; the mail's dedupe key uses the version after the update. Can a recovery renew or replace the
     hash of an order the requester does not own, or change a working link?
   - item 7: `refund_json` gains `environment`, which the admin's strict parser now requires; the claim fails only the
     refunds it parks (due ones), so a refund of the other mode in flight with no due time stays on the screen;
     `attempt_dismiss` clears `last_error`, its NOT_PARKED shows «تعذّر الحفظ» and its success «سُجّلت المراجعة.»; the
     screens read `status` once, so the money controls show until it answers (a brief flash).
2. **Money:** every money control on `ReconciliationView.tsx` and `OrderView.tsx` (refund, recheck, external record,
   dispute, dismiss): can any act on a payment, refund, review payment or order of the other mode once the mode is
   read; when the mode cannot be read, do they stay as before; is `attempt_dismiss` owner only, audited, and refused
   for an attempt the claim did not park `MODE_CHANGED`; does «تحتاج مطابقة» drop it; can `refund_ref` reach another
   mode's refund by any route.
3. **The SQL's safety:** every function keeps `security definer`, `set search_path = ''`, its revokes and grants;
   nothing new is callable by `anon`; the new columns (`return_requests.request_key` and any other) are not readable
   where they should not be; the locks are taken in the order the earlier definitions take them; every dropped
   signature has no caller left (SQL, functions, client, tests).
4. **Functions and clients:** the AVIF brand reading stays inside the bytes already read; the Resend webhook's status
   uses the verifier's own decoding; the recovery and return request shapes match on both sides of the boundary; the
   public JavaScript budget (`orders.html` 148.4 KiB of 150 by the writer's run).
5. **The tests prove what they claim**, the mutations the writer reports are real, and the docs claim nothing beyond
   what is built. The four e2e files the writer changed (`orders-money.spec.ts`, `order-page.spec.ts`, `media.spec.ts`;
   `orders-admin.spec.ts` unchanged) did not run (memory and the local staff rows): read them for what they would prove
   and whether they would pass. Known to the orchestrator, not to report: `docs/development.md:244`,
   `docs/media-rights.md:40` and `PLANS/DATA-AND-SECURITY.md:95` still say five minutes; `PLANS/P08-CONTRACT.md` still
   shows `refund_ref` without a mode; `docs/privacy-data-map.md` lacks `request_key`.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no `docker` and no `supabase`
command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
