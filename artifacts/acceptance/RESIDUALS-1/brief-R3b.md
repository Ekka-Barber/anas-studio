# RESIDUALS-1, round R3b: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R3b, branch `agent/residuals-1` with R1,
R2a, R2b and R3a committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI
2.106.0, Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no Deno (CI runs
`deno check`). The package's rounds: `SCOPE.md`; how the earlier rounds ended: `RECORD-R1.md`, `RECORD-R2a.md`,
`RECORD-R2b.md`, `RECORD-R3a.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `PLANS/DESIGN-AUDIT.md` (every item that
applies to an admin control you change), `docs/payments-runbook.md`, and each entry's block in
`artifacts/acceptance/FABLE-AUDIT/work/waveC/digest.md` by its id. R2b changed the screens this round changes
(`ReconciliationView.tsx`, `OrderView.tsx`: the other payment mode's controls give way to «دفعة من وضع الدفع الآخر؛ تُدار
من لوحة Moyasar.»); keep that rule on everything you add. Where this brief decides otherwise, it wins.

## Write only these paths

- `supabase/migrations/20261015160000_residuals_r3b.sql` (new: every SQL change of this round, one file)
- `supabase/functions/_shared/contact.ts`, `checkout.ts`, `orders.ts`, `notify.ts`, `disputes.ts`, `media.ts`,
  `media-rules.ts`, `paid-files.ts`; new pure modules under `supabase/functions/_shared/` that items 9 and 10 name;
  `supabase/functions/staff-admin/index.ts`
- `src/lib/admin-orders.ts`, `admin-money.ts`, `admin-commerce.ts`; `src/admin/tables/variants.ts`
- `src/components/admin/ReconciliationView.tsx`, `OrderView.tsx`, `RefundView.tsx`, `DisputeForm.tsx`,
  `VariantCommerce.tsx`, `TableForm.tsx`, `MediaUpload.tsx`, `MediaLibrary.tsx`; `src/components/store/OrderPage.tsx`
  (item 10's one import only)
- tests: `tests/unit/admin-money.test.ts`, `admin-refunds.test.ts`, `admin-disputes.test.ts`, `admin-commerce.test.ts`,
  `admin-orders.test.ts`, `admin-paid-files.test.ts`, `media.test.ts`, `media-library.test.ts`, `table-rules.test.ts`,
  `staff-admin-function.test.ts`, `orders-page.test.ts`, `email.test.ts`; `tests/integration/stats.test.ts` and the one
  integration file that tests the variants' table rules (name it in your report); `tests/e2e/store-admin.spec.ts`,
  `orders-money.spec.ts`, `orders-admin.spec.ts`
- `docs/payments-runbook.md` (the paragraphs items 2 and 3 change)

Any other path: stop and report. Every earlier migration stays untouched: a function you change is created again in the
new file from its latest definition.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, with these additions: Arabic copy exactly
as given here; money screens stay calm (no new motion); the public JavaScript budget (if `pnpm check:budgets` fails
after item 10's import, take that import back out and say so); a new sentence that reports a state is announced as the
screen's existing ones are. The local outbox's daily allowance may be spent: as in `brief-R2b.md`. Work in the order
below; if your run is cut short, your last message says what is built, what ran, and what is left.

## The items

1. **ADMIN-COMMERCE-11, what a refund also does** (`RefundView.tsx`, `src/lib/admin-money.ts`). Decided: the
   confirmation of an order's refund lists, under its lines and above «سيُعاد المبلغ…», what the ledger will do on
   success, from one pure exported function of the order, the frozen lines, the total and what the paying attempt can
   still give back: when the total takes all of that, every line counts as refunded in full; otherwise a line counts
   when its amount equals what is left of it. A digital line refunded in full: «سيُسحب الملف: <the line's name>». A
   physical or signed line refunded in full that has not shipped and is not stopped: «لن يُشحن: <the line's name>», and
   once per SKU «لا يعود المخزون تلقائيًا؛ عدّل مخزون <SKU> بعد الاسترداد.». A line already refunded in full lists
   nothing. A review payment's refund lists nothing. Whether a goodwill refund should keep the file is the owner's
   policy: not built. Proof: unit tests of the function (a partial line, a full digital line, the total that empties
   the payment, a shipped physical line, a stopped one, two lines of one SKU).
2. **ADMIN-COMMERCE-09, a payment Moyasar shows voided** (`OrderView.tsx`, `RefundView.tsx`). Decided: when the paying
   attempt's provider status is `voided`, the order's refund form gives way to «أُلغيت هذه الدفعة لدى Moyasar؛ سجّل
   الإلغاء هنا.» with the «تسجيل استرداد خارجي» form already open (it reads the amount from Moyasar itself:
   `refund_record_external` records a void as the whole unrefunded amount). `docs/payments-runbook.md`: one line where
   a void is described. Proof: a unit test of the choice; `orders-money.spec.ts`, an order whose paying attempt reads
   `voided`.
3. **ADMIN-COMMERCE-06, a review payment in another currency** (`ReconciliationView.tsx`, `OrderView.tsx`,
   `RefundView.tsx`, `src/lib/admin-money.ts`; `owner_commerce_stats`, latest in `20261002170000_stats_disputes.sql`).
   Decided: a review payment whose `currency` is not `SAR` shows its amount and its refunded total as the amount in that
   currency's own units with its code, in a `<bdi dir="ltr">` (for example `10.000 KWD`: the minor units divided by the
   currency's digits, which `Intl.NumberFormat`'s `resolvedOptions().maximumFractionDigits` gives; 2 for a code it does
   not know), never with «ر.س»; its refund form gives way to «دفعة بعملة أخرى؛ أعدها من لوحة Moyasar ثم سجّلها هنا.»,
   and «تسجيل استرداد خارجي» stays. `owner_commerce_stats` sums the review payments' amounts and refunds over `SAR` ones
   only (the open count stays every currency). `docs/payments-runbook.md`: one line where the review payments are
   described. Proof: unit tests of the amount's text (SAR, USD, KWD, an unknown code) and of the form's choice;
   `stats.test.ts`: a USD review payment in the range changes the count of open ones and neither sum.
4. **ADMIN-COMMERCE-03, the statistics' review line** (`src/lib/admin-commerce.ts` `commerceLines`). Decided, the
   digest's wording: `دفعات وصلت للمراجعة في المدة: مبالغها X، المسترد منها Y، المفتوح منها الآن N`. Proof:
   `admin-commerce.test.ts` and the expectation in `store-admin.spec.ts`.
5. **ADMIN-COMMERCE-12, the dispute form's lines** (`ReconciliationView.tsx`, `DisputeForm.tsx`). Decided: the open
   form's key is kept in a ref and an answer for a form that is no longer open is dropped; the order's lines are
   `'loading'`, the lines, `'failed'` (the read failed or found no order), or null (no order at all). `DisputeForm` says
   «يحمّل بنود الطلب…» while they load and «تعذّر قراءة بنود الطلب؛ أغلق النموذج وافتحه من جديد أو سجّل من صفحة الطلب.»
   when they failed, and offers in both cases what it offers today without lines. Proof: unit tests (the stale answer
   dropped, through a small pure function if the component cannot be rendered in the unit suite; the two sentences).
6. **The closed review card's «تسجيل اعتراض»** (`ReconciliationView.tsx`, «دفعات بلا طلب أُغلقت مراجعتها»; R1's
   record left it to this round). Ruled: a chargeback can arrive after a review was closed, and `dispute_record` accepts
   a closed review payment, so each closed card of the current mode offers «تسجيل اعتراض» exactly as an open card does
   (the same form, with no order). Proof: a unit or e2e test that the closed card offers it and an other-mode one does
   not.
7. **ADMIN-COMMERCE-14, changing the type of a variant that has a paid file** (the migration; `TableForm.tsx`,
   `src/admin/tables/variants.ts`). Decided: the migration renames the check `product_variants_check1` (`fulfillment =
   'digital' or digital_asset is null`; check the name with `pg_get_constraintdef` before you rename) to
   `product_variants_file_needs_digital`; a table's config may map a check's name to its own sentence, and `TableForm`
   shows that sentence when a 23514 names that check (else «تحقق من القيم.» as today). The variants' config maps it to
   «لهذا الخيار ملف مدفوع؛ أنشئ خيارًا جديدًا للنسخة الورقية.». Proof: a unit test of the message's choice; the variants'
   integration file: the refused update names the renamed check.
8. **ADMIN-COMMERCE-15, a digital variant on sale with no file** (`VariantCommerce.tsx`, `TableForm.tsx`). Decided: the
   saved variant's «معروض» reaches the panel; when the saved variant is digital, not a preorder, on sale, and the panel
   read no file, its alert line says «هذا الخيار معروض للبيع بلا ملف: من يشتريه ينتظر حتى ترفع الملف. ارفع الملف أو
   أوقف عرضه.». Refusing to save such a variant is the owner's call: not built. Proof: a unit test of the condition.
9. **QUALITY-18, the staff order search and an Arabic domain** (`src/lib/admin-orders.ts`; `_shared/contact.ts`,
   `checkout.ts`, `orders.ts`, `notify.ts`). Decided, the digest's fix: a new pure module
   `supabase/functions/_shared/email-address.ts` holds `EMAIL_SHAPE`, `toAsciiAddress` and the one email field the four
   functions use (lowercased, then converted, then checked, as `contact.ts` does today); the four import it; the
   search's `normalizeOrderQuery` lowercases, converts and checks with them. Proof: `admin-orders.test.ts` (an address at
   `.السعودية` becomes its `xn--` form; a malformed one is still refused); the four functions' existing tests stay green.
10. **QUALITY-24, one Riyadh day and one set of limits.** Decided: a new pure module
    `supabase/functions/_shared/riyadh-day.ts` holds `riyadhToday` and `isDay` (from `admin-commerce.ts`);
    `admin-commerce.ts`, `admin-money.ts` and `_shared/disputes.ts` use them (the libs may re-export them for their
    importers); the dispute form's day check is `isDay`. The media limits (`ORIGINAL_MIME_TYPES`, `MAX_ORIGINAL_BYTES`,
    `MAX_PIXELS`, `MAX_DERIVATIVE_BYTES`) move to `media-rules.ts`, which `media.ts` and `MediaUpload.tsx` import;
    `PAID_FILE_MAX_BYTES` moves to a pure module that `paid-files.ts` and `admin-commerce.ts` import; `MediaLibrary.tsx`
    uses `formatFileSize`; `OrderPage.tsx` uses `preorderSentence` (if the budget allows). Proof: `admin-money.test.ts`
    (`2026-02-30` refused); the existing tests of each moved piece stay green.
11. **The order link of the other mode** (`OrderView.tsx`; R2b's audit, outside its five controls). Decided: on an order
    of the other payment mode, «إعادة إرسال رابط الطلب» is not offered (the order page answers such a link NOT_FOUND, and
    `order_link_reissue` takes no mode); when the mode cannot be read it stays, as R2b's controls do. Proof: a unit test of
    the choice, or the order view's other-mode e2e in `orders-money.spec.ts`.
12. **QUALITY-26, `staff-admin`'s body** (`supabase/functions/staff-admin/index.ts`). Decided:
    `const text = await boundedText(req, 4096); if (text === null) return fail(413, 'TOO_LARGE', 'الطلب أكبر من المسموح.')`.
    Proof: `staff-admin-function.test.ts` (a body over 4,096 bytes, and one of 4,096 bytes of Arabic text, which the old
    check let through by UTF-16 length).

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. `supabase migration up` (local); after any edit under `supabase/functions`, `docker restart
   supabase_edge_runtime_ANASAQ.ME`; then `pnpm test:db` (all files; `TEST_ENV=local`, `DATABASE_URL` from `supabase
   status -o json`, never printed);
3. a mutation for items 1, 3 (the SQL's filter) and 7 (revert the change, run its test, see it fail, restore);
4. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/store-admin.spec.ts tests/e2e/orders-money.spec.ts tests/e2e/orders-admin.spec.ts` (Playwright on
   `http://localhost:3000`; restore `next-env.d.ts` afterwards); otherwise say so and list the e2e tests you changed;
5. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the three largest pages).

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, what you moved and restored in the
outbox if anything, anything not done and why, and the risks left. Do not accept your own work.
