# RESIDUALS-1, round R2b: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R2b, branch `agent/residuals-1` at
`c19354c`; R1 and R2a committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase
CLI 2.106.0, Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no Deno (CI runs
`deno check`). The package's rounds: `SCOPE.md`; how R1 and R2a ended: `RECORD-R1.md`, `RECORD-R2a.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `PLANS/DESIGN-AUDIT.md` (the items that
apply to the admin and store controls you change), each entry's block in
`artifacts/acceptance/FABLE-AUDIT/work/waveA/digest.md` (or `waveC`) by its id, and `docs/payments-runbook.md`
("Test and live never mix", "Changing the payment mode", "Before live"). Where this brief decides otherwise, it wins.

## Write only these paths

- `supabase/migrations/20261015140000_residuals_r2b.sql` (new: every SQL change of this round, one file)
- `supabase/functions/_shared/admin.ts`, `_shared/refunds.ts`, `_shared/orders.ts`, `_shared/media.ts`, `_shared/email.ts`
- `src/components/admin/ReconciliationView.tsx`, `OrderView.tsx`, `MediaUpload.tsx`; `src/lib/admin-orders.ts`,
  `src/lib/admin-money.ts`; `src/components/store/OrderPage.tsx`, `src/lib/orders.ts`
- tests: `tests/integration/refunds.test.ts`, `refunds-http.test.ts`, `payment.test.ts`, `order-operations.test.ts`,
  `orders-access.test.ts`, `orders-http.test.ts`, `media-security.test.ts`, `stats.test.ts`, `disputes-http.test.ts`;
  `tests/unit/admin-refunds.test.ts`, `admin-function.test.ts`, `admin-orders.test.ts`, `admin-money.test.ts`,
  `admin-disputes.test.ts`, `orders.test.ts`, `orders-page.test.ts`, `media.test.ts`, `media-library.test.ts`,
  `resend-webhook.test.ts`, `email.test.ts`; `tests/e2e/orders-money.spec.ts`, `orders-admin.spec.ts`,
  `order-page.spec.ts`, `media.spec.ts`
- `docs/operations.md`, `docs/payments-runbook.md` (the paragraphs your items change)

Any other path: stop and report. Every earlier migration stays untouched (R1's and R2a's included): a function you
change is created again in the new file from its latest definition.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, with these additions: the public
JavaScript budget (`orders.html` has 1,688 bytes left, `checkout.html` 263; if `pnpm check:budgets` fails, stop and
report, no lazy loading); Arabic copy exactly as given here; money screens stay calm (no new motion); the local outbox's
daily allowance may be spent (100 sends a UTC day): if the mail tests find no claim for that reason, you may move
today's sent rows back one day for the run and must restore every one of them by id afterwards, counting both. Work in
the order below; if your run is cut short, your last message says what is built, what ran, and what is left.

## The items

1. **P08-CKPT-09, `dispute_record`** (latest in `20261007110000_fable_audit_operations.sql`). Decided, the digest's
   fix: a call at an occupied `seq` is a duplicate only when it says what the stored row says (target, amount,
   direction, occurred_on, decision, item_ids, resolution, reason); one that differs answers `{ok: false, code:
   'SEQ_TAKEN'}` and writes nothing. The `admin` function answers it 409 «سُجّل سطر آخر لهذا المرجع للتو؛ أعد فتح المرجع
   وراجع آخر سطر.». Proof: `stats.test.ts` (the digest names lines 893-895 and 949-951: the differing calls expect
   SEQ_TAKEN, the identical repeats stay duplicates), the function's mapping in a unit test.
2. **EF-ADMIN-06, AVIF brands** (`supabase/functions/_shared/media.ts:179`). Decided: a file whose `ftyp` major brand is
   `mif1` or `msf1` is `image/avif` when `avif` or `avis` is among its compatible brands, read from the head bytes
   already read; anything else as today. Proof: `media.test.ts`, both brands with and without `avif` listed.
3. **EF-ADMIN-09, the Resend webhook's status** (`_shared/admin.ts:746`). Decided: `webhook` is configured only when the
   secret is `whsec_` followed by base64 that decodes to a non-empty key, read with the same decoding the verifier uses
   (`_shared/email.ts:713`; export one small helper rather than copy it). The digest's "time of the last verified
   event" is not built (P10's monitoring). Proof: `admin-function.test.ts` (no secret, a mis-pasted one, a valid one).
4. **EF-ADMIN-05 with ADMIN-CMS-15, the upload's window** (`media_ticket`, latest in
   `20260926090000_media_library.sql`; `src/components/admin/MediaUpload.tsx`). Decided: the ticket expires 30 minutes
   after creation (the signed URLs still bound the upload; the 10 open tickets per actor stay); when the completion is
   answered GONE, the upload screen says «طال الرفع أكثر من المسموح؛ جرّب اتصالًا أسرع أو صورة أصغر.» (the completion's
   GONE only). Proof: `media-security.test.ts` (a 29-minute-old ticket completes, a 31-minute-old one is GONE), a unit or
   e2e test of the sentence.
5. **EF-ACCESS-10, the return request's key** (`src/components/store/OrderPage.tsx:170-215`, `_shared/orders.ts:230`,
   `return_request_create` latest in `20261002140000_delivery.sql`). Decided, the digest's fix: `ReturnForm` mints a key
   kept until the form changes (as the contact form's `submissionKey` is), sends it as `requestKey` (a uuid in the
   function's schema), `finance.return_requests` stores it with a unique constraint, and a repeat of the same key
   answers the existing return's id and writes nothing new. Proof: `orders-http.test.ts` or `order-operations.test.ts`
   (two calls with one key make one request), `orders-page.test.ts` or `order-page.spec.ts` for the kept key.
6. **EF-ACCESS-04, link recovery after a pepper change** (`_shared/orders.ts:94`, `order_recover_apply` latest in
   `20261002140000_delivery.sql`). Decided, the digest's fix: `recoveryItems` sends the current version's hash for an
   unexpired order too; `order_recover_apply` renews the stored hash only when it equals that hash, and otherwise treats
   the order as expired and sets the next version's hash (the existing expired branch). `docs/operations.md`: one line
   where the pepper's rotation is described, that recovery now repairs a buyer's link after it. Proof:
   `orders-access.test.ts` or `orders-http.test.ts`: an order whose stored hash was made with another pepper is
   recovered and its new link works.
7. **CONTRACT-04 with ADMIN-COMMERCE-08 and ADMIN-COMMERCE-17, the other payment mode after the switch.** Decided:
   - `refund_ref` (latest in `20261002130000_refunds.sql`) takes `p_mode` and answers NOT_FOUND for a refund whose
     attempt or review payment is of another environment; `refund-recheck` passes the configured mode, as
     `payment_attempt_ref` is called (`_shared/admin.ts:571`). The two-argument form is dropped.
   - The reconciliation claim (`payment_reconcile_claim`, latest in `20261007100000_fable_audit_payments.sql`): an
     in-flight refund of the other mode that it parks leaves flight, `failed` with error `MODE_CHANGED`, keeping the one
     owner alert it already queues (it is test money that only Moyasar's dashboard can settle).
   - `attempt_dismiss(p_attempt uuid)`, owner only (`finance.require_staff(true)`, as `event_dismiss`), called by the
     screen as `event_dismiss` is: only for an attempt the claim parked `MODE_CHANGED`; it leaves the reconciliation list
     and «تحتاج مطابقة», with an audit row `payment.attempt_dismissed`. Anything else answers as `event_dismiss` does
     (NOT_FOUND, or a code that says why).
   - The screens (`ReconciliationView.tsx`, `OrderView.tsx`) read the payment mode once from the `status` action
     (`payments.mode`). On an attempt, a review payment, a refund or an order of the other mode, the money controls
     («أعد الفحص», «إعادة المبلغ», «استرداد هذه الدفعة», «تسجيل استرداد خارجي», «تسجيل اعتراض») give way to «دفعة من وضع
     الدفع الآخر؛ تُدار من لوحة Moyasar.», and a parked attempt of the other mode offers «إغلاق بعد المراجعة»
     (`attempt_dismiss`). When the mode cannot be read, the controls stay as they are today.
   - `docs/payments-runbook.md`: "Test and live never mix" and "Changing the payment mode" say what is now done.
   Proof: `refunds.test.ts` or `refunds-http.test.ts` (another mode's refund is NOT_FOUND to `refund_ref`), `payment.test.ts`
   (the claim fails a parked refund MODE_CHANGED, once, with its alert), `order-operations.test.ts` (`attempt_dismiss`:
   a parked attempt leaves the list and the count; an unparked one is refused; not for operations), unit tests of the
   screens' choice, and the e2e that covers the reconciliation and order screens (`orders-money.spec.ts`,
   `orders-admin.spec.ts`) with a row of the other mode.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. `supabase migration up` (local); after any edit under `supabase/functions`, `docker restart
   supabase_edge_runtime_ANASAQ.ME`; then `pnpm test:db` (all files; `TEST_ENV=local`, `DATABASE_URL` from `supabase
   status -o json`, never printed);
3. a mutation for items 1, 5, 6 and 7 (revert the change, run its test file, see it fail, restore);
4. free memory at least 10 GB and fewer than 950 staff rows, then once: `pnpm exec playwright test
   tests/e2e/orders-money.spec.ts tests/e2e/orders-admin.spec.ts tests/e2e/order-page.spec.ts tests/e2e/media.spec.ts`
   (Playwright on `http://localhost:3000`; restore `next-env.d.ts` afterwards);
5. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the three largest pages).

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, what you moved and restored in the
outbox if anything, anything not done and why, and the risks left. Do not accept your own work.
