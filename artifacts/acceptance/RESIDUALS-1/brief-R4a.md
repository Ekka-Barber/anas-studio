# RESIDUALS-1, round R4a: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R4a, branch `agent/residuals-1` with R1,
R2a, R2b, R3a and R3b committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase
CLI 2.106.0, Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no Deno. The
package's rounds: `SCOPE.md` (R4 is split in three: R4a the store, R4b the public site, the reader and the scripts, R4c
the tests); how the earlier rounds ended: `RECORD-R1.md` to `RECORD-R3b.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `PLANS/DESIGN-AUDIT.md` (every item that
applies to a store control you change), `PLANS/P08-CONTRACT.md` section 10 (`/checkout`, `/checkout/return`, `/orders`,
`/notify/*`), and each entry's block by its id: STORE-UI-03, -08, -09, -10, -11, -13, -16, -18, QUALITY-06 and -07 in
`artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md`; TEST-UNIT-07 in `work/waveB/digest.md`; FD-B-01 in
`artifacts/acceptance/FABLE-AUDIT/cloud/DEEP-AUDIT.md` with its residual in `PLANS/ISSUES.md` I55 (8); I50 (2) in
`PLANS/ISSUES.md`. Where this brief decides otherwise, it wins.

## Write only these paths

- `src/components/store/CheckoutForm.tsx` and the new `src/components/store/CheckoutBody.tsx` (item 1),
  `CartView.tsx`, `HoldView.tsx`, `PaymentReturn.tsx`, `NotifyAction.tsx`, `VariantAction.tsx`
- `src/lib/cart.ts`, `src/lib/orders.ts`
- tests: `tests/unit/cart.test.ts`, `store-checkout.test.ts`, `store-availability.test.ts`, `orders-page.test.ts`,
  `checkout.test.ts` (only a comment or a source path item 1 moves); `tests/e2e/no-js.spec.ts`, `cart-checkout.spec.ts`,
  `order-page.spec.ts`, `product-availability.spec.ts` and `orders.spec.ts` (the last two only where a changed word or
  state makes a line stale)
- `docs/operations.md` (the store's checkout paragraph, for items 6, 7 and 12)

Any other path: stop and report.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, except its SQL rule (this round changes no
SQL and no Edge Function), with these additions: Arabic copy exactly as given here; the store's money pages stay calm
(D38: no new motion, nothing counting on screen); a new sentence that reports a state is announced as the page's
existing ones are (`role="status"` for a state, `role="alert"` for a failure) and is mounted only while shown, unless
the item says otherwise; the public JavaScript budget (`pnpm check:budgets`) passes at the end. The local outbox's daily
allowance may be spent: as in `brief-R2b.md`. Work in the order below: item 1 first, since it makes the room the others
need. If your run is cut short, your last message says what is built, what ran, and what is left.

## The items

1. **I50 (2), the checkout's room.** `checkout.html`'s first script is at 149.75 of its 150 KiB budget (254 bytes left)
   and this round adds to the checkout. Decided: the checkout form's body loads on demand. Move today's `CheckoutForm`
   component with its helpers, constants and imports, unchanged, into the new `CheckoutBody.tsx` (exporting
   `CheckoutBody`). `CheckoutForm.tsx` keeps the name and the props the page uses and becomes a `'use client'` shell:
   `const CheckoutBody = lazy(() => import('./CheckoutBody').then((m) => ({ default: m.CheckoutBody })))`, rendered inside
   `<Suspense fallback={<p role="status" className="visually-hidden" />}>` (item 2's empty status), props passed through.
   The long module comment moves with the body; the shell's comment says why it exists (I50 (2)). The hold view's own
   `lazy` import stays in the body. Proof: `pnpm build` and `pnpm check:budgets` before and after (the checkout page's
   figure, both, in the report), and the e2e of items 2 to 9.
2. **STORE-UI-03, no static loading line.** Decided: no static page carries a loading line that only script ends
   (P08 round 10a's rule R10A-5, now for the return page, the cart and the checkout). `PaymentReturn` keeps its
   `role="status"` paragraph empty while the address is not read (`target === undefined`); «جارٍ التحقق من الدفع…» only
   once the order is known. `CartView` and the checkout body render, while the cart is not read (`cartState === null ||
   !cartState.ready`), an empty `<p role="status" className="visually-hidden" />` instead of «جارٍ تحميل السلة…» and
   «جارٍ تحميل الطلب…» (OrderPage's way). The hold view's Suspense fallback «جارٍ تحميل الطلب…» stays: it shows only
   with script. Proof: `no-js.spec.ts`'s loading-line check (today `/orders` and `/notify/*`) also covers `/cart`,
   `/checkout` and `/checkout/return?order=K7M2P9QX`: none of the three lines is on the page without JavaScript, and the
   noscript sentences still show.
3. **STORE-UI-13, the return page after its schedule.** Decided: once the schedule has run out, or a throttle stopped
   it (`done`), with the state still `pending`, the status line says «بانتظار الدفع.» (the order page's sentence for
   the same state) instead of «جارٍ التحقق من الدفع…»; «متابعة الدفع» and «تحديث» stay, and a press of «تحديث» leaves the
   sentence until an answer changes the state. Proof: an e2e test (the spec that drives the return page's schedule today)
   with `verify` answering `pending` and Playwright's clock run through 30 s: «بانتظار الدفع.», «تحديث», and no «جارٍ
   التحقق من الدفع…».
4. **STORE-UI-08, the hold view before it knows the payment.** Decided: a view opened with no `create` reply (from
   storage, or by ACTIVE_HOLD) starts with a payment it does not know: `WAITING`'s payment is a view-only state
   `{ state: 'unknown' }` (the view's own type: `LivePayment | { state: 'unknown' }`; the function never sends it), which
   draws no sentence and keeps «أعد المحاولة» and «إلغاء الطلب». A failed `pay` (throttle, network, unreadable reply)
   then shows only its own failure. `CHECKOUT_DISABLED` sets that same state and says only «الشراء غير متاح حاليًا،
   ويفتح قريبًا.», never with «تعذّر تجهيز الدفع؛ حاول بعد لحظات.» beside it. Proof: `store-checkout.test.ts` renders the
   view with `start: null`: no «نجهّز صفحة الدفع…»; `cart-checkout.spec.ts`: a stored order whose `pay` answers 429 shows
   «أرسلت طلبات كثيرة؛ حاول لاحقًا.» without «نجهّز صفحة الدفع…», and one answered 503 `CHECKOUT_DISABLED` the
   store-closed sentence alone.
5. **STORE-UI-09, «نجهّز صفحة الدفع…» moves on by itself.** Decided: while the shown payment is `preparing` and the
   order is open (`closed === null`), the view asks `pay` again 5, 15, 45 and 75 seconds after «نجهّز صفحة الدفع…» first
   showed (`PAY_SCHEDULE_SECONDS`, in `HoldView.tsx`, which loads on demand), skipping a tick while a request of the
   view runs, and stops as soon as the payment is no longer `preparing`, the order closes or the view goes; after the
   last tick only «أعد المحاولة» asks again. A scheduled ask moves no focus (only the buyer's own action does); a tick
   that answers `preparing` again changes nothing on screen; a failed tick shows its failure as a pressed retry's does.
   Proof: `cart-checkout.spec.ts` with Playwright's clock: `create` answering `payment: {state: 'preparing'}` and `pay`
   counted: no `pay` before 5 s, one at 5 s; when `pay` answers `ready`, «ادفع الآن» shows without a press; when it
   answers `preparing` every time, exactly four scheduled calls by 80 s and none after. A mutation (no schedule) fails it.
6. **STORE-UI-16, the tab's session values when storage is blocked.** Decided: they survive a client navigation, as
   the cart does (`memoryCart`). In `cart.ts` the session layer (`readSessionValue`, `writeSessionValue`, and a new
   `removeSessionValue` that `clearPendingOrder` and `clearIdempotency` use) keeps a module-level `Map` that overrides
   storage: a write that cannot reach sessionStorage (none, or it throws) is kept in the map; a write that reaches it
   drops the key from the map; a removal removes from storage and from the map, and keeps `null` in the map when the
   removal throws; a read returns the map's value when the map holds the key, else storage's. The checkout session, the
   pending order, the key, the city and the coupon then survive leaving the checkout for the cart and coming back in
   the tab (a reload with storage blocked still loses them). `docs/operations.md` says so in one sentence. Proof:
   `cart.test.ts` with a sessionStorage whose `getItem`, `setItem` and `removeItem` throw: `checkoutSession()` twice
   gives one id; `writePendingOrder` then `readPendingOrder` gives it back, and `clearPendingOrder` then null; the key
   the same; with a working storage nothing stays in the map. A mutation (the read ignores the map) fails it.
7. **FD-B-01's residual, a lost reply across a reload** (ISSUES I55 (8)). Decided: the request whose reply was lost
   (`unseenRequest`) is kept with the key, so a reload keeps it as it keeps the retry. The idempotency record becomes
   `{digest, key, unseen?}` (`unseen`: that request's 16-hex digest, absent when none); `readIdempotency()` also returns
   `unseen: string | null` (anything but 16 hex digits reads as null, and a record without it as null: a record stored
   before this round reads as it did); the body writes the record again whenever `unseenRef` changes (after a reply,
   after a network failure) and reads `unseen` back on mount; `endKey` clears it with the key, as today.
   `docs/operations.md`'s sentence on `anasaq:idempotency` names it (a digest, no buyer data). Proof: `cart.test.ts`
   (the round trip; an unreadable or missing `unseen` is null; an old record still gives its key); the
   `cart-checkout.spec.ts` journey of FABLE-AUDIT's FV-02 (a lost `create` reply made by `route.fetch()` then
   `route.abort('failed')`) gains a reload between the lost reply and the corrected press: the hold view still says
   «هذا الطلب أُنشئ قبل تعديلك؛ ادفعه كما هو أو ألغه لتطلب من جديد.», and the same request again after a reload does
   not. A mutation (the mount does not read `unseen`) fails it.
8. **STORE-UI-11, a pasted control character in the name.** Decided: the name field folds control characters to
   spaces as the buyer types or pastes: one exported `foldControls(text)` in `cart.ts` (`text.replace(/\p{Cc}/gu, ' ')`),
   used by `setDedication` (its existing replace) and by the name's `onChange`. A pasted «أنس», TAB, «القرني» shows and
   is sent as «أنس القرني». The function's own refusal can no longer be reached from the form, so its mapping stays.
   Proof: `cart.test.ts` for `foldControls` (TAB, LF, CR, U+007F and U+0085 become spaces; Arabic letters and U+200C
   stay); `cart-checkout.spec.ts`: a name typed with a TAB reaches `create` without it (the body read in the route).
9. **STORE-UI-18, a press that waits for Turnstile.** Decided: a press made before the widget has a token keeps the
   label «تأكيد الطلب» («جارٍ الإرسال…» only while `create` is being sent); the button stays `aria-disabled` while it
   waits; and a `role="status"` line under the widget's box, mounted only while the press waits, says «أكمل التحقق
   أعلاه ليُرسل الطلب.». The form still sends itself when the token arrives. Proof: `cart-checkout.spec.ts` with a
   widget that never answers (stub Turnstile's script the way an existing spec does: grep `challenges.cloudflare.com`
   under `tests/e2e/`): after the press, the label «تأكيد الطلب», the sentence, and no `create` request.
10. **QUALITY-06, the manual quote refresh.** Decided: `refreshQuote`'s catch sets the failure only for the newest run:
    `catch { if (quoteRun.current === run) setQuoteFailed(true) }`, as the debounced effect does. Proof: the checks only
    (one guard); say so.
11. **QUALITY-07, the order page and an added key.** Decided: the buyer's order page reads the keys it uses and ignores
    any other, as the admin's parsers do. `orders.ts`'s `exact()` keeps "every required key is there" and drops "no
    other key"; rename it `keyed`, its comment saying so; its `optional` parameter goes (the payment's `invoiceUrl` is
    read as today: optional). Every caller keeps its required keys and its type checks. Proof: `orders-page.test.ts`: the
    cases that pinned the refusal of an unknown key (`'with an unknown key'`, and "the small replies, by their exact
    shape") now pin that it is ignored and the reply still reads; a missing required key and a wrong type still refuse,
    at every level. A mutation (the "no other key" check back) fails them.
12. **STORE-UI-10, a notification link after a reload.** Decided: the token is kept in this tab's sessionStorage until
    the page's last word, as `/orders` keeps its pair: when the page takes the token from the address (on mount, or on a
    fragment navigation) it writes it under `anasaq:notify:<kind>` (`confirm` or `unsubscribe`); on mount, an address
    with no fragment reads it from there; a final answer (`done`: the success, or a dead link) removes it. Storage that
    throws keeps today's behaviour (memory only). «الرابط غير مكتمل.» stays for a page with no token in the address and
    none kept. The helpers live in `src/lib/orders.ts` beside `readOrderAccess` (`readNotifyToken`, `keepNotifyToken`,
    `clearNotifyToken`); the token is the fragment, as today. The module comment says so. Proof: `orders-page.test.ts`
    for the helpers (the round trip, cleared, a throwing storage); `order-page.spec.ts`: `/notify/unsubscribe#<token>`,
    a press answered 429 («حاول بعد قليل.»), a reload: the prompt and the button again, not «الرابط غير مكتمل.»; a press
    answered ok: «أُلغي الاشتراك.»; a reload then says «الرابط غير مكتمل.».
13. **TEST-UNIT-07, the preorder date in the buyer's browser.** Decided: `preorderCurrent` compares with
    `riyadhToday(now.getTime())` from `supabase/functions/_shared/riyadh-day.ts` (R3b's one definition, imported by a
    relative path as `src/lib/admin-commerce.ts` does), with no locale data. Proof: `store-availability.test.ts` keeps its
    cases and adds one with `Intl.DateTimeFormat` stubbed to format '10/4/2026': the answer is unchanged. A mutation
    (back to `en-CA`) fails it.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. the mutations items 5, 6, 7, 11 and 13 name (revert the change, run its test, see it fail, restore, run it again);
3. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/no-js.spec.ts tests/e2e/cart-checkout.spec.ts tests/e2e/order-page.spec.ts
   tests/e2e/product-availability.spec.ts` (Playwright on `http://localhost:3000`; restore `next-env.d.ts`
   afterwards); otherwise say so and list the e2e tests you changed;
4. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the checkout, cart and orders pages' figures).

No `pnpm test:db`: nothing under `supabase/` changes.

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, anything not done and why, and the
risks left. Do not accept your own work.
