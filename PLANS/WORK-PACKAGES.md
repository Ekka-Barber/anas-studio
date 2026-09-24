# Execution PRDs: Next.js with a custom Supabase admin (D29)

Every package includes ARCHITECTURE.md, DATA-AND-SECURITY.md, DECISIONS.md and VERIFICATION.md by reference. Exact directory shorthand expands relative to its named parent; the orchestrator writes the full expanded allowlist to the exclusive lock before dispatch. Only one writer runs. Shared config/types/lockfiles are changed by that writer and audited. No edits to frozen/source paths or _archive/.

Phases: P00–P02 foundation, P03–P06 administration, P07–P09 store/payment, P10–P11 launch. P12 is separately accepted BONUS SCOPE and does not change the offered 7–9-week timeline. Run sequentially; the orchestrator personally runs and audits EVERY package. Work is local-first until P11 (ARCHITECTURE). External inputs remain open gates, not excuses to omit implementation.

## P00: Exact runtime spike, then foundation

Depends: none. Complexity/risk: high, integration feasibility. Owner C01/C02.

**Proven, 2026-09-22/23 (committed):** Next 16 + OpenNext on Workers Free for the public route with the ISR cache (R2 incremental cache, D1 tag cache), the revalidate gate ahead of OpenNext, Hyperdrive to the Supabase transaction pooler with caching disabled, R2 through the binding, Cron Trigger delivery, pinned toolchain, strict TS/lint, check scripts and CI. **Withdrawn by D29, not failed:** the Payload admin login, CRUD, upload and native-job criteria, and the Oracle VM admin target (I19 part 1).

**P00 D29 swap** (runs after the P01 part 1 commit). Remove: `payload`, every `@payloadcms/*` package and whatever becomes unused (drizzle, graphql); `src/payload/`, `src/payload.config.ts`, `src/payload-types.ts`, `src/payload-generated.schema.ts`, `src/lib/payload.ts`, `src/app/(payload)/`, `src/app/(public)/probe/`, `withPayload` and the drizzle/S3/`RUNTIME_TARGET` branches in `next.config.ts`, `Dockerfile`, `.dockerignore`, `scripts/admin-vm/`, `tests/unit/runtime-target.test.ts`, `tests/e2e/runtime.spec.ts` Payload steps, the CI "Build-only Payload secret" step, `PAYLOAD_SECRET` and the Payload entries in `scripts/check-copy.mjs`/`check-budgets.mjs`. Add: `supabase/config.toml` (sign-up off, email OTP on, Google provider wired to env and off until a client exists, Mailpit), the first migration (`staff`, the role helper, the `app_server` login role, deny-by-default grants, RLS on), `supabase/seed.sql` (local-only app_server password), `src/lib/db.ts` on `app_server`, `src/app/api/health/route.ts` using `select 1`, `.env.example`, and rewritten `docs/{development,runtime-spike}.md`.

Proof: no `payload` or `@payloadcms` entry in the lockfile; `pnpm install --frozen-lockfile`, `pnpm check` (lint, typecheck, unit tests, copy, frozen, budgets) exit 0; `supabase db reset` exits 0 on a clean stack; `next build` passes and Linux `build:worker` passes with the Worker upload size recorded against the 25,338 KiB Payload baseline; every P01 room renders unchanged in the existing visual suite; `/api/health` answers through `app_server`; a grep of `.open-next/` finds no Supabase secret key. Hosted re-measurement belongs to P10.

## P01: Eight public rooms and new journal composition

Depends P00. Complexity high; risk prototype canvas vs real responsive layout. Owner C03/C04/C05/C07/C32.

Files: public route files from ARCHITECTURE for home/started/built/passed/book/shelf/scenes/contact/journal/journal slug/project slug/policies; `src/app/(public)/{not-found,error}.tsx`, `src/components/site/{Header,Footer,Navigation,MotionPreference}.tsx`, `src/components/public/{RoomPage,HomeSections,BookPage,SceneGallery,ContactForm,Journal}.tsx`, `src/components/public/public.module.css`, `src/components/site/site.module.css`, `src/styles/{tokens,globals}.css`, `src/lib/format.ts`, `src/lib/content.ts`, `src/lib/richtext.tsx`, `content/initial-content.json`, approved exact `public/fonts/` and `public/images/` manifest destinations, `scripts/prepare-media.mjs`, `tests/e2e/{public,visual}.spec.ts`, `tests/unit/{format,content}.test.ts`.

Transfer frozen compositions/copy/fonts/images into semantic React; book layout stays final. Replace .dc links with routes. Remove prototype customization/reference screens/runtime. Implement mobile menu, actual built tabs, gallery filter/lightbox, static shelf, motion preference and JS-off readable content. Journal default المجلس: lead story + dated readable list, categories, detail; no fake public articles. Content comes from `content/initial-content.json` until P04 binds the database; production requires approved published admin records. Purchase/form controls have truthful unavailable states until later wiring, never fake success. Public links keep `prefetch={false}` (I23). Design work is paused by the owner; P01 part 1 is committed as audited and the remaining rooms wait for the owner to reopen design.

Proof: every route, menu/tab/filter/lightbox real clicks; keyboard and focus restore; 360/768/1024/1440 screenshots, no horizontal overflow/cropped glyphs, reduced-motion/JS-off readable. Font licenses E06; copy/assets E05. Public design boundary and book comparison documented. No new content invention to fill missing photographs.

## P02: Authentic physical PDF reader

Depends P01. Complexity high; risks old flip dependency and missing final manuscript. Owner C06/C33.

Files: `src/components/book/{PdfBookReader,StaticPdfReader}.tsx`, `reader.module.css`, `src/lib/book-preview.ts`, book mounting component/page, `scripts/prepare-preview.py`, `content/book-source-manifest.json`, generated safe fixture PDFs under `tests/fixtures/reader/`, `tests/e2e/reader.spec.ts`, `tests/unit/reader-mapping.test.ts`, `docs/book-preview.md`, manifests/lockfile.

Inventory hashes/pages; supplied actual Khous fragments are 1–2 pages, not proven complete manuscript. Privately render a real fragment; public range/source approval E04 required. Export a separate approved excerpt with patched pypdf; strip actions/attachments, record input/output hashes. Lazy patched PDF.js/local matching worker, isEvalSupported:false; render actual canvases/text into direct page-flip leaves, correct right binding with no mirrored Arabic. Current+adjacent only (max 6 canvases, DPR<=2), cancel stale renders. Previous/next/page jump/count/fullscreen plus expanded fallback; RTL Right=previous, Left=next. Reduced-motion static pagination/selectable text, corrupt/network retry and approved excerpt alternative. No hidden full-paid PDF.

Proof: real source first/middle/last as applicable, odd/1-page synthetic fixtures, Arabic/Latin digits, resize/portrait/keyboard/touch/fullscreen/failure/static fallback and request log proving no manuscript transfer. Outside reader the book visual baseline remains unchanged. Phase 1 gate: all public pages faithful/responsive/console-clean and reader functionality proven; unresolved rights remain explicit launch blockers.

## P03: Staff auth, schema, RLS and admin shell

Depends P02. Complexity high; risk an RLS gap or a policy that trusts client input. Owner C21.

Files: `supabase/migrations/`, `supabase/config.toml`, `supabase/seed.sql`, `supabase/functions/staff-admin/index.ts`, `@supabase/supabase-js`, `@supabase/ssr` if the admin layout needs cookie sessions, `src/lib/supabase/{browser,server}.ts`, `src/lib/{db,validation}.ts`, `src/app/(admin)/layout.tsx`, `src/app/(admin)/admin/{page,sign-in/page,mfa/page,team/page}.tsx`, `src/components/admin/{AdminShell,SignIn,MfaEnroll}.tsx`, `src/components/admin/admin.module.css`, `scripts/bootstrap-owner.mjs`, `tests/db/{roles,rls,staff}.test.ts`, `tests/e2e/auth.spec.ts`.

Supabase Auth passwordless: email one-time code now; Google sign-in wired and enabled when Anas supplies a Google OAuth client. Sign-up disabled; one owner bootstrapped out of band by script against the local stack. `staff` table, active-role helper, last-owner trigger. Content, taxonomy, media and settings tables from DATA-AND-SECURITY with RLS on every table and published-only anon policies; `content_versions`; `audit_events`. Owner TOTP enrolment and aal2 checks for refunds, role changes and invites. `staff-admin` Edge Function for invite/role/revoke. Admin shell at `/admin`: Arabic RTL, main theme colors and tokens, noindex, no-store, claims checked in the layout. Auth mail goes to local Mailpit.

Proof: real-JWT Data API tests for anon, editor, operations, owner and a revoked owner deny every forbidden read and write, including self-promotion; direct SQL proves `app_server` is EXECUTE-only and that anon/authenticated cannot reach `finance`; the last owner cannot be removed; a sensitive function fails at aal1 and at a stale aal2 and passes with a fresh TOTP; sign-in by email code works end to end through Mailpit; with sign-up disabled an uninvited email cannot sign in; no password hashing and no secret key in the Worker bundle. All negative tests pass before admin acceptance.

## P04: Collections, drafts, versions and site binding

Depends P03. Complexity medium; risk early draft leakage or lost edits. Owner C08/C13/C14/C15/C16/C19.

Files: `src/admin/collections/{pages,posts,projects,scenes,shelf-entries,taxonomies,policies,site-settings}.ts`, `src/components/admin/{CollectionList,CollectionForm,RichTextEditor,VersionHistory}.tsx`, `src/app/(admin)/admin/[collection]/{page,[id]/page}.tsx`, `src/app/api/preview/route.ts`, migrations for the publish/restore/schedule functions and pg_cron job, `src/lib/{content,richtext}.tsx` (content.ts), `src/app/api/revalidate/route.ts`, `tests/e2e/cms.spec.ts`, `tests/db/publication.test.ts`, `tests/unit/richtext.test.ts`.

One collection config format drives a generic list and edit form (field types in ARCHITECTURE). Pages have typed sections with text/media/show/hide/order; projects have room/status/logos/metrics; scenes/shelf; taxonomies/authors. Lexical editor with an Arabic RTL toolbar; the public renderer allows explicit supported nodes only. Autosave, drafts, version history, restore as a new version, preview through `draftMode`, scheduled publish by pg_cron, archive. Optimistic `version` checks keep unsaved content on conflict. Public loaders move from `content/initial-content.json` to published-only reads; publish revalidates at once and scheduled items appear within 60 seconds.

Proof: Anas-style owner writes an Arabic post, adds category/tag/author/image, drafts/previews/schedules/archives/restores; it never leaks early (HTML, API, relations, metadata, sitemap). Reorder/hide/edit a public section without code or redeploy. Two sessions editing one record don't silently overwrite. Scheduler delay and public cache tested. The admin menu contains only real, useful collections.

## P05: Media library with no-Sharp derivatives

Depends P04. Complexity medium; risk accidental server image processing/invalid derivative. Owner C17/C18.

Files: `src/admin/collections/media.ts`, `src/components/admin/{MediaLibrary,MediaUpload}.tsx`, `src/lib/{media,r2}.ts`, `src/app/api/media/{upload,complete}/route.ts`, media migration, `tests/e2e/media.spec.ts`, `tests/integration/media-security.test.ts`, `docs/media-rights.md`.

Admin media library with folders, reuse across records and a where-used deletion guard. The upload flow generates WebP sizes and crop in the authenticated browser, never upscaling; no Sharp or cloud transforms. Preserve the private original for future recrop. Tickets hold a server-owned key/purpose/expiry; the server checks magic bytes/type/dimensions/bytes plus ownership and preset bounds before promotion. Reject SVG/HTML/archives/oversize. Header checks are not described as full decode/sterilization. Require rights/alt and explicit dimensions. Handle an unsupported encoder or corrupt file with a usable error, never a raw public fallback. Browser crop/encode quality and RTL controls tested.

Proof: actual crop visible publicly, normal EXIF removed by re-encode, spoof/size/key/expiry/cross-user failures, private original unreadable, folder move/reuse/delete-in-use correct. No Sharp in the Worker bundle or hidden transform costs. Re-encoding derivatives is automatic, not a manual outside-design job.

## P06: Settings/inbox/team, owner home/stats and backups

Required audit additions: allow `src/app/api/email/resend/webhook/route.ts`, `.env.example`, `docs/costs.md`, and `tests/integration/{email-delivery,privacy-requests}.test.ts` alongside the files below. Implement signed delivery-event verification, dedupe, recipient suppression and bounded/exhausted retries using the DATA contract and existing operations view. All mail paths share the policy; prioritize sign-in codes/receipts over availability notices and reconcile uncertain sends before replay after provider idempotency expiry. Prove forged, duplicated and reordered events, quota exhaustion, suppressed recipients and safe replay; provider acceptance alone never passes a delivery assertion.

Select and document the off-site backup destination and key custodian, retention footprint, current allowances/overages, available alerts and measured restore cost/time. Supabase Free has no backups, so the CI dump is required from the first hosted day. A missing free allowance blocks hosted proof/E07; continue safe local synthetic tests. Add the identity-verified privacy-request runbook to `docs/privacy-data-map.md`; test cross-customer isolation, export/correction/deletion, accounting exceptions and reapplication of deletions after restore. No new customer portal. P08/P10 complete checks against the financial schema once it exists; record those prerequisites explicitly rather than falsely accepting an unrun check.

Depends P05. Complexity high; risk invented analytics/PII leakage. Owner C09/C12/C22/C23.

Files: `src/admin/collections/{contacts,notifications,commerce-settings}.ts`, `src/app/(admin)/admin/{home,inbox,team,stats,backups}/page.tsx`, `src/components/admin/{AdminHome,StatsView,BackupsView}.tsx`, `src/lib/{stats,email,outbox,rate-limit,audit,jobs}.ts`, `src/app/api/{contact,notify,notify/confirm,notify/unsubscribe,health}/route.ts`, `src/app/api/admin/stats/route.ts`, `supabase/functions/staff-admin/index.ts`, `scripts/{backup,restore-check}.mjs`, `.github/workflows/backup.yml`, migrations, `tests/e2e/owner-operations.spec.ts`, `tests/integration/{forms,outbox,stats}.test.ts`, `docs/{operations,privacy-data-map}.md`.

Settings, inbox and team screens on the generic collection form where it fits. Editable nav/footer/SEO/contact/store policy/domain/sender verification. WhatsApp normalized wa.me telephone link; no Business API. Team invite/role/revoke through `staff-admin` at owner aal2; no unsolicited real invites in tests. Supabase Auth mail uses Resend SMTP when hosted. Contacts persist with outbox even when mail is down; Turnstile hostname/action/honeypot/throttles. Confirm/unsubscribe availability notices. Domain/email screens describe real DNS steps and verification, never editable secret fields.

Owner home: actual pending tasks and compact real DB order/paid/refund/net-collected/customer counts; payment tables arrive P07/P08, so the initial state says not configured. Visits/top pages use the server-side Analytics API with verified dataset definition/range/freshness; missing permission/data says unavailable, not an invented zero. SQL stats test after the financial schema arrives in P08/P10. Owner-only 5-minute cache. Bonus board tasks attach in P12.

Backups view reports the actual encrypted off-site database+binary manifest/restore. Nightly 7 daily/4 weekly/3 monthly retention, disposable restore first, manual owner confirmation for production restore. Proof: save/reload settings, real inbox despite email outage, dedupe/retry, unauthorized stats denied, analytics fixture reconciles response, restore includes assets/roles, staff invite and sign-in mail received in Mailpit. Phase 2 gate: the orchestrator, acting as owner, adds/crops an image, writes/publishes a post, edits/reorders a section without code and inspects every admin screen; no blank CRUD screens.

## P07: Catalog plus transactional cart/checkout

Required audit additions: include `src/lib/rate-limit.ts` in the allowlist. Enforce the DATA contract's pre-reservation attempt/active-hold limits and Turnstile checks. Document concrete limits, expiry behavior and residual abuse risks. Test distinct idempotency keys and concurrent attempts against one scarce variant, retry reuse, expiry reclamation and legitimate shared-network buyers. Never extend an existing hold merely because the caller changes the key.

Depends P06. Complexity high; risk money/stock races. Owner C20/C26/C27 (C20 closure awaits supporting P08).

Files: `src/admin/collections/{products,variants,coupons,customers,shipping-rates}.ts`, commerce settings, migrations (finance tables/functions, stock guards, column privileges), `src/lib/{catalog,cart,checkout,db,jobs}.ts`, `src/components/store/{CartProvider,CartDrawer,CheckoutForm,EditionCards}.tsx`, `store.module.css`, public store/product/cart/checkout routes, `src/app/api/checkout/quote/route.ts` and `src/app/api/checkout/route.ts`, book purchase wiring, `tests/e2e/cart-checkout.spec.ts`, `tests/integration/checkout.test.ts`, `tests/unit/money.test.ts`.

Catalog, customer and coupon screens use the generic collection form; no bespoke product editor. Owner product variants/price/stock/preorder/rights, supported cities/rates, tax/seller/invoice settings and policy revisions. `authenticated` cannot update reserved/redeemed counters; SQL functions adjust the shared rows. Configure before selling; no historical demo prices. Persist cart IDs/qty only, session fallback if storage denied. Validate 1–20 qty/50 lines, all server totals, stale quotes, coupon eligibility, exact tax/discount allocation, dedication, address only physical, versioned policy consent. Atomic reserve/idempotent pending order under the DATA protocol.

Proof: a new non-book product reaches a persisted pending order without code changes (paid flow P08). Concurrent last unit/coupon, unknown city/unconfigured tax/price, tampered total/stale quote, persistent cart/mixed physical+digital, duplicate idempotency and rollback/expiry. A direct Data API update of a counter column is denied. Empty store truthful. Actual paid stats/availability dispatch become testable P08, not falsely passed here.

## P08: Verified gateway and post-sale operations

Required audit additions: extend the existing payments runbook and reconciliation audit trail for owner-verified disputes, chargebacks and payout differences. Keep payment/refund history immutable and record explicit entitlement/fulfillment decisions. Test a synthetic dispute, fee/timing discrepancy and repeated reconciliation without double-counting. Explain that gross minus confirmed refunds excludes fees/chargebacks/payout timing and is not bank-settled cash. Recheck email failure/priority and privacy handling against real order/customer relations. Update the remaining-effort estimate after the first complete sandbox payment proof; no automatic change to the commercial commitment.

Depends P07. Complexity high; risk duplicate money/fulfillment. Owner C28/C29/C30.

Files: `src/lib/payments/moyasar.ts`, `src/lib/{orders,checkout,outbox,email,jobs,r2}.ts`, `src/components/admin/{OrderView,RefundView,ReconciliationView}.tsx`, `src/app/(admin)/admin/orders/**`, payment/order/download API routes from ARCHITECTURE, public order-token route, finance migrations, `tests/integration/{payment,download,stats}.test.ts`, `tests/e2e/orders.spec.ts`, `tests/support/moyasar-emulator.ts`, `docs/payments-runbook.md`.

Hosted invoice server-only; durable attempt before network; real secret_token webhook validation plus authoritative invoice/payment fetch checking identity/amount/currency/mode/status. Idempotent transactional stock/coupon/receipt/entitlement; redirect never paid. Creation/refund timeout remains uncertain until reconciled, not blindly retried. Provider minimum enforced. Admin order pages show verified evidence, fulfillment/tracking/signed dedication/return/refund; a refund needs a fresh owner aal2. Expiring hashed order/download tokens and private ebook delivery. Availability change enqueues once per variant availability revision/confirmed subscriber; recheck unsubscribe on send. Low-stock/unresolved paid alerts.

Proof: negative/duplicate/out-of-order/retry/crash/late-stock-payment cases; refund reserve prevents overrefund; correct partial entitlement revocation. Full book AND new non-book sandbox purchase reaches real confirmed mail/admin; failed/3DS/cancel/refund tested with redacted provider IDs. The sandbox webhook needs a public URL: a short-lived tunnel authorized by the owner at that time, otherwise E02 stays open. Availability opt-in/restock/mail/unsubscribe actual journey; no notification to pending/unsubscribed users. The emulator is necessary but not a substitute for the real sandbox E02. Reconcile stats with ledger. Booking-specific late slot conflicts run P09.

## P09: Services and availability, atomic bookings/ICS

Required audit additions: include `src/lib/rate-limit.ts` in the allowlist and reuse P07's hold protections for paid slots. Bound attempts for free bookings too. Test rotating-key and concurrent slot exhaustion, reclaimed expiry, duplicate retries and shared-network customers; retain the SQL exclusion guarantee independently of abuse controls.

Depends P08. Complexity high; risk overlap/timezone. Owner C24/C25.

Files: `src/admin/collections/{services,availability-rules,availability-exceptions}.ts`, `src/lib/{booking,calendar,checkout,jobs,email}.ts`, `src/components/booking/BookingForm.tsx`, `booking.module.css`, public services routes, services slots/bookings/calendar API routes, finance migrations, `tests/e2e/bookings.spec.ts`, `tests/integration/bookings.test.ts`, `tests/unit/calendar.test.ts`, `docs/calendar-setup.md`.

Service/weekly-hours/exceptions/manual busy screens on the generic collection form. Riyadh presentation/UTC ranges, durations/buffers, free confirmed vs paid held booking, cancellation/reschedule/policy/customer mail. SQL exclusion and expiry guarantee one active slot; a late paid conflict never bumps another booking. The ics library produces stable UID/sequence/cancel events, a revocable private subscription and per-booking export; no calendar-platform dependency, two-way claim or URL import/SSRF. Operations actions are controlled admin actions, not a separate app.

Proof: concurrent one-slot winner, buffer/back-to-back boundaries, expiry/free/paid/cancel/refund/rebook, late payment conflict, token rotation, CRLF escaping and actual calendar import/subscription. Owner understands client polling delay. Phase 3 gate: all money/sandbox/fulfillment/service journeys pass; missing E02 cannot be waived.

## P10: Whole-platform quality, monitoring and design audit

Required audit additions: deploy to the hosted test Worker with the owner's authorization and repeat hosted Worker CPU/bundle/connection/scheduled-job measurements for the whole app, including I21's cache-hit CPU check. Run all follow-up checks in VERIFICATION, including email failures, hold abuse, dispute accounting, privacy/restore behavior and measured backup/quota evidence. The P00 public-route pass does not waive a later runtime regression.

Depends P09. Complexity high; risk partial audit claimed complete. Owner C10/C11/C31/C34.

Files: `src/app/{sitemap,robots}.ts`, `src/lib/seo.ts`, `src/instrumentation.ts`, `sentry.server.config.ts`, `src/instrumentation-client.ts`, `tests/e2e/{accessibility,security,journeys,visual}.spec.ts`, `tests/integration/retention.test.ts`, `scripts/check-{copy,budgets}.mjs`, `lighthouserc.cjs`, CI config, `docs/{security,qa-report,monitoring}.md`; bug-fix production paths enumerated by the orchestrator before dispatch.

Arabic per-route metadata/canonical/OG/Person/Book/Product/Article truthful from approved data. Private/draft/admin/board/token routes excluded. Cloudflare public cookieless analytics disclosed, no PII. Admin screens complete empty/loading/validation/error/success flows. Sentry free checkout/webhook/scheduler errors with beforeSend redaction and no replay; one external free monitor checks coarse health, alert test to owner only on activation authorization. No paid operational dependency. Design audit every item; book outside reader faithful. Full unit/integration/real DB/e2e/axe/Worker performance/dependency/license/restore gates; real-device limitations labelled.

Proof: all VERIFY checks, no unexplained console/network errors, stats match provider+ledger, monitor/Sentry synthetic failure received without PII, no tool copy/fake price. Lighthouse >=90, LCP<2.5s/CLS<0.1, public initial budget measured, actual INP evidence distinguished from Lighthouse. Any failed security/runtime gate stops P11.

## P11: Client-owned launch, training and support

Required audit additions: E07 closes only with the actual destination/retention/key-custody and all-in operating cost sheet; alerts must not be represented as hard spending caps. E08 includes the tested privacy-request procedure. Owner training includes exhausted-email recovery, dispute/payout reconciliation and privacy/restore exceptions. Missing evidence stays an explicit launch gate.

Depends P10 and live E gates. Complexity medium. Owner C35/C36/C37/C38/C39/C40.

Files: `.github/workflows/deploy.yml`, `docs/{deployment,owner-guide.ar,account-inventory,launch-checklist,training-record,support-log,rollback,license-register}.md`, exact approved production config paths.

First production deployment, with the owner's authorization. Confirm accounts/domain/DNS/TLS/mail verification (Resend SMTP for Supabase Auth), provider methods/webhooks, Google OAuth client if used, backups/jobs, real approved content/fonts/manuscript/tax/policy, monitor alerts, cost approval. No real orders on the free pausable DB; approve the always-on baseline (Workers Paid, Supabase Pro) before enabling checkout. One deployment; tested migrations/rollback, no destructive rollback drops. Train the owner by unaided admin tasks: post/image/page/product/price/coupon/inbox/order/booking/team/backups/stats. Record the actual date/steps, not a pretend training document. Export accepted work and client-owned account inventory at every phase.

Proof: live route/private boundary/domain/sender/job/backup/monitor smoke, actual training and owner acceptance. 30-day support contact/start/end/issue ledger remains an obligation until elapsed and delivered; launch acceptance and commercial closure differ. Missing external facts produce explicit blocked launch status, not omitted features. No live purchases are authorized by this plan.

## P12: لوحة أنس (BONUS SCOPE)

Depends P11 application baseline; may build after P10 if P11 is blocked only on external launch inputs, without changing offer acceptance/timeline. Complexity medium; risk privacy/RTL drag loss. No C-IDs.

Files: board migration, `src/app/(admin)/admin/board/page.tsx`, `src/components/admin/{WorkspaceView,AdminHome}.tsx`, `src/components/admin/workspace.module.css`, `src/app/api/admin/workspace/move/route.ts`, `tests/e2e/workspace.spec.ts`, `tests/integration/workspace.test.ts`, `docs/workspace-guide.ar.md`, manifests/lockfile.

Owner-only board/column/card tables under RLS; one custom @dnd-kit kanban screen. Boards/free-form named columns/cards, arbitrary life/work projects retained indefinitely. Card title/notes/order and optional due date/content link. No hardcoded idea-production-publish lifecycle. Optional per-card link to a post/project/shelf record; linking cannot create/publicize content and cannot change its status. Publishing only through the distinct explicit content action. No teams, permission matrix, swimlanes, automations or external project tools.

Drag-drop pointer/touch/keyboard with RTL transforms, focus/announcements; move-menu fallback. The server verifies owner/board/column/card versions, moves/reorders transactionally; collision reload preserves edits; persisted after reload. Admin home adds actual due/pending board actions, with no fake workload metric. No public grants, no sitemap, robots denied, no public caching.

Proof: anon/editor/operations JWTs are denied at the Data API and the move endpoint; private strings absent from sitemap/public search/SEO. Link card to draft/published content, move/edit/archive board, verify target publication state NEVER changes. Free-form columns survive reorder/reload; RTL pointer/touch/keyboard/fallback operate; concurrent stale move returns conflict. Private notes are excluded from Sentry/analytics. Accept bonus separately, then stop.
