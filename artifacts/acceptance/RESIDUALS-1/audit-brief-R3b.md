# RESIDUALS-1, round R3b: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, reads every money and migration line itself, runs
the e2e and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against `910e4ec`: `git diff 910e4ec` plus the untracked files
(`git status --short`: the migration `supabase/migrations/20261015160000_residuals_r3b.sql` and the new pure modules
`supabase/functions/_shared/email-address.ts`, `riyadh-day.ts`, `paid-file-rules.ts`). Not yours: `.claude/launch.json`
and `.claude/settings.json` (the owner's: never open them), `artifacts/acceptance/RESIDUALS-1/brief-R3b.md`'s own diff
(the orchestrator named the exact new modules and test files in it before the writer started). The writer's brief, with
the orchestrator's decided fixes, is `brief-R3b.md` (12 items); each item's evidence is its block, by id, in
`artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md`; items 6 and 11 come from `RECORD-R1.md` and `RECORD-R2b.md`.

The migration renames one check and creates `owner_commerce_stats` again: diff the function against its previous latest
definition (`grep -ln` over `supabase/migrations/`, the newest file wins): only the SAR filter on the review sums.

## What to verify

1. **Each item against its decided fix and its evidence.** The writer's choices, to rule on:
   - item 1: «سيُسحب الملف» only for a line whose entitlement is live; «لن يُشحن» only for a `preparing` fulfilment
     (nothing for a `needs_resolution` order); no stock sentence for a preorder line. Do these match what
     `refund_succeed` and `finance.item_fully_refunded` actually do on success, line by line and when the total empties
     the payment?
   - item 2: the void's sentence and the external record already open; `ExternalRefund` no longer takes the focus when it
     mounts open.
   - item 3: a null `currency` counts as not SAR (where can a review payment's currency be null, and does that hide the
     refund form from a payment that is SAR?); the minor units and digits by `Intl.NumberFormat`; the external record's
     success sentence in the payment's currency; the stats' SAR filter.
   - item 5: the stale answer dropped by the open form's key; 'failed' against null (no order).
   - item 7: the rename by name and definition, raising if absent; `checkMessages` declared on the variants' config as
     `TableConfig & {checkMessages}` and read by `TableForm` with an `in` check (`TableConfig` lives in
     `src/admin/tables/index.ts`, outside the round's paths).
   - item 9: the one email field in `email-address.ts` and the four functions' use of it (do they read, lowercase,
     convert and check exactly as before?); `contact.ts` re-exports `EMAIL_SHAPE` and `toAsciiAddress` for `admin.ts`.
   - item 10: the moved limits and day helpers (every importer, on both sides of the boundary, Deno and Next); the
     dispute form's `isDay`; `OrderPage.tsx` left unchanged (the import cost 1.9 KiB over the budget) with a unit test that
     pins its preorder sentence to `quote.ts`'s.
   - item 11: `canReissueLink` and the mode it reads.
2. **Money and the other mode:** every new money control or sentence keeps R2b's rule (a row of the other mode shows
   «دفعة من وضع الدفع الآخر؛ تُدار من لوحة Moyasar.»; when the mode cannot be read, the controls stay); the closed review
   card's new «تسجيل اعتراض»; the refund form's choice between a void, another currency and the normal form.
3. **The SQL's safety:** `owner_commerce_stats` keeps `security definer`, `set search_path = ''`, its revokes and grants;
   the rename cannot fail on a database where the check carries another name without saying so.
4. **Functions:** the shared pure modules import nothing that only one side can resolve; `staff-admin`'s `boundedText`.
5. **The tests prove what they claim**, the mutations the writer reports are real, and the docs claim nothing beyond
   what is built. The e2e the writer changed did not run (memory): read them for what they would prove and whether they
   would pass.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json`, `.claude/launch.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no
`docker` and no `supabase` command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and
reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
