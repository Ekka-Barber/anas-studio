# RESIDUALS-1, round R4a: the record

Started under the owner's word of 2026-10-16 ("go ahead in a new session fixing all issues then do what next in our
plan"), after R3b was committed and pushed. Orchestrator Claude Opus 5.5 at effort max, on the owner's machine. The lock
moved from R3b to R4a on 2026-10-16 (base `01ff7ca`), with R4a's 20 exact paths; added later, with the reason in the
lock: `PLANS/DECISIONS.md` (D51 and D52, folded while the round ran), `PLANS/P12-CONTRACT.md` and
`artifacts/acceptance/P12/` (the projects board's contract and design, drafted while the round's e2e ran; they are
committed with P12's records once the contract's audit is settled, not here). Committed under
the same word: the code first, these records in the commit after it, by explicit path; the branch pushed for CI; the
lock kept for P12, which the owner put next (D52).

## Scope

R4 is split in three (`SCOPE.md`, 2026-10-16); R4a is the store: STORE-UI-03, -08, -09, -10, -11, -13, -16, -18;
QUALITY-06, -07; FD-B-01's residual (ISSUES I55 (8)) with I50 (2); TEST-UNIT-07. The decided fixes are in `brief-R4a.md`
(13 items).

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 48 minutes, 202 tool calls: all 13 items in 17 changed files
and one new (`src/components/store/CheckoutBody.tsx`). Item 1 first: `CheckoutForm.tsx` became a shell that loads the
form's body on demand, and `checkout.html`'s first script fell from 153,337 to 144,988 gzip bytes before the other items
(145,112 after them). Its choices, ruled below: (a) the return page says «بانتظار الدفع.» once the schedule is done only
after an answer said pending; (b) `clearOrderAccess` goes through `removeSessionValue` too, and with storage blocked the
tab now also keeps the dedications, the test-mode code, the order page's link and the notification links in memory; (c)
the schedule's ticks skip while any request of the view runs (a `requesting` ref) and clear a focus flag a failed
request of the buyer's left; (d) the e2e stub a Turnstile widget with the dummy token. Its checks: lint, typecheck,
copy, frozen 0; unit 71 files, 2,760 passed and 39 skipped; build, export and budgets green; mutations for items 6, 11
and 13 in the unit tests, each caught; a browser harness of its own over the built `out/` with every function mocked
(13 scenarios, items 2 to 5, 7, 8, 9 and 12, twice), where removing the schedule failed item 5's three and not reading
`unseen` failed item 7's corrected press. The e2e did not run (7.4 GB free).

## 2. The audit and the fixes

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R4a.md`), 28 minutes: **audit_failed**, on one major
finding, four minor and two nits. Its rulings on the writer's choices: (a) accepted, with a residual it named (below);
(b) accepted, both (routing `clearOrderAccess` through the same layer is required, or a forgotten link would come back
from memory); (c) accepted, with findings 2 and 3 standing. It confirmed: the scope (every path on the lock's list); the
moved body unchanged but for the items' lines; the static pages (no loading line in `cart.html`, `checkout.html` and
`checkout/return.html`; headings, landmarks and `noscript` intact; the checkout's boundary renders the shell's own empty
status, so nothing flashes); no body code in the checkout's first script; FD-B-01's paths across a reload (an old record
reads with no `unseen`, and the key's end clears it); every caller of `keyed` keeping its required keys and types.

| Finding | Severity | Ruling | Done by the orchestrator |
|---|---|---|---|
| 1: a notification page took any fragment as its token: the layout's skip link (`#main`, the first Tab stop) replaced the link's token in the page and in the tab, and a press sent `main` and read «الرابط غير صالح…» | major | Accepted | `takeNotifyFragment` (`src/lib/orders.ts`) takes and keeps only a fragment shaped as the function's token; any other is left in the address and changes nothing; a unit test, and an e2e that activates the skip link then presses |
| 2: a scheduled answer could remove the focused control («أعد المحاولة» once the payment is ready, a closed order's branch), dropping the focus to the page | minor | Accepted | a scheduled answer that removed the control the buyer was on gives the focus to the order box; an e2e |
| 3: each scheduled ask ran the pressed retry's busy cycle (both buttons `aria-disabled` while it ran) and wiped any alert on screen | minor | Accepted | scheduled asks (the ticks, the hold's end) are quiet: no busy state and nothing cleared before their answer; the newest `pay` answers for the view (a run counter), and a later scheduled answer clears only a failure a scheduled ask put there |
| 4: the body's lazy import had no catch: a failed chunk landed in the error page, whose retry `lazy` cannot repeat | minor | Accepted | the shell falls back to the hold view's own «تعذّر تحميل الطلب؛ حدّث الصفحة.» (`role="alert"`) |
| 5: the stored order's 429 case followed a 503, so it would pass with the view's first state back at «نجهّز صفحة الدفع…» | minor | Accepted | an e2e whose first `pay` answers 429 |
| 6: a comment called the hold view's fallback the cart's loading sentence | nit | Accepted | reworded |
| 7: `docs/operations.md` listed five of the values kept in memory | nit | Accepted | every value the tab keeps |
| Residual of (a): after a throttle stopped the first ask, «جارٍ التحقق من الدفع…» stayed though nothing was asked | — | Accepted | once nothing is asked and no answer was read, the line is empty (the alert beside it says why) |
| Adjacent: a press still in flight when a second notification link opened could end the new link's page and clear its token | — | Accepted | an answer for a link the page no longer stands on is dropped, and the last word clears only the token it answered (a unit test) |

What no test covers, recorded: a press made during a scheduled ask (the run counter decides) and an alert a scheduled
answer leaves in place; the hold's end timer meeting a tick; a failed body chunk (the fallback is drawn from the hold
view's tested pattern); hydration when the cart is ready before the body chunk arrives (the markup is the same); the
cart, checkout, cart, checkout journey with storage blocked (item 6 is unit tested).

## 3. Checks on the final tree

- lint, typecheck, copy, frozen 0; unit 71 files, 2,762 passed and 39 skipped.
- `pnpm build`, `pnpm check:export`, `pnpm check:budgets` 0: `checkout.html` 142.4 KiB (was 149.7), `cart.html` 147.2,
  `orders.html` 148.6 (now the largest, 1.4 KiB left); none of the three loading lines in the static pages.
- E2E, one file at a time with a fresh dev server each (7.4 to 8.6 GB free, under the 10 GB rule, so each file ran
  alone), on the final tree: `no-js.spec.ts` 21 of 21; `product-availability.spec.ts` 46 of 46; `orders.spec.ts` (the
  journeys, which the audit asked for: its verify watcher has a shorter window now that the static page carries no
  loading line) 20 of 20; `order-page.spec.ts` 104 of 106 and `cart-checkout.spec.ts` 44 of 46. The four failures were
  stale tests, not defects. `order-page.spec.ts`'s "a reply that does not fit" fed a reply whose only fault was an added
  key, which QUALITY-07 now ignores by design; its first reply is now one missing a required key. The two hold-end tests
  of `cart-checkout.spec.ts` still asserted HOLD_EXPIRED for an order whose invoice could still be paid, which R2a
  (P08-CKPT-04) changed on purpose and whose e2e never ran this file; both now expire the invoice too. Rerun alone, the
  four passed: 239 of 239 across the five files.
- `pnpm test:db` not run: nothing under `supabase/` changed.
