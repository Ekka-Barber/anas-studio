# Ordered implementation PRDs

All paths are exact repository-relative destinations. The common architecture, data contract and verification rules are part of every PRD; builders must read them. Packages are serial, not a parallel scheduling suggestion. GLM alone owns planning/status records. Complexity is relative, not a deadline promise. The offered 7–9 weeks depends on client materials and merchant onboarding.

## P00: Production foundation and runtime proof

Phase: الأساس الإنتاجي. Depends: none. Complexity: medium. Requirements: C01, C02, C35, C40.

**Owned files:** `package.json`, `pnpm-lock.yaml`, `.node-version`, `.npmrc`, `.gitignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `next-env.d.ts`, `open-next.config.ts`, `wrangler.jsonc`, `cloudflare-env.d.ts`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/env.ts`, `src/styles/globals.css`, `src/types/content.ts`, `src/lib/content-types.ts`, `src/lib/content.ts`, `content/initial-content.json`, `scripts/check-frozen.mjs`, `scripts/check-copy.mjs`, `scripts/check-budgets.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tests/unit/env.test.ts`, `tests/e2e/foundation.spec.ts`, `.github/workflows/ci.yml`, `docs/development.md`. Later P01 replaces `src/app/page.tsx` with the public route-group page; do not leave two `/` routes.

**Steps:**

1. Preserve existing Git and every frozen/source path; create a branch and baseline hash manifest from `PLANS/evidence/source-manifest.json`. Configure ignored secrets, `.next/`, `.open-next/`, node_modules, local lock, local Supabase and private test/download files. Do not change `_archive/`.
2. Pin the selected research versions and Node 24 LTS compatible with Next/OpenNext; use the running 24.19.0 as candidate and verify Node official release/support metadata before committing `.node-version`. Match `@types/node` major 24, not the registry latest major 26. Resolve exact pnpm version, peer packages and license notices in P00, save the full lockfile. Never use an unverified version merely because a plan names it.
3. Create strict TS, ESLint, CSS Modules and App Router baseline. Establish typed content contracts used by both initial local fixtures and later published DB loaders. Initial fixtures are available only in local/test `DEMO_MODE`; production fails rather than publishing fabricated data. No prices in this file.
4. Add scripts `dev`, `build`, `build:worker`, `preview:worker`, `lint`, `typecheck`, `test`, `test:db`, `test:e2e`, `check:frozen`, `check:copy`, `check:budgets`, `check`. Use `tsc --noEmit`, ESLint, Vitest, Playwright; `test:db` becomes active in P03. `check` must not mask nonzero exits. Pin CI actions to verified immutable SHAs when implemented, never invent them.
5. Compile the real Next app and OpenNext Worker on Linux CI; exercise an RSC page, server action, cookie-backed handler and static asset under Wrangler. Record compressed Worker size, CPU and unsupported APIs. Use Node runtime, `nodejs_compat`, generated binding types; no beta vinext substitution. Do not deploy externally yet.

**Proof:** fresh frozen-lockfile install; lint/typecheck/unit tests/build and Worker preview smoke pass; no secrets in browser bundle; hash checker rejects a deliberate temporary test copy mutation; restore before final check. Record actual bundle/CPU measurements, not estimates. Risk: Next/React/TS peer mismatch or Worker incompatibility. If current versions fail, pin the nearest supported patched versions with documented advisory/license check, rerun full foundation checks and update research resolution.

## P01: Locked public site and new journal design

Phase: الأساس الإنتاجي. Depends: P00. Complexity: high. Requirements: C03–C12, C31, C32.

**Owned files:** `src/app/page.tsx` (remove route collision); `src/app/(public)/layout.tsx`, `page.tsx`, `started/page.tsx`, `built/page.tsx`, `passed/page.tsx`, `book/page.tsx`, `shelf/page.tsx`, `scenes/page.tsx`, `contact/page.tsx`, `journal/page.tsx`, `journal/[slug]/page.tsx`, `projects/[slug]/page.tsx`, `policies/[slug]/page.tsx`; `src/app/not-found.tsx`, `error.tsx`; `src/components/site/Header.tsx`, `Footer.tsx`, `Navigation.tsx`, `MotionPreference.tsx`, `site.module.css`, `src/components/public/RoomPage.tsx`, `HomeSections.tsx`, `BookPage.tsx`, `SceneGallery.tsx`, `ContactForm.tsx`, `Journal.tsx`, `public.module.css`; `src/styles/tokens.css`, `globals.css`; `src/lib/format.ts`, `content-types.ts`, `content.ts`; `content/initial-content.json`; `public/fonts/lyon/`, `public/fonts/thmanyah/` (only exact approved runtime faces listed in ARCHITECTURE, asset-copy manifest records filenames); `public/images/` (only approved deploy image filenames from source manifest); `tests/e2e/public.spec.ts`, `tests/e2e/visual.spec.ts`, `tests/unit/format.test.ts`.

**Steps:**

1. Transfer the eight page compositions, copy and final images into semantic responsive React/CSS, using the named frozen file for each room. Preserve all book sections, visual rhythm, image treatment, signature and cover. The reader mounting slot is filled by P02. Purchase forms are truthful disabled states until catalog/payment integration; no pretend success.
2. Remove prototype reference/tuning UI from production; remap all `.dc.html` and hash-only navigation to actual routes/anchors. Preserve active nav semantics, heading hierarchy, menu close/focus restore, Escape and skip link. Author logical spacing, 360/768/1024/1440 widths, safe viewport sizing and 44px targets.
3. Implement built-category tabs, scenes category filtering/lightbox, shelf static tilts, motion preference persisted without hiding content, reduced-motion static stats/reader fallback, and keyboard access. No opacity-zero initial text. Default static content must be readable with JS blocked.
4. Design `/journal` and article detail from the same identity: one lead story and readable dated entries, restrained category filtering, no templated card wall or fictitious posts. Inline model data contains real source copy as drafts or clearly synthetic test-only entries. Default name المجلس is editable later.
5. Format Latin digits, isolate Latin strings, preserve Arabic shaping. Use current web-licensed font faces; produce WOFF2 derivatives only if licensing permits, keeping shaping tables and diacritics. Do not replace missing license evidence with a claim of ownership.

**Proof:** every route navigates without console errors; Playwright real clicks cover all controls; screenshots at all four widths; no horizontal overflow or clipped headlines; JS-off/reduced-motion views readable. Compare final book outside reader to frozen reference; document only behavior/data-accessibility differences. Risk: prototype artboards look broken at phone widths; use their composition and responsive showcase target, not their fixed canvas dimensions. Data/content rights are E05/E06 launch gates.

## P02: Real-PDF physical book reader

Phase: الأساس الإنتاجي. Depends: P01. Complexity: high. Requirements: C06, C33.

**Owned files:** `src/components/book/PdfBookReader.tsx`, `StaticPdfReader.tsx`, `reader.module.css`, `src/lib/book-preview.ts`, `src/components/public/BookPage.tsx`, `src/app/(public)/book/page.tsx`, `scripts/prepare-preview.mjs`, `content/book-source-manifest.json`, `tests/fixtures/reader/` (generated safe synthetic PDFs only, record exact filenames), `tests/e2e/reader.spec.ts`, `tests/unit/reader-mapping.test.ts`, `docs/book-preview.md`, `package.json`, `pnpm-lock.yaml`.

**Steps:**

1. Inventory real PDFs by hash/page count/title; current evidence finds separate 1–2-page Khous fragments, not an identified complete manuscript. Use a genuine fragment privately to prove rendering, never represent it as a finished sale file. Require approved preview source/range before publishing. Source preparation accepts an explicit private local PDF and page list, exports a separate excerpt, strips attachments/actions and records input/output hashes. Do not edit source PDFs or expose the full file to truncate in JavaScript.
2. Use lazy PDF.js and local worker from the same pinned version. Render actual page canvases/text layer into direct page-flip leaves; use the existing physical-cover illusion and RTL binding orientation. No fake retyped paragraphs. Cap device pixel ratio at 2 and keep current/adjacent spreads rendered (at most 6 page canvases); cancel stale render tasks, clean resources, and reload on resize without losing logical page.
3. Define page 1 as the first cover/leaf from the approved manifest; visual right-to-left order must match the PDF, not reverse Arabic text. Isolate any mirroring to page-turn geometry and counter-mirror page content; expose previous/next according to logical reading direction. Keyboard Right=previous and Left=next for RTL. Reject a mirrored glyph fix.
4. Add next/previous, page count, page jump and fullscreen with exit/focus restore. Fullscreen unavailable means an expanded in-page reader. Honor reduced-motion and user motion-off with immediate static pagination and selectable text/transcript. Network/corrupt PDF shows a retry and approved excerpt download, never an empty region. Lazy load on deliberate reader activation so public entry bundles stay small.

**Proof:** compare photographed/canvas pages with actual source rendering at first/middle/last page; Arabic joining/diacritics and Latin 4 unchanged. Check 1-page, odd-page, portrait/landscape, slow/error fetch, rotation/resize, keyboard, touch, fullscreen, reduced motion and text alternative. No paid-file URL in public request log. GLM clicks next/back and inspects source-to-view page order. Stale page-flip is a contained risk: lock version, supply no untrusted HTML, and keep static fallback. Do not silently replace the promised physical reader with a generic iframe.

**Phase 1 gate:** all public routes plus journal are responsive and faithful, no browser errors; authentic reader rendering demonstrated on the real candidate privately. If approval is missing, mark E04 open and preview not publishable, not reader done with made-up text.

## P03: PostgreSQL schema, Auth and database authorization

Phase: لوحة الإدارة. Depends: P02. Complexity: high. Requirements: C13, C21, C30, C34.

**Owned files:** `supabase/config.toml`, `supabase/migrations/202609210001_identity_content.sql`, `supabase/migrations/202609210002_policies.sql`, `supabase/seed.sql`, `supabase/tests/identity_content.test.sql`, `src/types/database.ts`, `src/lib/supabase/server.ts`, `browser.ts`, `integration.ts`, `src/lib/auth.ts`, `validation.ts`, `env.ts`, `src/app/admin/layout.tsx`, `login/page.tsx`, `login/actions.ts`, `auth/callback/route.ts`, `security/page.tsx`, `security/actions.ts`, `page.tsx`, `src/components/admin/AdminShell.tsx`, `RecordForm.tsx`, `StatusMessage.tsx`, `admin.module.css`, `scripts/bootstrap-owner.mjs`, `tests/e2e/auth.spec.ts`, `tests/integration/rls.test.ts`, `package.json`, `pnpm-lock.yaml`, `.env.example`.

**Steps:** create identity/content/media/settings/policy/audit tables and grants from data contract; migrations are replayable on empty local DB. Use Supabase Auth invite-only staff, PKCE SSR exchange, password recovery, session expiration/logout and owner MFA enrollment/challenge. Bootstrap owner once through an explicit local/CI operator command checking there is no owner, never a public signup route. Protect last owner, active membership and private routes. Build Arabic login and task shell, no empty fake charts. RLS tests call real REST endpoints under actual test JWT identities. Security-definer functions have restricted EXECUTE and explicit actor checks.

**Proof:** anon/editor/operations/revoked session cannot read private data or grant itself ownership through REST/Server Actions; owner without MFA cannot invite/refund/configure sensitive fields; last-owner removal fails transactionally; callbacks reject external redirect; expired cookie routes return login; strict type regeneration matches migration. Risk: UI-only gating, stale claims and Supabase default grants. A failing negative test blocks all admin packages.

## P04: Complete editorial CMS and public binding

Phase: لوحة الإدارة. Depends: P03. Complexity: high. Requirements: C08, C12–C16, C19.

**Owned files:** `src/app/admin/pages/page.tsx`, `pages/[id]/page.tsx`, `pages/actions.ts`, `posts/page.tsx`, `posts/[id]/page.tsx`, `posts/actions.ts`, `taxonomies/page.tsx`, `taxonomies/actions.ts`, `projects/page.tsx`, `projects/[id]/page.tsx`, `projects/actions.ts`, `scenes/page.tsx`, `scenes/actions.ts`, `preview/[id]/page.tsx`; `src/components/admin/RichTextEditor.tsx`, `MediaPicker.tsx`; `src/lib/content.ts`, `content-types.ts`, `richtext.tsx`, `validation.ts`; `supabase/migrations/202609210003_content_workflows.sql`, `src/lib/jobs.ts`, `src/app/api/jobs/route.ts`, `workers/scheduler.ts`, `wrangler.scheduler.jsonc`, `tests/e2e/cms.spec.ts`, `tests/integration/publication.test.ts`, `tests/unit/richtext.test.ts`, `package.json`, `pnpm-lock.yaml`.

**Steps:**

1. Build explicit editors for pages/sections, posts, projects, scenes and shelf entries. Owner edits texts/titles/images, room assignment, logos/metrics/status, order and visibility. Navigation/footer/SEO managed in P06 use same publication pipeline. Preserve fixed book layout while making its text/media data editable.
2. Tiptap Arabic direction, Arabic toolbar labels, safe links and media references, no paid cloud extensions. Save draft, preview, publish now, schedule in Riyadh time, archive/unarchive, revisions and restore. Keep categories/tags/author editorial identity. Debounced draft save with visible saved/error state may supplement explicit save; no silent loss on conflicts.
3. Publish an immutable safe snapshot in a DB transaction, not the editable document. Implement admin revision comparison sufficient to identify what changed. Scheduled visibility query uses database clock; cron performs due publication/invalidation and logs retries. Restore is a new revision.
4. Replace fixture loader with public RLS-backed queries; write-through invalidation refreshes home previews, article/project detail, SEO and sitemap within 60 seconds. Empty drafts do not produce broken links. Pagination/filter state survives a copied URL. Unknown slug is 404.

**Proof:** owner creates Arabic article with image, category/tag/author, drafts/preview/schedules it, observes no early public exposure, sees it after due time, archives it and verifies cache removal. Two editors conflict safely; unsaved copy survives. Publish and reorder/hide a home section; public display changes without code or redeploy. Rich-text XSS/unsafe links rejected. Risk: publishing mutable draft objects or leaking future content in metadata. Required tests include both HTML and API/metadata paths.

## P05: Media library, crop, optimization and reuse

Phase: لوحة الإدارة. Depends: P04. Complexity: high. Requirements: C17, C18, C33.

**Owned files:** `src/app/admin/media/page.tsx`, `media/[id]/page.tsx`, `media/actions.ts`, `src/components/admin/ImageCropper.tsx`, `MediaPicker.tsx`, `src/app/api/media/upload/route.ts`, `complete/route.ts`, `transform/route.ts`, `src/lib/media.ts`, `r2.ts`, `supabase/migrations/202609210004_media.sql`, `tests/e2e/media.spec.ts`, `tests/integration/media-security.test.ts`, `docs/media-rights.md`, `wrangler.jsonc`, `.env.example`, `package.json`, `pnpm-lock.yaml`.

**Steps:** implement folders, direct private upload tickets, completion verification, Arabic alt/caption/rights fields, crop UI using react-easy-crop and server-bounded transformation presets. Before adoption verify actual Cloudflare Images binding calls in Worker preview/staging; document provider limits and billing. Derivatives are optimized automatically and dimensioned, originals preserved privately. Store media references, reuse one asset in multiple pages, show where-used, prevent destructive deletion while referenced. Archive/unpublish removes new public references; clarify already-public cached image revocation is bounded by cache TTL. No SVG upload sanitization project; arbitrary SVG stays rejected.

**Proof:** wrong extension/mime/magic bytes, oversized dimensions, wrong user's ticket, out-of-bounds crop, expired signature and HTML/SVG rejection; published image has correct dimensions/alt and reduced byte size with no EXIF; folder rename keeps references; delete-in-use fails; legitimate crop selected by real pointer affects public rendering. Private original/paid PDF cannot be fetched anonymously. Risk: trusting client resize as validation or using native sharp in Workers. Do not pass until actual server transform is tested.

## P06: Owner settings, team, inbox and operational control

Phase: لوحة الإدارة. Depends: P05. Complexity: high. Requirements: C14, C20–C25, C29, C34.

**Owned files:** `src/app/admin/team/page.tsx`, `team/actions.ts`, `settings/page.tsx`, `settings/actions.ts`, `inbox/page.tsx`, `inbox/actions.ts`, `audit/page.tsx`, `backups/page.tsx`, `backups/actions.ts`, `src/app/api/contact/route.ts`, `notify/route.ts`, `notify/confirm/route.ts`, `notify/unsubscribe/route.ts`, `health/route.ts`, `src/lib/email.ts`, `outbox.ts`, `rate-limit.ts`, `audit.ts`, `jobs.ts`, `supabase/migrations/202609210005_operations.sql`, `tests/e2e/owner-operations.spec.ts`, `tests/integration/forms.test.ts`, `tests/integration/outbox.test.ts`, `.github/workflows/backup.yml`, `scripts/backup.mjs`, `scripts/restore-check.mjs`, `docs/operations.md`, `docs/privacy-data-map.md`, `package.json`, `pnpm-lock.yaml`.

**Steps:** Arabic team invite/revoke/role change with last-owner protection and MFA; editable nav/footer/SEO/social/motion labels and settings, domain/mail address/verified-state screens with DNS instructions, versioned policy publishing. Gateway credentials stay deployment secrets; do not expose tokens in UI settings. Inbox lists/filter/search/read/close/spam/notes; public form stores first and sends notification via outbox. Add Turnstile action+hostname verification, throttling, anti-enumeration notify confirmation/unsubscribe, email templates and retries visible to owner. Backup screen shows last verified backup/restore result and owner-triggered request; nightly off-site encrypted DB export plus R2 originals manifest/copy, 7 daily/4 weekly/3 monthly retention. Restore to disposable environment first; no production restore button that bypasses confirmation.

**Proof:** contact persists when Resend is down; one receipt despite concurrent job retries; failed token/honeypot/rate-limit attempts store no message; inbox PII inaccessible to editor/anon; invalid social URL rejected; owner modifies footer and mail sender, unverified sender cannot be used. Invite and revoke exercise real isolated Auth environment, no real unsolicited invitations. Backup has decryptable dump+objects, hash check and a successful disposable restore including roles/content/assets. Risk: backup database without binary assets, leaking customer data into CI logs, or saying domain settings automatically change DNS when they only guide configuration.

**Phase 2 gate:** GLM personally logs in as owner, adds a real test article/image, crops it, edits/hides/reorders a section and publishes without touching code. Verify every admin menu action works; no deferred empty CRUD screens pass.

## P07: Catalog, cart, stock, coupons and checkout

Phase: المتجر والدفع. Depends: P06. Complexity: high. Requirements: C20, C26–C28, C30.

**Owned files:** `supabase/migrations/202609210006_commerce.sql`, `supabase/tests/commerce.test.sql`, `src/app/admin/products/page.tsx`, `products/[id]/page.tsx`, `products/actions.ts`, `customers/page.tsx`, `coupons/page.tsx`, `coupons/actions.ts`, `shipping/page.tsx`, `shipping/actions.ts`, `src/app/(public)/store/page.tsx`, `store/[slug]/page.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `src/components/store/CartProvider.tsx`, `CartDrawer.tsx`, `CheckoutForm.tsx`, `EditionCards.tsx`, `store.module.css`, `src/lib/catalog.ts`, `cart.ts`, `checkout.ts`, `src/app/api/checkout/quote/route.ts`, `src/app/api/checkout/route.ts`, `src/components/public/BookPage.tsx`, `src/lib/jobs.ts`, `tests/e2e/cart-checkout.spec.ts`, `tests/integration/checkout.test.ts`, `tests/unit/money.test.ts`, `src/types/database.ts`.

**Steps:** owner-managed digital/physical/signed variants and future general products; no default selling price; rights/availability/stock/low-stock alerts, customers, coupons, city shipping and policy/tax configuration. Connect locked book cards and home book teaser to same catalog data. Client persisted cart versioning/quantities/remove/resume, localStorage denial fallback, drawer keyboard behavior and full-page cart. Server quotes/checkout implement all transaction rules. Checkout asks only relevant fields, dedication for signed copy, policy consents with revision IDs. Order/payment pending record creates resources for P08, but no local stub may label a real order paid.

**Proof:** price tampering, disabled variant, price change between quote and submit, invalid/expired/exhausted coupons, unknown city, mixed cart, missing consent/tax setup, simultaneous last-unit checkout, duplicate idempotency request, integer discount remainder and stock expiry. Add a new non-book product from admin and reach a persisted pending order through the same flow without code changes; paid completion is P08. Empty/unpriced catalogs show truthful unavailable states. Risk: UI price literals, race conditions, and discount/stock counters diverging on failure.

## P08: Verified gateway, orders, digital delivery and returns

Phase: المتجر والدفع. Depends: P07. Complexity: high. Requirements: C20, C26–C30, C34.

**Owned files:** `src/lib/payments/moyasar.ts`, `src/lib/orders.ts`, `src/app/api/payments/moyasar/webhook/route.ts`, `return/route.ts`, `src/app/api/orders/access/route.ts`, `src/app/api/orders/[token]/request/route.ts`, `src/app/api/download/[token]/route.ts`, `src/app/(public)/orders/[token]/page.tsx`, `src/app/admin/orders/page.tsx`, `orders/[id]/page.tsx`, `orders/actions.ts`, `src/lib/checkout.ts`, `email.ts`, `outbox.ts`, `jobs.ts`, `r2.ts`, `supabase/migrations/202609210007_payments_fulfillment.sql`, `tests/integration/payment.test.ts`, `tests/integration/download.test.ts`, `tests/e2e/orders.spec.ts`, `tests/support/moyasar-emulator.ts`, `docs/payments-runbook.md`, `.env.example`, `src/types/database.ts`.

**Steps:** server-created hosted invoice; fetch payment+invoice verification; actual documented webhook secret token; durable event ingestion/reconciliation; idempotent ledger and outbox. Record invoice creation uncertainty, provider refunds and late-payment state exactly as data contract. Admin order/customer views, fulfillment/tracking, signed dedication, returns/refund approval with owner MFA, partial refunds, entitlement/download/recovery emails. Notify the owner of low stock and unresolved paid orders. When a variant changes from unavailable to sellable, enqueue one availability email per confirmed subscriber and availability revision using a unique dedupe key; recheck consent at dispatch and include unsubscribe. Use same-role restrictions on all action paths, not just buttons.

**Proof:** fake redirect cannot create paid order; wrong secret/environment/currency/amount/order mapping fails; duplicates/out-of-order callbacks fulfill/email once; crash after durable receipt recovers; timeout during invoice creation/refund does not blindly retry; late success after stock expiry has correct resolution. Booking-specific late slot conflicts run in P09. Unknown/lost invoice ID stays uncertain until provider listing/manual reconciliation or expiry; document actual endpoint capability, never assume `given_id` applies to invoices. Test stolen/expired/refunded download tokens, revoked entitlements and cross-customer order access. Prove availability activation sends once to confirmed opt-ins, never to unsubscribed/pending users, and retries do not duplicate it. Finally complete the new non-book product and book flows with real Moyasar sandbox card, failure/3DS/cancel, webhook and refund recorded with redacted IDs. Emulator tests do not substitute for gateway sandbox evidence.

**Risk:** gateway credentials/activation E02; Apple Pay needs merchant setup and supported browser/device. All code may complete locally but phase 3 cannot claim its contractual gateway test passed without the real sandbox transaction. No live charge is required or authorized by this planning task.

## P09: Paid services, appointment availability and calendars

Phase: المتجر والدفع. Depends: P08. Complexity: high. Requirements: C24, C25, C30.

**Owned files:** `src/app/admin/services/page.tsx`, `services/actions.ts`, `bookings/page.tsx`, `bookings/actions.ts`, `availability/page.tsx`, `availability/actions.ts`, `src/app/(public)/services/page.tsx`, `services/[slug]/page.tsx`, `src/components/booking/BookingForm.tsx`, `booking.module.css`, `src/lib/booking.ts`, `calendar.ts`, `src/app/api/services/[id]/slots/route.ts`, `src/app/api/bookings/route.ts`, `src/app/api/calendar/[token]/route.ts`, `src/lib/checkout.ts`, `jobs.ts`, `email.ts`, `supabase/migrations/202609210008_booking.sql`, `supabase/tests/bookings.test.sql`, `tests/e2e/bookings.spec.ts`, `tests/integration/bookings.test.ts`, `tests/unit/calendar.test.ts`, `docs/calendar-setup.md`, `package.json`, `pnpm-lock.yaml`, `src/types/database.ts`.

**Steps:** Arabic service list/edit with duration, price, online/in-person and owner-configured availability; Riyadh weekly hours/date exceptions/manual busy blocks. Public date/slot selection, free confirmed requests or paid holds that commit only after verified payment. DB exclusion prevents overlap including buffers; handle cancellation/rescheduling, return/refund policy and customer confirmation. Operations sees upcoming bookings and contact channels. Use `ics` for validated escaped RFC 5545 events, UTC timestamps, stable UID and sequence/cancellation updates; revocable private subscription URL plus per-booking `.ics`. Test actual import/subscription behavior; subscription clients refresh on their own schedule, so do not promise instant two-way sync. No arbitrary URL calendar fetching or OAuth scope collection.

**Proof:** two concurrent bookings on one slot yield one reservation; unpaid hold expires; paid late conflict resolves without double booking; free vs paid cases, unavailable dates, timezone boundaries, cancel/refund/rebook, calendar token rotation, escaping newline/header injection, file import in a calendar client. Customer notes/email excluded from public slot listing and busy-only feed. Risk: ambiguous calendar expectation explicitly resolved by D12; this is actual one-way standards integration, not a dead calendar icon.

**Phase 3 gate:** a full Arabic sandbox order reaches verified paid state, one confirmation email and admin fulfillment; digital delivery and refund paths work; coupons/shipping and paid appointments pass. E02 is a real blocker, never a waived requirement.

## P10: Full-platform hardening and design audit

Phase: التجربة والإطلاق. Depends: P09. Complexity: high. Requirements: C01–C34, C40.

**Owned files:** `src/app/sitemap.ts`, `robots.ts`, `src/lib/seo.ts`, `src/app/(public)/layout.tsx`, all production files requiring a verified bug fix under the active single-writer lock (GLM enumerates actual paths before dispatch), `tests/e2e/accessibility.spec.ts`, `tests/e2e/security.spec.ts`, `tests/e2e/journeys.spec.ts`, `tests/e2e/visual.spec.ts`, `tests/integration/retention.test.ts`, `scripts/check-copy.mjs`, `check-budgets.mjs`, `lighthouserc.cjs`, `.github/workflows/ci.yml`, `docs/security.md`, `docs/qa-report.md`, `public/og/site.jpg` (only if approved asset is available).

**Steps:** per-route Arabic metadata/canonicals/OG, Person/Book/Product/Article structured data reflecting actual configured data, sitemap excludes draft/private/hidden pages; robots disallows admin/order/preview; external social links safe. Add cookieless Cloudflare analytics only on public pages, privacy disclosure, no PII in events. Evaluate CSP and private caching, restore/retention, secret detection, dependency/license scan. Walk every design-law item in DESIGN-AUDIT, compare frozen book, fix visibility/clipping/contrast/alignment without redesign. Cover complete empty/loading/error/success states on mobile and desktop. Run bounded performance budgets with reader/editor excluded from initial route chunk but measured separately. No fail-on-purpose skipped checks.

**Proof:** full VERIFICATION suite, all C IDs evidenced, no critical/serious accessibility issues, route console clean, no unapproved copy/tool names, no price literals in production, screenshots and test artifacts tied to commit. Check actual iOS Safari and Android browser plus supported Apple Pay setup before claiming device proof; emulator-only evidence labelled. Risk: calling a partial audit launch-ready. Any unresolved high-risk defect stops P11.

## P11: Launch, training, ownership and support handoff

Phase: التجربة والإطلاق. Depends: P10 and external gates. Complexity: medium. Requirements: C35–C40.

**Owned files:** `.github/workflows/deploy.yml`, `docs/deployment.md`, `docs/owner-guide.ar.md`, `docs/account-inventory.md`, `docs/launch-checklist.md`, `docs/training-record.md`, `docs/support-log.md`, `docs/rollback.md`, `docs/license-register.md`; necessary final production config paths explicitly granted in lock before editing.

**Steps:** client-owned accounts/domain; environment isolation and secrets set without logging; DNS/TLS, verified sender SPF/DKIM/DMARC, payment methods/webhook registrations, production R2 isolation, scheduled job monitoring, backed-up migrations and reversible deploy. Confirm E01–E09 and owner acceptance of recurring costs/legal texts. Prepare rollback to previous Worker plus compatible schema; forward-fix destructive migrations, no unreviewed drop. Verify health and idempotent webhook handling before checkout enablement. Show owner Arabic guide; have Anas create/publish article, crop image, edit price/stock, handle message/order/booking, invite/revoke and locate backups unaided. Record date and actual completion.

**Proof:** live custom-domain public paths and private access smoke, email delivery, scheduled jobs/backup check, owner account ownership and repo export, completed training. Keep a 30-day post-launch support window with named owner, start/end dates, incident contact and issue register; a scheduled future end date is not completed support. The final commercial closure occurs after that month, while launch acceptance can be recorded separately. If any external gate is unavailable, deliver build/test artifacts with exact blocked status and do not claim launch.

**Stop:** after handing over the accepted result and open operational obligations. No new redesign, expansion or optional integration backlog disguised as remaining mission work.
