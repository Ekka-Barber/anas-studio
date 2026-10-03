# the product page's availability and preorder states, the availability sign-up form, and preorder notes in the cart and checkout

## Worker report 1

Round 10b is built. Every check is green, with one gap: checkout has 1.1 KiB of budget headroom, not the 5 KiB asked.

- Product page (`VariantAction`): one anon read of `catalog_availability()` per page, parsed strictly. A row shows the add control, the preorder sentence and note with «اطلب مسبقًا», «غير متوفر حاليًا» with the sign-up, «غير مسعّر», or «غير متاح حاليًا». Before the states arrive, or when the read fails, a row is today's control.
- `AvailabilityForm`: visible label, email field, the privacy link with `consentRevision` only when a privacy policy is published, Turnstile loaded on first focus or scroll into view, one sentence for every 200, the field error on 422, short messages for 400, 503 and 429 with the spent token reset, and focus on the sentence after a sign-up.
- Cart and checkout summary show a preorder line's date and note. `OUT_OF_STOCK` with `held: true` says «الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.».
- The hold view is now `HoldView`, loaded on demand with `React.lazy`. All 34 cart-checkout tests pass unchanged, and I used the controls in the browser at 360 and 1440. `next/dynamic` was 1.2 KiB heavier and put checkout over budget.
- Budget, before to after in KiB gzip: product pages 141.9 to 144.5, cart 146.0 to 146.2, checkout 149.4 to 148.9, return 144.5 to 144.9. The hold view is only 2.0 KiB, so 5 KiB headroom needs the checkout form itself loaded on demand. That is your decision.
- Migration `20261003100000` changes `finance.payment_view` by one condition: no `invoiceUrl` once `invoice_expires_at` has passed. The new SQL test fails against the round 2 definition and passes against the new one.
- Round 10a's rule held: I read no `.env` file and called nothing at Moyasar.
- Nothing is committed, and the stack is untouched. `src/lib/cart.ts` was changed and put back, so it has no diff.

Files: src/lib/store.ts, src/app/(public)/store/[slug]/page.tsx, src/components/store/VariantAction.tsx (new), src/components/store/AvailabilityForm.tsx (new), src/components/store/HoldView.tsx (new), src/components/store/AddToCart.tsx, src/components/store/CartView.tsx, src/components/store/CheckoutForm.tsx, src/components/store/quote.ts, src/components/store/store.module.css, supabase/migrations/20261003100000_payment_view_expiry.sql (new), tests/integration/payment.test.ts, tests/unit/store-availability.test.ts (new), tests/unit/quote.test.ts (new), tests/unit/store.test.ts (new), tests/e2e/product-availability.spec.ts (new)

Checks:
- `pnpm exec vitest run tests/unit/store-availability.test.ts` → 0 (19 tests, final tree)
- `pnpm test` → 0 (65 files, 2045 tests (was 62 files, 2015))
- `pnpm lint` → 0
- `pnpm typecheck` → 0 (.next/e2e removed first (generated types break tsc after an e2e run))
- `pnpm check:copy` → 0 (219 files)
- `pnpm check:frozen` → 0
- `pnpm exec supabase migration up --local` → 0 (applied 20261003100000 once; no db reset, stack untouched)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/payment.test.ts tests/integration/checkout-http.test.ts` → 0 (97 tests in 2 files, new payment_view expiry test included)
- `mutation: new payment_view test against the round 2 definition, then against the new one (throwaway script, DB left on the new definition)` → 1 (exit 1 on the old definition (the link is still handed out, as the finding says); exit 0 on the new. Migration diff vs round 2 is exactly `and v_active.invoice_expires_at > now()`.)
- `pnpm build` → 0 (next-env.d.ts restored, md5 identical)
- `pnpm check:export` → 0 (55 required files, no secrets)
- `pnpm check:budgets` → 0 (largest 148.9 KiB (checkout.html) of 150. Sizes, KiB gzip, before -> after: product pages 141.9 -> 144.5; cart 146.0 -> 146.2; checkout 149.4 -> 148.9; checkout/return 144.5 -> 144.9; store list 141.3 -> 141.4; orders 147.8 and notify 144.6 unchanged. The hold view chunk is 2.0 KiB gz and not in checkout's first script. next/dynamic measured 150.3 (over budget), so React.lazy.)
- `pnpm exec playwright test tests/e2e/product-availability.spec.ts tests/e2e/cart-checkout.spec.ts` → 0 (80 passed (46 availability, at 360 and 1440, + 34 cart-checkout unchanged); 12.85 GiB free before; two earlier full runs also green)
- `throwaway script: the production export on :3000 with the hold view's chunk request aborted` → 0 (the page shows the fallback «تعذّر تحميل الطلب؛ حدّث الصفحة.»; not repeatable in dev (Turbopack's dev runtime never rejects a lost chunk), so no repo test)

Contract gaps:
- Budget: checkout has 1.1 KiB of headroom (148.9 of 150), not the 5 KiB asked. The hold view, moved whole (view, pay, cancel, timer, focus), is only 2.0 KiB gz; this round's own additions took most of it back. Each page carries every module it imports whole (Turbopack does not tree-shake quote.ts or cart.ts), so more headroom needs either the checkout form itself loaded on demand (about -5 KiB, one more request before the form shows) or code out of shared modules, whose exports tests/unit/store-checkout.test.ts pins. Your call.
- Brief says 'an unknown state or a missing row is treated as no information' but its row list says 'no row -> «غير متاح حاليًا»'. I followed the list: a variant absent from a good reply is «غير متاح حاليًا»; an unknown state, a failed read and a malformed reply are no information (today's controls).
- A variant unpriced when built stays the static «غير مسعّر» whatever the live state says (the page has no price to show). A live `preorder` state for a variant whose build carried no date and note shows the plain add control, never preorder wording; the cart and checkout then show the note from the quote.
- The availability read, its strict parser and `rowView` live in VariantAction.tsx, not quote.ts, and `AddToCart`/`AvailabilityForm` import relatively: a page ships every imported module whole (quote.ts and orders.ts would have added about 4.5 KiB to product pages) and the unit config has no alias. The sign-up has its own 12-line POST instead of `src/lib/orders.ts` for the same reason. `consentRevision` is in store.ts (server only); src/lib/cart.ts is unchanged.
- The shared read is reused for 60 seconds (one promise, as briefed, but not for a whole session of client navigations).
- Sign-up success is read strictly: only 200 `{sent: true}` shows the sentence; any other 200 is the network sentence (round 10a's rule), not 'any 200'.
- The brief's 'the format the cart uses' for the date: the cart had none; I used `formatDate` (Riyadh calendar day, Latin digits, Arabic month), the order page's own format. The product page's price and preorder sentence are formatted at build.
- Cloudflare's widget is 300px wide (measured in a browser with the real widget, 360 and 1440). A row on a phone under 381px gave it less room, so below 381px its box takes the row's full width and centres it (store.module.css). Not in the brief.
- DESIGN.md section 8 still says the availability sign-ups arrive with P08; PLANS and DESIGN.md are not mine to edit.

Open risks:
- The held sentence is proven in the browser against the real quote patched to carry `held: true`; the real `held: true` is proven at SQL level by tests/integration/checkout.test.ts, and the function passes the SQL result through unchanged.
- The sign-up is exercised in the browser against a mocked `notify` and a stubbed Turnstile script; the real function's body and reply shapes come from its own tests (notify-http.test.ts: `{ok: true, data: {sent: true}}`). No real sign-up was made, so no row or mail was queued. The real `catalog_availability` read is tested for real (one test, no mock).
- The lost-chunk fallback for the hold view was proven only in the production export with a throwaway script, not by a repo test. A buyer whose connection drops between press and chunk sees that message and reloads; the order stays in the tab and `pay` brings the view back. The chunk is preloaded when «تأكيد الطلب» is pressed.
- e2e: 'the request ... no privacy revision' skips itself if the database already holds a published privacy policy (the local database has none). The privacy test publishes one and removes it again in `finally`.
- No browser test of the return page with a really expired invoice: SQL test (before and after expiry, return-page reads and order_access) plus a mocked `verify` without the link.
- Screenshots went to git-ignored test-results/ (ACCEPTANCE_PACKAGE unset): nothing under artifacts/acceptance was rewritten. Product-page captures are of the rows only (the page is long on purpose, to put the form below the fold).
- Evidence, screenshots viewed by me: test-results/screenshots/P08/availability-{product,signup-form,signup-error,signup-sent,signup-widget,cart-preorder,cart-held,checkout-preorder}-{360,1440}.png and .../P07/store-order-{360,1440}.png (hold view after the split). Logs in the session scratchpad: pw-pair-final2.log, db-tests.log, budgets-final.log, build-last.log.

## Audit 1: audit_failed

### R10B-1 [medium] src/components/store/CheckoutForm.tsx:97
- Problem: Brief item 5 says the on-demand split must leave checkout with at least 5 KiB of headroom under the 150 KiB public JS budget. The build leaves 1.1 KiB. The hold view is the only thing split out. It saved 2.0 KiB, but this round's additions to the checkout chunk took most of that back (net 0.5 KiB). The contract's own line (stay under 150 KiB, section 12) is met. The brief's target is not. The budget gate will now fail on the next ~1.1 KiB added to the checkout page, quote.ts or cart.ts.
- Evidence: My own `pnpm build` (exit 0, next-env.d.ts md5 unchanged), then `pnpm check:budgets` (exit 0) printed: "checkout.html initial JS gzip 148.9 KiB (10 scripts)" and "OK largest 148.9 KiB (budget 150.0 KiB)". The size before this round was 149.4 KiB (orchestrator's final checks, artifacts/acceptance/P08/rounds/round-10a.md:210). The HoldView chunk out/_next/static/chunks/3-d1nynhxkzcc.js (2027 B gzip) is not referenced by out/checkout.html, so the split works. Checkout's own page chunk 38a9b1qiq_w58.js is about 11.0 KiB gzip. Other pages: cart.html 146.2, checkout/return.html 144.9, store/*.html 144.5, matching the worker's report. The worker lists this as an open gap ('Your call').
- Correction: Orchestrator ruling, then a fresh worker if needed. (a) Accept 1.1 KiB of headroom and record it in round-10b.md. Or (b) authorize loading the checkout form body on demand as well: React.lazy, preloaded on mount in parallel with the cart read and the 300 ms-debounced quote, same «جارٍ تحميل الطلب…» fallback. This goes beyond the brief's 'what the buyer sees only after create'. Or (c) authorize moving the return-page-only code (parseVerify, postPayments) out of src/components/store/quote.ts, together with the matching edit to tests/unit/store-checkout.test.ts, which is outside this round's allowlist. Then rebuild and show checkout.html at or below 145.0 KiB in `pnpm check:budgets`.

### R10B-2 [low] src/components/store/VariantAction.tsx:100
- Problem: The row shows the build-time preorder sentence whenever the live state is `preorder`. It never checks the build's date against today. Case: a preorder lapses, the owner moves its date, and the page is not rebuilt yet (rebuild pending, or failed so the last good deployment stays live). The live state turns back to `preorder` and the row shows the old, passed delivery date beside «اطلب مسبقًا». Contract section 4 says the buyer must not be shown a date that has passed. The cart and checkout show the current date from the quote before payment, so nothing is sold wrongly.
- Evidence: VariantAction.tsx:100-101 picks 'preorder' from the live state and `hasPreorder` alone. page.tsx:105 passes only the build-formatted `sentence` and `note`, no raw date. `finance.variant_public_state` (supabase/migrations/20261002150000_notifications.sql:49-55) computes `preorder` from the database's current `preorder_ships_on`, not the build's.
- Correction: Pass the build's `shipsOn` (YYYY-MM-DD) to the island along with the sentence. When it is before today's Riyadh date (`new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())`), treat the variant as having no build preorder: `hasPreorder` false, so the plain add control and no preorder wording. Add the case to tests/unit/store-availability.test.ts.

### R10B-3 [low] tests/e2e/product-availability.spec.ts:606
- Problem: When no privacy policy is published, the privacy test publishes one. Its `finally` block then deletes every privacy row in public.content_versions, not only the version it inserted. Any unpublished privacy draft in the local database is destroyed. The spec header (line 3) says it 'saves nothing it does not put back'.
- Evidence: Line 576 sets seq = max(seq)+1, so it expects earlier versions may exist. Line 606 runs `delete from public.content_versions where collection = 'policies' and doc_id = 'privacy'` with no seq filter. The local database has no privacy versions now, so my run deleted nothing. After the run: published policies are delivery/refund/store only, privacy versions 0, no e2e-avail products left.
- Correction: Delete only the version the test inserted (`... and doc_id = 'privacy' and seq = $1`, [seq]). Delete the published row only when it still carries that seq.

### R10B-4 [low] src/components/store/AvailabilityForm.tsx:49
- Problem: The brief says 'any 200 replaces the form with one sentence'. The form shows the sentence only for exactly 200 {ok:true, data:{sent:true}}. Any other 200 shows the network sentence and keeps the form. This follows contract section 7 (subscribe answers 200 {sent: true}) and the orchestrator's R10A-7 exact-shape rule for `recover`. Nothing leaks whether an address was already subscribed. But the brief text and the build disagree, and the e2e pins the strict reading.
- Evidence: AvailabilityForm.tsx:49-55. supabase/functions/_shared/notify.ts:157 answers only okReply({ sent: true }) on 200. tests/e2e/product-availability.spec.ts:686 asserts the network sentence for ok({}), ok({sent:true, extra:1}), ok({sent:false}) and {ok:true}. The worker disclosed this in contractGaps.
- Correction: No code change unless the orchestrator orders the brief's 'any 200' reading. Either way, record the ruling in round-10b.md.

### R10B-5 [low] src/components/store/VariantAction.tsx:98
- Problem: The brief contradicts itself. Item 2 says 'an unknown state or a missing row is treated as no information'; its state list says 'no row for the variant → «غير متاح حاليًا», no control'. The worker followed the list, so a variant missing from a well-formed reply loses its price and control. That is sound under contract section 6 (catalog_availability returns every enabled variant of a published product). Ceiling: if PostgREST's row cap ever truncated the reply, every variant past the cap would show «غير متاح حاليًا». That cannot happen at the current tens of variants.
- Evidence: VariantAction.tsx:98-99 (`case undefined: return 'gone'`). tests/unit/store-availability.test.ts:102-107 pins 'gone', including an empty reply. The e2e mock mixed() omits T_GONE. The worker disclosed this in contractGaps.
- Correction: Orchestrator records in round-10b.md that the list's reading stands. No code change is needed at this catalog size.

Checks re-run:
- `pnpm exec vitest run tests/unit/store-availability.test.ts (19 tests)` → 0
- `pnpm test (65 files, 2045 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck (before and again after the e2e run)` → 0
- `pnpm check:copy (219 files)` → 0
- `pnpm check:frozen (50 files)` → 0
- `pnpm exec supabase migration up --local (local database is up to date; 20261003100000 is in schema_migrations; DB payment_view has the expiry condition, ACL {postgres=X/postgres}, stable, not security definer; catalog_availability anon+authenticated, stable, security definer; anon column grants on product_variants have preorder, preorder_ships_on, preorder_note and no stock or capacity)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/payment.test.ts tests/integration/checkout-http.test.ts (97 tests)` → 0
- `pnpm build (next-env.d.ts copied aside and restored, md5 0e4a65e8b2b9aa3ed0f8957b9406bd41 unchanged)` → 0
- `pnpm check:export (55 required files, 346 text files, no secrets)` → 0
- `pnpm check:budgets (checkout.html 148.9, cart 146.2, checkout/return 144.9, store/* 144.5, store 141.4, orders 147.8, notify/* 144.6 KiB; budget 150.0)` → 0
- `pnpm exec playwright test tests/e2e/product-availability.spec.ts tests/e2e/cart-checkout.spec.ts (12.71 GB free before, no leftover headless Chrome; 80 passed in 4.4 min, none skipped; next-env.d.ts restored)` → 0

Uncovered:
- Live `preorder` state on a stale build whose preorder date has passed (R10B-2): no guard and no test.
- The lost hold-view chunk (`HoldViewLost`, CheckoutForm.tsx:90-99) has no repo test. Also, for a `create` duplicate of an order that already ended, `onEnd()` now runs only after the chunk loads. While the chunk cannot load, the idempotency key and fingerprint stay in sessionStorage; a reload that loads the chunk clears them.
- No test sends the client's real `subscribe` body to the real `notify` function: the e2e mocks it, and notify-http tests send their own bodies. That the body matches the function's strictObject {action, variantId, email, consentRevision, turnstileToken} was verified by reading only (AvailabilityForm.tsx:119 against supabase/functions/_shared/notify.ts:57-64).
- Two out-of-stock variants on one product page (two Turnstile widgets, each form with its own variantId): not tested.
- `create`'s own OUT_OF_STOCK refusal (supabase/functions/_shared/checkout.ts:155) still says «الكمية المطلوبة غير متوفرة الآن.» when another order's hold is the cause. Only the quote path carries `held`. This is outside this round's files.
- The return page with a really expired invoice in the browser: covered only at SQL level (payment.test.ts) and with a mocked `verify` in the e2e.
- A catalog_availability reply truncated by the PostgREST row cap would mark the remaining variants «غير متاح حاليًا» (R10B-5): no test, and not reachable at tens of variants.


## The orchestrator's rulings and own audit (2026-10-03)

The workflow ended `needs_orchestrator` after one build and one audit (one medium, four low; no fix pass, since the medium was a ruling). Workers run Sonnet 5.5 at effort max and the auditor Opus 5.5 at effort max (raised from xhigh on the owner's word for this session). The worker read no `.env` file. I read the migration, the hold view's split (its `pay`, `cancel`, timer and storage rules, which are unchanged), the product island, the sign-up form and the build read: no stock, capacity or count reaches the page or the build; the sign-up body is exactly `notify`'s schema `{action, variantId, email, consentRevision, turnstileToken}`; the address travels only in a POST body; the quote stays the only gate.

| Finding | Ruling |
|---|---|
| R10B-1 (medium: checkout has 1.1 KiB of headroom under the 150 KiB budget, not the 5 KiB asked) | Accepted as built (option a). The hold view's split works (its 2.0 KiB chunk is not in checkout's first script); this round's own additions took the rest. Option (c), moving the return page's code out of `quote.ts`, would free about 0.4 KiB. P08 adds nothing more to checkout. Ceiling recorded: the next change to the checkout page, `quote.ts` or `cart.ts` that needs room loads the checkout form body on demand (option b, about 5 KiB). Written into ISSUES at the close. |
| R10B-2 (low: a stale build could show a passed preorder date while the live state says preorder) | Fixed by me: the build passes the date (`shipsOn`) to the island, and `preorderCurrent` shows the preorder wording only while that date is today or later in Riyadh; otherwise the row is the plain add control and the cart and checkout show the current date from the quote. Unit tests added (a Riyadh day boundary, the stale case). |
| R10B-3 (low: the privacy e2e deleted every privacy version, drafts included) | Fixed by me: it deletes only the version it inserted, and the live copy only while it is still that version. |
| R10B-4 (low: only 200 `{sent: true}` shows the sentence, the brief said "any 200") | The strict reading stands: contract section 7 fixes the reply, and round 10a's rule (R10A-7) reads small replies in their exact shape. Nothing tells whether an address was subscribed. |
| R10B-5 (low: a variant missing from a good reply is «غير متاح حاليًا») | The list's reading stands: `catalog_availability` returns every enabled variant of a published product, so a missing one is off the shelf. Ceiling: PostgREST's row cap (1000) would truncate the reply long before this catalog nears it. |

The worker's other choices are accepted: an unknown state, a failed read and a malformed reply are no information (today's controls); a variant unpriced at build stays «غير مسعّر»; the read is reused for 60 seconds; `formatDate` for the preorder day (the order page's own); the full-width Turnstile box under 381px; `React.lazy` rather than `next/dynamic` (1.2 KiB lighter). Noted for later: `create`'s own `OUT_OF_STOCK` refusal does not carry `held` (only the quote does), so a buyer who passes the quote and loses the race at `create` reads «الكمية المطلوبة غير متوفرة الآن.»; DESIGN.md section 8 still says the sign-ups arrive with P08 (updated at the close).

My own browser pass, on the dev server and the real local stack (no mocks), at 360x740 and 1440x900, with `DEMO-MOON-CUP` set out of stock and `DEMO-KHOUS-PAPER` made a preorder 30 days out (local data, reset afterwards): the preorder row (price, «طلب مسبق: يُسلَّم في 2 نوفمبر 2026», the note, «اطلب مسبقًا», which added the line); the out-of-stock row with «غير متوفر حاليًا» and the form, Turnstile loaded only once the form came into view; an invalid address refused under the field with the focus on it; a real sign-up through the local `notify` (200, one sentence, which took the focus; the row stored `pending` with the address lower-cased and the revision null, and one `notify_confirm` queued); the cart and the checkout summary showing the preorder date and note from the real quote; a real `create` opening the lazily loaded hold view with the focus in the order box (the emulator was not running, so the creation was uncertain: «نجهّز صفحة الدفع…»), «إلغاء الطلب» refused with «الدفع قيد المعالجة؛ حاول بعد لحظات.» and nothing cancelled, «أعد المحاولة» asking `pay` again with the focus kept; a reload re-opening the stored order through `pay` without taking the focus. No horizontal overflow at either width; calm, no reveal on the money rows.

Checks on the final tree: `pnpm test` 0 (65 files, 2047 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; from a fresh `supabase db reset` with `pnpm db:import` and `pnpm db:demo-catalog` and the edge runtime restarted, `vitest --mode db` on payment, checkout-http, orders-access, orders-http and notify-http 0 (160 tests); `pnpm build` 0; `pnpm check:export` 0 (55 files); `pnpm check:budgets` 0 (checkout 148.9, cart 146.2, product pages 144.5 of 150 KiB); `pnpm exec playwright test tests/e2e/product-availability.spec.ts tests/e2e/cart-checkout.spec.ts tests/e2e/order-page.spec.ts` 176 passed (12.3 GB free before; `next-env.d.ts` restored). No call to Moyasar.
