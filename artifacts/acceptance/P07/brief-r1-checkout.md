# Brief: P07 round 1, the checkout function, the demo catalog and the tests

You work under `.anasaq-execution.lock` at the commit that adds this brief. Do this one task, run the checks, report, stop.

Read first:
- `PLANS/DATA-AND-SECURITY.md` "Checkout transaction" and "Unpaid reservation abuse";
- `PLANS/DECISIONS.md` D06, D07, D08, D34, D37 and D38;
- the orchestrator's migration `supabase/migrations/20260927160000_catalog_and_checkout.sql`. It is the contract and it is already applied locally. Do not edit it. If a test proves it wrong, stop and report the failing case with the evidence;
- the patterns to follow:
  - `supabase/functions/_shared/contact.ts`: the handler's order of checks, origin, content type, size, schema, Turnstile, throttle errors;
  - `supabase/functions/_shared/{http,db,env,rate-limit,turnstile}.ts`;
  - `supabase/functions/contact/{index.ts,deno.json}`;
  - `scripts/import-content.mjs`: the local-only guard, and how a content version goes live;
  - `tests/integration/support.ts` (`serviceRoleDb`, `pgRpc`, `createStaff`, `signIn`, `anonClient`) and `tests/integration/forms.test.ts`;
  - the API-level cases in `tests/e2e/owner-operations.spec.ts`.

## 1. The `checkout` Edge Function

Build `supabase/functions/checkout/index.ts` and `deno.json`, copied from `contact`. The handler lives in `supabase/functions/_shared/checkout.ts` and exports `handleCheckout(request, deps?)`. `deps` lets the unit tests inject the rpc and the Turnstile verifier. In `supabase/config.toml`, add `[functions.checkout]` with `verify_jwt = false`, next to `contact`.

Checks, in contact's order:
- OPTIONS answers 204 with CORS for the origin of `SITE_URL`;
- only POST (405);
- the Origin must equal `SITE_URL`'s origin (403);
- JSON content type (415);
- a body of at most 64 KiB (413; a larger declared length is refused before reading);
- the JSON parses (400);
- a strict Zod schema per action (422 with flattened fields).

A missing `SITE_URL` or `TOKEN_HASH_PEPPER` answers 503 `UNAVAILABLE`. Never log a body, an email, a name, a phone number, an address or a token.

The body is a discriminated union on `action`:

- **`quote`**: `{ action, lines, cityKey?, couponCode? }`.
  - A line is `{ variantId: uuid, quantity: integer 1..20, dedication?: string|null (at most 200) }`, with 1 to 50 lines.
  - Call `checkout_quote(p_ip_hash, p_lines, p_city_key, p_coupon_code)`.
  - Answer 200 `{ok:true, data:<the quote as returned>}`. Cart errors are data inside the quote, not HTTP errors.
- **`create`**: `{ action, idempotencyKey: uuid, checkoutSession: uuid, lines, cityKey?, address?, couponCode?, email, name, phone?, policyRevisions: {string: integer}, quoteHash: 64 hex, turnstileToken }`.
  - Normalize before hashing and calling:
    - email: lower-case and trim. Use contact's `toAsciiAddress` and `EMAIL_SHAPE`; export them from `contact.ts` instead of copying them.
    - name: trimmed.
    - phone: through `normalizeSaudiMobile`. Empty becomes null; present and invalid is 422.
    - address: trimmed, with every run of whitespace, newlines included, collapsed to one space.
    - coupon code: upper-case and trimmed. `variantId`: lower-case.
  - Then Turnstile: action `checkout`, the hostname of `SITE_URL`, the same 503 and 400 answers as contact. A missing `TURNSTILE_SECRET_KEY` is 503 `TURNSTILE_UNAVAILABLE`.
  - Then call `checkout_create(...)` with:
    - `p_request_hash`: the sha256 hex of the canonical JSON (keys sorted at every depth) of the normalized body, without `action`, `idempotencyKey` and `turnstileToken`;
    - `p_access_token_hash`: from the token rule below;
    - `p_ip_hash`: `clientKeyHash(request, TOKEN_HASH_PEPPER)`;
    - `p_environment`: `'live'` only when `PAYMENTS_MODE === 'live'` and `isHostedSite()`, otherwise `'test'`.
  - The access token is base64url(HMAC-SHA256, key `TOKEN_HASH_PEPPER`, message `'order-access:' + idempotencyKey`). Its hash is the sha256 hex of `` `${TOKEN_HASH_PEPPER}:order:${token}` ``. The token is deterministic, so a retried request gets the same one.
  - Replies:
    - a new order: 201 `{ok:true, data:{order, accessToken}}`;
    - a duplicate: 200 with the same shape, but `accessToken` only when `tokenMatches` is true.
- **`cancel`**: `{ action, orderNumber: /^[2-9A-HJ-NP-Z]{8}$/ (upper-cased first), accessToken: 43 base64url characters }`.
  - Call `checkout_cancel(orderNumber, hash(accessToken))` and answer 200 `{ok:true, data:{status}}`.
  - `NOT_FOUND` is 404.

Map the SQL refusals (`{ok:false, code, ...}`) to a status and a short Arabic message. No em dash, no internal detail; for example `CHECKOUT_DISABLED` is «الشراء غير متاح حاليًا، ويفتح قريبًا.»
- **409:**
  - `ACTIVE_HOLD`, `IDEMPOTENCY_CONFLICT`, `OUT_OF_STOCK` and `COUPON_EXHAUSTED`;
  - `QUOTE_CHANGED`, with fields `{quote}`;
  - `POLICY_CHANGED`, with fields `{policyRevisions}`.
- **422:**
  - `INVALID_CONTACT`, `ADDRESS_REQUIRED` and `PHONE_REQUIRED`;
  - every cart code, with fields `{quote}` when the SQL returned one: `INVALID_CART`, `EMPTY_CART`, `TOO_MANY_LINES`, `INVALID_LINE`, `INVALID_QUANTITY`, `DUPLICATE_LINE`, `UNAVAILABLE`, `DEDICATION_NOT_ALLOWED`, `INVALID_DEDICATION`, `CITY_REQUIRED`, `CITY_UNSUPPORTED`, `COUPON_INVALID`, `COUPON_MIN_SUBTOTAL`, `COUPON_NOT_APPLICABLE`, `CART_TOO_LARGE`.
- **503:** `CHECKOUT_DISABLED`, `SELLER_NOT_CONFIGURED` and `POLICIES_NOT_CONFIGURED`.
- **Errors raised by SQL:** SQLSTATE 54000 is 429 `RATE_LIMITED`; anything else is 500 `FAILED` with no detail.

Move `normalizeSaudiMobile` and its digit-folding helper, unchanged, from `src/lib/format.ts` to `supabase/functions/_shared/saudi-mobile.ts`. Re-export it from `src/lib/format.ts` so every current import keeps working.

Also add `formatMoney(halalas: number): string` to `src/lib/format.ts`: SAR, Latin digits, two decimals, in integer arithmetic.
- Check what `Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency: 'SAR' })` gives, and use it if it reads right.
- Otherwise format the number yourself and append « ر.س».

## 2. The demo catalog (D37)

Write `scripts/seed-demo-catalog.mjs`, and add `"db:demo-catalog": "node scripts/seed-demo-catalog.mjs"` to `package.json`.
- It has import-content.mjs's local-only guard: refuse unless `DATABASE_URL` is a loopback PostgreSQL URL.
- It is idempotent: a second run changes nothing. Upsert by slug, sku, city key and code; skip a policy version whose data is unchanged.
- It runs in one transaction, and at the end prints what it did plus a line saying the store is open locally with demo values.

What it writes:
- **Products:** `demo = true`, published, every title ending in « (تجريبي)». Each has a summary and a one-paragraph Lexical body saying it is demo data Anas will replace. Variants are all enabled, prices in halalas:

  | Product | Slug | SKU | Variant | Fulfillment | Price | Stock | Low stock |
  |---|---|---|---|---|---|---|---|
  | «خوص (تجريبي)» | `demo-khous` | `DEMO-KHOUS-EBOOK` | «نسخة إلكترونية» | digital | 3500 | | |
  | | | `DEMO-KHOUS-PAPER` | «نسخة ورقية» | physical | 6900 | 40 | 5 |
  | | | `DEMO-KHOUS-SIGNED` | «نسخة موقعة» | signed | 9900 | 10 | 3 |
  | «كوب ضوء القمر (تجريبي)» | `demo-moonlight-cup` | `DEMO-MOON-CUP` | «كوب» | physical | 4500 | 25 | |
  | «خلفيات من الغرف (تجريبي)» | `demo-room-wallpapers` | `DEMO-WALLPAPERS` | «ملف رقمي» | digital | 1500 | | |

- **City rates (enabled):**

  | Key | Name | Fee |
  |---|---|---|
  | riyadh | «الرياض» | 2500 |
  | jeddah | «جدة» | 3000 |
  | dammam | «الدمام» | 3000 |
  | makkah | «مكة المكرمة» | 3000 |
  | madinah | «المدينة المنورة» | 3000 |
  | tabuk | «تبوك» | 3500 |
  | abha | «أبها» | 3500 |

- **Coupon:** `DEMO10`, percent, 1000 basis points, enabled, no limit, every product.
- **Policies:** three documents in the `policies` content collection, doc ids `store`, `delivery` and `refund`.
  - Their data is `{ "title": "...", "body": <a Lexical root with one paragraph> }`; round 2's collection config will use this shape.
  - Titles: «سياسة المتجر», «سياسة التوصيل», «سياسة الاسترجاع».
  - Body: «نص تجريبي يكتبه أنس ويعتمده قبل فتح المتجر.»
  - Each is written as the next `content_versions` row and made live with `public.content_go_live('policies', doc, seq)`, as import-content.mjs does.
- **`finance.commerce_settings` (local only):**
  - `seller_legal_name` «متجر أنس (بيانات تجريبية)»;
  - `seller_address` «تبوك، المملكة العربية السعودية (تجريبي)»;
  - `seller_registration` «DEMO-0000»;
  - `policy_revisions` `{"store": <seq>, "delivery": <seq>, "refund": <seq>}`;
  - `checkout_enabled = true`, with the version bumped.

Document `pnpm db:demo-catalog` in `docs/development.md`, in two sentences.

## 3. Tests

- Use the existing helpers, and never touch a row you did not create: unique slugs, SKUs and emails per run.
- A test that changes `finance.commerce_settings` saves the row first and restores it in `afterAll`.
- The database files run serially.
- `tests/integration/commerce-settings.test.ts` was updated by the orchestrator for the lifted check; leave it as it is.

### `tests/unit/checkout.test.ts`

The handler with an injected rpc and Turnstile verifier; no network.
- The origin, method, content-type, size, JSON and schema refusals, each with its status.
- Quote passes the IP hash and the arguments through.
- Create normalizes: email case, the phone spellings, the collapsed address, the upper-case coupon.
- The request hash:
  - is equal for equal normalized bodies;
  - differs when any field changes;
  - ignores key order and the Turnstile token.
- The token is deterministic per idempotency key, and its hash is what reaches the rpc. A duplicate with `tokenMatches` false returns no token.
- Turnstile failures map like contact's.
- Every SQL code maps to its status; 54000 is 429; an unknown error is 500 with no detail.
- `environment` is `'test'` unless `PAYMENTS_MODE=live` on a hosted `SITE_URL`.

### `tests/unit/money.test.ts`

`formatMoney` on 0, 1, 99, 100, 6900 and 123456789, and that it uses Latin digits.

### `tests/integration/checkout.test.ts`

The real database. Checkout is switched on only inside this file.

**Grants and access**
- anon and authenticated cannot execute the three functions: 42501 through the Data API with real JWTs, as the other files test it. service_role can.
- `has_function_privilege` is false for anon, authenticated and service_role on every `finance` function of the migration.
- anon:
  - cannot read coupons or customers;
  - cannot select a variant's `stock`, `digital_asset` or `low_stock_threshold`;
  - sees only published products, the enabled variants of published products, and the enabled, priced city rates.
- An editor and an operations member cannot insert or update catalog rows.
- An owner can. An owner's update with a stale version changes 0 rows.
- authenticated cannot update `demo` or `version`.

**Quote**
- Totals and per-line discounts for a percent coupon and a fixed coupon.
- The largest-remainder rule with three odd lines: the line discounts sum to the order discount, the extra halalas go to the largest remainders, ties by line order.
- Coupons:
  - start and end dates, the minimum, the product scope;
  - a usage limit of 1 with one held redemption is `COUPON_EXHAUSTED`.
- Delivery:
  - a digital-only cart has no city and no shipping;
  - a physical cart without a city is `CITY_REQUIRED`;
  - a physical cart with a disabled or unpriced city is `CITY_UNSUPPORTED`.
- `UNAVAILABLE` for an unpublished product, and for a disabled or unpriced variant.
- A dedication only on a signed line.

**Create**
- The refusals:
  - `CHECKOUT_DISABLED` while checkout is off;
  - `SELLER_NOT_CONFIGURED`, `POLICIES_NOT_CONFIGURED`, `POLICY_CHANGED` and `INVALID_CONTACT`;
  - `ADDRESS_REQUIRED` and `PHONE_REQUIRED` for a physical cart;
  - `QUOTE_CHANGED` after a price change between the quote and the create; the returned quote carries the new total.
- A created order has:
  - the snapshots: seller, policies, contact, city, address;
  - items whose discounts sum to the order discount;
  - holds for its physical and signed lines only;
  - a held coupon redemption;
  - one `order.created` audit row.
- Repeats:
  - the same key and request return the same order, with `tokenMatches`;
  - the same key with another request is `IDEMPOTENCY_CONFLICT`.
- Hold limits:
  - a second order for the same email is `ACTIVE_HOLD`, and so is one for the same checkout session with another email;
  - after a cancel with the right token, the holds are released and a new order is accepted;
  - a wrong token is `NOT_FOUND`.
- Throttle: the 11th create in an hour from one IP hash is 54000.

**Concurrency** (separate connections, `Promise.all`)
- Five creates for the last unit of a variant with stock 1, with different emails, sessions and keys: exactly one succeeds and four are `OUT_OF_STOCK`.
- Two creates with a coupon limited to one use: exactly one keeps the coupon; the other gets `COUPON_EXHAUSTED` or `QUOTE_CHANGED`.
- Two creates with the same idempotency key at once: one order, and both answers name it.

**Expiry**
- Move a hold into the past as the superuser: its order's `hold_expires_at` and its rows' `expires_at`.
- The quote sees the stock again before any job runs.
- `finance.checkout_expire()` marks the order expired and releases its rows.
- The cron job `checkout-expire` exists.

**Rebuilds**
- A price change requests a site build: `finance.site_builds.requested_at` moves.
- A stock-only change does not.

**Audit**
- A price change is recorded with from and to.
- A customer's name change is recorded by the column name only.

### `tests/e2e/checkout-api.spec.ts`

API level, through the local functions runtime at the URL the helpers already use, with Turnstile's always-pass test secret as in the contact tests.
- A quote for a fixture product.
- A create while checkout is off is 503 `CHECKOUT_DISABLED`.
- With checkout on (a fixture, restored afterwards):
  - a create is 201 with an order and an `accessToken`;
  - the same request again is 200 with the same order and token;
  - a cancel with the token is 200 `cancelled`.
- A foreign Origin is 403.

The fixtures (the test's own product, variant, rate and settings) are removed or restored afterwards. If the local runtime does not serve the new function, restart the stack with `supabase stop` and then `supabase start` (never `--no-backup`), run `pnpm db:env` if it asks, and say so in the report.

## 4. Docs

In `docs/operations.md`, add a section "Checkout holds and limits", from the migration's header and `checkout_create`'s comment:
- holds last 20 minutes, one per email and one per checkout session;
- the throttles: 10 per hour per IP hash, 5 per hour per email, 500 per day, and quotes 300 per hour per IP hash;
- expiry: availability ignores an expired hold at once, and the minute job tidies up;
- how a buyer cancels;
- the residual risk;
- checkout stays off until P08.

## Checks to run and report

- `supabase migration up --local` (it should apply nothing).
- `pnpm check`.
- `TEST_ENV=local DATABASE_URL=<DB_URL from supabase status -o json> pnpm test:db`.
- `pnpm exec playwright test tests/e2e/checkout-api.spec.ts tests/e2e/owner-operations.spec.ts`.
- `pnpm db:demo-catalog`, twice; the second run reports no changes.
- `deno check supabase/functions/checkout/index.ts`, if `deno` is available; say so if it is not.

Your launcher cannot run `git checkout`, so leave the screenshots and `next-env.d.ts` that an e2e run rewrites. The orchestrator restores them. Do not claim you restored them.

## Paths you may write

- `supabase/functions/checkout/index.ts` and `supabase/functions/checkout/deno.json`
- `supabase/functions/_shared/checkout.ts` and `supabase/functions/_shared/saudi-mobile.ts`
- `supabase/functions/_shared/contact.ts` (the two exports only)
- `supabase/config.toml` (the `[functions.checkout]` block only)
- `src/lib/format.ts`
- `scripts/seed-demo-catalog.mjs`
- `package.json` (the one script)
- `tests/unit/checkout.test.ts` and `tests/unit/money.test.ts`
- `tests/integration/checkout.test.ts`
- `tests/e2e/checkout-api.spec.ts`
- `docs/operations.md` and `docs/development.md`

Anything else: stop and ask. Never edit the migration. Never read or print `.env`.

## Report (40 lines or fewer)

- The files you changed.
- Each check as `command → exit code`, with counts.
- Anything you skipped or left open, and any case where the migration looked wrong.
