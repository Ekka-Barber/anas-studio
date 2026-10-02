# P08 round 2: the payment schema and the payment core SQL (workflow wf_fa3ffa49-6fb)

## Worker report 1

Round 2 built: one migration, 20261002100000_payment_core.sql, applied with migration up --local (no db reset), plus tests.
Schema (section 4): orders widened to six states, paid_at and access_token_version; preorder columns on variants (anon sees flag, date and note, never capacity; owner loses digital_asset, gains the four; build trigger and catalog_audit updated); preorder snapshots on items and reservations; nine email kinds; the eleven finance tables (no API grant), the append-only disputes trigger, public.notifications (RLS, staff read only, no write grant for any role), the paid-files bucket.
Functions: payment_attempt_begin/created/close, apply_verified_payment, payment_event_record/result, payment_check_begin, payment_state, payment_callback_begin, payment_attempt_ref, payment_reconcile_claim, payment_attempt_checked, payments_kick (cron payments-reconcile), finance.owner_alert, and one commit helper finance.order_try_commit (own held hold needs only the units; released or expired hold reacquires by the full rule; the reservation's flag picks stock or capacity; fully refunded lines are skipped; used by apply now, order_resolve later). Also finance.availability and buyer_retention_purge replaced. checkout_price/create/quote/cancel untouched.
Lock order of the contract kept everywhere; claims use skip locked. Tests of 6 connections at once, a payment racing a checkout (5 rounds), and four late payments sharing a coupon against two checkouts (3 rounds) show one settlement, no oversell and no deadlock.
Tests: payment.test.ts (76 tests, all twelve required areas plus a few extra: late payment on closed attempts, unmapped-then-mapped, begin race), buyer-retention.test.ts (+1), collections.test.ts (variant grant list); support.ts needed nothing.
Results: migration up 0; payment + retention 0 (79 tests); full test:db 0 (309 tests); lint, typecheck, check:copy 0; pnpm test 1 (only tests/unit/cron-jobs.test.ts, which pins 10 schedules, the migration adds the 11th, see contractGaps).
Decisions where the contract is silent or literal reading is unsafe are listed under contractGaps.

Files: C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/payment.test.ts, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/buyer-retention.test.ts, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/unit/collections.test.ts

Checks:
- `pnpm exec supabase migration up --local` → 0 (applied 20261002100000_payment_core.sql once (checked first in a rolled-back transaction); the file was not edited after it was applied, no db reset used)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/payment.test.ts tests/integration/buyer-retention.test.ts` → 0 (2 files, 79 tests passed (payment 76, retention 3); the concurrency tests were also repeated 6 times, no deadlock)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` → 0 (18 files, 309 tests passed (the whole integration suite). An earlier full run failed once: staff-admin 'refuses to remove the last active owner' timed out at 5008 ms with 165 active test owners, which my repeated runs had piled up; see openRisks)
- `pnpm test` → 1 (1 failed | 1027 passed. FAIL tests/unit/cron-jobs.test.ts > cronScheduleStatements > keeps a real migration statement whole: AssertionError: expected [ 'content-publish-due', ...(10) ] to have a length of 10 but got 11 (cron-jobs.test.ts:79). The contract deliberately adds the 11th schedule, payments-reconcile; the file is outside this round's paths, left alone)
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0 (199 source files)

Contract gaps:
- tests/unit/cron-jobs.test.ts:79 pins exactly 10 pg_cron schedules; section 6 and the task add `payments-reconcile` (11). pnpm test fails that one test. Not fixed here (not an allowed path): the orchestrator changes the count to 11 and adds the name to the arrayContaining list.
- ORDER_NOT_PAYABLE: the contract names the reasons MODE_CHANGED and UNDER_REVIEW only. For a status other than pending_payment I return reason 'NOT_PENDING' (with status).
- payment_attempt_begin order of answers: not payable, HOLD_EXPIRED, TOTAL_BELOW_MINIMUM, then the active-attempt replies, then TOO_MANY_ATTEMPTS only when a new attempt would be created. A literal reading would hide the URL of an active fifth attempt.
- Step 5 read literally (captured -> review) would put an already paid attempt's own paying payment into review as well. Built: captured on the attempt's own paying payment answers already_paid (the step 4 provider_status alert fires); captured on any other payment is UNEXPECTED_STATUS.
- The contract is silent on a payment already recorded as review (UNMAPPED_INVOICE) whose invoice is mapped later by the uncertain resolution. Built: it is never fulfilled; the existing review row is linked to the attempt and order, the attempt becomes review, no second row or alert.
- A payment id the ledger already holds on another attempt is rejected as INVOICE_MISMATCH (otherwise a raised 23505 from the unique index).
- Alert names: the contract names external_refund, provider_status, needs_resolution, low_stock, event_exhausted, attempt_unverified. For every review payment (UNMAPPED_INVOICE included) it only says 'an owner alert'; built as `payment_review` with the reason in the payload. Round 5's alert_email_data must render these. A subject over 120 chars (an event id can be 200) is shortened with its md5 so the 200-char dedupe key never fails the caller.
- payment_attempt_ref's success reply also carries ok:true (the listed fields are all there), so callers can test `ok` on both branches.
- Backoff reads the row's value before the increment, as an UPDATE's right side does: checks 1, 2, 4 ... 30 min (section 13 item 7), errors 1, 2, 4 ... 60 min, event retries 1, 2, 4 ... 60 min and exhausted on the 10th retry result.
- payments_kick is granted to service_role (outbox_kick is not), following the section 6 rule that every function there is service_role.
- buyer_retention_purge skips an order with any review payment, open or closed (payment_reviews.order_id is a foreign key). Events of unpaid payments cannot be tied to an order (the attempt gets a payment id only when paid or review), so only the events of the removed attempts' payment ids are deleted; payment_events has no age-based retention rule at all.
- supabase/config.toml [storage] file_size_limit = "50MiB" is below the paid-files bucket's 104857600: the global limit applies first, so uploads above 50 MiB fail locally.
- payment_reconcile_claim leases due events whatever their `live` (the answer returns `live` so the job closes a mode_mismatch); the mode filter applies to attempts and refunds.

Open risks:
- No Moyasar call anywhere: the payment and invoice objects are built by the tests in the shape the Edge Functions will normalize; E02 and E03 stay open. Round 3 must send amounts as integers (a non-integer amount raises 22023) and fee, refunded and source fields as the contract lists.
- Local database hygiene: my repeated runs piled up active test owners (staff-admin's last-owner test pauses every active owner and timed out at 165). I set the test staff created since 2026-10-02 07:00 UTC inactive (active owners back to the original 30), closed my leftover review rows and deleted my leftover refunds and events. payment.test.ts now creates three staff members once and retires everything it creates in afterAll, so it adds no active owners. The other suites still add about 30 per full run and thousands of contact_notice rows, as before.
- The payments_kick test writes Vault secrets and reads pg_net's net.http_request_queue inside a rolled-back transaction (pg_net 0.3.1 local); a pg_net upgrade could break it. Timing assertions use windows of 15 s on the database's clock.
- The retention gap above: payment_events of unpaid payments grow without a purge until the owner settles a rule.
- Alert kinds and the under-review receipt are only rows here; their rendering is round 5. No screenshots or artifacts were written or rewritten.

## Audit 1: pass

### R2-01 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/unit/cron-jobs.test.ts:79
- Problem: `pnpm test` is red (exit 1). The test pins exactly 10 pg_cron schedules; the migration adds the 11th, `payments-reconcile`, as the contract requires. The file is outside the round's allowlist, so the worker correctly left it. The round cannot be committed with a red unit suite until the orchestrator updates this pin.
- Evidence: Re-run: `1 failed | 1027 passed`; `AssertionError: expected [ 'content-publish-due', ...(10) ] to have a length of 10 but got 11` at cron-jobs.test.ts:79. Migration line 1621: `select cron.schedule('payments-reconcile', '* * * * *', 'select public.payments_kick()')`.
- Correction: Orchestrator: change `toHaveLength(10)` to `toHaveLength(11)` at line 79 and assert `statements.get('payments-reconcile')` equals the migration's statement. Re-run `pnpm test` before acceptance.

### R2-02 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql:756
- Problem: Cross-layer contract gap. The refusals of `payment_attempt_begin` (ORDER_NOT_PAYABLE x3 at 756-764, HOLD_EXPIRED 765-767, TOTAL_BELOW_MINIMUM 768-770, TOO_MANY_ATTEMPTS 803-805) carry no `order`. Section 6 only promises `order` on `ok` replies, so the SQL matches section 6, but section 7 `pay` (contract line 371) must answer these refusals with `payment: {state:'closed', code, status?}` AND the order. `pay` has no other SQL source for the order summary (`order_access` is round 7), so round 3/4 cannot build that reply from what this function returns.
- Evidence: Lines 757, 760, 763, 766, 769, 804 build `{ok:false, code, ...}` without `order`. Tests pin the bare shape with `toEqual` (payment.test.ts:740, 749, 758, 764, 780). The token is already verified at that point (line 748-753), so adding the summary leaks nothing.
- Correction: Settle before round 3 is dispatched: add `'order', finance.order_summary(v_order.id)` to the six token-verified refusals and update the five `toEqual` assertions to `toMatchObject`, or amend section 7 so `pay` answers a closed payment without the order.

### R2-03 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql:1721
- Problem: Cross-layer contract gap. Section 7 `startPayment` step 2 (contract line 377) has the Edge Function raise the owner alert `attempt_duplicate_invoices:<attemptId>`. The only alert writer is `finance.owner_alert`, which is internal: execute is revoked from service_role (line 1721), and no service_role function of section 6 raises that alert. Round 3 has no migration in its scope, so it has no way to queue it.
- Evidence: Line 420 defines `finance.owner_alert`; line 1721 revokes it from `public, anon, authenticated, service_role`. Grep of the migration: alerts raised are payment_review, external_refund, provider_status, needs_resolution, low_stock, event_exhausted, attempt_unverified only.
- Correction: Settle before round 3: add a narrow service_role function, for example `public.payment_attempt_duplicates(p_attempt uuid) returns void` that checks the attempt exists and performs `finance.owner_alert('attempt_duplicate_invoices', p_attempt::text, jsonb_build_object('attemptId', p_attempt))`, with the usual revoke/grant and a test. Do not grant `finance.owner_alert` itself.

### R2-04 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql:1642
- Problem: `finance.buyer_retention_purge` does not follow the contract's one lock order. It selects candidate orders without locking them (1642-1657), then deletes their attempts before the order rows (1665-1669) with no re-check. A payment applied to a closed attempt between the select and the deletes can (a) deadlock with `apply_verified_payment` (purge holds the attempt, waits for the order; apply holds the order, waits for the attempt), or (b) for a `paid_needs_resolution` outcome, which creates no entitlement or fulfilment row to trip a foreign key, delete a just-paid order together with its paid attempt. Reachable only when a payment lands on an invoice 90 days after its order ended, so the practical risk is negligible, but it is the one writer that breaks the rule.
- Evidence: By reading: `select array_agg(o.id) into v_orders ... ` has no `for update`; `delete from finance.orders where id = any (v_orders)` (1669) has no status predicate. `apply_verified_payment` locks the order then the attempt (1038-1039). The retention test runs in one transaction and has no concurrent case.
- Correction: Lock the candidates first, as `finance.checkout_expire` does: select the ids in a subquery with `for update of o skip locked` (order row first), evaluate the skip rules in that same locked statement, then delete. A skipped order is simply taken the next day.

### R2-05 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql:1000
- Problem: Step 2 of `apply_verified_payment` decides 'no attempt has this invoice' on an unlocked read (1000-1001) and then writes an UNMAPPED_INVOICE review row with no re-check. If `payment_attempt_created` maps the invoice in between and a second call settles the same payment, the result is a payment that both paid an order and sits as an open review row with an owner alert (the mapped path's `exists` check at 1080 cannot see the uncommitted row). In the mapped review path, the plain insert at 1098-1103 raises 23505 instead of answering when the unmapped insert commits first. Only reachable when a charged payment exists on an invoice whose creation is still being resolved, which needs a buyer to hold a URL the function never returned.
- Evidence: By reading: 1003-1008 inserts with `on conflict do nothing` under no order or attempt lock; 1090 `select ... for update` cannot see an uncommitted row, then 1098 inserts without `on conflict`. The 'unmapped then mapped' test (payment.test.ts:1227) is sequential.
- Correction: In the mapped path use `insert ... on conflict (provider_payment_id) do nothing` and re-read the row. In step 2, after the insert, re-read `finance.payment_attempts` by invoice id and, when one now exists, fall through to the locked path (the row is then linked there) instead of answering `unknown_invoice`. Add a two-connection test.

### R2-06 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/migrations/20261002100000_payment_core.sql:1597
- Problem: Rows of the other mode stay due for ever. `payment_reconcile_claim` leases attempts and refunds of `p_mode` only (1407, 1468), but `payments_kick` (1597-1601) wakes the job for any due row whatever its mode, and `buyer_retention_purge` (1650) keeps every order whose attempt still has a `next_check_at`. After the planned switch from test to live on one database, any test-mode attempt still due is never claimed: the kick posts to the outbox function every minute for ever and those orders are never purged.
- Evidence: By reading: the claim filters `a.environment = p_mode`; the kick's three `exists` have no mode predicate; the purge skips on `a.next_check_at is not null`. The claim test (payment.test.ts:2146) shows the live attempt is taken only by a `live` claim.
- Correction: Either have `payment_reconcile_claim` clear `next_check_at` on due attempts and refunds of the other mode (marking attempts `last_error = 'UNVERIFIED'` with the existing alert so the owner sees them), or put an explicit step in the runbook's go-live section: drain the job, then null `next_check_at` for `environment = 'test'` rows. Record the choice in the contract.

### R2-07 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/payment.test.ts:691
- Problem: The `payments_kick` test creates the Vault secrets `functions_url` and `jobs_secret` without removing existing ones, so it fails with 23505 on any local stack that already has them (docs/operations.md:358 tells the owner to create them). The sibling test in static-site.test.ts deletes them first inside its rolled-back transaction.
- Evidence: payment.test.ts:691-692 call `vault.create_secret(...)` directly; static-site.test.ts:346 runs `delete from vault.secrets where name in ('functions_url', 'jobs_secret')` first. The local stack currently holds 0 such secrets, which is why the test passes here.
- Correction: Add `delete from vault.secrets where name in ('functions_url', 'jobs_secret')` before line 691, inside the same rolled-back transaction.

### R2-08 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/payment.test.ts:393
- Problem: Fixture isolation is by time and by table, not by this run's rows. `parkAll()` (393-397) pushes every due attempt, event and refund in the database 30 days out and never restores rows it does not own; `afterAll` deletes every refund, closes every open review payment and deletes every owner alert created since the run began (154-159). Safe today because db files run one at a time and nothing else writes these tables, but once round 3 ships the real `payments_reconcile` job the claim tests (2106-2248) also race the minute cron on a stack that has the Vault values.
- Evidence: vitest.config.ts sets `fileParallelism: false` for db mode. Two consecutive full runs here passed and left 0 due attempts, 0 due events, 0 refunds, 0 open reviews; the 4 pending receipts left in the outbox are P06 fixtures (`p06-outbox-test-*`), not this file's.
- Correction: Scope the cleanup to `created.orders` and this run's payment ids, and scope `parkAll` to rows created before `startedAt` with a restore in `afterAll`. Round 3's brief must state that the claim tests may not assume they are the only claimer.

### R2-09 [low] C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/config.toml:120
- Problem: The storage-wide limit is below the new bucket's. The `paid-files` bucket allows 104857600 bytes as section 4 requires, but the local stack's global `file_size_limit` is 50MiB and applies first, so an upload between 50 and 100 MiB fails locally. This is the orchestrator's round-0 file, not the worker's diff; the worker reported it.
- Evidence: config.toml:120 `file_size_limit = "50MiB"`; migration 408-409 inserts the bucket with 104857600; the bucket test (payment.test.ts:624) asserts only the bucket row.
- Correction: Orchestrator: raise `[storage] file_size_limit` to at least 100MiB before round 7 and note the hosted project's global upload limit in the runbook.

Checks re-run:
- `pnpm exec supabase migration up --local` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/payment.test.ts tests/integration/buyer-retention.test.ts` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` → 0
- `pnpm test` → 1
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0

Uncovered:
- apply_verified_payment racing payment_attempt_close, payment_attempt_checked, checkout_cancel or finance.checkout_expire on separate connections: only sequential orderings are tested (the order lock serializes them by reading, no test proves it).
- apply_verified_payment racing an owner's stock or capacity UPDATE through the Data API on a second connection: only 'lowered before the payment' is tested.
- The unmapped-then-mapped race of finding R2-05 (two connections): the existing test is sequential.
- buyer_retention_purge racing a late payment on a closed attempt (finding R2-04): the retention test is one rolled-back transaction.
- A paid order that still has an active sibling attempt: finance.payment_view (migration 578-579, 593) answers `pending` with that attempt's invoiceUrl to the token holder until the job cancels the invoice. This is the contract's literal rule; no test pins it or the resulting ORDER_ALREADY_PAID second payment from that URL.
- Reordering across payment ids on one attempt: a failed or initiated payment first, then a different payment id paid on the same invoice. Each half is tested alone (not_paid keeps provider_payment_id null; a fresh pay), not the sequence.
- A digital line with its own preorder reservation (capacity counted, entitlement with no file, no stock touched): the preorder tests use a physical variant only.
- Events of the other mode: payment_reconcile_claim leases events whatever their `live` (the worker's stated choice); no test covers a live event claimed by a test-mode run or the job closing it as mode_mismatch.
- Malformed amounts on a charged payment: a non-integer or 10-digit `amount` raises 22023 rather than recording a review row, so such a webhook event would retry to exhaustion. Only `{id:'p'}` is tested as malformed.
- payment_attempt_close('failed') or ('uncertain') arriving after the row was already turned `uncertain` by a begin or a claim (BAD_TRANSITION, the job then resolves it): the transition matrix covers the answer, no test covers the two-connection ordering.
- The low-stock alert at the boundary: only one crossing (10 to 7 over a threshold of 8) is asserted; stock landing exactly on the threshold and stock already under it are not.
- Every worker deviation listed under contractGaps (NOT_PENDING reason, TOO_MANY_ATTEMPTS only for a new attempt, captured on the own paying payment answering already_paid, unmapped-then-mapped staying in review, a ledger-held payment id rejected as INVOICE_MISMATCH, the `payment_review` alert name, payments_kick granted to service_role, events not purged by retention) is built and tested as described, and needs the orchestrator's ruling into the contract; none contradicts an invariant of section 11.

## The orchestrator's rulings and own audit (2026-10-02)

The Opus auditor passed the round with nine low findings and no fix pass. I read the whole migration (1,728 lines) line by line: the schema against contract section 4, `apply_verified_payment` and `finance.order_try_commit` step by step, the lock order against `checkout_create`, `checkout_cancel` and `checkout_expire`, every transition and every grant. It is sound. Then I fixed what follows myself, in the migration (edited in place: it had only ever been applied to the local database, which was rebuilt from zero afterwards).

| Finding | Ruling |
|---|---|
| R2-01 (the unit test pinned 10 cron schedules) | Fixed: 11, and the new statement is asserted. |
| R2-02 (begin's refusals carried no order, which `pay` must answer) | Fixed: every reply after the token check carries `order`. Tests updated. |
| R2-03 (no way for the function to raise `attempt_duplicate_invoices`) | Fixed: `payment_attempt_duplicates(p_attempt)`, service_role, with a test. `finance.owner_alert` stays internal. |
| R2-04 (the purge took the attempts before the order rows) | Fixed: it locks the candidate orders first (`for update of o skip locked`), so it cannot deadlock with, or delete under, a late payment. |
| R2-05 (the unmapped decision was taken on an unlocked read) | Fixed: after the unmapped insert the attempt is read again and, when mapped meanwhile, the locked path goes on; the mapped insert is `on conflict do nothing`. |
| R2-06 (due rows of the other mode stayed due for ever) | Fixed: the claim parks them (no due time, `MODE_CHANGED`; an active attempt becomes `expired`, a refund stays in flight for a person). Tests updated. |
| R2-07 (the kick test failed on a stack that already holds the Vault secrets) | Fixed. |
| R2-08 (the test file parks and cleans by time and table, not by its own rows) | Recorded, not changed: the database files run one at a time, and the local stack has no Vault values, so no job races them. Later rounds' briefs say that claim tests may not assume they are the only claimer. |
| R2-09 (the stack's 50 MiB storage limit was under the bucket's 100 MiB) | Fixed in `supabase/config.toml`; the stack was restarted. The hosted limit is a P11 check. |

Found by the orchestrator:

- A paid order with another attempt still open answered `pending` with that attempt's invoice link (the auditor's "uncovered" note): a buyer who had paid could be sent to pay again. A settled order now answers `paid`, `needs_resolution` or `refunded` first and offers no invoice. Test added.
- An order under review (`paid_needs_resolution`) did not get the fresh 7-day link that a paid one gets, though its receipt carries the order link. Fixed.

The worker's stated deviations are accepted and written into the contract: `NOT_PENDING` as a reason; `TOO_MANY_ATTEMPTS` only when a new attempt would be made; `captured` on the attempt's own paying payment is `already_paid`; an unmapped payment whose invoice is mapped later stays in review; a payment id held by another attempt is rejected; the alert name `payment_review`; `payment_attempt_ref` answers `ok: true`; the purge keeps an order with any review payment. Webhook events have no retention rule yet: round 9 adds a daily purge of processed events older than 180 days.

Checks on the final tree, after `supabase db reset` and the two imports: `pnpm test:db` 0 (18 files, 310 tests, with the edge runtime up); `pnpm test` 0 (50 files, 1028 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0.
