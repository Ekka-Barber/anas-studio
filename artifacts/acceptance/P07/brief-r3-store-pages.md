# Brief: P07 round 3, the public store, product, cart and checkout pages

You work under `.anasaq-execution.lock` at the commit that adds this brief. Do this one task, run the checks, report, stop.

## Read first

**Plan documents.**
- `PLANS/ARCHITECTURE.md`: "Three data paths", "Public routes and identity", the file map rows for `src/components/store/*`.
- `PLANS/DATA-AND-SECURITY.md`: "Checkout transaction" steps 1, 2, 3 and 5.
- `PLANS/DECISIONS.md`: D06, D08, D09, D34, D37 and D38.
- `PLANS/DESIGN-AUDIT.md`: items 2, 45, 56, 95, 105 and 138.

**Design.** It is paused for a v2 (I25), so these pages are plain on the current tokens (D38): no new visual concept, nothing copied from a landing template. They get restyled once a v2 direction is accepted.

**Contracts.**
- `supabase/functions/_shared/checkout.ts`: the function's actions, replies and error codes.
- `supabase/migrations/20260927160000_catalog_and_checkout.sql`: what anon may read.
- `supabase/migrations/20260927180000_store_media.sql`: a published product's library cover is now public.

**Patterns to follow.**
- `src/lib/content.ts`: build-time reads with the publishable key over REST, media resolution through `resolveMedia`/`replaceMediaIds`.
- `src/lib/richtext.tsx`: the safe renderer.
- `src/components/public/Picture.tsx`, and the public layout and CSS.
- `src/lib/format.ts`: `formatMoney` and `formatNumber`.
- `tests/e2e/checkout-api.spec.ts`: how the function is called and how its settings fixture is saved and restored.
- `tests/e2e/visual.spec.ts`: the JS-off readability check.

## What to build

### 1. Build-time loaders: `src/lib/store.ts`

The loaders read, with the publishable key, as `content.ts` does:
- the published products: `id, slug, title, summary, body, cover_image, sort_order, demo`;
- their enabled variants: `id, product_id, sku, title, fulfillment, price_halalas, sort_order`.

Anon has exactly these grants, and anon never sees stock.

Parse every row with Zod. A malformed row fails the build, like content.

The cover is resolved like content images:
- a manifest id goes through the image manifest;
- a media-library id is read through `/rest/v1/media` and becomes a media reference.

Order the list by `sort_order`, then title.

### 2. Routes, static and plain

All routes live under `src/app/(public)/`:

- **`store/page.tsx`** (the list):
  - Title «المتجر».
  - A card per product with its title, summary, cover and the lowest configured price as «من 35.00 ر.س». A product with no priced, enabled variant shows «غير متاح حاليًا».
  - A link «السلة» with the item count, filled in by the client.
  - No products shows «لا توجد منتجات بعد.»
- **`store/[slug]/page.tsx`** (one product):
  - `generateStaticParams` over the published slugs.
  - Title, cover, summary and body, then every enabled variant as a row with its title, fulfillment label («نسخة إلكترونية» / «نسخة ورقية» / «نسخة موقّعة», from the variant's own title) and price.
  - An `AddToCart` control: a quantity from 1 to 20 and «أضف إلى السلة». After adding it says «أُضيف إلى السلة.» with a link «عرض السلة».
  - An unpriced variant shows «غير مسعّر» and no button.
- **`cart/page.tsx`** and **`checkout/page.tsx`**: client screens described below.
- **`policies/[slug]/page.tsx`**:
  - `generateStaticParams` over the four fixed policy ids: `store`, `delivery`, `refund`, `privacy`.
  - It renders the published policy's title and body at build time, through `fetchPublished`'s pattern with the `policySchema` from `src/admin/collections/policies.ts`.
  - An unpublished policy renders «لم تُنشر هذه السياسة بعد.», not a 404.

**The empty catalog must build.** The hosted project has no products today. Prove that `pnpm build` passes with the demo catalog seeded and also with no published product: archive them as the superuser, build, then `pnpm db:demo-catalog` to republish.
- If Next 16's `output: 'export'` refuses an empty `generateStaticParams`, use the smallest documented way to keep the build green.
- Cite the Next.js doc or source you relied on, in a comment and in the report.
- Never render a fake product.

### 3. The cart, client only

Write `src/components/store/{CartProvider,CartView,AddToCart}.tsx` and `src/lib/cart.ts`. `cart.ts` holds the pure storage logic, unit-tested.

- **Storage** (DATA "Checkout transaction" step 1): `localStorage['anasaq:cart:v1']` holds `{ "version": 1, "lines": [{ "variantId": uuid, "quantity": 1..20, "dedication"?: string }] }` and nothing else. No price, total, name or address is ever stored.
  - A malformed value or another version is discarded.
  - Duplicate variant lines merge, with the quantity capped at 20.
  - At most 50 lines.
- **Storage denied:** when `localStorage` throws, the cart lives in memory for the tab, with the note «السلة مؤقتة في هذه الصفحة: المتصفح يمنع الحفظ.»
- **Prices come from the live `quote` only.** The cart page calls the `checkout` function's `quote` on load and after every change, debounced about 300 ms.
  - Call it with `fetch` to `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/checkout`, sending the headers the API tests send; check whether the local gateway needs `apikey`. No `@supabase/supabase-js` on public pages: the public JS budget is 150 KiB and the largest page is 142 KiB now.
  - It shows each line's title, unit price, quantity (−/+ and a number input), line total and «حذف».
  - It shows each line error from the quote in Arabic next to its line (`OUT_OF_STOCK` with "left: N" when the quote gives `available`, `UNAVAILABLE`, `INVALID_QUANTITY`), and a button «إزالة غير المتاح» for the invalid lines.
  - It shows the subtotal, the discount, the delivery (once a city is chosen), and the total, all through `formatMoney`.
- **City:** the select appears when a line is physical or signed. Its options are read live from `/rest/v1/shipping_rates?select=city_key,name_ar,fee_halalas&order=sort_order,name_ar` with the publishable key; RLS returns only enabled, priced cities. The choice is kept in `sessionStorage`.
- **Coupon:** an input and «تطبيق», kept in `sessionStorage`. The quote's coupon errors are shown in Arabic.
- **Dedication:** a signed line gets its field (at most 200 characters) in the cart.
- «المتابعة لإتمام الطلب» leads to `/checkout`.
- When the quote's `checkoutEnabled` is false, the cart shows «الشراء غير متاح حاليًا، ويفتح قريبًا.» and no checkout button (D34). The cart itself keeps working.

### 4. Checkout: `src/components/store/CheckoutForm.tsx`

- **The same live quote**, shown as the summary the buyer confirms.
- **Fields:**
  - email: `type=email`, `dir=ltr`, `autocomplete=email`;
  - name;
  - phone, required when a line is physical or signed: `dir=ltr`, `inputmode=tel`, checked on submit with `normalizeSaudiMobile`;
  - the city from the cart, changeable here;
  - the address, a textarea, for physical and signed carts only;
  - the coupon, prefilled from the cart.
  - A digital-only cart shows none of phone, city or address.
- **Policy consent:** one required checkbox «قرأت سياسة المتجر وسياسة التوصيل وسياسة الاسترجاع وأوافق عليها», with each name linking to its `/policies/<id>` page, plus the privacy page when it exists. The `policyRevisions` sent are exactly the quote's `policyRevisions`, the ones the buyer saw.
- **Turnstile:**
  - Explicit render of the widget with `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, action `checkout`, loading `https://challenges.cloudflare.com/turnstile/v0/api.js` once.
  - A missing site key shows «التحقق غير متاح حاليًا.» and disables submit.
  - Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (Cloudflare's documented always-pass test site key, paired with the always-pass test secret the functions already use locally) to what `scripts/local-env.mjs` writes into `.env.local`, then run `pnpm db:env`.
  - Never add a test bypass to product code.
- **Submit** sends `create` with:
  - a `checkoutSession` uuid kept in `sessionStorage['anasaq:checkout-session']`;
  - an `idempotencyKey` reused only when retrying the identical request after a network failure. Any change to the request gets a new key. Compare a fingerprint of the normalized request kept in component state.
- **Success (201 or 200):**
  - Show the order number, the total and «حُجز طلبك لمدة 20 دقيقة. الدفع يُضاف في المرحلة القادمة، ولن يُخصم أي مبلغ الآن.»
  - Show a «إلغاء الطلب» button that sends `cancel` with the access token.
  - Keep `{orderNumber, accessToken}` in `sessionStorage` only, so the cancel survives a reload.
  - Do not clear the cart (DATA step 5: nothing is settled before payment verification, P08).
- **Errors:**
  - Show the function's own Arabic `error.message`.
  - `QUOTE_CHANGED`: re-render with `fields.quote` and ask the buyer to confirm the new total.
  - `POLICY_CHANGED`: reload the quote and require the consent again.
  - `ACTIVE_HOLD`: offer the cancel when this session holds the order's token.
  - 429 says so. A network failure keeps the form and allows a retry with the same key.
- **JS off:** the cart and checkout pages show a `<noscript>` line «السلة والطلب يحتاجان JavaScript.»

### 5. Styling

`src/components/store/store.module.css`, on `src/styles/tokens.css` only:
- RTL, logical properties, Thmanyah, Latin digits;
- 44 px targets, visible focus, WCAG AA contrast;
- no horizontal overflow at 360;
- the cart lines as cards on phones.

No new colours or fonts. Do not edit `src/components/site/*` (the P01 header and footer). The store pages link to the cart themselves; a nav entry for the store is Anas's to add in the site settings.

## Tests

### `tests/unit/cart.test.ts`

The storage parse and serialize:
- malformed input, another version, duplicate merge, the caps;
- the storage-denied fallback;
- the request fingerprint:
  - equal for equal requests, different when any field changes;
  - the Turnstile token is not part of it.

### `tests/e2e/cart-checkout.spec.ts`

Run in the browser on `next dev`, which renders pages live, so fixtures made in the test appear. Use the test's own fixtures (a product with a digital, a physical and a signed variant, a city rate, a coupon), made through the database like the other specs and retired in `afterAll`. Save `finance.commerce_settings` in `beforeAll` and restore it in `afterAll`.
- **Store and product:**
  - `/store` lists the fixture product with «من …»;
  - its page lists the variants with prices.
- **The cart:**
  - Add the paper edition ×2 and the e-book. Reload, and the cart persists.
  - Change a quantity, and the total follows the quote. Remove a line.
  - Carts:
    - a digital-only cart shows no city;
    - a physical line needs a city;
    - the coupon applies and the discount shows.
- **Checkout off:** the cart and the checkout say «الشراء غير متاح حاليًا، ويفتح قريبًا.»
- **Checkout on** (the fixture):
  - fill the form, consent, let the Turnstile test widget pass, submit;
  - the order number and «حُجز طلبك لمدة 20 دقيقة» appear, and the cart is still there;
  - cancel, and the status says cancelled.
- **A price change between the quote and the submit** (update the variant as the superuser): the page shows the new total, and confirming again succeeds.
- **Storage denied** (an `addInitScript` that makes `localStorage` throw): adding to the cart works, and the note shows.
- **JS off:** `/store` and a product page are readable (titles and prices visible).
- **Screenshots** at 360 and 1440 of `/store`, a product, the cart with lines, the checkout form and the pending order, into `artifacts/acceptance/P07/screenshots/store-*.png`. Check horizontal overflow and in-table overflow as `owner-operations.spec.ts` does.

If the Turnstile widget cannot load in the local browser, stop, record the exact error, and report it. Do not work around it in product code.

## Checks to run and report

- `pnpm db:env`
- `pnpm check`
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` (it should be unchanged: 177)
- `pnpm build` with the demo catalog, then `check:export` and `check:budgets`, and the empty-catalog build
- `pnpm exec playwright test tests/e2e/cart-checkout.spec.ts tests/e2e/checkout-api.spec.ts tests/e2e/public.spec.ts tests/e2e/visual.spec.ts`

Leave the other packages' rewritten screenshots and `next-env.d.ts` for the orchestrator.

## Paths you may write

- `src/lib/{store,cart}.ts`
- `src/components/store/**`
- `src/app/(public)/store/**`, `src/app/(public)/cart/**`, `src/app/(public)/checkout/**`, `src/app/(public)/policies/**`
- `scripts/local-env.mjs` (the one key) and `scripts/check-export.mjs` (the required-file list only, if you add the store pages to it)
- `tests/unit/cart.test.ts`
- `tests/e2e/cart-checkout.spec.ts`
- `artifacts/acceptance/P07/screenshots/**`
- `docs/operations.md` (a short "Public store (P07)" section) and `docs/development.md` (the Turnstile test key line)

Anything else: stop and ask. Never edit a migration, `src/components/site/*` or `deploy/design/`. Never read or print `.env`.

## Report (40 lines or fewer)

- The files you changed.
- Each check as `command → exit code`, with counts.
- The empty-catalog build result and its source.
- Anything you skipped or left open.
