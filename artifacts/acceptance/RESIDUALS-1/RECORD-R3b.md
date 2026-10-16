# RESIDUALS-1, round R3b: the record

Started under the owner's word to go ahead with the plan's next work (2026-10-15), after R3a was committed and pushed.
Orchestrator Claude Opus 5.5 at effort max, on the owner's machine, in two sessions: the one that ran R1 to R3a briefed,
dispatched and audited R3b and ran its first e2e; on the owner's word (2026-10-16: "go ahead in a new session fixing all
issues then do what next in our plan") a fresh session took the lock by the handover the lock records (`handover`,
2026-10-15T23:50:29Z), fixed the audit's findings, ran the checks and committed. The lock moved from R3a to R3b on
2026-10-15T21:57:31Z (base `910e4ec`), with R3b's 44 exact paths; nothing was added later. Committed under the owner's
word: the code first, these records in the commit after it, by explicit path; the branch pushed for CI; the lock kept
for R4a.

## Scope

R3b is the second half of R3 (`SCOPE.md`): the admin's commerce screens: ADMIN-COMMERCE-03, -06, -09, -11, -12, -14,
-15; QUALITY-18, -24, -26; the closed review card's «تسجيل اعتراض» (R1's record); the other mode's «إعادة إرسال رابط
الطلب» (R2b's audit). The decided fixes are in `brief-R3b.md` (12 items; before the writer started, the orchestrator
named the exact new modules and test files in it).

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 68 minutes, 315 tool calls: all 12 items in 37 changed and 4 new
files: one migration (`supabase/migrations/20261015160000_residuals_r3b.sql`: the variants' paid-file check renamed
`product_variants_file_needs_digital`, found by its name and its definition, raising when neither name is there;
`owner_commerce_stats` created again with the review sums over SAR only), three pure modules shared by the functions and
the screens (`_shared/email-address.ts`, `riyadh-day.ts`, `paid-file-rules.ts`), the functions (`contact.ts`,
`checkout.ts`, `orders.ts`, `notify.ts`, `disputes.ts`, `media.ts`, `media-rules.ts`, `paid-files.ts`,
`staff-admin/index.ts`), the screens (`RefundView.tsx`, `OrderView.tsx`, `ReconciliationView.tsx`, `DisputeForm.tsx`,
`VariantCommerce.tsx`, `TableForm.tsx`, `MediaUpload.tsx`, `MediaLibrary.tsx`) with their libraries and
`src/admin/tables/variants.ts`, the tests and `docs/payments-runbook.md`. Item 10's import into `OrderPage.tsx` was tried
and taken back out: it took `orders.html` to 150.3 KiB of its 150 KiB budget; a unit test pins the page's preorder
sentence to `quote.ts`'s instead. Its choices, ruled below: (a) «سيُسحب الملف» only for a line whose entitlement is live,
«لن يُشحن» only for a fulfilment still `preparing` (nothing for a `needs_resolution` order), no stock sentence for a
preorder line; (b) an effect is `{lead, subject, tail, ltr}`, so a SKU is drawn left to right inside the Arabic
sentence; (c) the external record no longer takes the focus when it mounts open; (d) the external record's success
sentence says the payment's currency; (e) a null currency counts as not SAR; (f) `checkMessages` is declared on the
variants' config as `TableConfig & {checkMessages}` and read by `TableForm` with an `in` check (`TableConfig` is outside
the round's paths); (g) `contact.ts` re-exports `EMAIL_SHAPE` and `toAsciiAddress` for `admin.ts`; (h) item 5's
sentences are `role="status"` while the lines load and `role="alert"` when they failed, mounted when shown. Its checks:
lint, typecheck, copy, frozen 0; unit 71 files, 2,736 passed and 39 skipped; `test:db` 944 of 944 (a first run failed 8
tests on the runtime-freshness guard: its own unit mutation touched `staff-admin/index.ts` after the runtime's restart;
restarted, clean); build, export and budgets green; mutations for items 1, 2, 3, 5, 7, 8, 9 and 12 in the unit tests,
and for the SQL's filter (`stats.test.ts`) and the rename (`download.test.ts`), each caught. The e2e did not run (9.1 to
9.5 GB free, under its 10 GB rule).

## 2. The audit and the fixes

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R3b.md`), 29 minutes: **audit_failed**, on one wrong e2e
assertion (major), four minor findings and three nits. Its rulings on the writer's choices, all accepted: item 1's three
rules match `refund_succeed` and `finance.item_fully_refunded` line by line and when the total empties the payment (a
refund never touches fulfilments, but a line refunded in full leaves `order_lines_to_ship`; a `needs_resolution` order
has no fulfilment and no entitlement; a preorder line took no stock, and its capacity is released); the `wasOpen` ref
holds under StrictMode's double effects; a null currency is reachable only for rows the Edge path did not write
(Moyasar's parser requires `currency`), so it never hides a SAR payment's refund form; `toFixed` on whole minor units is
exact; the rename is guarded by name and definition, idempotent, and cannot pass silently on another name; `emailField`
is identical to the four copies it replaced; the shared modules import nothing one side cannot resolve (zod 4.6.5 at the
root and in each function's `deno.json`); leaving `OrderPage.tsx` unchanged is acceptable. R2b's rule for the other
payment mode holds on every new control (the voided panel, the other-currency panel, the closed card's «تسجيل اعتراض»,
the reissue link), and the controls stay when the mode cannot be read.

| Finding | Severity | Ruling | Done by the orchestrator (the new session) |
|---|---|---|---|
| 1: `orders-money.spec.ts:1675` expected the file sentence before the paper line's; the confirmation lists the effects in line order, and the test pays `[paper, book]` | major | Accepted | the order asserted is: the last line, «لن يُشحن», the stock sentence, «سيُسحب الملف», the warning |
| 2: the confirmation recomputed its effects on every render: after an unknown answer whose refund succeeded, the re-read lowered the cap and listed effects the replay would not cause | minor | Accepted | the effects are computed once in `start()` and kept with the frozen request (`Frozen.effects`); a kept key's replay shows its own again |
| 3: a refund of a review payment in another currency was drawn as riyals in the order's refunds and in the reconciliation's refunds in flight, and «أعد الفحص» read its reply as SAR | minor | Accepted | `refundCurrency` (the review payment's currency from the screen's own lists, riyals otherwise) feeds `ReviewMoney` in both rows and `recheckRefund`; a unit test |
| 4: a follow-up pressed after the lines failed said «انتظر لحظة», though the read is never retried | minor | Accepted | `followWaitSentence`: LINES_FAILED when the lines failed; a unit test |
| 5: the preorder pin never read `OrderPage.tsx` | minor | Accepted | the test reads the page's source and finds its line |
| 6: `not.toContain('autofocus')` could not fail | nit | Accepted | removed (the e2e proves the focus rule) |
| 7: `MediaUpload.tsx`'s `accept` repeated the MIME list | nit | Accepted | `ORIGINAL_MIME_TYPES.join(',')` |
| 8: a missing space in `admin-money.test.ts` | nit | Accepted | fixed |

The fixes follow the auditor's own text and were not audited again. What no test covers, recorded: a kept-key
confirmation re-read after its refund succeeded (finding 2's path, now frozen); the dispute form's late-answer race (the
e2e can pass before a dropped answer would have landed); a null currency in the statistics or on a screen; the stock
sentence for a physical variant whose stock is not tracked (shown) and for a preorder line committed as a stocked unit
(R2a F5: missing); a refund in flight on a voided attempt (the external record opens, and `refund_record_external` would
answer REFUND_IN_FLIGHT); the migration's raise path and a re-run; `staff-admin`'s declared Content-Length path (the
tests drive the streamed body); the e2e status and alert helpers meeting the dispute form's second status line while its
lines load (a strict-mode error if the read is slow); a refund row and a recheck of a non-SAR review payment, rendered
(the function that chooses the currency is unit tested). **Deploy the SQL with the site:** the statistics' review sums
change at once.

## 3. Checks on the final tree

- lint, typecheck, copy, frozen 0; unit 71 files, 2,738 passed and 39 skipped.
- E2E, the first run (the previous session; 4 files, 161 tests, 9.3 GB free): 158 passed, `media.spec.ts` in full. It
  failed `orders-money.spec.ts:1632` at both widths (finding 1) and `store-admin.spec.ts:1323` at 1440 only (a
  `pageerror` from `next dev`'s refusal of `/admin/store/notifications/edit`, which the test opens on purpose; the same
  test passed at 360 in that run).
- After the fixes (9.5 GB free): `orders-money.spec.ts` and `store-admin.spec.ts`, 100 tests in 16.7 minutes: 100
  passed, `store-admin.spec.ts:1323` at both widths among them, so its earlier failure was the timing of the dev
  server's error page, not a defect.
- The orchestrator's look: the refund confirmation at 360 (`admin-money-refund-effects-360.png`, written by the e2e):
  the two lines, «لن يُشحن…», the stock sentence with its SKU left to right, «سيُسحب الملف…», then the warning; nothing
  overflows. The other screens' shots (`admin-money-voided-order`, `-reconciliation-currency`, `-dispute-lines-failed`,
  `admin-variant-on-sale-without-file`, `-type-with-file`, at 360 and 1440) were written by the same passing run.
- `owner_commerce_stats` extracted from `20261002170000_stats_disputes.sql` and from this migration and diffed: only the
  two `filter (where pr.currency = 'SAR')`; the revoke and the grant are the same.
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` 0 (`checkout.html` 149.7 KiB, `orders.html` 148.4 KiB,
  `cart.html` 147.1 KiB, of 150).
- `pnpm test:db` not run again: the fixes change no SQL and no function, and the writer's 944 of 944 stands.
- The local database holds the round's test residue (901 staff rows, 549 active; test orders); nothing was published.
