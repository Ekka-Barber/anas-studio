# Brief: P07 round 2, the store admin and the approved policies

You work under `.anasaq-execution.lock` at the commit that adds this brief. Do this one task, run the checks, report, stop.

Read first:
- `PLANS/ARCHITECTURE.md` "Collections" and the sentence "Commercial collections … use the same configs and generic screens without drafts";
- `PLANS/DATA-AND-SECURITY.md` "Content schema" rows for products, variants, coupons, customers, shipping rates and commerce_settings;
- `PLANS/DECISIONS.md` D06, D34 and D37;
- `PLANS/DESIGN-AUDIT.md` items 2, 45, 56 and 95;
- `supabase/migrations/20260927160000_catalog_and_checkout.sql`. It is the contract, with the RLS, column grants and triggers the screens must respect. Do not edit it.

Then follow these existing patterns:
- **Field configs:** `src/admin/fields.ts`, `src/admin/collections/*.ts`, `src/components/admin/FieldInput.tsx`.
- **Content screens:** `src/components/admin/{CollectionList,CollectionForm,DocumentEditor}.tsx` and `src/app/(admin)/admin/content/**`. They show the static-export route pattern (`[x]/page.tsx` with `generateStaticParams`, `edit?id=`), the headings, the back link and the card tables.
- **Step-up and the admin action:**
  - `src/components/admin/CommerceSettingsForm.tsx` and `src/components/admin/StepUp.tsx`;
  - `supabase/functions/_shared/{admin,commerce-settings}.ts`;
  - `supabase/migrations/20260927130000_commerce_settings.sql`;
  - `tests/integration/commerce-settings.test.ts`.
- **Screenshots and overflow checks:** `tests/e2e/owner-operations.spec.ts`.

## 1. Three new field types

In `src/admin/fields.ts`:
- **`number`:** an integer with `min`/`max` on the field. The schema is `z.number().int()` within them.
- **`money`:** integer halalas (D06) with an optional `max`. The schema is `z.number().int().min(1)`, and `.max(field.max ?? 10_000_000)`.
- **`datetime`:** an ISO timestamp. The schema is `isoDateSchema`.

`required: false` and `nullable` work as for the other types. In `defaultsForFields`, `number` and `money` default to `null` when nullable, otherwise `0`; `datetime` defaults to `null` when nullable, otherwise `''`.

In `FieldInput.tsx`:
- **`number`:** `<input type="number" inputmode="numeric" dir="ltr">`. Empty becomes `null` when nullable.
- **`money`:** a text input `inputmode="decimal" dir="ltr"`, with a short « ر.س» label after it.
  - It shows the value as riyals with two decimals and accepts `69`, `69.5` and `69.50`, with Arabic-Indic digits allowed. Fold them the way `supabase/functions/_shared/saudi-mobile.ts`'s `foldDigits` does; reuse it if its behaviour fits.
  - It stores integer halalas using string arithmetic, never `* 100` on a float.
  - Invalid input shows «أدخل مبلغًا صحيحًا بالريال، مثل 69 أو 69.50.» and leaves the stored value unchanged.
  - Empty becomes `null` when nullable. A nullable empty price also shows «غير مسعّر: لا يُعرض للبيع.»
- **`datetime`:** `<input type="datetime-local">`, read and written as Riyadh wall-clock time (UTC+3 all year), stored as an ISO string. Empty becomes `null` when nullable.

Put the pure conversions in `src/lib/money-input.ts`: `parseRiyals(text) → number | null | 'invalid'`, `formatRiyalsInput(halalas)`, and the Riyadh datetime-local round trip. Add unit tests in `tests/unit/money-input.test.ts`:
- `69.99` → 6999, `0.1` → 10, `10` → 1000, `٦٩٫٥` → 6950;
- `1e3`, `-5`, `69.999` and `abc` are invalid;
- a Riyadh round trip across midnight.

## 2. Table-backed records: configs and two generic screens

The catalog tables are plain rows with a `version` column, not content documents: there are no drafts and no publish step. A save is a Data API write under the caller's JWT. RLS and the column grants decide what is allowed.

Configs in `src/admin/tables/{index,products,variants,shipping-rates,coupons,customers}.ts`, one per table. Each config names:
- the table and its Arabic label;
- the list columns;
- the form fields, as `Field`s from `fields.ts`, restricted to the columns the migration grants on insert and update;
- the default order;
- who may write: owner only. Customers: the owner edits `name` and `phone` only, with no insert. Operations read products, variants, rates and customers and write nothing. Editors see nothing of the store.
- a `toRow` / `fromRow` mapping where the UI differs from the column. The coupon percentage is typed as a percentage with up to two decimals and stored as basis points: 10 → 1000, 12.5 → 1250.

The configs, field by field:

| Config | Fields | Rules |
|---|---|---|
| products | `slug`, `title`, `summary` (textarea), `body` (richtext), `cover_image` (image, nullable), `status` (select, labels «مسودة»/«منشور»/«مؤرشف»), `sort_order` (number) | Lists show a «تجريبي» badge where `demo`. |
| variants | Edited only from their product's page; `product_id` is fixed. `sku` (text, upper-case on save), `title`, `fulfillment` (select, labels «رقمي»/«ورقي»/«موقّع»), `price_halalas` (money, nullable), `enabled` (boolean), `stock` (number, min 0), `low_stock_threshold` (number, nullable), `sort_order` | `stock` shows only for «ورقي» and «موقّع», is required there, and is sent as `null` for «رقمي» (the table's check). `digital_asset` is not in the form; paid files arrive with P08. |
| shipping-rates | `city_key` (slug), `name_ar`, `fee_halalas` (money, nullable, a fee of 0 allowed), `enabled`, `sort_order` | A null fee reads «غير مسعّر: لا نوصل إليها». |
| coupons | `code`, `kind` (select «نسبة»/«مبلغ ثابت»), `percent` (shown when the kind is a percentage) or `amount_halalas` (money, shown for a fixed amount), `starts_at` / `ends_at` (datetime, nullable), `min_subtotal_halalas` (money, 0 allowed), `usage_limit` (number, nullable, min 1), `product_ids` (checkboxes of the products; none means every product), `enabled` | Save the field the other kind does not use as `null`. |
| customers | `email` (read only), `name`, `phone` (Saudi mobile through `normalizeSaudiMobile`, nullable), created | |

The money field must allow a fee of 0 where the table allows it: add a `min` to `money` fields.

Screens, in the static-export route pattern:
- **`src/app/(admin)/admin/store/page.tsx`:** tiles for المنتجات, التوصيل, أكواد الخصم and العملاء, plus السياسات, which links to `/admin/content/policies`. Owner and operations only. When any demo row exists, a line says «بيانات المتجر الحالية تجريبية، يحرّرها أنس أو يستبدلها قبل الافتتاح.» (D37).
- **`src/app/(admin)/admin/store/[table]/page.tsx`:** the list. `generateStaticParams` over the config keys except variants. «جديد» for the owner (not for customers), rows linking to the edit page, the card layout on phones (`styles.responsive`, with `data-label` on each cell), and `AdminShell wide`.
- **`src/app/(admin)/admin/store/[table]/edit/page.tsx`:** the form, opened with `?id=<uuid>` or `?id=new`, and for a variant `?product=<uuid>`. The components are `src/components/admin/{TableList,TableForm}.tsx`.
  - **Heading:** a title h1 and a link back to the list, like `CollectionForm`.
  - **Save:**
    - an insert, or an update with `.eq('id', id).eq('version', version).select()`;
    - zero rows updated shows «تغيّر هذا السجل من جلسة أخرى. حمّل آخر نسخة ثم أعد التعديل.» and keeps the typed values;
    - a unique violation (23505) names the field, for example «المعرّف مستخدم من قبل.»
  - **Other errors:** a check violation (23514), with «تحقق من القيم.» and no internal detail.
  - **No delete buttons:** retire a row with `status = archived` or `enabled = false`, because orders reference rows.
  - **A product's page** lists its variants below the form, as cards on phones, with «إضافة خيار».
  - **A variant's page** links back to its product.
  - **Read-only viewers** see the values without inputs.

Add «المتجر» to the admin nav in `AdminShell.tsx` for owner and operations.

## 3. Policies as content, approved by the owner

- **The collection:** `src/admin/collections/policies.ts`, fields `title` (text) and `body` (richtext), exactly the shape the demo seed wrote.
  - Register it in `src/admin/collections/index.ts`: in `collections`, in `COLLECTION_LABELS` as «السياسات», in `schemaFor`, and in `documentTitle` (the title, or the fixed label).
  - It has fixed documents, like rooms: `store` «سياسة المتجر», `delivery` «سياسة التوصيل», `refund` «سياسة الاسترجاع» and `privacy` «سياسة الخصوصية». Make `CollectionList`'s fixed-document rows and `DocumentEditor`'s id check handle it.
  - Policies are never archived: `canArchive` stays false, and `archive_document` already refuses anything but posts and taxonomies.
  - Editors draft and publish policy text as content. It becomes the store's checkout policy only when the owner approves it (below).
- **The migration:** `supabase/migrations/20260927170000_policy_approval.sql`, in the style of `20260927130000_commerce_settings.sql`, with `public.commerce_policies_approve(p_actor uuid, p_expected_version integer) returns jsonb`.
  - Refuse an actor who is not an active owner (42501).
  - Lock the settings row. A stale version raises 40001.
  - Read the published seq of each of `store`, `delivery` and `refund` from `public.published_documents`, plus `privacy` when it is published. A missing required one raises P0001 with the message `'Publish the store, delivery and refund policies first.'`
  - Write `policy_revisions` as `{"store": n, "delivery": n, "refund": n[, "privacy": n]}`, bump the version, set `configured_at` and `approved_by`, and insert one `commerce.policies` audit row with the revisions.
  - Return `{version, policyRevisions}`.
  - Grants: `service_role` only.
  - Also extend `public.commerce_settings_get()` with nothing new; it already returns `policyRevisions`. Leave it as it is.
- **The `admin` Edge Function:** action `commerce-policies-approve`, owner with a fresh TOTP, the same guard as `commerce-settings-save`. Body `{action, expectedVersion}`.
  - 40001 is 409 CONFLICT.
  - P0001 is 422 `POLICIES_NOT_PUBLISHED`, «انشر سياسات المتجر والتوصيل والاسترجاع أولًا.»
- **`CommerceSettingsForm.tsx`:** list the approved revisions, with the policy names and version numbers, or «لم تُعتمد بعد». Add a button «اعتماد السياسات المنشورة» through the same step-up dialog, and after it the line «الشراء يفتح بعد ربط بوابة الدفع (المرحلة القادمة).»

## 4. Tests

- **`tests/unit/money-input.test.ts`:** as above.
- **Field configs:** extend `tests/unit/collections.test.ts` for the new field types, the policies schema and the table configs.
  - The configs' writable fields must be a subset of the migration's granted columns. Write the granted lists into the test.
- **`tests/integration/policy-approval.test.ts`:**
  - Only `service_role` executes the function.
  - A non-owner is 42501.
  - A missing required policy is P0001.
  - A stale version is 40001.
  - It approves the published seqs and includes privacy only when privacy is published.
  - It writes exactly one audit row.
  - Save and restore `finance.commerce_settings` around the file.
- **The `admin` action:** a unit test next to the existing admin-function tests for the role, step-up, 409 and 422 mappings.
- **`tests/e2e/store-admin.spec.ts`,** with a new owner through `signInByCode`:
  - **The "without code changes" proof:** create a non-book product (published) with one physical variant priced `45.50`, stock 3, and a city rate. The variant list shows «45.50 ر.س».
  - Call the `checkout` function's `quote` for it through the API: the total is 4550 plus the fee. With checkout on (a fixture, restored), a `create` reaches a persisted pending order.
  - **A stale save:** two pages edit one product; the second save shows the conflict text and keeps its input.
  - **Coupons:** create one as a percentage of 12.5; the database holds 1250 basis points.
  - **Access:**
    - an editor gets no «المتجر» link;
    - an operations member sees the products list and no «جديد», and cannot save;
    - an owner can.
  - **Policies:** `/admin/content/policies` lists the four fixed documents.
  - **Screenshots** at 360 and 1440 of `/admin/store`, the products list, a product with its variants, the rates list, a coupon form and the settings policy block, into `artifacts/acceptance/P07/screenshots/`. Check horizontal overflow and in-table overflow as `owner-operations.spec.ts` does.
  - **Cleanup:** archive the products it created, and disable its rates and coupons, in `afterAll`.

## 5. Docs

- `docs/operations.md`: a short "Store admin (P07)" section: who can do what, retire instead of delete, stale-save conflicts, and the policy approval with step-up.

## Checks to run and report

- `supabase migration up --local`
- `pnpm check`
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db`
- `pnpm build`
- `pnpm exec playwright test tests/e2e/store-admin.spec.ts tests/e2e/cms.spec.ts tests/e2e/checkout-api.spec.ts` (Playwright starts its own server)

Leave the rewritten screenshots of other packages and `next-env.d.ts` for the orchestrator. Your launcher cannot run `git checkout`.

## Paths you may write

- `src/admin/fields.ts`
- `src/admin/tables/**`
- `src/admin/collections/policies.ts` and `src/admin/collections/index.ts`
- `src/lib/money-input.ts`
- `src/components/admin/{FieldInput,TableList,TableForm,CollectionList,DocumentEditor,CommerceSettingsForm,AdminShell}.tsx`
- `src/components/admin/admin.module.css`
- `src/app/(admin)/admin/store/**`
- `supabase/migrations/20260927170000_policy_approval.sql`
- `supabase/functions/_shared/{admin,commerce-settings}.ts`
- `tests/unit/{money-input,collections}.test.ts` and 
- `tests/integration/policy-approval.test.ts`
- `tests/e2e/store-admin.spec.ts`
- `artifacts/acceptance/P07/screenshots/**`
- `docs/operations.md`

Anything else: stop and ask. Never edit `20260927160000_catalog_and_checkout.sql`. Never read or print `.env`.

## Report (40 lines or fewer)

Files changed; each check as `command → exit code` with counts; anything skipped or open.
