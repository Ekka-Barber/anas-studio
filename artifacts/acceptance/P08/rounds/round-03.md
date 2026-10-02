# P08 round 3: tokens, the payments function, the reconciliation job, the owner's recheck (workflow wf_6269b58d-fc8)

## Worker report 1

Round 3 built and green. Evidence logs: C:/Users/alazi/AppData/Local/Temp/claude/C--Users-alazi-Downloads-Tech-Code-My-projects-not-shipped-yet-ANASAQ-ME/d2373315-5e5f-4772-b764-cc2413b8a937/scratchpad/p08-r3-{testdb,unit,lint,tsc,copy}.log.

(A) tokens.ts: sha256Hex, hmacBase64Url, orderAccessToken (version 0 = old output, n>0 adds ':n'), orderAccessTokenHash, downloadToken, downloadTokenHash, notificationToken, parseNotificationToken. checkout.ts only imports them; its unit test passes unchanged.
(B) payments.ts: PaymentDeps and defaultPaymentDeps; startPayment (begin, create, adopt, late-201 cancel, 4xx/429 failed, uncertain, one retry after abandon, 60 s line); resolveUncertain (match on the invoice's own metadata, amount, currency; duplicates alert; page walk); settlePayment; settleInvoice; handlePayments (webhook, callback, verify); runPaymentsReconcile (adopt or abandon, cancel the other invoice of a paid order, settle, events, stops provider calls after a 429, one job_run_record with counts only, refund leg left as a marked hook).
(C) payments/index.ts is the five-line entrypoint. The three deno.json files already held zod and supabase-js, so none changed.
(D) jobs.ts runs payments_reconcile, or records a skipped run (PAYMENTS_NOT_CONFIGURED).
(E) admin.ts: payment-recheck (owner only, no TOTP; 503, 404, 422, role 403) and status gains payments {configured, reason?, mode?, emulator}.

Tests: tokens 22, payments 176, admin-payments 28, payment-http 41 (every case in the brief, scoped to rows the file made). A 12-mutant check on payments.ts killed all 12.
Proven against the real functions: webhook settle, forged secret 401 with no row, mode_mismatch, unknown_payment, review on amount and currency, five non-paying statuses, 5 sequential and 5 concurrent duplicates settle once, callback-only, verify-only (state only without the token), the job (settles, idempotent, event, adopt, abandon, cancels the second invoice), drop_after_commit gives one invoice, dropInvoiceMetadata and ignoreMetadataFilter adopt nothing foreign, payment-recheck for owner (editor and operations refused).
Read the open risks, above all the edge runtime: it does not hot-reload edits here, so I restarted only that container once before the final runs; restart it after any later function edit.
No network call to Moyasar, no SQL written, no migration, lock and PLANS untouched, nothing committed. A stray .vitest/ output directory from an aborted reporter run was deleted.

Files: supabase/functions/_shared/tokens.ts (new), supabase/functions/_shared/payments.ts (new), supabase/functions/_shared/checkout.ts (token functions now imported from tokens.ts, nothing else), supabase/functions/_shared/jobs.ts (payments_reconcile job, skipped record when not configured, optional 4th handleJobs argument), supabase/functions/_shared/admin.ts (payment-recheck, payments in status, optional AdminDeps.payments), supabase/functions/payments/index.ts (placeholder replaced), tests/unit/tokens.test.ts (new), tests/unit/payments.test.ts (new), tests/unit/admin-payments.test.ts (new), tests/integration/payment-http.test.ts (new), tests/integration/support.ts (localEnv helper added)

Checks:
- `pnpm exec vitest run tests/unit/tokens.test.ts tests/unit/payments.test.ts tests/unit/admin-payments.test.ts tests/unit/admin-function.test.ts tests/unit/checkout.test.ts` → 0 (5 files, 351 tests (226 new: tokens 22, payments 176, admin-payments 28). checkout.test.ts passes unchanged.)
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec vitest run --mode db tests/integration/payment-http.test.ts` → 0 (41 tests against the real payments, outbox and admin functions in Docker and the in-process emulator on 54390. Run on a freshly restarted edge runtime.)
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db` → 0 (19 files, 351 tests.)
- `pnpm test` → 0 (53 files, 1254 tests.)
- `pnpm lint` → 0
- `pnpm typecheck` → 0 (One earlier failure (noUncheckedIndexedAccess on destructured rows in payment-http.test.ts) was fixed; the final run is clean.)
- `pnpm check:copy` → 0 (201 source files.)
- `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"id":"x","type":"payment_paid","secret_token":"wrong","live":false}' http://127.0.0.1:54321/functions/v1/payments/webhook` → 0 (printed 401, run after the edge runtime restart. The same restart also showed checkout answering 403 for a foreign origin and outbox 401 without a bearer, so all four entrypoints boot with the new import graph.)
- `mutation sanity check on payments.ts (12 one-line mutations, each run against tests/unit/payments.test.ts, file restored afterwards)` → 0 (All 12 mutants killed: young window, secret check, check recording, duplicate short-circuit, cancel of a refused invoice, page cap, 429 stop, callback id check, live flag, mode check, uncertain close status, amount in the match rule.)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (Only that container, once, before the final runs. The stack, the database and its content were not touched; no supabase db reset.)

Contract gaps:
- Section 7 settleInvoice says payments[] are applied 'oldest first'. MoyasarInvoicePayment is only {id, status} (round 1) and carries no time, so the order the provider lists them in is used (marked with a ponytail comment).
- Section 7 verify says 'payment_check_begin, settleInvoice, then payment_state'; section 6 says payment_state is 'the second read after a settle'. Built as: payment_state is read again only when a check was settled; with no check the begin's own view is the answer.
- The contract does not say what the callback and verify do while paymentsConfig() is not ok. Built: callback 404 (like the webhook, though section 7 says the callback is 'always 200'), verify 503 UNAVAILABLE.
- Section 7 describes the uncertain resolution as one list call. I read pages while nextPage exists, at most 5; more pages left with no match counts as 'absence not proven' (unavailable), never an abandon. The job also needed rules the contract lacks: a failed list is payment_attempt_checked(false, INVOICE_LIST_FAILED); two matches or a ledger refusal is a good check (backoff); a young attempt is left alone.
- Section 6 payment_event_result takes p_error for any outcome. I pass an error code only for 'retry' (PAYMENT_FETCH_*, INVOICE_FETCH_*, APPLY_FAILED); other outcomes pass null so a closed review or rejected event never looks like a failure to a later screen.
- Section 7 gives the invoice currency as the literal 'SAR'; the task says 'from the begin reply'. Both are SAR (the table check forces it); the begin reply's currency is used.
- No SQL function was missing and none was worked around.

Open risks:
- The local edge runtime (per_worker) does NOT hot-reload edits to _shared files on this machine: a deliberate edit was visible inside the container but a running worker kept serving the old code for minutes. I restarted supabase_edge_runtime_ANASAQ.ME once so the final code was served and tested. Anyone editing supabase/functions later must restart that container before trusting a payment-http run.
- settleInvoice and the callback and verify paths settle only from payments[] of the fetched invoice (contract section 2 lists it). If the real sandbox answers an invoice without it (E02), a paid invoice is recorded as a good check and only the webhook, by payment id, settles it.
- payload_hash is sha256 of the raw webhook body (contract), and that body contains secret_token. It is not reversible, but it is a hash over text that includes the secret.
- The reconciliation job is sequential (at most 10 attempts, 10 events, plus refunds in round 6; each provider call has a 10 s timeout). A hung provider makes a run long; the 2-minute lease then lets the next run take what is left and every step is idempotent. No time budget was added.
- payment_attempt_created raises (not a reply) for an id or URL that breaks its patterns; startPayment lets that propagate (500) and leaves the attempt creating, and the job later resolves it. Unlikely with a UUID id and an http(s) URL.
- The cron payments_kick can claim this file's due rows at the same moment a test does; the HTTP tests assert end states of rows they created and make their own rows the oldest due, so a lost race gives the same state, but a very unlucky timing could still flake one assertion.
- The HTTP tests need Docker Desktop's host.docker.internal to reach an emulator bound to 127.0.0.1:54390; it did here. Port 54390 busy gives a clear failure message.
- Not run (not asked): pnpm build, Playwright e2e, any visual suite. No screenshots were written or rewritten.

## Audit 1: pass

### R3-L1 [low] supabase/functions/_shared/payments.ts:341
- Problem: settleInvoice applies an invoice's charged payments in the order the provider lists them. Contract section 7 says "oldest first". The worker's stated reason (contractGaps 1: the listed payment carries no time) does not hold: every charged payment is fetched before it is applied, and the fetched payment has a creation time.
- Evidence: payments.ts:341-353 loops over invoice.data.payments and calls applyPayment straight after each fetchPayment; the ponytail comment at 329-330 admits the deviation. MoyasarPayment.createdAt exists at supabase/functions/_shared/payments/moyasar.ts:143 and is filled at :261. The round brief itself said "in the listed order", so the code matches the brief and not the contract. Section 2 says lists are newest first, so listed order may be the reverse of oldest first. Effect when one invoice holds two charged payments: which one pays the order and which becomes the SECOND_PAYMENT review differs between the webhook path and the invoice path. No money is lost either way.
- Correction: Either fetch every charged payment first, sort by createdAt ascending (missing times last, listed order as tie-break) and then apply; or amend contract section 7 to "in the listed order". Add a unit case with two charged payments listed newest first.

### R3-L2 [low] supabase/functions/_shared/payments.ts:446
- Problem: The invoice callback answers 404 while payments are not configured and 405 for a method other than POST. Contract section 7 and the brief say the callback is "always 200 {ok:true}"; the 404 rule is written for the webhook only.
- Evidence: payments.ts:446 `if (!deps) return new Response(null, { status: 404 })` and :447 (405). tests/unit/payments.test.ts:471-479 pins both. The worker disclosed it (contractGaps 3). No retry policy is documented for the callback, so nothing depends on the status today.
- Correction: Orchestrator ruling: either return accepted() in both cases and change the unit test, or add "404 when paymentsConfig() is not ok" to the callback line of contract section 7. The same ruling covers verify answering 503 UNAVAILABLE when unconfigured (payments.ts:478), which the contract does not specify.

### R3-L3 [low] supabase/functions/_shared/payments.ts:355
- Problem: When the fetched invoice itself says paid (or refunded) but no apply settled the attempt, settleInvoice records a GOOD check. This happens when payments[] is empty or missing, or when every apply answered rejected or not_paid. The attempt then ends expired with no owner alert. The code follows contract section 7 word for word, so this is a contract gap, not a worker deviation.
- Evidence: payments.ts:355-357 calls payment_attempt_checked(p_ok = error === null, invoice.status). moyasar.ts:244 accepts a missing payments[] and :277 turns it into []. In the migration (20261002100000_payment_core.sql:1568-1593) a good check only backs off, and 24 hours after expiry sets the attempt expired with v_unverified = not p_ok = false, so no attempt_unverified alert. The callback, verify, the job and payment-recheck all settle only through payments[]. If the real GET /invoices/:id does not embed payments and the webhook is lost, a paid invoice is never fulfilled and never alerted. tests/unit/payments.test.ts:1104-1113 pins the good check with status paid. The worker listed this under openRisks; it is not among the 13 E02 items.
- Correction: Orchestrator ruling. Recommended: in settleInvoice, when invoice.data.status is 'paid' or 'refunded' and no outcome is in SETTLED, call payment_attempt_checked(attemptId, source, false, null, 'INVOICE_PAID_UNSETTLED') so the SQL terminal rule marks UNVERIFIED and alerts the owner. Amend the contract section 7 sentence, add a unit case, and add an E02 item: "GET /invoices/:id embeds payments[] with their statuses".

### R3-L4 [low] supabase/functions/_shared/payments.ts:640
- Problem: The reconciliation run is bounded by row count but not by time. With a provider that hangs, the run can outlive the Edge Function wall clock and be killed before job_run_record, so the failed run is never recorded and the last recorded run still reads ok.
- Evidence: payments.ts:640-662 works up to 10 attempts and 10 events in sequence. Each provider call can take MOYASAR_TIMEOUT_MS = 10 s (moyasar.ts:21). One attempt can cost a cancel, an invoice fetch and one fetch per charged payment; an uncertain attempt up to 5 list pages (payments.ts:42); an event two fetches. Only a 429 stops the run (payments.ts:551-567). job_run_record is written only at the end (payments.ts:670-683). Rows are safe (2-minute lease, idempotent SQL); only the run record is lost. Disclosed in openRisks.
- Correction: Add a deadline: once about 60 s have passed since startedAt, stop taking rows and count the rest as skipped, like the 429 path, so job_run_record is always written. Add a unit case with slow stubs and fake timers.

### R3-L5 [low] supabase/functions/_shared/payments.ts:648
- Problem: A row whose processing throws in the job records no check. If the throw is deterministic, the attempt is re-leased every 2 minutes for ever and never reaches the 24-hour terminal rule or the UNVERIFIED alert, both of which live only in payment_attempt_checked.
- Evidence: payments.ts:646-650 catches and only counts summary.errors. payment_attempt_created raises 22023 for an invoice id outside ^[A-Za-z0-9._:-]{1,120}$ or a URL with whitespace or over 2000 characters (migration lines 839-845); adopt() lets that propagate (payments.ts:129-134). The claim's lease is the only schedule left (migration line 1450). It needs a malformed provider reply, so it is unlikely; the worker disclosed the startPayment side only.
- Correction: In the attempts loop's catch, make a best-effort call (its own try) to payment_attempt_checked(row.attemptId, 'job', false, null, 'ROW_FAILED'), so the backoff and the terminal rule apply. Add a unit case where payment_attempt_created throws 22023 during the job.

### R3-L6 [low] tests/integration/payment-http.test.ts:400
- Problem: Several assertions count every call the emulator received, and the job tests assert straight after makeDue plus runJob. Neither is scoped to rows this file created. A due attempt or event from any other source, or the minute cron payments_kick firing inside the window, makes these tests flake.
- Evidence: Lines 400, 445, 587, 634 and 829 assert emulator.state().calls toHaveLength(0); line 501 asserts exactly one GET /v1/payments/:id. The cron job (migration line 1677) calls the same emulator for any due row in the database. Lines 681-689, 742-747, 754-761 and 789-792 assert right after runJob; if payments_kick leased the row first (2-minute lease) the test's own run skips it and the state arrives asynchronously. The file passed in both of my runs (database had 0 due rows afterwards). The worker disclosed the cron race.
- Correction: Filter calls by this test's ids: EmulatorCall has path and query (tests/support/moyasar-emulator.ts:156-165). For the claim race, pause the cron job for the file: `select cron.alter_job(jobid, active := false) from cron.job where jobname = 'payments-reconcile'` in beforeAll, restored in afterAll (the file already connects as postgres).

### R3-L7 [low] supabase/functions/_shared/admin.ts:439
- Problem: When payment_attempt_ref raises insufficient_privilege (an owner revoked between the staff lookup and the SQL recheck), payment-recheck answers 403 with the media message that says the action is for an owner or an editor. The action is owner only.
- Evidence: admin.ts:439 returns sqlFail(error); sqlErrorToHttp maps 42501 to «هذا الإجراء متاح فقط لمالك أو محرر نشِط.» (supabase/functions/_shared/media.ts:121-122). The role gate in handleAdmin uses «هذا الإجراء للمالك فقط.» for the same action. tests/unit/admin-payments.test.ts:277-279 checks the status only.
- Correction: In paymentRecheck's catch, answer fail(403, 'FORBIDDEN', 'هذا الإجراء للمالك فقط.') for code 42501 before falling back to sqlFail.

Checks re-run:
- `pnpm exec vitest run tests/unit/tokens.test.ts tests/unit/payments.test.ts tests/unit/admin-payments.test.ts tests/unit/admin-function.test.ts tests/unit/checkout.test.ts` → 0
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec vitest run --mode db tests/integration/payment-http.test.ts` → 0
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db` → 0
- `pnpm test` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0
- `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"id":"x","type":"payment_paid","secret_token":"wrong","live":false}' http://127.0.0.1:54321/functions/v1/payments/webhook  (printed 401)` → 0
- `docker inspect -f '{{.State.StartedAt}}' supabase_edge_runtime_ANASAQ.ME  (08:16:23Z, after the newest function source mtime 08:13:47Z of _shared/payments.ts: the running functions are the final code)` → 0

Uncovered:
- Late 201 against the real SQL and the emulator: an attempt closed while its create is in flight. Only stubbed in tests/unit/payments.test.ts:782-794; the emulator's commit_after_delay fault is never used, so nothing proves end to end that the invoice id is stored on the closed attempt, the emulator invoice ends canceled and the URL is not returned.
- Two concurrent startPayment calls for one order against the real database and emulator (exactly one POST /v1/invoices, the second answers preparing). The unit test only stubs the 'creating' reply.
- Verify 429 and the callback throttle through the real functions (the IP hash as derived inside Docker). The SQL throttles are proven in tests/integration/payment.test.ts:2088-2099 and the 54000 to 429 mapping in the unit test only.
- Two matching invoices for one uncertain attempt against the real SQL (the attempt_duplicate_invoices alert row). Unit stub only.
- The job stopping provider calls after a 429 against the emulator's 429 fault. Unit only.
- Two overlapping reconciliation runs over HTTP (lease plus skip locked). Only webhook, callback and verify concurrency is exercised over HTTP.
- A paid invoice whose payments[] is empty or missing (finding R3-L3): no test, and no E02 item covers it.
- A webhook for a charged payment on an invoice no attempt maps (unknown_invoice, UNMAPPED_INVOICE review row) through the real function. The SQL side is round 2; the unit test only passes the outcome through.
- Out of order over HTTP in the other direction: a failed or initiated event first, then the paid one, for the same invoice. Only failed-after-paid is tested.
- payment_attempt_created raising 22023 for a malformed provider id or URL, in startPayment and in the job (finding R3-L5).
- Provider ids in upper case: the callback lower-cases the id before payment_callback_begin (payments.ts:454) while the ledger stores the id as the provider returned it; no test with an upper-case stored id.
- An event recorded with a type that does not start with payment_ and left unprocessed: the job has no type in the claim, so it closes it as unknown_payment or no_payment_id instead of ignored. Harmless, but untested.
- The worker's 12-mutant claim was not re-run: it needs edits to product code, which the auditor does not make. Test strength was judged by reading every test against the branch it names.
- Not run by the worker or by me, and not asked for this round: pnpm build, Playwright e2e, the visual suite.

## The orchestrator's rulings and own audit (2026-10-02)

The Opus auditor passed the round with seven low findings and no fix pass. I read `supabase/functions/_shared/payments.ts` line by line (the invoice step, the settle functions, the three endpoints, the job), `tokens.ts`, and the changes to `admin.ts`, `jobs.ts` and `checkout.ts`, against contract sections 6 and 7 and the SQL signatures of round 2.

| Finding | Ruling |
|---|---|
| R3-L1 (charged payments applied in the listed order, not oldest first) | Fixed: every charged payment is fetched, then applied oldest first by its own time. Test added (listed newest first; one with no time goes last). |
| R3-L2 (the callback answers 404 unconfigured and 405 for another method; verify answers 503) | Accepted as built; the contract now says so. |
| R3-L3 (a paid invoice that nothing settled was recorded as a good check and would end "expired" with no alert) | Fixed: it is a failed check, `INVOICE_PAID_UNSETTLED`, so the job keeps trying and the owner is alerted by the terminal rule. Tests changed and added. Sandbox item 14 added (does `GET /invoices/:id` list the payments). |
| R3-L4 (the job was bounded by rows, not by time) | Fixed: a 60-second budget; the rows left keep their lease and the run is always recorded. Test added. |
| R3-L5 (a row that throws recorded no check) | Fixed: a failed check `ROW_FAILED`, so the backoff and the terminal rule apply. Test changed. |
| R3-L6 (the HTTP tests count all emulator calls and could race the minute cron) | Recorded, not changed: the cron's kick does nothing without the two Vault values, which the local stack does not hold, and the database test files run one at a time. |
| R3-L7 (a revoked owner got the media message) | Fixed: 42501 answers «هذا الإجراء للمالك فقط.». |

Found by the orchestrator:

- The callback lower-cased the invoice id before asking the ledger, while the ledger stores the id as the provider wrote it. It now passes the id unchanged.

The worker's stated choices are accepted and written into the contract: the uncertain resolution reads at most five pages of the list (more pages left with no match is "absence not proven", never an abandon); `payment_state` is read again only after a settle; an error code is passed to `payment_event_result` only for `retry`.

Checks on the final tree, with the edge runtime restarted so the functions serve the final code: `pnpm test:db` 0 (19 files, 351 tests, 41 of them against the real functions and the emulator); `pnpm test` 0 (53 files, 1257 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; a webhook with a wrong secret answers 401 from the running function.

Left open, recorded: the late 201 and two concurrent creates are proven with stubs, not end to end against the emulator (round 4's checkout tests reach `startPayment` over HTTP); a local edit to `supabase/functions/_shared` needs `docker restart supabase_edge_runtime_ANASAQ.ME` before an HTTP test run (the runtime does not reload shared files).
