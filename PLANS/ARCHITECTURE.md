# Application and file contracts

Paths below are relative to the repository root and describe future files. Build one Next.js app at root. Keep prototype and source assets intact. No monorepo, custom framework, plugin system or separate admin backend.

## Runtime

Browser -> Next App Router on Cloudflare Workers -> Supabase Auth/PostgREST/PostgreSQL. Use user-session Supabase clients for staff actions so RLS sees the actual user. A small server-only integration client performs verified payment/outbox/invite operations through narrowly defined SQL functions. It never handles arbitrary user-selected table names or unchecked payloads. R2 stores public optimized derivatives and separately private originals, ebooks and backups. Moyasar hosts card collection; the site never receives PAN/CVC. Resend receives the minimum receipt/contact notification fields.

OpenNext runs the actual Next build; Cloudflare's newer vinext option is currently labelled beta and reimplements the API surface, so it is not the selected interpretation of the announced Next.js stack. Avoid Node middleware and filesystem writes in request handlers. Use Node-compatible Web APIs; generate Cloudflare binding types with Wrangler. Develop normal Next locally; build and verify the Worker artifact in Linux CI because OpenNext does not guarantee native Windows support.

Use request SSR plus a maximum 60-second public cache; staff publication calls invalidation and records failures for retry. SQL publication checks remain authoritative. A public content query returns only a published snapshot whose `published_at <= now()` and not archived/hidden. Anonymous callers cannot fetch editable drafts. Private routes set `Cache-Control: private, no-store`, never enter CDN cache, and `robots` denies indexing. Public JSON-LD, sitemap and OG derive from the same published query, not a permissive service-role read.

## Public route map

| Exact route file | Destination and behavior |
|---|---|
| `src/app/(public)/page.tsx` | Home hero, three circles, ordered visible previews and contact. Real links to full pages. |
| `src/app/(public)/started/page.tsx` | Started projects; images, plain descriptions, case-story details. |
| `src/app/(public)/built/page.tsx` | Rahha narrative, working category tabs, approved metrics and projects. |
| `src/app/(public)/passed/page.tsx` | Peak, signature watermark, six readable plaques and linked case detail when present. |
| `src/app/(public)/book/page.tsx` | Complete locked book page; replace only reader contents/engine and connect existing purchase controls. |
| `src/app/(public)/shelf/page.tsx` | Owner-edited ideas, static tilt composition, no drag interface. |
| `src/app/(public)/scenes/page.tsx` | Server initial gallery, category query/filter, accessible lightbox. |
| `src/app/(public)/contact/page.tsx` | Contact form, channels and link to services/booking. |
| `src/app/(public)/journal/page.tsx` | New blog index: editorial lead article, dated text-led list; category/tag filters and paginated results. |
| `src/app/(public)/journal/[slug]/page.tsx` | Article, author, date, category/tags, safe rich-text rendering, related links. |
| `src/app/(public)/projects/[slug]/page.tsx` | Published project detail under its room accent. |
| `src/app/(public)/store/page.tsx`, `store/[slug]/page.tsx` | General catalog and product detail; book links to `/book#editions`. |
| `src/app/(public)/cart/page.tsx`, `checkout/page.tsx` | Accessible full-page alternative to cart drawer, address/shipping/coupon/policy review. |
| `src/app/(public)/orders/[token]/page.tsx` | Token-authorized order status, item delivery links, return/cancel request. No email/ID-based lookup. |
| `src/app/(public)/services/page.tsx`, `services/[slug]/page.tsx` | Published services, availability and appointment request/paid reservation. |
| `src/app/(public)/policies/[slug]/page.tsx` | Published privacy, store, delivery/refund, cancellation and terms revisions. |
| `src/app/not-found.tsx`, `src/app/error.tsx` | Arabic truthful missing/error states and retry/home action. |

Global files: `src/app/layout.tsx`, `src/app/(public)/layout.tsx`, `src/styles/tokens.css`, `src/styles/globals.css`, `src/components/site/Header.tsx`, `Footer.tsx`, `Navigation.tsx`, `MotionPreference.tsx`, `src/components/site/site.module.css`. All document roots use `lang="ar" dir="rtl"`; numeric/URL/email snippets use explicit bidi isolation. Navigation is owner-ordered but never permits arbitrary script/unsafe URLs. Existing eight labels remain by default; blog/services/store links can be added within the same visual language.

## Arabic admin

`src/app/admin/layout.tsx` provides session verification, role-aware nav, skip link, breadcrumb, task heading and one primary action. Desktop uses a restrained right-side navigation rail; mobile uses a Radix modal menu and readable stacked forms. Use the same Thmanyah body voice, ink and forest, with utilitarian tables and tonal surfaces. No KPI dashboard invented from fake metrics. The start page shows genuine pending tasks (drafts, low stock, unhandled messages, orders), each linked to its underlying record.

Routes: `/admin/login`, `/admin/auth/callback`, `/admin/security`, `/admin`, `/admin/pages`, `/admin/pages/[id]`, `/admin/posts`, `/admin/posts/[id]`, `/admin/taxonomies`, `/admin/projects`, `/admin/projects/[id]`, `/admin/scenes`, `/admin/media`, `/admin/media/[id]`, `/admin/products`, `/admin/products/[id]`, `/admin/orders`, `/admin/orders/[id]`, `/admin/customers`, `/admin/coupons`, `/admin/shipping`, `/admin/services`, `/admin/bookings`, `/admin/availability`, `/admin/inbox`, `/admin/team`, `/admin/settings`, `/admin/audit`, `/admin/backups`. Exact route directory names match these URLs. Use native search/select/pagination, 25 rows/page, server sorting by stable `(created_at,id)` or `(sort_order,id)`; no unbounded full-table browser downloads.

Shared editor files: `src/components/admin/AdminShell.tsx`, `RecordForm.tsx`, `RichTextEditor.tsx`, `MediaPicker.tsx`, `StatusMessage.tsx`, `admin.module.css`. Each domain owns its field editor and server actions in its route folder. A generic RecordForm handles labels/errors/submit, not a schema-driven UI framework. Rich text allows paragraphs, headings 2–3, lists, blockquote, bold, italic, safe links and approved media IDs; no raw HTML, iframes, arbitrary CSS or remote image ingestion.

## Server modules and boundaries

| File | Responsibility |
|---|---|
| `src/lib/env.ts` | Zod-validated environment separation; server-only secrets never exported through public modules. |
| `src/lib/supabase/server.ts`, `browser.ts`, `integration.ts` | Session client, auth browser client and restricted server integrations. Mark server modules `server-only`. |
| `src/lib/auth.ts` | Verified claims/user, active membership and MFA gate; safe redirect allowlist; role checks supplement RLS. |
| `src/lib/content.ts`, `content-types.ts` | Published data loaders and fixed section types, draft preview with staff session. |
| `src/lib/richtext.tsx`, `validation.ts`, `format.ts` | Allowlisted render/schema, input parsing, Latin-digit Arabic formatting. |
| `src/lib/media.ts`, `r2.ts` | Upload tickets, object verification, rights/access, image presets and signed download URLs. |
| `src/lib/catalog.ts`, `cart.ts`, `checkout.ts` | Product visibility, persistent non-PII cart, server quote and checkout transaction. |
| `src/lib/payments/moyasar.ts`, `src/lib/orders.ts` | Gateway fetch/create/refund and monotonic ledger transitions. |
| `src/lib/booking.ts`, `calendar.ts` | Availability/reservations/ICS; no external calendar secrets in browser. |
| `src/lib/email.ts`, `outbox.ts`, `jobs.ts`, `rate-limit.ts` | Safe templates, durable dispatch/retry, due work and throttling. |
| `src/lib/audit.ts` | Human-readable audit display; authoritative audit writes occur in DB triggers/functions. |

No `service_role` client inside shared page loaders or staff CRUD helpers. Public mutation route handlers validate body, origin, content type, size, idempotency and bot checks before a restricted transaction. All monetary state changes happen in SQL transactions, not client components.

## Route-handler contract

Every JSON mutation returns `{ok:true,data}` or `{ok:false,error:{code,message,fields?},requestId}`. Messages are Arabic, codes stable ASCII, no stack traces or secret values. Use 400 validation, 401 unauthenticated, 403 unauthorized, 404 unavailable resource, 409 version/stock/conflict, 413 oversized, 422 unsupported setup, 429 throttled, 503 provider unavailable. Limit general JSON to 64 KiB and contact to 8 KiB. Webhook is capped at 256 KiB and handled separately. Upload bodies go directly to R2 with ticket bounds, never through a generic unbounded JSON endpoint.

| Route file | Input, authorization and result |
|---|---|
| `src/app/api/contact/route.ts` | POST name/email/message/Turnstile/honeypot/client idempotency ID; validate token action+hostname, throttle, store contact and outbox atomically; success despite later email failure. |
| `src/app/api/notify/route.ts` | POST email/productVariant/consent/Turnstile; generic duplicate response, confirmation token; only confirmed consent receives availability mail. |
| `src/app/api/notify/confirm/route.ts`, `unsubscribe/route.ts` | Expiring opaque token, idempotent consent transition. |
| `src/app/api/media/upload/route.ts`, `complete/route.ts`, `transform/route.ts` | Active staff; purpose/MIME/size/dimensions, presigned private key, verify actual stored bytes before usable status; transform selected coordinates to presets. |
| `src/app/api/checkout/quote/route.ts` | POST variant IDs/qty/coupon/city; server prices and eligibility only; short-lived quote with version and exact totals. |
| `src/app/api/checkout/route.ts` | POST quoteId, customer/address/policyVersions/idempotencyKey; revalidate and reserve stock/coupon/slot atomically, create hosted invoice and return allowlisted gateway URL. |
| `src/app/api/payments/moyasar/webhook/route.ts` | Validate body secret token, environment and event shape; durable receipt; fetch authoritative invoice/payment; idempotent transition. Never trust the redirect. |
| `src/app/api/payments/moyasar/return/route.ts` | Treat query IDs as untrusted; fetch server-side, then redirect to locally held order access route. Return itself never declares paid. |
| `src/app/api/orders/access/route.ts` | POST email/orderNumber/Turnstile; always same public response; send access link only to matching verified order email. |
| `src/app/api/orders/[token]/request/route.ts` | POST validated return/cancel reason using scoped hashed token; no direct refund execution. |
| `src/app/api/download/[token]/route.ts` | Check hashed token/expiry/entitlement/refund/rate bound, redirect to 60-second R2 signed file URL; no public caching/referrer. |
| `src/app/api/services/[id]/slots/route.ts`, `bookings/route.ts` | Public published service slots excluding reservations; create free confirmed or paid pending appointment with same checkout rules. |
| `src/app/api/calendar/[token]/route.ts` | Read-only private ICS feed, hash-checked revocable token, no private customer notes. |
| `src/app/api/jobs/route.ts` | Scheduler bearer secret, no public session; run bounded leased jobs for email, publication invalidation, payment reconciliation, expiry and purge. |
| `src/app/api/health/route.ts` | Public coarse health only; detailed provider status owner-only in admin. |

Staff mutations are server actions in their route's `actions.ts`; they all check session/origin/schema and use user-context RLS. Refund action requires owner MFA and calls the payment module; role grants/invites also require owner MFA. Do not execute external provider operations in render functions.

## Data lifecycle and runtime configuration

Environment template contains names, never values: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (integration only), `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`, `PAYMENTS_MODE`, `RESEND_API_KEY`, `EMAIL_FROM`, `JOBS_SECRET`, `TOKEN_HASH_PEPPER`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, bucket bindings for original/public/private/backup, and `IMAGES` binding. `DATABASE_URL` for migrations/backup is CI-only, not bundled in Worker. Never prefix a secret with `NEXT_PUBLIC_`.

Separate local/test/staging/production data, keys, buckets, webhook URLs and sender domains. Staging is access-restricted/noindex, uses sandbox payment mode and synthetic customers. Production startup fails closed on missing secrets; checkout has a DB-controlled enable flag plus complete merchant/policy/catalog checks. An owner cannot enable live checkout by changing a browser flag.

Versioned SQL migrations live in `supabase/migrations/`; generated types in `src/types/database.ts`. Supabase CLI runs locally in Docker. Use a real local database for RLS/transaction tests. Cloudflare Worker scheduled trigger lives in `workers/scheduler.ts` with `wrangler.scheduler.jsonc`; it invokes authenticated `/api/jobs` every minute. Do not rely on frequently delayed GitHub cron for checkout reservation correctness; database predicates check expiry at request time too. Backup is a separate nightly Linux GitHub Action with least-privilege DB export and encrypted off-site storage.
