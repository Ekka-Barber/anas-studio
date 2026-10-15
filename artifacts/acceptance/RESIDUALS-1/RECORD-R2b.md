# RESIDUALS-1, round R2b: the record

Started on the owner's word (2026-10-15: "START R2b"). Orchestrator Claude Opus 5.5 at effort max, on the owner's
machine. The lock moved from R2a to R2b on 2026-10-15T17:29:02Z (base `c19354c`, R2a committed and pushed, CI green on
`c19354c`, run 38777276093), with R2b's exact paths; added later, with the reason in the lock: `artifacts/ledger/` (the owner's Build
Ledger page, orchestrator only), `supabase/functions/_shared/disputes.ts` (item 1's sentence), `docs/development.md`,
`docs/media-rights.md`, `PLANS/DATA-AND-SECURITY.md` and `docs/privacy-data-map.md` (the lines R2b made stale). The local
database was reset on the owner's word for the e2e (2026-10-15: "Yes: reset the local database (test data only), run
the imports, then run R2b's e2e. I'll free memory first."). Committed under the owner's word to go ahead with the plan's
next work (2026-10-15): the code first, these records in the commit after it, by explicit path; the branch pushed for
CI; the lock kept for R3a.

## Scope

R2b is what crosses the database, the functions and the screens (`SCOPE.md`): P08-CKPT-09, EF-ADMIN-06, EF-ADMIN-09,
EF-ADMIN-05 with ADMIN-CMS-15, EF-ACCESS-10, EF-ACCESS-04, CONTRACT-04 with ADMIN-COMMERCE-08 and ADMIN-COMMERCE-17. The
decided fixes are in `brief-R2b.md`.

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 75 minutes, 310 tool calls: all 7 items, one migration
(`supabase/migrations/20261015140000_residuals_r2b.sql`: `dispute_place`, `dispute_record`, `return_request_create`,
`order_recover_apply`, `refund_json`, `refund_ref`, `payment_reconcile_claim` created again from their latest
definitions, the new `attempt_dismiss`, the ticket's 30-minute default, `return_requests.request_key` with its unique
index), the functions (`media.ts`, `email.ts`, `admin.ts`, `orders.ts`, `refunds.ts`), the screens (`OrderView.tsx`,
`ReconciliationView.tsx`, `MediaUpload.tsx`, `OrderPage.tsx`) and their libraries, the tests and the two runbooks. One
piece it could not write: item 1's sentence lives in `_shared/disputes.ts`, which the brief left out; the orchestrator
added it (`SEQ_TAKEN`, 409, the brief's sentence) with its unit test. Its choices, ruled below: `dispute_place` takes the
call's facts (the old four-argument form dropped); the ticket's expiry is the column's default; the return key is
optional, unique per order, and answered under the order lock before every other check; an unexpired order's recovery
item carries `currentHash` and `nextHash`; `refund_json` carries `environment`, the claim fails only the refunds it
parks, `attempt_dismiss` clears `last_error`, the screens read `status` once. Its checks: lint, typecheck, copy, frozen
0; unit 2,656 passed and 39 skipped; `test:db` 937 of 940, the three failures from the polluted local database (two
outbox tests over the 5 s default, which pass at 90 s; the last-active-owner test over 20 s with 524 active owners);
build, export and budgets green (`checkout.html` 149.7 KiB, `orders.html` 148.4 KiB of 150); a mutation for items 1, 5,
6 and 7, each caught. The e2e did not run (7.7 GB free, then 5.3; 2,429 staff rows). It moved the day's 109 sends back
one day and restored 100 by id; 9 had been deleted by the tests' own setup.

## 2. The orchestrator's read

The money and recovery functions extracted from their previous latest definitions and diffed against the new copies
(`scratchpad/fn-extract.cjs`): `refund_json`, `refund_ref`, `payment_reconcile_claim`, `dispute_place`,
`dispute_record`, `return_request_create`, `order_recover_apply`: only the item's lines moved; `attempt_dismiss` read in
full; `finance.refund_fail` (the claim's new call) sets `failed` and writes one audit row, nothing else. The repeat test
of `dispute_place` compares with `=` only columns that are `not null` (amount, direction, day, reason, decision; the
resolution and the targets with `is not distinct from`; the items as sets, which the call already makes distinct).

## 3. The audit and the fixes

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R2b.md`): **pass**, with four minor findings and four nits.
Its rulings on the writer's choices, all accepted: the repeat test is complete; only `media_create_ticket` writes a
ticket, through the default; a key repeated with another payload is answered the request filed (only a hand-made call
sends that, and only to its own order); a working link's hash always equals `currentHash`, so recovery only renews it,
and a replaced hash was already dead; the claim fails only what it parks, once, with its one alert.

| Finding | Severity | Ruling | Done by the orchestrator |
|---|---|---|---|
| F1: the `refund_mode_changed` alert sends the owner to the reconciliation screen, which no longer lists the refund the same claim failed | minor | Accepted | the alert says the refund was recorded failed here and to read its outcome in that mode's dashboard; `email.test.ts` |
| F2: `docs/operations.md` still said tickets expire after five minutes | minor | Accepted | 30 minutes |
| F3: «إضافة متابعة» was still offered on a dispute reference of the other mode (NOT_FOUND, or NO_PREDECESSOR for a difference) | minor | Accepted | the sentence instead of the button and its form; a reference of each mode in the e2e |
| F4: `attempt_dismiss` could clear the mark while the invoice could still be paid, leaving a late payment (closed `mode_mismatch`) listed nowhere and its order erasable | minor | Accepted, with a code of its own | the close waits for the job's grace (10 minutes after the invoice expired) and answers `INVOICE_OPEN` before it: «ما زالت فاتورة هذه الدفعة قابلة للدفع؛ أغلقها بعد انتهاء صلاحيتها بعشر دقائق.»; integration and e2e tests; the runbook |
| F5: a dispute form opened before `status` answered stayed on a payment of the other mode on the order view | nit | Accepted | the form hides with its button |
| F6: the AVIF comment described a box larger than the head wrongly (the code is safe) | nit | Accepted | the comment |
| F7: the runbook called the failed refund test money in both directions of the switch | nit | Accepted | each direction, and what to do after switching back |
| F8: the ticket test compared the database's clock with the host's | nit | Accepted | the reply's time equals the stored one |
| The doc lines R2b made stale (`docs/development.md`, `docs/media-rights.md`, `PLANS/DATA-AND-SECURITY.md`, `PLANS/P08-CONTRACT.md`, `docs/privacy-data-map.md`) | (known) | Accepted | each line |
| Uncovered: a return key repeated with another payload | — | Pinned | `orders-access.test.ts` |
| Adjacent: «إعادة إرسال رابط الطلب» on an order of the other mode mails a link the order page answers NOT_FOUND | — | Routed | R3b, item 11 |

What no test covers, recorded: the claim on a refund of the other mode on a review payment, and on one with no due time
(left untouched, as the runbook says); `attempt_dismiss` racing a settlement (one UPDATE guards it); a refund or an
external record on a review payment of the other mode while the mode cannot be read (only Moyasar's 404 refuses it:
item 15 of the runbook's list); an AVIF `ftyp` box with a size of 0, 1, under 16 or larger than the head; a claimed but
failed upload ticket now counts toward the 10-ticket cap for 30 minutes. **Deploy SQL, functions and site together:**
the admin export before the migration breaks both money screens (`environment` is required), and the migration before
the functions makes `refund-recheck` answer 500 (the two-argument `refund_ref` is gone) and skips the renewal of
unexpired links until the new `orders` function is deployed.

## 4. Checks on the final tree

- The local database, on the owner's word: every row was test data (`auth.users` at `example.com` 2,696 and
  `erased.invalid` 7; no order outside the test domains); `supabase db reset` applied all migrations through
  `20261015140000`; `pnpm db:import` (7 documents) and `pnpm db:demo-catalog` (3 products, 5 variants, 7 rates, 1
  coupon, 3 policies, 1 settings update): 0 staff rows.
- E2E, first run (the four files the brief names, 203 tests, 31.4 minutes, 10.3 GB free): 200 passed; 3 failed, all in
  `media.spec.ts`, the first file run, each at the 90 s test timeout while the dev server compiled from cold (two during
  uploads, one waiting for Turnstile's token at sign-in).
- After the fixes: lint, typecheck, copy, frozen 0; unit 71 files, 2,657 passed and 39 skipped; `media.spec.ts` and
  `orders-money.spec.ts` again (53 tests, 8.6 minutes): 53 passed.
- `pnpm test:db` (all 31 files, on the reset database): 942 of 942.
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` 0 (`checkout.html` 149.7 KiB, `orders.html` 148.4 KiB, of 150).
- F4's guard mutated (its line removed from `attempt_dismiss`, applied locally): its test failed; the real function
  applied again, the five `attempt_dismiss` tests passed.
