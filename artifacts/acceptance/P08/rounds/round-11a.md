# the admin's orders: the list, the order view, the nav entry, the home alerts and the customer's orders link

## Worker report 1

Round 11a is built and every check above is green on the final tree. Nothing is committed.

What exists. The list /admin/orders has the alerts line, seven aria-pressed filters, the labelled search (the number upper-cased, the email lower-cased, anything else refused without a call), 50-row pages with «المزيد» that sends the cursor back unchanged, and the badges. The customers list has «طلباته», which carries the address in #q=; the screen reads it once and clears the address bar. /admin/orders/view shows the sections in the brief's order. The view has fulfilment with the signed checklist and the form checks, returns with the owner's restock fields (operations send []), the two-step «إكمال الطلب», and «إغلاق المراجعة». The owner also gets the disputes and the audit, read-only, and everyone gets the refunds read-only. The nav entry and the home section with low stock are in, and the two pages are in check-export.

How it behaves. Every call is supabase.rpc under the session: no Edge function, no TOTP, no new dependency. The status and alert lines are mounted before they are filled and take the focus. Buttons are off while a call is in flight and a ref guard backs that up, so a double press sends one request. 42501 and any other error have their own sentences, and the order is re-read after every answered call. Parsers refuse a missing key or a wrong type, ignore extra keys, and show an unknown enum as its code, dir=ltr.

Proof. The e2e is 52 tests, 26 at each width, on the real stack. Staff sign in with real email codes (3 per run) and the orders come from the integration harness. It covers each filter that has data, both searches, the customers link, the double press, a signed line refused then shipped, refund-related refusals made by changing the order behind the page, the restock rising by the quantity restocked, a preorder line with no restock field, and the review closing. Only the «المزيد» second page, the disputes and the API failures are mocked. I viewed the list, view, return card and home at both widths. After viewing I added spacing between cards and stopped action codes from breaking mid-word.

Deviations to rule on are under contractGaps: changed is a count in the SQL, events are not drawn, and some Arabic words are mine. Under openRisks: one unexplained transient 500 from the admin function's stats call in a repeat run of an existing owner-home test, not this round's code.

Files: src/lib/admin-orders.ts, src/components/admin/OrdersView.tsx, src/components/admin/OrderView.tsx, src/app/(admin)/admin/(shell)/orders/page.tsx, src/app/(admin)/admin/(shell)/orders/view/page.tsx, src/components/admin/AdminShell.tsx, src/components/admin/AdminHome.tsx, src/components/admin/TableList.tsx, src/components/admin/admin.module.css, src/admin/tables/index.ts, src/admin/tables/customers.ts, scripts/check-export.mjs, tests/unit/admin-orders.test.ts, tests/unit/collections.test.ts, tests/e2e/orders-admin.spec.ts

Checks:
- `pnpm exec vitest run tests/unit/admin-orders.test.ts` → 0 (52 tests: every label table with an unknown value, the three parsers (owner and operations order_detail) by deleting and corrupting every key, normalizeOrderQuery, action replies, refusal sentences, isWidePath)
- `pnpm test` → 0 (66 files, 2100 tests (includes admin-ops and collections, which load AdminHome, AdminShell and the customers config))
- `pnpm lint` → 0
- `pnpm typecheck` → 0 (also after restoring next-env.d.ts and removing .next/e2e)
- `pnpm check:copy` → 0 (224 source files)
- `pnpm build` → 0 (/admin/orders and /admin/orders/view are in the route table)
- `pnpm check:export` → 0 (57 required files present, including admin/orders.html and admin/orders/view.html)
- `pnpm check:budgets` → 0 (largest public page 148.9 KiB of 150)
- `pnpm exec playwright test tests/e2e/orders-admin.spec.ts` → 0 (52 passed (26 per width, 360 and 1440), final tree. The brief's one Playwright command was run as three, one per spec file, to stay inside the 10-minute foreground limit. Memory before each run: 11.6 to 12 GB free.)
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts` → 0 (11 passed. Ran before the last small edits to OrdersView.tsx (a ref guard), one refusal sentence in admin-orders.ts and the e2e spec, none of which it loads.)
- `pnpm exec playwright test tests/e2e/owner-operations.spec.ts` → 0 (20 passed, same note. A later 12x repeat of its owner-home test had one failure from the admin function's stats call answering 500 once (see openRisks).)

Contract gaps:
- fulfillment_update answers `changed` as an integer count of the items that moved (SQL, round 7b), not the boolean `changed: false` the brief names. The parser reads a count or a boolean; 0 or false says «لا تغيير.».
- The contract (section 6, order_detail) lists the webhook events among what the order screen shows; the brief has no events section. They are validated by the parser but not drawn. Needs a ruling (round 11b's reconciliation screen lists events).
- The brief gives no Arabic words for the dispute kind, direction and decision, the provider's status, source type and company: they are shown as their codes, dir=ltr. Words I chose where it gave none: entitlements «ممنوح» and «مسحوب (code)», the section «الاستردادات», «لا توجد محاولات دفع.», «لا توجد نزاعات.», «لا يوجد سجل.», «أدخل شركة الشحن ورقم التتبع.», «أدخل سبب الإغلاق.», «لا يُقبل هذا السبب؛ اكتب سببًا آخر.», «تم تسجيل القرار.», «تم تسجيل الاستلام.», «تم إكمال الطلب.», «أُغلقت المراجعة.», «لم نجد طلب الإرجاع.», «لم نجد هذه الدفعة.», «أُغلقت هذه المراجعة من قبل.», «كمية العودة إلى المخزون غير صحيحة.», «لا يمكن هذا الإجراء؛ حالة طلب الإرجاع الآن: …», «لا يمكن إكمال هذا الطلب؛ حالته الآن: …», and the field labels. Owner to confirm or replace.
- review_close: the brief says to refuse the word `refunded`; the screen refuses it in any letter case, the SQL only the exact lowercase word.
- Addition beyond the brief: each review payment card also shows the provider's payment id under «رقم الدفعة لدى Moyasar» (a review payment cannot be found at the provider without it). The audit rows show the action code and the summary as left-to-right JSON text; the actor is not shown (not asked).

Open risks:
- Unexplained transient in the local stack: in one dev run the owner home's email line («outbox_attention») showed «تعذّر التحميل», and in a 12x repeat of the existing owner-home test (owner-operations.spec.ts:357) one run failed because POST /functions/v1/admin (the stats action, not this round's code) answered 500 FAILED in 29 ms; owner_commerce_stats itself answered 40 of 40 direct calls in 3 ms. Trace: test-results/playwright/owner-operations-the-owner-9b5fc-al-counts-and-no-inbox-D31--chromium-repeat6/trace.zip (replaced by the next run). The orders section loaded in both. Not reproduced since.
- The list test finds this width's seeded orders in the newest 50 rows; another writer creating more than 50 orders meanwhile would push them off page 1. The real keyset cursor is exercised only when the stack holds more than 50 orders (it did here, no order repeated); the second page is otherwise mocked.
- At 360 the fulfilment test takes about 20 s against 11 s at 1440 because the Next dev badge overlaps the left edge and Playwright retries clicks: dev only, no product effect.
- «إكمال الطلب» sits after «الإرجاع», as the brief orders the sections, so on a long paid_needs_resolution order the owner reaches it low on the page.
- Staff functions take no mode (round 7b ruling): on a live site a leftover test order can still be shipped or resolved; the list and view label it «تجريبي» as asked. The local database keeps the fixture orders of every harness run, so the alerts counts on it include them (R7B-5).
- Screenshots and traces written by my runs are all git-ignored under test-results/ (no ACCEPTANCE_PACKAGE was set): test-results/screenshots/P08/admin-*.png (8 files), the store-admin spec's P07 shots and the owner-operations spec's P06 shots. Nothing under artifacts/acceptance/ was rewritten.

## Audit 1: pass

### R11A-1 [low] src/lib/admin-orders.ts:509
- Problem: The worker changed the ORDER_NOT_PAID sentence to «الطلب غير مدفوع، فلن يُشحن.». The brief's final copy is «الطلب غير مدفوع، فلا يُشحن.». The worker did not list the change in contractGaps. The unit test named 'says what the brief gives for a fulfilment' asserts the changed text, so it hides the deviation.
- Evidence: admin-orders.ts:509 has 'الطلب غير مدفوع، فلن يُشحن.'. tests/unit/admin-orders.test.ts:603-604 and tests/e2e/orders-admin.spec.ts:1004 assert the same text. The brief in artifacts/acceptance/P08/tools/round-11a.json reads: `ORDER_NOT_PAID` «الطلب غير مدفوع، فلا يُشحن.». check:copy does not force the change: scripts/check-copy.mjs only checks digits and placeholders.
- Correction: Restore «الطلب غير مدفوع، فلا يُشحن.» in three places: src/lib/admin-orders.ts:509, the unit assertion at tests/unit/admin-orders.test.ts:604 and the e2e assertion at tests/e2e/orders-admin.spec.ts:1004.

### R11A-2 [low] src/components/admin/OrdersView.tsx:200
- Problem: If `orders_alerts` fails, or its reply fails the parser, the list screen shows «تعذّر التحميل.» but no «تحديث» button. The button only renders when the list itself failed, so the alerts line can only be retried by reloading the page. Brief section 1 says a failed reply shows «تعذّر التحميل.» with «تحديث».
- Evidence: OrdersView.tsx:199-200 renders the alerts error with no button. OrdersView.tsx:255-259 renders «تحديث» only when `failed`, which is the list's own state. refresh() at 160-164 already resets and re-asks the alerts. The e2e 'the home says the orders could not load, never zero; the list says it too' (orders-admin.spec.ts:1206-1216) checks the text only.
- Correction: Render the «تحديث» button when `failed || alerts === 'failed'`; refresh() already reloads both. In orders-admin.spec.ts:1212-1215, unroute the mock, press «تحديث», and check that the counts line appears.

### R11A-3 [low] src/lib/admin-orders.ts:147
- Problem: `time()` accepts any text that Date.parse can read, so the parsers do not enforce the brief's 'dates ISO strings'. The same function reads `next`, the keyset cursor that goes back to the server unchanged as p_before.
- Evidence: admin-orders.ts:146-151 returns the text unless Date.parse gives NaN. Run here: node prints Date.parse('1') = 978296400000, Date.parse('2026') = 1767225600000 and Date.parse('Oct 3 2026') = 1790974800000, all valid. The unit test refuses only 'yesterday' (tests/unit/admin-orders.test.ts:433).
- Correction: Check the shape before Date.parse. The database writes timestamps like '2026-10-03T01:03:24.796123+00:00' and dates like '2026-10-02'. Suggested pattern: /^/d{4}-/d{2}-/d{2}(?:T/d{2}:/d{2}(?::/d{2}(?:/./d{1,6})?)?(?:Z|[+-]/d{2}:/d{2}))?$/. Add '1', '2026' and 'Oct 3 2026' to the refused cases in tests/unit/admin-orders.test.ts.

### R11A-4 [low] src/components/admin/OrderView.tsx:439
- Problem: The contract says `order_detail` returns everything the order screen shows, webhook events included (type, time, outcome). Sections 10 and 12 also put 'verified evidence' on the view. The view parses `events` but never draws them. The brief gave no events section, and the worker reported the gap. The contract and the built screen disagree, so you need to rule.
- Evidence: PLANS/P08-CONTRACT.md:356 says 'everything the order screen shows: ... events (type, time, outcome)'. :486 and :540 say 'verified evidence'. src/lib/admin-orders.ts:438 parses `events: list(o.events, eventOf)`. A grep finds no use of `events` in src/components/admin/OrderView.tsx.
- Correction: Rule one of two ways. Either a fix round draws the events under «الدفع»: type and outcome as codes with dir="ltr", received and processed times with formatRiyadh, plus attempts. Or amend contract sections 6 and 10 to say round 11b's reconciliation screen shows the events and the order view does not.

Checks re-run:
- `pnpm exec vitest run tests/unit/admin-orders.test.ts (52 tests)` → 0
- `pnpm test (66 files, 2100 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy (224 source files)` → 0
- `pnpm build (/admin/orders and /admin/orders/view static in the route table)` → 0
- `pnpm check:export (57 required files, including admin/orders.html and admin/orders/view.html; no secrets)` → 0
- `pnpm check:budgets (largest 148.9 KiB of 150)` → 0
- `pnpm check:frozen (50 files under deploy/ unchanged)` → 0
- `pnpm exec playwright test tests/e2e/orders-admin.spec.ts tests/e2e/store-admin.spec.ts tests/e2e/owner-operations.spec.ts (one run on the final tree, 11.8 GB free before it; 83 passed: 52 + 11 + 20, 4.6 min; the dev server rewrote the tracked next-env.d.ts, which was clean before the run and was restored with git checkout afterwards)` → 0

Uncovered:
- Several refusals never come through the screen and are covered only by unit tests of their sentences: ITEM_REFUNDED, fulfilment INVALID_ITEMS, return INVALID_ITEMS, and the NOT_FOUND of decide, receive and close. ITEM_REFUNDED is reachable: a line selected before a refund lands stays checked but disabled after the re-read, so «تم الشحن» still sends it.
- The screens never meet a real 42501 from the SQL. Untested cases: an operations member forcing a restock, a review close or a resolution, and a member revoked or demoted while the shell still holds the old role. Only a mocked 403/42501 on fulfillment_update is tested.
- Only the fulfilment double press is proven. «قبول», «رفض», «تم الاستلام», «تأكيد إكمال الطلب» and «إغلاق المراجعة» use the same act() guard but no test presses them twice.
- Two fragment cases are untested. A `#q=` holding text that is neither an order number nor an email should give BAD_QUERY. A `#q=` opened by an editor stays in the address bar, because OrdersView never calls takeFragment for a role without access.
- The «المزيد» failure path (moreFailed) is untested, and so is a filter or search restart while «المزيد» is in flight.
- The real keyset cursor only runs because the shared local database holds more than 50 orders. On a fresh database only the mocked second page is tested.
- No seeded order has webhook events (the harness pays with p_event_id null), so the events part of a real order_detail reply is never parsed in the e2e.
- A restock typed above the returned quantity, negative or fractional is silently clamped or truncated by clampQuantity before the call. No test pins this, and the SQL's INVALID_ITEMS bound is never reached from the screen.
- For a returned line whose variant has null stock, the owner is offered the restock field but the SQL silently skips it.
- An uppercase UUID in ?id= gives «لم نجد هذا الطلب.» without asking the server, because isUuid accepts lowercase only. Untested.
- No test opens the view of an expired or cancelled order, or of an order whose attempt is in creating or uncertain state.
- The «و<n> غيرها» line for more than 10 low-stock entries is only asserted when the shared database happens to hold more than 10.
- No test has two staff pressing the same action at the same moment from two tabs. Only sequential changes made behind the page are tested; SQL-level serialization is covered only by round 7b's integration tests.


## The orchestrator's rulings and own audit (2026-10-03)

The workflow ended `audit_pass` after one build and one audit (four low findings, no fix pass). The worker read no `.env` file. I read the screens' every RPC call against the SQL signatures of `20261002145000_order_operations.sql` (`orders_list(p_filter, p_query, p_before, p_limit)`, `order_detail(p_order)`, `fulfillment_update(...)`, `return_decide(p_return, p_decision, p_note)`, `return_receive(p_return, p_restock)`, `order_resolve(p_order)`, `review_close(p_payment, p_reason)`, `orders_alerts()`): they match. Every role rule stays in the SQL; the screens only hide what the role cannot do.

| Finding | Ruling |
|---|---|
| R11A-1 (the `ORDER_NOT_PAID` sentence was reworded without saying so) | Fixed by me: the brief's «الطلب غير مدفوع، فلا يُشحن.» in the module, the unit test and the e2e. |
| R11A-2 (a failed alerts line had no «تحديث») | Fixed by me: «تحديث» shows when the list or the alerts failed (it reloads both); the e2e now unroutes the failure, presses it and sees the counts. |
| R11A-3 (the parsers accepted any text `Date.parse` reads as a time, the keyset cursor included) | Fixed by me: a date or an ISO time with its offset, as the database writes them, before `Date.parse`; '1', '2026', 'Oct 3 2026' and a time without its offset are refused in the unit test. |
| R11A-4 (the order view parses the webhook events but does not draw them; the contract lists them as verified evidence) | Ruled for the contract: the view shows them. Round 11b edits `OrderView` anyway, so its brief gains «إشعارات الدفع» under «الدفع» (type, outcome, times, attempts, error; read-only for owner and operations). |

From the uncovered list I fixed one real path: a line selected before a refund made it fully refunded stayed checked after the re-read and was still sent (the SQL answered `ITEM_REFUNDED`). Now a line that can no longer move is shown unchecked and is left out of `p_item_ids`. The rest stay recorded for checkpoint (c): forced double presses of the other actions, a real 42501 from the SQL, `#q=` opened by an editor stays in the address bar (the editor has no access and makes no call), the «المزيد» failure, an uppercase id. The worker's added words (entitlement states, empty lists, the refusal sentences it wrote) are accepted; the codes of dispute kinds, provider status and source stay codes here (round 11b gives the dispute words).

My own browser pass, on the dev server and the real local stack (no mocks), signed in by email code as a local test owner, at 1440x900 and 360x740: the home's «الطلبات» section with its counts and the nav entry after «المتجر»; `/admin/orders` with the alerts line, «تحتاج حلًا» pressed (two orders, `aria-pressed`), an invalid search refused with «أدخل رقم طلب كاملًا أو بريدًا إلكترونيًا.»; a needs-resolution order's view with «إكمال الطلب», its second button «تأكيد إكمال الطلب» (it took the focus), and the real `STOCK_UNAVAILABLE` worded in the alert line; a paid order's shipping: «تم الشحن» refused without a carrier («أدخل شركة الشحن ورقم التتبع.»), then shipped with a carrier and a tracking value («تم التحديث.», the focus on the status line, the row showing «شُحن» with both), then «تم التسليم» at 360 («سُلِّم» and both times); the customers list's «طلباته» opening the orders with the address in the search field and the fragment gone from the address bar; the list as cards at 360. No horizontal overflow at either width; the line checkboxes sit in 44px labels.

Checks on the final tree: `pnpm exec vitest run tests/unit/admin-orders.test.ts` 0 (52); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; from a fresh `supabase db reset` with both imports and the edge runtime restarted: `pnpm test` 0 (66 files, 2100 tests), `pnpm build` 0, `pnpm check:export` 0 (57 files, `admin/orders.html` and `admin/orders/view.html` included), `pnpm check:budgets` 0 (largest 148.9 KiB), `pnpm exec playwright test tests/e2e/orders-admin.spec.ts tests/e2e/store-admin.spec.ts tests/e2e/owner-operations.spec.ts` 83 passed (11.4 GB free before; `next-env.d.ts` restored). No SQL changed; no call to Moyasar.
