# Round 4b: the checkout form and hold view, the payment return page, the checkout switch

## Worker report 1

Round 4b built; every listed check is green (final e2e: 48 passed). Nothing committed, no network call to Moyasar.

Browser side: src/lib/policies.ts (one React-cached loader of published_documents) now feeds the policy pages and the checkout page, which passes builtRevisions to CheckoutForm. `create` sends the built revisions for the keys the quote lists; a missing or different one shows «نحدّث السياسات الآن؛ حاول بعد قليل.» (role=note) and keeps the button off.

The hold view follows section 10: order number, total, «محجوز حتى HH:MM» (Riyadh, 24 h), ready/preparing/unavailable/closed with «ادفع الآن» as a plain link, retry through `pay` (also once after a reload), cancel (settled payments say «وصلتنا دفعة هذا الطلب.» and clear nothing), one timer to the hold's end, NOT_FOUND/503/429 and both ACTIVE_HOLD branches, and the test-mode note. The P07 sentence is gone.

quote.ts parses testMode, preorder, holdExpiresAt and the payment object (unknown shapes become `preparing`, a non-http(s) URL is never a link) and gains postPayments; the sandbox code travels from `#test=` to sessionStorage to the quote, create and pay bodies only. /checkout/return (PaymentReturn.tsx, noindex, no-store, no-referrer header, required by check:export) verifies at 0, 2, 4, 8, 15 and 30 seconds, stops at the first non-pending state, then offers «تحديث». The settings form has the «الشراء» box (payments sentence from `status`, state, one switch through the step-up dialog).

Evidence: 48 e2e against the real local functions and the emulator (create, reload, cancel, paid return, late payment found by a later check, preparing and unavailable faults, timer, HOLD_EXPIRED, ACTIVE_HOLD with and without the email, forged status, every return state, 429, lost connection, switch with step-up, CONFLICT and NOT_READY, operations without the control); new unit tests for every pure helper.

Decisions are listed in contractGaps (closed-without-reason mapping, cart cleared on paid only in the tab that holds the order, my copy for two links, helpers placed in src/lib/cart.ts because format.ts and the unit alias are outside my paths). Teardown deletes the paid orders' rows and restores the commerce settings first; next-env.d.ts is back to its committed content.

Files: src/lib/policies.ts, src/lib/cart.ts, src/app/(public)/policies/[slug]/page.tsx, src/app/(public)/checkout/page.tsx, src/app/(public)/checkout/return/page.tsx, src/components/store/CheckoutForm.tsx, src/components/store/PaymentReturn.tsx, src/components/store/quote.ts, src/components/store/CartProvider.tsx, src/components/admin/CommerceSettingsForm.tsx, src/components/admin/admin.module.css, public/_headers, scripts/check-export.mjs, tests/e2e/cart-checkout.spec.ts, tests/e2e/store-admin.spec.ts, tests/unit/cart.test.ts, tests/unit/store-checkout.test.ts

Checks:
- `pnpm lint` → 0 (re-run after the last source and spec edits)
- `pnpm typecheck` → 0 (re-run after the last source and spec edits)
- `pnpm test` → 0 (54 files, 1414 tests (new: tests/unit/store-checkout.test.ts, additions in cart.test.ts))
- `pnpm check:copy` → 0 (204 source files)
- `pnpm check:frozen` → 0 (50 files under deploy/ unchanged)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (once, before the first e2e run; checkout and payments answered 405 to a GET afterwards)
- `node -e "console.log((require('os').freemem()/2**30).toFixed(1))"` → 0 (11.9 GB before the first e2e run, 12.4 before the last)
- `pnpm exec playwright test tests/e2e/cart-checkout.spec.ts tests/e2e/store-admin.spec.ts tests/e2e/checkout-api.spec.ts` → 0 (48 passed (cart-checkout 34, checkout-api 4, store-admin 10) on http://localhost:3000 against the real local functions and the emulator; next-env.d.ts copied before and put back after (git diff clean); the DB holds none of the spec's rows afterwards)
- `pnpm build` → 0 (/checkout/return is prerendered; out/checkout/return.html has robots noindex, nofollow and the title «حالة الدفع»; out/checkout.html embeds builtRevisions {store:1,delivery:1,refund:1}; the four policy pages render as before)
- `pnpm check:export` → 0 (52 required files (checkout/return.html now required), no secrets)
- `pnpm check:budgets` → 0 (largest checkout.html 149.2 of 150.0 KiB; checkout/return.html 144.4; no zod in the client chunks)

Contract gaps:
- Closed payment without a reason: `payment: {state:'closed', code, status?}` does not carry the SQL's `reason`, so ORDER_NOT_PAYABLE on an order that is still pending_payment (UNDER_REVIEW or MODE_CHANGED) cannot be told apart. I show «وصلتنا دفعة هذا الطلب.» with the link to the return page (which answers review or unknown) and clear nothing, because clearing the token of an order with a charged payment under review is the worse failure. Needs a ruling, or the function adding `reason`.
- Contract section 10 says the checkout view clears the stored order 'on paid'; the task says to leave it for the return page. Built per the task: the received view clears nothing.
- The return page clears the cart, the stored order and the idempotency key on `paid` only when this tab's stored pending order has that number; the contract does not say what a tab that does not hold the order does. So a crafted `?order=` of someone else's paid order empties no cart and drops no other order's token. Expired and cancelled also clear the key (the task named only the stored order).
- Copy the contract and task leave open, chosen by me: the order link «عرض الطلب» and the recovery link «استعادة رابط الطلب»; on the return page expired «انتهت مدة حجز الطلب.» and cancelled «أُلغي الطلب.» (the contract says only 'the hold ended'); a period after «أرسلنا رابط الطلب إلى بريدك.»; «تعذّر تجهيز الدفع؛ حاول بعد لحظات.» is role=alert; after `pay` NOT_FOUND the form shows the function's «لم نجد هذا الطلب.».
- `formatRiyadhTime` (and `instantOf`, which cuts the database's microseconds to milliseconds before any parse) are in src/lib/cart.ts: src/lib/format.ts is not in my path list and has no clock-time helper. Move them if you prefer.
- `builtPolicyRevisions`, `returnOrder` and `VERIFY_SCHEDULE_SECONDS` live in src/lib/cart.ts, not exported from the components: the unit config resolves no `@/` alias (vitest.config.ts is not mine). The contract's test matrix names tests/unit/policies.test.ts; the allowlist names store-checkout.test.ts, which holds the comparison tests. `getPublishedPolicies` itself has no unit test (it needs the alias); the build and the e2e cover it.
- `getPublishedPolicies` is memoized with React `cache`, as instructed, which is per render: the checkout page and each policy page fetch separately, so 'one fetch per build' holds only within a page. A publish in the middle of a build could mix revisions across pages; the stale note and POLICY_CHANGED keep that safe.
- Beyond the list, small: `quoteErrorMessage` gains TOTAL_BELOW_MINIMUM (the function's own words, «قيمة الطلب أقل من الحد الأدنى للدفع.»), and `pendingOrderOf`/`ORDER_NUMBER` are factored out of `readPendingOrder`. Not built, in no round's list: the contract section 4 wording «الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.» for OUT_OF_STOCK with `held: true` (the cart still says «المتاح: n»).
- e2e: the hold timer test shortens only the page's ~20-minute timer (an init script that also records the delay), because `payment_attempt_begin` answers HOLD_EXPIRED before it looks at an active attempt when under 60 seconds remain: a database-shortened hold then a reload tests the server path, which has its own test.

Open risks:
- Public JS budget: checkout.html is 149.2 of 150.0 KiB; round 10's preorder notes on the cart and checkout may break it.
- Not exercised: PAYMENTS_NOT_CONFIGURED in the settings form (the local functions' env is fixed); the hosted sandbox fence (only its browser half is tested: fragment to sessionStorage to the quote, create and pay bodies, never cancel or verify); tests/e2e/owner-operations.spec.ts, which shares the settings page, was not run (it parks other outbox rows).
- The hold timer and «محجوز حتى» use the device's clock against the server's holdExpiresAt; a clock far ahead ends the view early and clears the stored order.
- A buyer who pays in a browser or tab that does not hold the order sees «تم الدفع» without the order link (the emailed link remains) and keeps the cart in the tab that does, until that tab opens /checkout and then the return page.
- /orders does not exist until round 10: «عرض الطلب» and «استعادة رابط الطلب» lead to the 404 page for now.
- Changed existing assertions: cart-checkout.spec.ts: the three assertions of the P07 sentence «حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف…» now assert the hold view (the sentence is removed per the task); the screenshots test ends by paying and capturing the return page instead of cancelling (cancel has its own tests); the throttle reset moved from beforeAll to beforeEach with more buckets; afterAll deletes the rows of a paid order. store-admin.spec.ts and checkout-api.spec.ts: no existing assertion changed.
- One e2e test waits 8 seconds (page.waitForTimeout) to show that asking stops after a settle; the tests rely on the emulator started by Playwright and reset it in beforeEach and afterAll.

## Audit 1: audit_failed

### R4B-01 [medium] src/components/store/CheckoutForm.tsx:260
- Problem: The hold view tells the buyer «وصلتنا دفعة هذا الطلب.» for every `closed` payment with code ORDER_NOT_PAYABLE on an order that is still `pending_payment`. That code has two causes on a pending order: UNDER_REVIEW (a charged payment exists, the sentence is true) and MODE_CHANGED (the site's payment mode changed; no payment exists). For MODE_CHANGED the page states a payment that never happened, then links to the return page, whose `verify` answers `unknown` in the new mode: «لم نجد هذا الطلب.». This is an invented payment claim, and it also departs from the brief, which puts everything but paid / paid_needs_resolution / refunded under the 'hold ended' branch. No test covers the branch at all.
- Evidence: supabase/migrations/20261002100000_payment_core.sql:763-770 returns ORDER_NOT_PAYABLE with status = the order's status (`pending_payment`) and reason MODE_CHANGED or UNDER_REVIEW. supabase/functions/_shared/payments.ts:251 forwards only `code` and `status` and drops `reason`. CheckoutForm.tsx:253-261: RECEIVED does not contain `pending_payment`, the order is not expired/cancelled, so line 260 `if (reply.code === 'ORDER_NOT_PAYABLE') setClosed('received')` runs for both reasons; lines 576-584 then render «وصلتنا دفعة هذا الطلب.». payment_check_begin answers `unknown` for an order of the other mode (contract section 6). grep of tests/e2e/cart-checkout.spec.ts and tests/unit/store-checkout.test.ts: no case sends ORDER_NOT_PAYABLE with a pending status to the form. The worker listed this under contractGaps as needing a ruling.
- Correction: Orchestrator: have `startPayment` pass the SQL's `reason` in the closed payload (`{state:'closed', code, status?, reason?}` at payments.ts:251, and in the contract's section 7), then in CheckoutForm show «وصلتنا دفعة هذا الطلب.» only when a RECEIVED status or `reason === 'UNDER_REVIEW'` arrives; for MODE_CHANGED (or a missing reason) show a neutral sentence that claims no payment and decide whether the stored order is cleared. Add an e2e or unit case for each reason.

### R4B-02 [low] src/components/store/PaymentReturn.tsx:189
- Problem: «تحديث» is removed from the DOM while its own request runs, so a keyboard or screen-reader user who presses it loses focus to the document body and must walk the page again to find the button when it comes back. When the answer is still `pending` nothing in the live region changes either, so the press gives no feedback at all.
- Evidence: Line 189 renders the button only when `!busy`; line 97 sets `busy` true at the start of every check, including the one the button itself starts through `setAgain` (line 190). The button unmounts with focus on it and is mounted again as a new element after line 100. The hold view's own retry (CheckoutForm.tsx:612-622) keeps its button mounted and `disabled`. The e2e at cart-checkout.spec.ts:893 only asserts the button is visible again, not where focus is.
- Correction: Keep the button mounted once it has appeared and use `disabled={busy}` (or `aria-busy`) instead of unmounting it; add a `toBeFocused()` assertion after the press in the throttle/lost-connection test.

### R4B-03 [low] src/components/store/CheckoutForm.tsx:543
- Problem: A `cancel` that answers 404 NOT_FOUND keeps the hold view and the stored pending order; only `pay` clears on NOT_FOUND. Contract section 10 says the stored order is cleared on NOT_FOUND, not only on a successful cancel. The buyer is left with «لم نجد هذا الطلب.» under a view that still shows «ادفع الآن» and «إلغاء الطلب» until a reload.
- Evidence: cancelOrder, lines 534-544: the only branches are a 200 with cancelled/expired, a 200 with a RECEIVED status, and `else setSubmitError(reply.error?.message ...)`. checkout.ts:349 maps `checkout_cancel`'s NOT_FOUND through `refusal` to a 404. The NOT_FOUND clearing exists only in loadPayment (lines 284-292). No test sends a 404 to cancel.
- Correction: In cancelOrder, treat `reply.error?.code === 'NOT_FOUND'` like loadPayment does (clear the pending order and key, reset the refs, `setPending(null)`, show the message), and add the case to the 'a cancel the function refuses' e2e.

### R4B-04 [low] src/components/store/CheckoutForm.tsx:739
- Problem: An unrelated line was changed: the visible escape `‎` before the minus sign of the discount was replaced by a literal, invisible U+200E character. The output is the same, but the mark can no longer be seen in the source, and the cart keeps the escape.
- Evidence: `git show HEAD:src/components/store/CheckoutForm.tsx` line 554: `{'‎−'}`; working tree line 739 as bytes: `{'M-bM-^@M-^NM-bM-^HM-^R'}` (E2 80 8E literal). src/components/store/CartView.tsx:388 still has `'‎−'`. Nothing in the round's brief touches the discount row.
- Correction: Restore `{'‎−'}` on line 739.

### R4B-05 [low] tests/e2e/cart-checkout.spec.ts:560
- Problem: The assertion that 'the cart link says so' after `paid` proves nothing: the return page has no CartLink, so the count is 0 whether or not the cart event was dispatched. The brief asked for the cart to be cleared through the cart module's functions and event so CartLink updates; no test would fail if `writeCart`'s event were lost.
- Evidence: Line 560: `await expect(page.getByRole('link', { name: /^السلة /(/d+/)$/ })).toHaveCount(0)` runs on /checkout/return. `grep -rn CartLink src` lists only src/app/(public)/store/page.tsx and store/[slug]/page.tsx; src/app/(public)/checkout/return/page.tsx renders no CartLink. The storage assertion on line 557 is the only real proof.
- Correction: After the paid assertions, open /store and assert the link's name is exactly «السلة» (no count), or drop line 560 and its comment.

### R4B-06 [low] tests/e2e/cart-checkout.spec.ts:282
- Problem: The teardown deletes every payment event the database received since the spec started, not the events of this spec's payments. Anything else that used the shared local database in that window loses its events.
- Evidence: Line 282: `delete from finance.payment_events where received_at >= $1` with `startedAt`; every other delete in the same afterAll is scoped by the `buyer-<marker>-%` orders. `finance.payment_events.provider_payment_id` (payment_core.sql:197) can scope it. After my run the database held 0 orders, attempts, reviews, events and outbox rows of the spec, and the commerce settings were restored, so the teardown itself is complete.
- Correction: Scope the delete to the spec's payments, before the attempts are deleted: `where provider_payment_id in (select provider_payment_id from finance.payment_attempts where order_id in (orders))`.

### R4B-07 [low] src/components/store/CartProvider.tsx:33
- Problem: The `#test=<code>` fragment is read only on /cart and /checkout. Contract section 1 says 'the store pages' read it. A supervised sandbox link to /store or /store/<slug> leaves the access code in the address bar, stores nothing, and the first in-site navigation drops it, so checkout then shows as closed. Built as the brief said (CartProvider on mount); the contract and the brief disagree.
- Evidence: `readTestFragment()` is called only at CartProvider.tsx:33. `grep -rn CartProvider src/app` lists only (public)/cart/page.tsx and (public)/checkout/page.tsx; src/components/store/AddToCart.tsx:6 states the product page has no CartProvider. The only e2e (cart-checkout.spec.ts '#test= fragment') enters at /cart.
- Correction: Orchestrator ruling: either state in the contract and the runbook that the sandbox entry link is `/cart#test=<code>`, or widen a later round to call `readTestFragment()` from a component every store page mounts (CartLink is on both).

### R4B-08 [low] src/lib/policies.ts:17
- Problem: The loader is memoized per render, not per build: the checkout page and each of the four policy pages fetch separately. A publish that lands during a build can leave the checkout page embedding one revision while a policy page shows another, which is the mismatch the contract's 'one fetch per build' wording exists to rule out. The worker built what the brief asked (React `cache`) and reported it.
- Evidence: policies.ts:17 wraps the fetch in React `cache`, whose scope is one server render. Contract section 6: 'returns each published policy's data and seq in one fetch per build ... so the seq the form sends is the seq of the text the same build shows'. No test can show a cross-page fetch count; the build embeds `builtRevisions {store:1,delivery:1,refund:1}` in out/checkout.html.
- Correction: Orchestrator ruling: accept per-render memoization and correct the contract's wording (the next build after a publish repairs it, and the stale note plus POLICY_CHANGED bound the damage), or require a build-wide snapshot outside this round's files.

### R4B-09 [low] src/components/store/CheckoutForm.tsx:319
- Problem: The hold timer compares the server's `holdExpiresAt` with the device's clock. A device clock 20 minutes or more ahead ends the view the moment it appears and clears the stored order; a new `create` with the same email gets the order handed back by ACTIVE_HOLD and the view ends again. Such a buyer cannot reach «ادفع الآن» while the order is fully payable on the server.
- Evidence: Line 319: `setTimeout(() => endOrder('expired'), Math.max(0, instantOf(holdEnds) - Date.now()))`; endOrder (lines 239-246) clears the pending order and the key. No reply carries the server's time or the seconds left. The worker listed this under openRisks; no test covers a skewed clock.
- Correction: Orchestrator: have `create` and `pay` return the seconds left on the hold (or the server's time) with the order, and set the timer from that duration; until then, record the limit in docs/operations.md.

Checks re-run:
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm test` → 0
- `pnpm check:copy` → 0
- `pnpm check:frozen` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `node -e "console.log((require('os').freemem()/2**30).toFixed(1))"` → 0
- `pnpm exec playwright test tests/e2e/cart-checkout.spec.ts tests/e2e/store-admin.spec.ts tests/e2e/checkout-api.spec.ts --reporter=list` → 0
- `pnpm build` → 0
- `pnpm check:export` → 0
- `pnpm check:budgets` → 0

Uncovered:
- A `closed` payment with ORDER_NOT_PAYABLE on a pending order (UNDER_REVIEW, MODE_CHANGED), TOO_MANY_ATTEMPTS and TOTAL_BELOW_MINIMUM: no e2e or unit case reaches the form's `showOrder` branches for them (only HOLD_EXPIRED is tested).
- TOO_MANY_ATTEMPTS ends the view and clears the token while the order still holds the checkout session: the same email is handed the order back by ACTIVE_HOLD and closed again until the hold expires, with no cancel offered. Built as the brief said; untested.
- A duplicate `create` (the retry of a lost reply with the same idempotency key) answering 200 with `{order, accessToken, payment}`, and a duplicate for an order already paid, expired or cancelled (a reply with no `payment`): no browser test.
- `cancel` answering 200 with `review`, `paid_needs_resolution` or `refunded`: only `paid` is tested.
- `cancel` answering 404 NOT_FOUND (finding R4B-03).
- A network failure of `pay` after a reload: that the stored order is kept is not asserted (only the mocked 503 and 429 are), and in that state the view has no hold time and no timer.
- The return page's «تحديث» after the 30-second schedule runs out on a still-pending order: the button is only reached through a mocked 429 and a lost connection. The schedule's actual times (0, 2, 4, 8, 15, 30) are pinned only as a constant; the e2e asserts more than one request.
- Timers cleared on unmount (leaving /checkout or /checkout/return mid-schedule): read in the code (CheckoutForm.tsx:320, PaymentReturn.tsx:116), no test.
- Focus: no assertion that focus moves into the order box after create, cancel or retry, nor where it is after «تحديث».
- A return page whose `?order=` names another order than the one the tab stores: covered by the `returnOrder` unit tests only; no e2e asserts the request body carries no token.
- The sandbox code on `create` and `pay` bodies: unit tests only; the e2e checks the quote. The hosted fence itself (isHostedSite and test mode) cannot run locally.
- PAYMENTS_NOT_CONFIGURED in the settings form and a failed `status` call («تعذّر قراءة حالة الدفع.»): not exercised; the local function environment is fixed.
- `getPublishedPolicies` has no unit test (the unit config has no `@/` alias); the build and the e2e cover it. The contract's matrix names tests/unit/policies.test.ts; the comparison tests are in tests/unit/store-checkout.test.ts as the allowlist says.
- Cloudflare Pages joins a header set by two matching rules with a comma, so /checkout/return is served `Referrer-Policy: strict-origin-when-cross-origin, no-referrer`. The last valid token wins by the Referrer Policy parsing rule, so `no-referrer` applies; this is a hosted check and was not run.
- A device clock ahead of the server (finding R4B-09).
- Public JS budget: checkout.html is 149.2 of 150.0 KiB; round 10's preorder notes on the checkout have 0.8 KiB left.
- tests/e2e/owner-operations.spec.ts shares the settings page and was not run by the worker or by this audit.


## The orchestrator's rulings and own audit (2026-10-02)

The workflow ended `needs_orchestrator` after one build and one audit: one medium and eight low findings, each needing a ruling or a file outside the worker's list, so no fix pass ran. I read every changed file (`CheckoutForm.tsx`, `PaymentReturn.tsx`, `quote.ts`, `cart.ts`, `policies.ts`, `CartProvider.tsx`, the two pages, `CommerceSettingsForm.tsx`, `_headers`, `check-export.mjs`) for the token, the sandbox code and the money path, and looked at the hold view, the return page and the settings form at 360 and 1440.

| Finding | Ruling |
|---|---|
| R4B-01 (medium: the hold view said «وصلتنا دفعة هذا الطلب.» for an order whose payment mode had changed, where no payment exists) | Fixed. `startPayment` now passes the ledger's `reason` in the closed payload. The view says a payment arrived only for a settled status or `UNDER_REVIEW`; a hold that ran out ends the view; anything else (`MODE_CHANGED`, `TOO_MANY_ATTEMPTS`, `TOTAL_BELOW_MINIMUM`) claims no payment, says the payment could not be prepared and keeps «إلغاء الطلب», because the order still holds its stock and its session. That also removes the dead end the auditor listed under "uncovered" (too many attempts: the view ended, the token was dropped, and the same email was handed the same order back until the hold ran out). E2E test added for both reasons against the real function. |
| R4B-02 («تحديث» left the page while its own request ran, so focus was lost) | Fixed: the button stays mounted and is `aria-disabled` while it asks. The test asserts it keeps the focus. |
| R4B-03 (a cancel answered NOT_FOUND kept the view and the stored order) | Fixed: one `forgetOrder` for `pay` and `cancel`. Test added. |
| R4B-04 (the visible `‎` escape replaced by an invisible character) | Restored. |
| R4B-05 (the cart-link assertion ran on a page with no cart link) | Fixed: the test opens `/store` and reads the link there. |
| R4B-06 (the teardown deleted every payment event since the spec started) | Fixed: only the events of the spec's own payments. |
| R4B-07 (the `#test=` fragment was read only on the cart and checkout pages) | Fixed: `CartLink`, which the store and product pages mount, reads it too. The contract says which components read it. |
| R4B-08 (the policy loader is memoized per render, not per build) | Accepted; the contract's wording is corrected. A build-wide cache would outlive the build and serve stale policies. The form's comparison and `POLICY_CHANGED` bound the case of a publish in the middle of a build. |
| R4B-09 (the hold timer trusted the device's clock: a clock 20 minutes ahead ended the view at once and the buyer could never reach «ادفع الآن») | Fixed without a server change: when the time passes the view calls `pay` and the function decides. A clock that runs ahead costs one request and ends nothing. The timer test now fires the timer twice: once while the function still holds the order (the view stays), once after the hold is over there (the view ends). |

The worker's stated choices are accepted: the return page clears the cart, the stored order and the key only in the tab that holds that order (a number in the address is no reason to empty anyone's cart); the copy of the two links («عرض الطلب», «استعادة رابط الطلب»); the pure helpers live in `src/lib/cart.ts` because the unit config has no `@/` alias.

Design, by the orchestrator: the paid sentence on the return page carries the order number's weight (it is the page's one statement); the test-mode note sits after the actions on the hold view, as on the return page; the «الشراء» box in the settings form says what the switch does («يتحكم المفتاح في استقبال الطلبات الجديدة فقط؛ الطلبات القائمة تُدفع وتُلغى كما هي.»). Money pages stay calm: the title's fade only, no countdown, no reveal.

Checks on the final tree, the edge runtime restarted: `pnpm test` 0 (54 files, 1414 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; `checkout-http` and `payment-http` against the real functions 60/60; `playwright test cart-checkout store-admin checkout-api` 49 passed, then `cart-checkout store-admin` 45 passed after the design edits; `pnpm build` 0, `pnpm check:export` 0 (52 required files), `pnpm check:budgets` 0.

Left open, recorded:

- The public JavaScript budget: `checkout.html` is 149.3 of 150 KiB. Round 10 adds the preorder notes to the checkout; the hold view will have to load on demand (or the budget question goes to P10) before that fits.
- `/orders` does not exist until round 10: «عرض الطلب» and «استعادة رابط الطلب» lead to the 404 page until then.
- The contract's wording for `OUT_OF_STOCK` with `held: true` («الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.») is not shown yet; round 10 owns the cart and checkout notes.
- For checkpoint (c): no browser test of a duplicate `create` after a lost reply; cancel answering `review`, `paid_needs_resolution` or `refunded`; timers cleared on unmount (read in the code); `PAYMENTS_NOT_CONFIGURED` in the settings form; the hosted fence itself; Cloudflare Pages joining `Referrer-Policy` values on `/checkout/return` (the last valid token, `no-referrer`, applies; a hosted check).
