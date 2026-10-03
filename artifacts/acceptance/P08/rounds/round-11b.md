# the admin's money actions: refunds with the step-up, the rechecks, external refunds, the reconciliation screen and disputes

## Worker report 1

Round 11b built: the owner's refund form (RefundView) with the confirmation, the rechecks, external refunds, the reconciliation screen, the dispute form and the links; every check above exits 0.

Refund: one field per line with something left (total less refunded) and one for shipping (less succeeded and in-flight allocations), amounts in integer halalas from parseRiyals, refusals under the field, live total, optional received return, reason 1 to 300. «إعادة المبلغ» freezes the body; «تأكيد الاسترداد» mints the key once (crypto.randomUUID) and is the only sender. STEP_UP_REQUIRED opens the existing StepUp dialog and the same body and key go once more; a network failure, a 500 or an unreadable reply keeps the confirmation and the key; a change renews it; a final answer drops it. A review payment sends allocation {} and its orderId only when it has one.

Answers: succeeded, uncertain and submitting, failed, a function refusal (its own message), PROVIDER_AHEAD (message plus the external button), and a reply that fails the strict parser («تعذّر قراءة الرد؛ حدّث الصفحة.»), all on the screen's one status or alert line with the focus there; every screen re-reads after any call. Rechecks need no code, external refund and disputes go through the step-up.

OrderView: webhook events under «الدفع» (owner and operations, read-only), the owner's recheck, dispute and refund controls, the in-flight refund recheck, and dispute words. ReconciliationView (owner only; others see «لا تملك صلاحية الوصول» and make no call) has the five sections with the 100 cap sentence and «لا شيء هنا.». DisputeForm opens from «تسجيل فرق», the paying attempt, a review payment and «إضافة متابعة» (reference, kind and target locked, follows = latest seq); the day is bounded, item decisions need lines, it never offers a refund. The count on /admin/orders and the home links to the screen, «المطابقة» is on /admin/orders, check-export lists the new page.

Proof: 30 e2e at 360 and 1440 (real sign-in and TOTP, mocked admin replies, exact request bodies, both roles refused) and the 52-test orders-admin spec, both green; a scratch run against the real stack checked my parsers and bodies against real replies and schemas (22 of 22).

Needs a ruling: the words I chose (contractGaps), the cards-not-tables choice for the reconciliation screen, and the dispute words now shown on the order view.

Files: src/lib/admin-money.ts (new), src/lib/admin-orders.ts, src/components/admin/RefundView.tsx (new), src/components/admin/DisputeForm.tsx (new), src/components/admin/ReconciliationView.tsx (new), src/components/admin/OrderView.tsx, src/components/admin/OrdersView.tsx, src/components/admin/AdminHome.tsx, src/app/(admin)/admin/(shell)/orders/reconciliation/page.tsx (new), scripts/check-export.mjs, tests/unit/admin-money.test.ts (new), tests/unit/admin-orders.test.ts, tests/e2e/orders-money.spec.ts (new), tests/e2e/orders-admin.spec.ts

Checks:
- `pnpm exec vitest run tests/unit/admin-money.test.ts tests/unit/admin-orders.test.ts` → 0 (2 files, 114 tests (admin-money: remainders, allocation, key life, step-up retry, readers, dispute form, the three strict reply parsers))
- `pnpm test` → 0 (67 files, 2162 tests, on the final src tree)
- `pnpm lint` → 0 (final run after the last edit)
- `pnpm typecheck` → 0 (final run; next-env.d.ts restored from my copy after each dev or build run)
- `pnpm check:copy` → 0 (229 source files; no em dash or Arabic-Indic digit in the new copy)
- `pnpm build` → 0 (/admin/orders/reconciliation is in the route table)
- `pnpm check:export` → 0 (58 required files incl. admin/orders/reconciliation.html; no secrets)
- `pnpm check:budgets` → 0 (largest public page 148.9 KiB of 150)
- `pnpm exec playwright test tests/e2e/orders-money.spec.ts` → 0 (30 passed (15 per width, 360 and 1440), 4.5 min; 11.5 GB free before; webServer only. Run as its own command (see openRisks))
- `pnpm exec playwright test tests/e2e/orders-admin.spec.ts` → 0 (52 passed (26 per width), 3.6 min; 11.1 GB free before)
- `node real-shapes.cjs (scratch script in the scratchpad, not in the repo)` → 0 (22 of 22: real reconciliation_list, disputes_list, order_detail replies parsed by my strict parsers; real dispute-record 201 / 200 duplicate / 409 NO_PREDECESSOR read by my readers; every money body accepted by the real admin function's zod schemas (no 422))

Contract gaps:
- Words I chose where the brief gives none (owner to confirm or replace): form refusals «أدخل مبلغًا لعنصر أو للشحن.», «أدخل المبلغ.», «المبلغ أكبر من المتبقي.», «اكتب سبب الاسترداد في 300 حرف أو أقل.», «اكتب سبب التسجيل في 300 حرف أو أقل.» («أدخل مبلغًا صحيحًا بالريال، مثل 69 أو 69.50.» is FieldInput's own); «بدون ربط», «لا يوجد مبلغ متبقٍ للاسترداد.», field labels «الإجمالي» «السبب» «الشحن»; the external form's «تأكيد التسجيل» «رجوع» and its success «سُجّل استرداد خارجي بمبلغ <amount>.»; «يلزم تفعيل تطبيق المصادقة أولًا من صفحة الأمان.»; the events table headers (النوع, النتيجة, وقت الاستلام, وقت المعالجة, المحاولات, الخطأ) and the refunds table's «إجراء» column (drawn only while a refund is in flight); the dispute form's labels and its refusals (DISPUTE_PROBLEMS in admin-money.ts); the reconciliation facts («الأسباب», «رقم الدفعة لدى Moyasar»...); «سُجّلت المراجعة.», «لم نجد هذا الإشعار.», «لا يحتاج هذا الإشعار إلى مراجعة.».
- PROVIDER_AHEAD «its message and, beside it, the external-refund button below»: built as a button inside the alert line next to the message, plus the permanent «تسجيل استرداد خارجي» under the refund form (the brief lists it for the paying attempt and for a review payment). Both open the same form.
- Round 11a's ruling that dispute kind, direction and decision stay codes until this round gives the words: OrderView's dispute cards now show them as words (Enum), so one 11a e2e assertion changed (codes to words), as did its two heading assertions (the owner's «الاستردادات» section is last; «إشعارات الدفع» is the only h3).
- The reconciliation screen is cards, not tables: AdminShell's isWidePath is outside my paths and tests/unit/admin-orders.test.ts pins /admin/orders/reconciliation as not wide.
- Moved shared helpers: Fact, ltr, ltrLong, NONE are now exported from OrdersView.tsx; clean, closeReason, NEEDS_REASON, RESERVED_REASON from admin-orders.ts (OrderView's closing now uses closeReason, behavior unchanged); OrderAction gains 'dismiss'. The three reply parsers sit in admin-orders.ts beside the other strict parsers (they need its private primitives) and are tested in admin-money.test.ts as the brief names.
- The shipping remainder counts in-flight refunds as briefed, while the SQL (refund_allocation_ok) counts only succeeded ones: the form is stricter than the SQL by design (an in-flight refund blocks a new one with REFUND_IN_FLIGHT anyway).
- A follow-up or a review payment's dispute opened on the reconciliation screen reads its order's lines by number (orders_list with the exact number, then order_detail: two extra reads when the form opens), because disputes_list and reconciliation_list rows carry only the order number; with no order, or lines that cannot be read, only the decisions that name no line are offered.
- disputes_list has no row cap, so only the four reconciliation_list lists say «تُعرض أحدث 100.»; the order view's events (SQL cap 100) say nothing, the brief asks for none.

Open risks:
- A reload loses the in-memory idempotency key and the typed form (the brief keeps them for a step-up and a network retry only). A second refund of the same money is still stopped by REFUND_IN_FLIGHT, PROVIDER_AHEAD, EXCEEDS_BALANCE and by the remainders read on load.
- The e2e mocks the admin function, so no real provider reply (succeeded, uncertain, failed) reached the screens; the real refund journey against the emulator is round 12a. My scratch run against the real local stack (owner at aal2) sent every money body to the real function: none was a 422; the refund legs ended 503 PROVIDER_UNAVAILABLE because no emulator was running.
- That scratch run left two append-only dispute rows (and its harness orders and products) in the shared local database; the acceptance reset clears them.
- The step-up retry relies on supabase-js sending the refreshed aal2 token after challengeAndVerify (the CommerceSettingsForm pattern, proven by owner-operations.spec); my e2e proves the dialog with a real TOTP and the same-body retry, not the real token swap.
- The e2e enrols a real TOTP and reuses a code inside one 30 s window; GoTrue accepted it in every run (four full runs).
- I ran the two Playwright specs as two commands (4.5 and 3.6 min), not the brief's single command, to stay inside the 10 minute foreground limit and never kill a run before the harness cleans up.
- A review payment on the reconciliation screen carries four controls (close, refund, external record, dispute), so its card is long at 360; the 360 reconciliation screenshot is about 20000 px tall because the e2e mocks 100 events.

## Audit 1: audit_failed

### R11B-1 [medium] src/components/admin/OrderView.tsx:205
- Problem: The idempotency key and the frozen request are lost when a network failure takes out both the refund call and the re-read that follows it. moneyRun replaces the order with {kind:'failed'} whenever that re-read fails. The sections unmount, RefundView unmounts with them, and its frozen body (RefundView.tsx:214) and key ref (RefundView.tsx:216) are gone. In a real outage, refund-create answers UNKNOWN (keep: true) and the order_detail re-read fails too, so the brief's rule is broken: the key must survive 'a retry after a network failure'. After «تحديث» the form is empty and the next confirmation mints a new key. If the first request did reach the server, the repeat is no longer recognised as the same refund. Only REFUND_IN_FLIGHT or the reduced remainders then stop a second provider refund. ReconciliationView has the same defect for review-payment refunds (ReconciliationView.tsx:159 `setLoad(await readAll())`; :221 and :250 unmount everything on a failed read).
- Evidence: OrderView.tsx:205 `setLoad(await fetchDetail(orderId))`. fetchDetail returns {kind:'failed'} on any rpc error (OrderView.tsx:73-82). OrderView.tsx:331 `const detail = valid && load.kind === 'ready' ? load.detail : null` and :361 `{detail !== null && sections(detail)}` unmount RefundView. The e2e network test (tests/e2e/orders-money.spec.ts:649-665) aborts only `**/functions/v1/admin`. Its order_detail re-read still succeeds, so this path never runs in the suite. The worker's openRisks name only a reload, not a failed re-read.
- Correction: In OrderView.moneyRun and ReconciliationView.run, keep the last ready data when the re-read after an action fails, and say on the alert line that the data could not be read again. For example: `const next = await fetchDetail(orderId); setLoad((prev) => (next.kind === 'failed' && prev.kind === 'ready' ? prev : next))`. Alternatively, lift the frozen body and the kept key out of RefundView into the screen, keyed by target, so an unmount cannot drop them. Add an e2e at both widths: abort the admin call and the next order_detail once, restore the network, press «تأكيد الاسترداد» again, and assert the same idempotencyKey and body.

### R11B-2 [medium] src/components/admin/RefundView.tsx:79
- Problem: Cancelling the step-up dialog leaves keyboard focus on the document body. This affects every control that opens the dialog: «تأكيد الاسترداد», and «تأكيد التسجيل» on the external-record and dispute forms. Each of these is disabled by money.busy when the dialog closes, because moneyRun and run keep busy set until the re-read finishes. A native dialog cannot return focus to a disabled element. When the task answers null (cancelled), nothing moves the focus afterwards. The code says the opposite ('closing it returns the focus to the control that asked for the code', OrderView.tsx:362 and ReconciliationView.tsx:498). The brief's audit focus names the dialog's focus return.
- Evidence: I replicated the flow in plain DOM in Chromium (scratch script): the button is disabled, showModal opens, «cancel» calls close(), and the button is re-enabled 200 ms later. It logged ["after close: cancel","after re-enable: BODY"]. The same script with the button left enabled logged ["after close: confirm","after re-enable: confirm"]. In the code, OrderView.tsx:192-209 sets busy before the call and clears it only after `await fetchDetail`. Line 208 reports nothing for a null reading. RefundView.tsx:300 has `disabled={money.busy}`, and DisputeForm.tsx:230 and RefundView.tsx:177 do the same. No e2e presses «إلغاء» in the dialog.
- Correction: Remember the control that opened the dialog before the call, for example `const opener = document.activeElement` captured in run/moneyRun or a ref passed in by the control. When the task answers null, focus that control once busy is cleared. Alternatively, keep the control focusable during the call: use aria-disabled together with the existing inFlight ref guard instead of the disabled attribute. Add an e2e at 360 and 1440: open the dialog from «تأكيد الاسترداد», press «إلغاء», and assert that focus is on «تأكيد الاسترداد», that both lines are empty, and that pressing it again sends the same body and key.

### R11B-3 [low] src/components/admin/RefundView.tsx:303
- Problem: Three «رجوع» buttons remove themselves while they hold the focus, so the focus falls to the document body instead of returning to the control that opened the step. They are: «رجوع» in the refund confirmation (RefundView.tsx:303, back to «إعادة المبلغ»), «رجوع» in the external-record form (RefundView.tsx:180, back to «تسجيل استرداد خارجي»), and «رجوع» in the dispute form (DisputeForm.tsx:233, back to «تسجيل اعتراض», «إضافة متابعة» or «تسجيل فرق»).
- Evidence: `onClick={() => setFrozen(null)}`, `onClick={() => onOpenChange(false)}` and `onClick={onClose}` unmount the pressed button, and none of them makes a focus call. After «رجوع» the e2e checks only the field value (orders-money.spec.ts:512-513), never the focus.
- Correction: After closing, focus the control that opened the step, using a ref on «إعادة المبلغ» and on each toggle button. Assert that focus in tests/e2e/orders-money.spec.ts.

### R11B-4 [low] src/components/admin/RefundView.tsx:221
- Problem: The confirmation step puts its initial focus on the irreversible «تأكيد الاسترداد». Enter in any field submits the form, and the effect then focuses the confirm button. A second Enter, or a held one that auto-repeats, therefore confirms the refund without the owner reading the repeated total and lines. If the owner's TOTP is still fresh, no dialog stands in between.
- Evidence: RefundView.tsx:220-222 `if (frozen !== null) confirmRef.current?.focus()`. The e2e asserts this focus (orders-money.spec.ts:503). The WAI-ARIA APG alert-dialog guidance puts the initial focus on the least destructive control when the action cannot be undone, and this step itself says «ولا يمكن التراجع عنه».
- Correction: Move the initial focus to the confirmation group itself (tabIndex=-1 on the container labelled by the total) or to «رجوع», and update the assertion at orders-money.spec.ts:503.

### R11B-5 [low] src/components/admin/ReconciliationView.tsx:287
- Problem: On the reconciliation screen, «تسجيل استرداد خارجي» is offered only for EXTERNAL_REFUND rows. A paying attempt voided in Moyasar's dashboard is listed as PROVIDER_STATUS, because its refunded total need not rise. refund_record_external does record a void, and the form's own sentence says «استردادًا أو إلغاءً». Today the owner has to open the order view to record it. The worker followed the brief word for word, so the gap is in the brief.
- Evidence: ReconciliationView.tsx:287 `attempt.reasons.includes('EXTERNAL_REFUND') && <ExternalRefund .../>`. Brief item 3 says 'for EXTERNAL_REFUND «تسجيل استرداد خارجي»'. Contract section 6, refund_record_external: 'for a status voided the delta is the whole unrefunded amount'. The PROVIDER_STATUS rule in reconciliation_list (20261002145000_order_operations.sql) is `provider_status not in ('paid','refunded')`.
- Correction: This needs an orchestrator ruling: offer «تسجيل استرداد خارجي» on PROVIDER_STATUS rows too, at least when providerStatus is voided. The code change is then one condition at ReconciliationView.tsx:287 plus one e2e assertion.

### R11B-6 [low] src/lib/admin-money.ts:283
- Problem: readRefundReply, readPaymentRecheck and readDisputeReply read result.error without checking that it exists. callFunction passes through any 2xx body that has an `ok` key. A 2xx body of {ok:false} with no error therefore throws a TypeError inside the task. The screen then says «تعذّر الحفظ» about a money action whose outcome is unknown, instead of the brief's «تعذّر قراءة الرد؛ حدّث الصفحة.». The key is still kept, because the throw comes before the discard, so no second refund follows. But the owner reads the message as a failure.
- Evidence: admin-money.ts:283 `const { code, message } = result.error`, :304 `result.error.message`, :315 `result.error.code`. src/lib/supabase/functions.ts:30 `if (data && typeof data === 'object' && 'ok' in data) return data as FunctionResult<T>`. OrderView.tsx:199-204 and ReconciliationView.tsx:153-158 turn a thrown task into SAVE_FAILED.
- Correction: In all three readers, treat `!result.ok` without a string `error.code` as a bad reply (BAD_REPLY, line 'alert', keep: true). Add this case to tests/unit/admin-money.test.ts.

Checks re-run:
- `pnpm exec vitest run tests/unit/admin-money.test.ts tests/unit/admin-orders.test.ts (2 files, 114 tests)` → 0
- `pnpm test (67 files, 2162 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy (229 source files)` → 0
- `pnpm build (next-env.d.ts copied aside and restored; /admin/orders/reconciliation in the route table)` → 0
- `pnpm check:export (58 required files incl. admin/orders/reconciliation.html, no secrets)` → 0
- `pnpm check:budgets (largest 148.9 KiB of 150)` → 0
- `pnpm exec playwright test tests/e2e/orders-money.spec.ts tests/e2e/orders-admin.spec.ts (11.1 GB free before; 82 passed in 7.3 min; next-env.d.ts restored)` → 0
- `NODE_PATH=<repo>/node_modules node <scratchpad>/dialog-focus.cjs (plain-DOM step-up cancel replica in Chromium: opener disabled at close -> focus on BODY; control variant with opener enabled -> focus on opener)` → 0

Uncovered:
- A network outage that fails both the refund call and the order_detail (or reconciliation_list) re-read: the RefundView unmounts and the key is lost (R11B-1). The e2e aborts only the admin route.
- The step-up dialog cancelled from «تأكيد الاسترداد», the external record or the dispute form: focus return, both lines left empty, the confirmation and key kept, and a re-press sending the same body and key. None of this is in any e2e.
- NOT_ENROLLED (an owner with no verified TOTP) on refund-create, refund-record-external or dispute-record: tested at unit level only, no e2e.
- refund-create answering 500 FAILED because refund_result could not be recorded: the key should be kept and the retry should answer the stored refund. Tested at unit level only (readRefundReply keep flag).
- A second STEP_UP_REQUIRED after a verified code: tested at unit level only (withStepUp), no screen test.
- A malformed 2xx {ok:false} with no error object: it throws, and the screen says «تعذّر الحفظ» instead of BAD_REPLY (R11B-6).
- A reload while the confirmation is open: the key is lost by design. No UI test shows that the server guards (REFUND_IN_FLIGHT, reduced remainders) stop the repeat.
- The «تُعرض أحدث 100.» sentence for the attempts, reviews and refunds lists: only the events list is driven to 100 in the e2e.
- A follow-up whose `follows` fell behind a row recorded meanwhile (another tab): it is answered as a duplicate and the form closes. No test.
- A double or held Enter from the reason field that both opens and confirms the refund (R11B-4). No test.
- The real aal2 token swap after challengeAndVerify against the real admin function: the admin replies are mocked here (deferred to round 12a).

## Worker report 2

All five findings are fixed at their causes and every check passes.

- **R11B-1:** a failed re-read after an action no longer blanks the screen. OrderView (`moneyRun` and `act`) and ReconciliationView (`run`) keep the last reading, so RefundView stays mounted and its frozen body and key survive. The alert line says what the call said, then «تعذّر تحديث الصفحة؛ قد لا تظهر آخر البيانات.»
- **R11B-2:** a new `useFocusBack` hook notes the pressed control as an action begins. When the owner closes the code dialog (the task answers null), the screen focuses that control once it is enabled again. It is used by both screens.
- **R11B-3:** «رجوع» in the refund confirmation focuses «إعادة المبلغ»; in the external record form it focuses its toggle; in the dispute form it focuses the control that opened the form.
- **R11B-4:** the confirmation group takes the initial focus (tabIndex=-1), not «تأكيد الاسترداد». A second Enter now confirms nothing.
- **R11B-6:** a shared `refusalOf` helper makes `{ok:false}` with no usable error read as «تعذّر قراءة الرد؛ حدّث الصفحة.» with the key kept. `withStepUp` had the same defect and is fixed too.

Tests added or changed:
- Unit: four new cases in `tests/unit/admin-money.test.ts` for `{ok:false}` without a refusal.
- E2E, at both widths in `orders-money.spec.ts`: the outage that takes the re-read down; a failed re-read after another action (the fulfilment); cancel and Escape returning focus for the refund, the external record and the dispute form; focus after each «رجوع»; Enter opening the confirmation with the group focused, then a second Enter sending nothing; a 200 `{ok:false}` reply on `refund-create`.

Files: src/lib/admin-money.ts, src/components/admin/RefundView.tsx, src/components/admin/DisputeForm.tsx, src/components/admin/OrderView.tsx, src/components/admin/ReconciliationView.tsx, tests/unit/admin-money.test.ts, tests/e2e/orders-money.spec.ts

Checks:
- `pnpm exec vitest run tests/unit/admin-money.test.ts tests/unit/admin-orders.test.ts` → 0 (2 files, 118 tests passed)
- `pnpm test` → 0 (67 files, 2166 tests passed)
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0 (229 source files)
- `pnpm build` → 0 (next-env.d.ts copied aside and restored)
- `pnpm check:export` → 0 (58 required files present, no secrets)
- `pnpm check:budgets` → 0 (largest 148.9 KiB of 150.0)
- `pnpm exec playwright test tests/e2e/orders-money.spec.ts (first try, with PLAYWRIGHT_BASE_URL set)` → 1 (Environment mistake, not code: that variable makes playwright.config.ts skip its own dev server, so page.goto got ERR_CONNECTION_REFUSED in beforeAll and 35 tests did not run. Re-run below without it.)
- `pnpm exec playwright test tests/e2e/orders-money.spec.ts` → 0 (36 passed (18 tests at 360 and at 1440), 5.3 min, 11 GB free before; Playwright's own webServer on http://localhost:3000)
- `pnpm exec playwright test tests/e2e/orders-admin.spec.ts --grep "at 360px"` → 0 (26 passed, 2.0 min. orders-admin ran in two halves by width to stay under the 10 minute foreground cap)
- `pnpm exec playwright test tests/e2e/orders-admin.spec.ts --grep "at 1440px"` → 0 (26 passed, 1.7 min)

Contract gaps:
- The brief names no sentence for a screen that could not read its data again after an action, and none for where the focus goes when the owner closes the code dialog. I chose REREAD_FAILED «تعذّر تحديث الصفحة؛ قد لا تظهر آخر البيانات.» (src/lib/admin-money.ts), said on the alert line after the call's own sentence, and the focus returning to the control that was pressed. Reword if you want other copy.
- R11B-6 is wider than its finding. `callFunction` (src/lib/supabase/functions.ts, outside my paths) passes through any 2xx body with an `ok` key, so `{ok:false}` with no error arrives. `withStepUp` read `first.error.code` before the readers ran and threw, so the screen said «تعذّر الحفظ». I fixed `withStepUp` and the three readers with one `refusalOf` helper; the cause in functions.ts is left alone.
- R11B-1 names moneyRun and ReconciliationView.run. OrderView.act (round 11a's path) replaced the order with the failure the same way, so a refund waiting for its repeat could lose its key through any other action whose re-read failed. I applied the same rule there (a failed re-read keeps what is drawn and says so) and added an e2e for it.
- No finding was judged wrong.

Open risks:
- R11B-4 side effect to view: the confirmation group takes focus with tabIndex=-1, so when the owner opens it with the keyboard (Enter in a field) the shell's own `.shell :focus-visible` ring is drawn around the whole group. It is visible in test-results/screenshots/P08/admin-money-refund-confirm-360.png and -1440.png (a mouse press shows no ring). I added no CSS. The alternative the finding allows is focusing «رجوع» instead.
- After a failed re-read the screen keeps the last reading and says so on the alert line. There is no «تحديث» button in that state: the next action re-reads, and a browser reload would lose the kept key (the server's REFUND_IN_FLIGHT and EXCEEDS_BALANCE still stop a second provider refund). Remainders shown meanwhile can be stale.
- useFocusBack.mark() takes document.activeElement as the action begins. In Safari a mouse press does not focus a button, so the focus then returns to whatever held it (a field or the body). Only Chromium was exercised.
- The new e2e tests were not run against the unfixed code (no revert was made); each assertion was checked by reasoning against the auditor's evidence.
- Screenshots rewritten by my runs are all git-ignored, under test-results/screenshots/P08/: admin-money-{refund-form,refund-confirm,reconciliation,dispute-form,dispute-follow-up}-{360,1440}.png, plus the orders-admin ones. Nothing under artifacts/acceptance changed. I viewed only the two refund-confirm shots; the layout of the others is untouched by this pass. `.next/e2e` was removed after the runs.

## Audit 2: pass

### R11B-5 [low] src/components/admin/ReconciliationView.tsx:294
- Problem: Carried over from the first audit, still waiting for a ruling. On the reconciliation screen, «تسجيل استرداد خارجي» appears only on EXTERNAL_REFUND rows. A paying attempt voided in Moyasar's dashboard shows up as PROVIDER_STATUS and gets no control there, although refund_record_external records a void and the form's own sentence says «استردادًا أو إلغاءً». The owner has to open the order view to record it.
- Evidence: ReconciliationView.tsx:294 `attempt.reasons.includes('EXTERNAL_REFUND') && <ExternalRefund .../>`. Contract section 6, refund_record_external: 'for a status voided the delta is the whole unrefunded amount'. Brief item 3 names only EXTERNAL_REFUND. The fix round correctly left this alone. The other five findings of the first audit are fixed at their causes, each with a test that fails if the fix is reverted. R11B-1: OrderView.tsx:158-162 (reread) and ReconciliationView.tsx:164 keep the last reading when the re-read fails (orders-money.spec.ts:719, :750). R11B-2: RefundView.tsx:110-122 useFocusBack (spec :778, :1018). R11B-3: RefundView.tsx:257-263 and :208-211, DisputeForm.tsx:242-245 (spec :533, :645, :968). R11B-4: RefundView.tsx:257-258 focuses the confirmation group, not the confirm button (spec :519-525). R11B-6: admin-money.ts:232-237 refusalOf, used by withStepUp and all three readers (admin-money.test.ts:442-478, spec :659-663).
- Correction: The orchestrator decides whether PROVIDER_STATUS rows (at least those with providerStatus 'voided') also get «تسجيل استرداد خارجي». If yes, the change is one condition at ReconciliationView.tsx:294 plus one e2e assertion in orders-money.spec.ts.

### R11B-7 [low] src/components/admin/ReconciliationView.tsx:311
- Problem: A review payment with no order disappears from the admin once the owner closes it by hand, so it can no longer be refunded or recorded as externally refunded from any screen. The contract says such a payment stays refundable. The brief contradicts itself here: item 1 gives a no-order review payment «استرداد هذه الدفعة» 'while it is not closed as refunded', but item 3 (and the SQL) list only open review payments.
- Evidence: ReconciliationView.tsx:311 renders only data.rec.reviews. reconciliation_list fills that list with `where pr.closed_at is null` (supabase/migrations/20261002145000_order_operations.sql:576). OrderView reads review payments only through order_detail, which selects `pr.order_id = v_order.id` (same migration, line 356), so a payment with orderId null never appears there. refund_request still accepts a payment closed by hand: it refuses only closed_reason 'refunded' (20261002130000_refunds.sql:409). Contract section 6, review_close: 'It stays refundable.' After «إغلاق المراجعة» (ReconciliationView.tsx:346) on a no-order payment, no screen offers «استرداد هذه الدفعة» or «تسجيل استرداد خارجي» for it.
- Correction: Needs an orchestrator ruling. Option 1: list the no-order review payments that were closed by hand but not refunded (a change to reconciliation_list or a new read, both outside this round). Option 2: accept the gap, and have the screen say beside «إغلاق المراجعة» on a no-order payment that closing it removes it from the admin's refund controls.

### R11B-8 [low] src/components/admin/ReconciliationView.tsx:326
- Problem: The reconciliation screen marks test-mode attempts but not test-mode review payments or dispute rows, although both lists include both modes. On a live site, open review payments left over from the sandbox would look like real customer money. A refund of one fails only with the function's 503 «تعذّر الوصول إلى بوابة الدفع الآن»: the live key cannot fetch a test payment.
- Evidence: ReconciliationView.tsx:267 puts `<TestBadge environment={attempt.environment} />` beside an attempt's order. The review card (:319-330, order fact at :326) and the dispute rows (:475-491) show no mode. Yet review.environment and each dispute row's environment are parsed (admin-orders.ts reviewOf and disputeOf), and reconciliation_list and disputes_list take no mode. Contract section 6 (order operations): 'orders of both modes are listed, each with its environment, and the screens label a test order'. OrderView and OrdersView already label test orders.
- Correction: Add `<TestBadge environment={review.environment} />` to each review card (beside its order or reason) and `<TestBadge environment={row.environment} />` to each dispute row, plus one e2e assertion on a test-mode review payment. In-flight refunds cannot be marked: refund_json has no environment, so labelling them is an orchestrator decision.

Checks re-run:
- `pnpm exec vitest run tests/unit/admin-money.test.ts tests/unit/admin-orders.test.ts (2 files, 118 tests)` → 0
- `pnpm test (67 files, 2166 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck (run before and again after the e2e run)` → 0
- `pnpm check:copy (229 source files)` → 0
- `pnpm build (next-env.d.ts copied aside and restored; /admin/orders/reconciliation in the route table)` → 0
- `pnpm check:export (58 required files including admin/orders/reconciliation.html; no secrets)` → 0
- `pnpm check:budgets (largest page 148.9 KiB of 150)` → 0
- `pnpm exec playwright test tests/e2e/orders-money.spec.ts tests/e2e/orders-admin.spec.ts --reporter=line (11.1 GB free before; Playwright's own webServer on http://localhost:3000, PLAYWRIGHT_BASE_URL unset; 88 passed in 8.5 min; next-env.d.ts restored, no headless Chrome left running)` → 0

Uncovered:
- Real reconciliation_list and disputes_list replies never reach the owner's screen in the suite: every owner test of /admin/orders/reconciliation mocks both. I checked the parsers against the SQL's jsonb_build_object keys by reading the migrations. The worker's real-shape run is a scratch script outside the repo.
- A reload while the confirmation is open loses the key, by design. No test shows the server's guards (REFUND_IN_FLIGHT, INVALID_ALLOCATION, EXCEEDS_BALANCE, PROVIDER_AHEAD) stopping the repeat on the real stack. That belongs to round 12a.
- NOT_ENROLLED (an owner with no verified TOTP) on refund-create, refund-record-external and dispute-record: unit tests only, no screen test.
- refund-create answering 500 FAILED (refund_result could not be recorded), where the key must be kept and the retry must answer the stored refund: unit tests only (the keep flag), no screen test.
- A second STEP_UP_REQUIRED after a verified code: unit tests only (withStepUp), no screen test.
- The «تُعرض أحدث 100.» sentence for the attempts, reviews and refunds lists: only the events list is filled to 100 in the e2e.
- A follow-up whose `follows` fell behind a row recorded meanwhile in another tab: the SQL answers it as a duplicate, so the owner's new row is never recorded and the form says «هذا السجل مسجّل من قبل». No test.
- The dispute form opened from a review payment card on the reconciliation screen (its order's lines are read by order number): only the follow-up path's line reading is exercised.
- Focus return after the code dialog and after «رجوع» in WebKit/Safari, where a mouse press does not focus a button: only Chromium was run.
- The real aal2 token swap after challengeAndVerify against the real admin function: the admin function's replies are mocked in this round (deferred to round 12a).


## The orchestrator's rulings and own audit (2026-10-03)

The workflow ended `audit_pass` after one build, an audit (two medium, four low), one fix pass and a second audit (three low left, two of them new). The workers read no `.env` file. I read the money path myself: `src/lib/admin-money.ts` (`orderRefundFields`, `shippingLeft`, `readAmount`, `refundBody`, `keyFor`, `withStepUp`, `readRefundReply`) and `RefundView`. Each line's remainder is its total less what was refunded of it; the allocation's items plus shipping always sum to the amount, in integer halalas from `parseRiyals`; a review payment's allocation is `{}`; the idempotency key is minted at the confirmation, kept for the same body across a step-up and a retry after an unknown answer, and discarded only after a final answer or a change of the form; a reply that is neither `{refundId, status, amount}` nor a refusal with a code is never read as a success or a failure and keeps the key.

| Finding | Ruling |
|---|---|
| R11B-1, R11B-2, R11B-3, R11B-4, R11B-6 (the key lost when the re-read fails too; focus after a cancelled step-up, after «رجوع»; the confirmation's initial focus; a `{ok:false}` with no error) | Fixed by the fix pass at their causes, each with a test that fails without it (the second audit checked them). |
| R11B-5 (a void shows as `PROVIDER_STATUS`, which had no «تسجيل استرداد خارجي») | Ruled yes, fixed by me: the control shows for `EXTERNAL_REFUND` or `PROVIDER_STATUS`; the function decides (a void records the unrefunded amount, anything else with nothing to record answers `NO_DELTA`). E2E: a voided attempt gets the control, an uncertain creation does not. |
| R11B-7 (a review payment with no order leaves every screen once closed by hand, though it stays refundable) | Accepted with a warning, not an SQL change: beside «إغلاق المراجعة» on a payment with no order the screen says «دفعة بلا طلب تختفي من اللوحة بعد إغلاقها ولا تُعاد منها؛ أعدها قبل الإغلاق إن لزم.» Closing one is the owner's deliberate act (money the bank reversed); `docs/operations.md` says so in round 12b. A refund at the provider after that is still recorded by the provider's own dashboard. |
| R11B-8 (test-mode review payments and dispute rows were not labelled) | Fixed by me: «تجريبي» beside a test review payment's order and on each test dispute row (E2E asserted). In-flight refunds carry no environment in their reply; their order number links to the labelled view. |

The worker's words where the brief gave none are accepted (the form refusals, the events table headers, the reconciliation facts, the dispute refusals). Its other choices are accepted: the shipping remainder counts in-flight refunds (stricter than the SQL, which counts succeeded ones; an in-flight refund blocks a new one anyway); the reconciliation screen as cards; a follow-up reading its order's lines by number. Left for checkpoint (c): a reload while the confirmation is open loses the key by design (the server's guards stop a repeat: `REFUND_IN_FLIGHT`, the reduced remainders, `PROVIDER_AHEAD`); `NOT_ENROLLED`, a 500 from `refund-create` and a second `STEP_UP_REQUIRED` are proven in unit tests only; a follow-up whose `follows` fell behind a row recorded in another tab is answered as a duplicate.

My own browser pass, on the dev server and the real local stack (the `admin` function and the SQL real; the emulator not running, so the provider could not be reached), signed in as a local test owner who enrolled a real TOTP on `/admin/security`:
- At 1440, a paid order's refund form: 40 riyals on a line with 35 left was refused under the field («المبلغ أكبر من المتبقي.»); 20 riyals opened the confirmation, which repeated the total and the line and said it cannot be undone, with the focus on the confirmation group (not on «تأكيد الاسترداد»); «رجوع» brought the focus back to «إعادة المبلغ» with the amount kept; «تأكيد الاسترداد» went to the real function, which answered 503 «تعذّر الوصول إلى بوابة الدفع الآن. لم يتغيّر شيء؛ حاول بعد قليل.» (the provider fetch comes first), with the focus on the alert, and the ledger held no refund row for the order afterwards.
- `/admin/orders/reconciliation` with the real lists at 1440 and 360 (ten attempts, each labelled «تجريبي»): «أعد الفحص» answered «الحالة الآن: مدفوع.» with the focus on the status line; no horizontal overflow at 360; every visible button at least 44px.
- At 360, after signing in again by email code (so the session had no fresh TOTP): «تسجيل استرداد خارجي», a reason, «تأكيد التسجيل» → the real 403 `STEP_UP_REQUIRED` opened the dialog; «إلغاء» closed it with the focus back on «تأكيد التسجيل» and both lines empty; pressed again, the dialog, a real TOTP code, and the same body went through to the function's provider fetch (503, nothing written). That is the real aal2 token swap the audits had left for round 12a.

Checks on the final tree: `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; from a fresh `supabase db reset` with both imports and the edge runtime restarted: `pnpm test` 0 (67 files, 2166 tests), `pnpm build` 0, `pnpm check:export` 0 (58 files, `admin/orders/reconciliation.html` included), `pnpm check:budgets` 0 (largest 148.9 KiB), `pnpm exec playwright test tests/e2e/orders-money.spec.ts tests/e2e/orders-admin.spec.ts` 88 passed (10.8 GB free before; `next-env.d.ts` restored). No SQL changed; no call to Moyasar.
