# the variant form's preorder fields, confirmed preorders and paid file, the sign-ups list, and the statistics figures

## Worker report 1

Round 11c is built and every listed check exits 0. No Moyasar call, no .env read, nothing committed.

SQL: variant_admin_info(p_variant) is security definer, stable, owned by postgres, search_path empty, with finance.require_staff(false) first. It reuses finance.preorder_committed for preorderUnits, takes the file by digital_asset and never returns the key. It is granted to authenticated only. 9 db tests.

Variant form: new `date` field type (input type=date, YYYY-MM-DD, nullable) and an optional `hint` on text fields. After «المخزون» come «طلب مسبق» and, only while it is on, the capacity (a whole number from 1), the delivery date and the note (1 to 300, no control characters, hint «تظهر للمشتري قبل الدفع.»). validate names each missing field and refuses a date before today in Riyadh. toRow sends false and null for the three while off. VariantCommerce (below the form, for a saved variant) shows «طلبات مسبقة مؤكدة: n» with the stock sentence, and for a digital variant the current file or «لا يوجد ملف بعد». The owner's upload is checked before any call (type from the file or the extension, size, empty, name), then paid-file-ticket, uploadToSignedUrl, paid-file-complete, with the focus on the status or alert line. BUSY keeps the ticket for «أعد المحاولة»; a replacement is the same upload.

Sign-ups: notifications table config (read staff, insert false, new edit:false), the list without row links, no edit route, the «طلبات الإشعار» tile, and check-export (the page required, the edit page forbidden).

Statistics: «المتجر» shows the strictly parsed commerce figures, the two-date range (Riyadh days, +03:00, 366 days, reversed refused before any call), the test-data label and the contract's sentence. A failed or unreadable reply keeps the figures and never shows a zero. commerce:null keeps today's sentence.

Proof: 33 unit-like additions in admin-commerce.test.ts plus collections and table-rules (68 files, 2213 tests). 22 new e2e tests (11 at 360, 11 at 1440, real stack and sign-in): the preorder form, the count from a harness-paid preorder, a real PDF upload that fills the waiting order, NOT_A_PDF read from the function's 422, BUSY retry with the same ticket, notify-made sign-ups, figures equal to owner_commerce_stats, operations read-only. Screenshots: test-results/screenshots/P08/admin-{variant-preorder,variant-file,notifications,stats-commerce}-{360,1440}.png, no page overflow, 44px targets checked.

Files: supabase/migrations/20261003110000_variant_admin_info.sql (new), tests/integration/variant-admin-info.test.ts (new), src/lib/admin-commerce.ts (new), src/components/admin/VariantCommerce.tsx (new), src/admin/tables/notifications.ts (new), tests/unit/admin-commerce.test.ts (new), src/admin/fields.ts, src/components/admin/FieldInput.tsx, src/admin/tables/index.ts, src/admin/tables/variants.ts, src/components/admin/TableForm.tsx, src/components/admin/TableList.tsx, src/components/admin/StatsView.tsx, src/app/(admin)/admin/(shell)/store/StoreHome.tsx, src/app/(admin)/admin/(shell)/store/[table]/edit/page.tsx, scripts/check-export.mjs, tests/unit/collections.test.ts, tests/unit/table-rules.test.ts, tests/e2e/store-admin.spec.ts

Checks:
- `pnpm exec supabase migration up --local` → 0 (applied 20261003110000_variant_admin_info.sql; no reset, stack left running)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/variant-admin-info.test.ts tests/integration/static-site.test.ts` → 0 (2 files, 40 tests (9 new: grants/owner/search_path, anon+editor+revoked+inactive 42501, owner and operations answer, NOT_FOUND, committed/held/released/non-preorder counts, file with and without, replaced file, no storage key, no lock). Re-run on the final test file.)
- `pnpm exec vitest run tests/unit/admin-commerce.test.ts tests/unit/collections.test.ts tests/unit/table-rules.test.ts` → 0 (3 files, 110 tests)
- `pnpm test` → 0 (68 files, 2213 tests, final tree)
- `pnpm lint` → 0 (final tree)
- `pnpm typecheck` → 0 (final tree, also after the e2e runs (no .next/e2e problem))
- `pnpm check:copy` → 0 (232 source files)
- `pnpm build` → 0 (run before two later edits that cannot change the export: a comment in [table]/edit/page.tsx and the e2e spec. next-env.d.ts saved and restored.)
- `pnpm check:export` → 0 (59 required files incl. admin/store/notifications.html; it now also fails if admin/store/notifications/edit.html exists (it does not))
- `pnpm check:budgets` → 0 (largest public page 148.9 KiB of 150, unchanged)
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts` → 0 (33 passed in 1.9 min on the final tree (11 existing + 22 new, 11 at 360 and 11 at 1440); 10.6 GB free before; Playwright's own webServer on http://localhost:3000)
- `pnpm exec playwright test tests/e2e/cms.spec.ts` → 0 (7 passed in 1.7 min (fields.ts and FieldInput changed). The brief's one command for both specs was run as two commands; ran before the last spec-only edit.)

Contract gaps:
- dispute_record refuses an occurred_on later than today in Riyadh (22023 'Invalid dispute.'). Contract section 6 does not say so. The stats e2e therefore dates its ledger on a random empty day between 2002 and 2024, not on a far-future one.
- The brief says 'the button disabled while busy' for the paid-file upload. There is no separate upload button: choosing the file starts the upload (the file input is the control, disabled while busy), and «أعد المحاولة» (BUSY only) is disabled while busy.
- paid_assets.bytes is a nullable column and the contract gives no null case. The strict parser of variant_admin_info refuses a null bytes. No flow writes one (paid_asset_set always sets it).
- Words I chose where the brief gives none (owner to confirm): the heading «الملف المدفوع»; the hint «PDF أو EPUB، حتى 100 ميغابايت.»; the four pre-call refusals «اختر ملف PDF أو EPUB.», «الملف فارغ.», «حجم الملف أكبر من 100 ميغابايت.», «اسم الملف غير صالح؛ يجب ألا يزيد على 120 حرفًا ولا يحوي شرطة مائلة.»; «تعذّر رفع الملف؛ حاول مرة أخرى.»; «تحديث» and «لم نجد هذا الخيار.» for the panel; the form's «أدخل رقمًا.», «اختر يومًا.», «يجب ألا يكون قبل اليوم، وإلا خرج الخيار من البيع.»; stats «اترك الحقلين فارغين لآخر 30 يومًا.», «تم تحديث الأرقام.», «يوم «إلى» قبل يوم «من».», «المدى أطول من 366 يومًا.», «اختر يومًا صحيحًا.»; the sign-up column labels (البريد الإلكتروني، رمز SKU، الحالة، نسخة الموافقة، تاريخ الطلب، تاريخ التأكيد); «بيانات بيئة الاختبار» drawn as the existing badge.
- Decisions inside the brief: the paid-file section and the preorder count follow the saved variant, not the unsaved form; the replace sentence shows only once a file exists; a range with one empty day omits it and the function fills its default (to = now, from = to minus 30 days); a negative net gets a left-to-right mark so its minus stays on its left; `edit` and the list column `dir` and the text field `hint` are optional new options.

Open risks:
- Next dev answers /admin/store/notifications/edit with a 404 on the first request and with its own 'missing param in generateStaticParams' error status afterwards (it also logs the error). The e2e accepts any error status with no form. The guarantee of no edit page is the export: no static param for it, and check:export fails if the file appears.
- Disputes are append-only: the stats e2e leaves two dispute rows (one old day) per run, plus the harness's usual orders and variants. Its uploaded paid files are removed from Storage (checked: none left); the paid_assets rows stay, as orders reference them.
- Not driven in a browser: a file over 100 MiB (a 100 MB buffer is too heavy) and a name with '/' (a browser File may not keep it): both are unit-tested only. A one-sided stats range is unit-tested only.
- A preorder variant whose delivery date has passed cannot be saved (any edit) until the date is moved or preorder is switched off: the brief's rule, and the checkout already refuses such a variant.
- Choosing a file uploads at once (no confirm step), so replacing a file is one gesture; the replace sentence is shown before.
- next-env.d.ts was rewritten by the dev and build runs and restored from my copy (git status clean for it). Screenshots are git-ignored under test-results/; nothing under artifacts/acceptance/ was rewritten (ACCEPTANCE_PACKAGE unset).

## Audit 1: audit_failed

### R11C-1 [medium] src/components/admin/TableForm.tsx:221
- Problem: Uploading a paid file under the variant form breaks the form's next save on the same page. The upload bumps the variant row's version, but the form keeps the version it read at load. The next «حفظ» therefore matches no row and shows «تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.», a false claim that another session changed the row. Doing what the message says (reload) throws away any edits not yet saved. The flow that triggers it (open a digital variant, upload, then edit the price or title and save) is the round's own main flow.
- Evidence: 1. `paid_asset_set` runs `update public.product_variants set digital_asset = p_storage_key` (supabase/migrations/20261002140000_delivery.sql:445).
2. The BEFORE UPDATE trigger `product_variants_touch` runs `public.catalog_touch()`, which sets `new.version := old.version + 1` on every update (supabase/migrations/20260927160000_catalog_and_checkout.sql:44 and :221). The live trigger list confirms it.
3. A probe on the local stack, rolled back so nothing stayed, called `paid_asset_set` on a digital variant: the version went from 1 to 2.
4. TableForm reads `version` only at load (TableForm.tsx:163) and after its own save (:244). It updates with `.eq('version', version ?? 0)` (:221), so the save matches zero rows and shows CONFLICT_MESSAGE (:239).
5. On a 201, VariantCommerce only re-reads `variant_admin_info` (VariantCommerce.tsx:121). Nothing reaches TableForm.
6. The e2e upload tests (tests/e2e/store-admin.spec.ts:893 and :943) never save the form after an upload.
- Correction: 1. Give VariantCommerce an `onRecorded` callback and call it after every `paid-file-complete` the function answered, at least on 201.
2. In TableForm, re-read the row's `version` when the callback fires. Adopt the new value only when it equals the held version + 1, i.e. the upload's own bump. An edit by another session in the meantime then still ends in the conflict message.
3. Add an e2e step at 360 and 1440: upload a PDF, change the title, press «حفظ», then expect «تم الحفظ.» and the new title in the database row.

### R11C-2 [low] src/components/admin/VariantCommerce.tsx:113
- Problem: The panel is read again only after a successful completion. When the database outcome is unknown, `paid-file-complete` answers 500 FAILED but keeps the moved object, because the file may already be recorded and the waiting buyers mailed. The panel can then go on saying «لا يوجد ملف بعد» for a recorded file, and the owner uploads it again.
- Evidence: The non-ok branch returns at VariantCommerce.tsx:113-119, before `setRound` at :121. In supabase/functions/_shared/paid-files.ts:285-296, an rpc error with no SQLSTATE keeps the object, and `sqlFailure` turns it into 500 FAILED.
- Correction: Read the panel again (`setRound`, plus R11C-1's callback) after every completion attempt that reached the function, before branching on `done.ok`. In the BUSY e2e, assert that the panel was read again after the refusal.

### R11C-3 [low] supabase/migrations/20261003110000_variant_admin_info.sql:39
- Problem: `preorderUnits` keeps counting confirmed preorders after they have shipped or been delivered. The panel shows «أدخل المخزون الفعلي بعد طرح الطلبات المسبقة المؤكدة.» whenever the count is above zero (VariantCommerce.tsx:199-205). After a campaign has shipped, an owner who follows that sentence at a later restock subtracts the shipped copies from the shelf count a second time. The stock is then understated and sales are lost. The worker implemented the contract's definition exactly, so this needs a contract ruling.
- Evidence: Reservation states are only held, committed and released (20260927160000_catalog_and_checkout.sql:410). Shipping changes `finance.fulfillments` only, never the reservation. `finance.preorder_committed` sums `state = 'committed' and r.preorder` with no fulfilment condition (20261002100000_payment_core.sql:439-447). Contract §6 'Admin reads (round 11c)' defines the count this way.
- Correction: Contract ruling: `preorderUnits` counts committed preorder units whose items are not yet shipped or delivered. Alternatively, keep the total, add a «لم يُشحن بعد» figure, and attach the stock sentence to that figure.

### R11C-4 [low] src/components/admin/VariantCommerce.tsx:204
- Problem: Digital preorder variants also show the stock sentence «أدخل المخزون الفعلي بعد طرح الطلبات المسبقة المؤكدة.». A digital variant has no stock field: its stock is null and the field is hidden. The sentence asks the owner to do something this form cannot do.
- Evidence: VariantCommerce.tsx:199-205 has no `digital` condition. variants.ts:33 hides «المخزون» for digital variants. The operations e2e asserts the sentence on `s.filed`, a digital preorder (tests/e2e/store-admin.spec.ts:1179, variant made at :552).
- Correction: Keep the count on every variant, but show the stock sentence only when the saved variant is physical or signed (`!digital`). Update the e2e at :1179 to match. The brief prescribed the sentence without this condition, so the orchestrator confirms.

### R11C-5 [low] src/components/admin/TableForm.tsx:155
- Problem: The variant form's `select('*')` loads `product_variants.digital_asset`, the paid file's storage key, into the admin browser for every digital variant. The same column is readable through the Data API by any active staff session, editors included. `variant_admin_info` (this round) and `order_detail` (7b) were specified never to carry a storage key, yet the screen that shows the file receives it. Risk is small: the key is unguessable and the bucket is private with no policy, so the key alone grants nothing. This is defence in depth.
- Evidence: TableForm.tsx:155 loads the row with `.select('*')`, and :182 does the same for a product's variants. The table-level grant `grant select on public.product_variants to authenticated` is at 20260927160000_catalog_and_checkout.sql:281. The policy `product_variants_read_staff` allows any non-null staff role (:290-291).
- Correction: Orchestrator ruling. Select explicit columns for variants in TableForm: the form's fields plus id, version and product_id, without digital_asset. Then replace the table-level select with column grants that leave out `digital_asset`, after checking every `product_variants` reader, the public store's included.

### R11C-6 [low] src/components/admin/StatsView.tsx:153
- Problem: The «المتجر» money figures never say which days they cover. The first figures are the function's 30 days, unlabelled apart from the hint «اترك الحقلين فارغين لآخر 30 يومًا.». The date inputs can also show a range the figures are not for:
- after the owner edits the dates without pressing «عرض»;
- after a refused or failed «عرض», which keeps the old figures on purpose.
- Evidence: StatsView.tsx:153-167 draws only the badge, the lines and the sentence. `show` (:92-119) replaces `figures` only on success (:118) and leaves `from`/`to` as typed (:129, :135).
- Correction: Add one line above the figures that names the range they cover. Set it together with `figures`, from the request that produced them: for example «من <يوم> إلى <يوم>», or «آخر 30 يومًا» when both dates were empty. Add an e2e assertion. The brief's design is final, so the orchestrator decides.

### R11C-7 [low] src/components/admin/VariantCommerce.tsx:186
- Problem: The panel's load-failure path breaks the 11a/11b rule for live regions and focus:
- The load-failure and NOT_FOUND alerts are mounted already holding their text, not mounted empty and filled later.
- «تحديث» removes itself while it has focus (`setInfo('loading')`), so focus falls to the document body.
- The reloaded count, or the next failure, never takes focus.
The 11a/11b rule is that status and alert lines are mounted before they are filled and take the focus; R11B-3 flagged the same self-removing-button pattern.
- Evidence: VariantCommerce.tsx:177-198 renders `role="alert"` only when the state is 'failed' or NOT_FOUND. The onClick at :185-188 unmounts the pressed button. The e2e at tests/e2e/store-admin.spec.ts:807 asserts texts only, never focus.
- Correction: Keep one alert or status line for the panel always mounted, for operations and non-digital variants too. After «تحديث», put the outcome on that line and move focus to it. Assert the focus in the e2e at :807.

Checks re-run:
- `pnpm exec supabase migration up --local (local database already up to date; the live public.variant_admin_info source compared byte for byte with the migration file: equal, security definer, stable, search_path="", owner postgres, ACL postgres+authenticated only)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/variant-admin-info.test.ts tests/integration/static-site.test.ts (2 files, 40 tests)` → 0
- `pnpm exec vitest run tests/unit/admin-commerce.test.ts tests/unit/collections.test.ts tests/unit/table-rules.test.ts (3 files, 110 tests)` → 0
- `pnpm test (68 files, 2213 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck (before and again after the e2e run)` → 0
- `pnpm check:copy (232 source files)` → 0
- `pnpm build (next-env.d.ts saved and restored; git status clean for it)` → 0
- `pnpm check:export (59 required files incl. admin/store/notifications.html; out/admin/store/notifications/ holds no edit.html)` → 0
- `pnpm check:budgets (largest 148.9 KiB of 150)` → 0
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts tests/e2e/cms.spec.ts (10.7 GB free before, no headless Chrome left over, ports 3000/54390 free; 40 passed in 3.5 min: 7 cms + 33 store-admin incl. 22 round-11c tests at 360 and 1440)` → 0
- `node pg probe inside BEGIN...ROLLBACK: public.paid_asset_set on an existing digital variant, then read product_variants.version (result ok:true, version 1 -> 2; rolled back, nothing persisted)` → 0

Uncovered:
- Screenshots viewed: 5 of the 8 (admin-variant-file-360, admin-stats-commerce-360, admin-notifications-360, admin-notifications-1440, admin-variant-preorder-1440). Not viewed: admin-variant-preorder-360, admin-variant-file-1440, admin-stats-commerce-1440.
- No screen-reader pass. Accessibility was judged from the code and from the e2e's focus, label and 44px assertions.
- Not driven in a browser, unit-tested only: an EPUB upload, a file with no browser-given type (the type taken from the extension), a file over 100 MiB, a name containing '/', and a one-sided statistics range.
- The real 55P03 BUSY path from the browser was not exercised: the e2e fakes the first completion at the network layer, and the function side belongs to round 7's tests.
- Hosted Supabase Storage signed uploads were not exercised; only the local stack ran.
- No end-to-end seed sits near Riyadh midnight for the statistics range. The e2e seeds at 12:00 Riyadh, so a UTC-versus-Riyadh boundary error would only be caught by the unit test that pins the '+03:00' strings.
- Not tested by any check: saving the variant form after an upload (R11C-1), and an unknown-outcome paid-file completion (R11C-2).

## Worker report 2

Fixed R11C-1, R11C-2 and R11C-7 at their causes; no finding disputed. R11C-1: VariantCommerce takes an onRecorded callback (called after every paid-file-complete attempt) and TableForm.takeRecordedVersion re-reads the row's version and takes it only when it is held + 1, so the next save after an upload is not a false conflict, while another session's edit still ends in the conflict message. R11C-2: the panel is read again after every completion attempt, before the reply is read (a failed re-read keeps the last reading and says REREAD_FAILED). R11C-7: the status and alert lines are always mounted for every user and variant; «تحديث» stays mounted and aria-disabled while it reads, and its outcome goes on a line that takes the focus. New e2e at 360 and 1440: save after an upload (also after a completion whose reply was lost: 500 returned after the real call), the conflict still shown for another session's edit, the failed re-read after an upload, the BUSY test counting reads, focus and always-mounted assertions in the failed-read and operations tests. The mutation run proved each of the first three catches its defect. Screenshots for review (git-ignored): C://Users//alazi//Downloads//Tech//Code//My_projects//not shipped yet//ANASAQ.ME//test-results//screenshots//P08//admin-variant-file-360.png and admin-variant-file-1440.png (viewed, panel intact, no overflow), plus admin-variant-preorder-*, admin-notifications-*, admin-stats-commerce-* at both widths and the P07 set under test-results//screenshots//P07.

Files: src/components/admin/VariantCommerce.tsx, src/components/admin/TableForm.tsx, src/lib/admin-commerce.ts, tests/e2e/store-admin.spec.ts

Checks:
- `pnpm typecheck` → 0 (also re-run after the spec edit and after the e2e runs: 0, no TS1128 from .next/e2e)
- `pnpm lint` → 0
- `pnpm check:copy` → 0 (232 source files)
- `pnpm exec supabase migration up --local` → 0 (local database already up to date)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/variant-admin-info.test.ts tests/integration/static-site.test.ts` → 0 (2 files, 40 tests)
- `pnpm exec vitest run tests/unit/admin-commerce.test.ts tests/unit/collections.test.ts tests/unit/table-rules.test.ts` → 0 (3 files, 110 tests)
- `pnpm test` → 0 (68 files, 2213 tests)
- `pnpm build` → 0 (next-env.d.ts copied aside and restored (git shows it clean))
- `pnpm check:export` → 0 (59 required files present, no secrets)
- `pnpm check:budgets` → 0 (largest 148.9 KiB of 150)
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts` → 0 (final run: 39 passed in 2.1 min (the 11c block at 360 and 1440, three new tests per width). 10.9 GB free before. An earlier attempt with PLAYWRIGHT_BASE_URL set to an empty string failed at once on an invalid URL (my command error, no test ran, nothing left behind); the run after it, before the third new test was added, was 37 passed.)
- `pnpm exec playwright test tests/e2e/cms.spec.ts` → 0 (7 passed in 1.8 min, run as its own command (the 10-minute foreground limit); app source unchanged since)
- `mutation check: the three fixes reverted at once, then pnpm exec playwright test tests/e2e/store-admin.spec.ts --grep "at 360px the owner (says it could not read the variant|keeps the ticket when|saves the form after|still ends in the conflict)"` → 1 (expected: 3 failed, 1 passed. The focus test failed (toBeFocused after «تحديث»), the BUSY test failed (reads expected one more), the save-after-upload test failed (no «تم الحفظ.»); the conflict test passed. VariantCommerce.tsx and TableForm.tsx restored from copies and checked with cmp: byte-exact.)

Open risks:
- R11C-1's rule is exact for a 201 and ambiguous for a completion whose outcome is unknown: if nothing was recorded and another session edited the row exactly once in that window, the form takes that version and its next save overwrites the other session's change. Narrow, and the correction named the rule (held + 1).
- A «حفظ» pressed in the few tens of milliseconds between the upload's database write and the form's version read can still show the false conflict message once; pressing again works.
- Copy choice not in the brief: «تم التحديث.» (REFRESHED in src/lib/admin-commerce.ts) is the status sentence after a successful «تحديث»; the orchestrator may want other words.
- The panel's status and alert lines now always exist, so their ids are variant-commerce-status and variant-commerce-alert (were variant-paid-file-*; the e2e is updated, nothing else referenced them). Two empty lines add about 0.75rem of flex gap at the end of the panel for operations and non-digital variants.
- Behaviour change I introduced, covered by a new e2e: when the re-read after an upload fails, the panel keeps the last reading and the alert line says the upload's sentence plus REREAD_FAILED (the OrderView pattern) with no «تحديث»; before it replaced the panel with the failure state.
- next dev logs 'Failed to generate static paths for /admin/store/[table]/edit' during the notifications edit-page assertions: expected, that route must not exist.
- Free memory was 10.7 to 10.9 GB for every e2e run, close to the 10 GB floor. Screenshots were written to git-ignored test-results/screenshots only (ACCEPTANCE_PACKAGE unset); nothing under artifacts/acceptance was rewritten, so nothing to restore.

## Audit 2: pass

### R11C-8 [low] src/components/admin/VariantCommerce.tsx:163
- Problem: New defect from the R11C-1 fix: after an upload the function refused, the form's next save can silently overwrite another session's change.
- The fix re-reads the row's version after every completion attempt, refusals included, and TableForm takes it when it is exactly one step ahead.
- A refused completion recorded nothing, so that one step can only come from another session's save.
- The form takes that version, and its next «حفظ» overwrites the other session's change with no conflict message. That change can be a price, the stock or the preorder fields.
- Before the fix this case ended in the conflict message.
Example: tab A saves a lower price. Tab B, opened earlier on the same variant, tries an upload that is refused (NOT_A_PDF, MISSING_FILE, BUSY). Tab B's next save writes its old price back.
The rule "held + 1" came from my own R11C-1 correction; it is wrong when the completion was refused.
- Evidence: 1. VariantCommerce.tsx:163 runs `Promise.all([reread(), onRecorded()])` after every completion attempt, before it checks `done.ok` at :165.
2. TableForm.tsx:264 takes any `read === held + 1`, with nothing showing the step was the upload's.
3. These refusals record nothing:
   - MISSING_FILE, TYPE_MISMATCH, TOO_LARGE, NOT_A_PDF and NOT_AN_EPUB come before any SQL (supabase/functions/_shared/paid-files.ts:253-272).
   - NOT_FOUND and NOT_DIGITAL are an `{ok:false}` reply (:298-302).
   - BUSY, CONFLICT, INVALID and FORBIDDEN carry a SQLSTATE, so the transaction rolled back (:294-296).
   - The same holds for a call that never reached the function (UNKNOWN from callFunction).
4. The save then sends `.eq('version', version)` (TableForm.tsx:221), which now matches the other session's version.
5. The clash e2e (tests/e2e/store-admin.spec.ts:1084) covers only a recorded upload (held + 2). No test covers a refused one.
The three earlier worker findings are fixed at their causes, each with an e2e that fails without its fix (the worker's mutation run, and my rerun green at both widths):
- R11C-1: save after an upload, also after a lost 201 (:1029).
- R11C-2: the panel is read again after BUSY (:1007).
- R11C-7: the lines are always mounted (:796, :1330) and the focus goes to the result after «تحديث» (:816).
- Correction: 1. In VariantCommerce.complete, keep `reread()` after every attempt. Call `onRecorded()` only when the file may have been recorded: on `done.ok`, or on an unknown outcome (codes FAILED and UNKNOWN).
2. Better, for an unknown outcome: call it only when the re-read shows a different file from the one shown before the upload.
3. Never call it for the refusals listed in the evidence.
4. Add an e2e at 360 and 1440:
   - another session changes the variant's title (service role);
   - the owner uploads a text file renamed .pdf (NOT_A_PDF), types a title and presses «حفظ»;
   - expect the conflict message, the typed title still in the field, and the other session's title still in the row.

### R11C-3 [low] supabase/migrations/20261003110000_variant_admin_info.sql:39
- Problem: Still open, no ruling recorded. `preorderUnits` keeps counting confirmed preorders after they have shipped or been delivered. The panel still tells the owner to subtract them from real stock, so stock entered at a later restock is too low and sales are lost.
- Evidence: Unchanged by the fix pass.
- Line 39 calls `finance.preorder_committed`, which sums `state = 'committed' and r.preorder` with no fulfilment condition (20261002100000_payment_core.sql:445-447).
- Shipping changes only `finance.fulfillments`, never the reservation.
- VariantCommerce.tsx:229-236 shows the stock sentence whenever the count is above zero.
- Contract §6 'Admin reads (round 11c)' defines the count this way, so the worker built what was asked.
- artifacts/acceptance/P08/rounds/round-11c.md does not exist yet.
- Correction: Contract ruling: count only committed preorder units whose items are not yet shipped or delivered. Alternatively, keep the total, add a «لم يُشحن بعد» figure, and attach the stock sentence to that figure.

### R11C-4 [low] src/components/admin/VariantCommerce.tsx:234
- Problem: Still open, no ruling recorded. Digital preorder variants show «أدخل المخزون الفعلي بعد طرح الطلبات المسبقة المؤكدة.», but a digital variant has no stock field.
- Evidence: - VariantCommerce.tsx:229-236 has no `digital` condition.
- src/admin/tables/variants.ts:33 hides «المخزون» for digital variants.
- tests/e2e/store-admin.spec.ts:1326 asserts the sentence on `s.filed`, a digital preorder created at :559.
- The sentence is visible under a digital variant in test-results/screenshots/P08/admin-variant-file-1440.png.
- Correction: Keep the count on every variant. Show the stock sentence only when the saved variant is not digital, and update the e2e at :1326. The brief prescribed the sentence without this condition, so the orchestrator confirms.

### R11C-5 [low] src/components/admin/TableForm.tsx:155
- Problem: Still open, no ruling recorded. The variant form's `select('*')` loads `product_variants.digital_asset`, the paid file's storage key, into the admin browser. Any active staff member, editors included, can read that column through the Data API. This is defence in depth only: the bucket is private and has no policy, so the key alone grants nothing.
- Evidence: - TableForm.tsx:155 loads the row with `.select('*')`; :182 does the same for a product's variants.
- 20260927160000_catalog_and_checkout.sql:281 grants select on the whole table: `grant select on public.product_variants to authenticated`.
- The policy `product_variants_read_staff` (:290) allows any staff role.
- `variant_admin_info` and `order_detail` were both specified never to return a storage key.
- Correction: 1. In TableForm, select explicit columns for variants: the form's fields plus id, version and product_id, without digital_asset.
2. Then replace the table-level select grant with column grants that leave out `digital_asset`, after checking every reader of `product_variants`, the public store's included.

### R11C-6 [low] src/components/admin/StatsView.tsx:153
- Problem: Still open, no ruling recorded. The «المتجر» money figures never say which days they cover. The date inputs can show a range the figures are not for:
- after the owner edits the dates without pressing «عرض»;
- after a refused or failed «عرض», which keeps the old figures on purpose.
- Evidence: - StatsView.tsx:153-165 draws only the badge, the lines and the sentence.
- `show` (:92-120) replaces `figures` only on success (:118) and leaves `from` and `to` as typed.
- test-results/screenshots/P08/admin-stats-commerce-1440.png has no line naming the range.
- Correction: Add one line above the figures naming the range they cover, set together with `figures` from the request that produced them: «من <يوم> إلى <يوم>», or «آخر 30 يومًا» when both dates were empty. Add an e2e assertion. The brief's design is final, so the orchestrator decides.

Checks re-run:
- `pnpm exec supabase migration up --local (local database already up to date)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/variant-admin-info.test.ts tests/integration/static-site.test.ts (2 files, 40 tests)` → 0
- `pnpm exec vitest run tests/unit/admin-commerce.test.ts tests/unit/collections.test.ts tests/unit/table-rules.test.ts (3 files, 110 tests)` → 0
- `pnpm test (68 files, 2213 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck (before the e2e run, and again after it: no TS1128 from .next/e2e)` → 0
- `pnpm check:copy (232 source files)` → 0
- `pnpm build (next-env.d.ts copied aside and restored; git status clean for it)` → 0
- `pnpm check:export (59 required files incl. admin/store/notifications.html; out/admin/store/notifications/ holds no edit.html)` → 0
- `pnpm check:budgets (largest 148.9 KiB of 150)` → 0
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts tests/e2e/cms.spec.ts (11.08 GB free before, no Playwright or headless Chrome left over, ports 3000 and 54390 free, PLAYWRIGHT_BASE_URL unset so http://localhost:3000; 46 passed in 3.7 min: 7 cms + 39 store-admin, including the new save-after-upload, clash and failed-re-read tests at 360 and 1440)` → 0

Uncovered:
- No test covers R11C-8: a refused paid-file completion followed by a save while another session has changed the variant.
- No test presses «حفظ» while an upload is in flight. Two short windows end in a false conflict message (the safe direction), and a second press works. (1) A save that lands between the upload's database write and the form taking the new version. (2) A save whose reply is applied after the form read the version again. The worker disclosed the first.
- No screen-reader pass. Accessibility was judged from the code and from the e2e's focus, label and 44px checks, in Chromium only (no WebKit run).
- Unit-tested only, never driven in a browser: an EPUB upload, a file the browser gives no type (type taken from the extension), a file over 100 MiB, a name containing '/', and a one-sided statistics range.
- The real 55P03 BUSY path from the browser: the e2e fakes the first completion at the network layer.
- Hosted Supabase Storage signed uploads: only the local stack ran.
- No e2e seed near Riyadh midnight for the statistics range. The e2e seeds at 12:00 Riyadh, so a UTC-versus-Riyadh boundary error would be caught only by the unit test that pins the '+03:00' strings.
- Screenshots: all eight round-11c screenshots are now viewed across the two audits. This pass viewed admin-variant-preorder-360, admin-variant-file-1440, admin-stats-commerce-1440, and a 3x crop of admin-notifications-360. The left-hand label on the LTR email and SKU cards at 360 follows the accepted 11a OrdersView pattern (`td dir="ltr"`), so it is not a finding.


## The orchestrator's rulings and own audit (2026-10-03)

The workflow ended `audit_pass` after one build, an audit (one medium, six low), one fix pass and a second audit (one new low, four low waiting for a ruling). The workers read no `.env` file. I read the migration line by line: `security definer`, owner `postgres`, `search_path ''`, `finance.require_staff(false)` before the variant is looked up, `revoke ... from public, anon` and `grant ... to authenticated`, no storage key and no buyer in the reply.

| Finding | Ruling |
|---|---|
| R11C-1, R11C-2, R11C-7 (a save after an upload met a false conflict; the panel not re-read after `BUSY`; the lines not mounted and the focus lost after «تحديث») | Fixed by the fix pass at their causes, with tests that fail without them (the second audit checked them). |
| R11C-8 (new: after an upload the function refused, the form took the next version as the upload's, so a save made meanwhile by another session would be overwritten) | Fixed by me: the form takes the bumped version only when the file may have been recorded (a success, or an unknown outcome: no code, `UNKNOWN`, `FAILED`); a refusal recorded nothing, so a version one step on is another session's and the next save meets it as a conflict. E2E added at both widths: another session renames the variant, the owner's text file renamed `.pdf` is refused, the save shows the conflict, the typed title stays, the other session's title is kept. |
| R11C-3 (the count kept confirmed preorders after they shipped, while the panel tells the owner to subtract it from real stock) | Ruled: the count is the confirmed preorders not yet shipped or delivered (shipped copies have left the stock he counts); the capacity rule still counts every committed one. Changed in this round's migration (not yet committed, so edited in place and the database rebuilt), the label is «طلبات مسبقة مؤكدة لم تُشحن» and the sentence «أدخل المخزون الفعلي بعد طرح هذه الطلبات.». Contract section 6 updated; the integration test ships and delivers one order and the count drops by its units. |
| R11C-4 (the stock sentence under a digital variant, which has no stock field) | Fixed by me: the count stays, the sentence shows only for a variant that is not digital (E2E updated). |
| R11C-5 (the variant form's `select('*')` loads `digital_asset`, the paid file's storage key, into an admin browser) | Deferred to P10's security pass, recorded in ISSUES: the bucket is private with no policies, so the key alone grants nothing; narrowing the table-wide select grant touches every reader of `product_variants`. |
| R11C-6 (the money figures did not say which days they cover) | Fixed by me: a line above the figures, set with them from the request that fetched them («الأرقام لآخر 30 يومًا.», «الأرقام من … إلى ….»), so edited but unsubmitted dates never mislabel them (E2E asserted). |

The worker's words where the brief gave none are accepted, and its choices too: the file input itself starts the upload; the panel follows the saved variant, not the unsaved form; a negative net keeps its minus on the left; `dispute_record` refusing a future day (the stats e2e seeds an old day; worth one line in the contract's dispute paragraph at the close). Left for checkpoint (c): an EPUB upload, a file the browser gives no type, a file over 100 MiB and a one-sided range are proven in unit tests only; a save pressed while an upload is in flight can end in a false conflict (the safe direction).

My own browser pass, on the dev server and the real local stack, signed in as a local test owner: the variant form of `DEMO-KHOUS-PAPER` at 1440 with preorder off (no preorder fields, no count), «طلب مسبق» switched on from the keyboard (the three fields, the date input and the hint «تظهر للمشتري قبل الدفع.» appear), and a save with them empty refused with each field named and nothing saved; at 360 the store home's «طلبات الإشعار» tile, the read-only list (empty: «لا توجد سجلات بعد.», no «جديد»; with one local sign-up: its address, `DEMO-MOON-CUP`, «مؤكَّد», «بلا», the two times, no row link), and the statistics section with «بيانات بيئة الاختبار», «الأرقام لآخر 30 يومًا.», the seven lines and the contract's sentence, its 11 paid orders and 940.00 ر.س equal to `owner_commerce_stats` called directly for the same range. No horizontal overflow. The paid-file upload itself was driven by the e2e with a real PDF (this browser pane cannot attach a file).

Checks on the final tree: `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; from a fresh `supabase db reset` with both imports and the edge runtime restarted: `vitest --mode db` on variant-admin-info and static-site 0 (40 tests), `pnpm test` 0 (68 files, 2213 tests), `pnpm build` 0, `pnpm check:export` 0 (59 files, `admin/store/notifications.html` included, no edit page), `pnpm check:budgets` 0 (largest 148.9 KiB), `pnpm exec playwright test tests/e2e/store-admin.spec.ts tests/e2e/cms.spec.ts` 48 passed (10.7 GB free before; `next-env.d.ts` restored). No call to Moyasar.
