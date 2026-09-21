# Execution PRDs: final Payload architecture

Every package includes ARCHITECTURE.md, DATA-AND-SECURITY.md, DECISIONS.md and VERIFICATION.md by reference. Exact directory shorthand expands relative to its named parent; the orchestrator writes the full expanded allowlist to the exclusive lock before dispatch. Only one writer runs. Shared config/types/lockfiles are changed by that writer and audited. No edits to frozen/source paths or _archive/.

Phases: P00–P02 foundation, P03–P06 administration, P07–P09 store/payment, P10–P11 launch. P12 is separately accepted BONUS SCOPE and does not change the offered 7–9-week timeline. Run sequentially; the orchestrator (Fable) personally runs and looks after EVERY package. External inputs remain open gates, not excuses to omit implementation.

## P00: Exact runtime spike, then foundation

Required audit additions: include `src/app/api/health/route.ts` and `src/payload/jobs.ts` in the exact file allowlist, plus the shared execution lock/status/issues/evidence paths. Record the dirty working-tree baseline and planning hashes as well as the base commit; preserve unrelated edits. Run the planning verifier before scaffolding because its PLANS-only assertion is not an application test. Add one native versioned Lexical record and one bounded scheduled job to the spike. Test private R2 denial, concrete API/catch-all precedence, rollback, read-after-write and pooled request isolation. Record pooler mode, prepared-statement behavior and connection limits; measure cold/warm requests and scheduled CPU separately on hosted Free against current limits. Missing hosted credentials or authorization is an external blocker, not a local-preview pass. Record a revised remaining-effort estimate after this proof without changing the offered scope or timeline.

Depends: none. Complexity/risk: high, integration feasibility. Owner C01/C02.

Files: `package.json`, `pnpm-lock.yaml`, `.node-version`, `.npmrc`, `.gitignore`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `next-env.d.ts`, `open-next.config.ts`, `worker-entry.ts`, `wrangler.jsonc`, `cloudflare-env.d.ts`, `.env.example`, `src/payload.config.ts`, `src/payload/collections/Users.ts`, `src/payload/collections/RuntimeProbe.ts`, `src/payload/storage.ts`, `src/payload/migrations/`, Payload route files listed in ARCHITECTURE, `src/app/(public)/layout.tsx`, `src/app/(public)/page.tsx`, `src/lib/{env,payload,db}.ts`, `scripts/{check-frozen,check-copy,check-budgets}.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `tests/e2e/runtime.spec.ts`, `docs/{runtime-spike,development}.md`.

1. FIRST: preserve existing Git/frozen hash baseline; create isolated branch. Prove native Payload admin login, one collection CRUD, Postgres adapter via Hyperdrive to SAME Supabase pooler DB, one R2 upload/read, no Sharp, on Workers Free. Use synthetic data and the single free preview DB. Verify custom API routes coexist with Payload REST catch-all, UUIDs/cms schema, migrate with separate credentials, no filesystem persistence, no unsafe session state across pooled requests. Test local Docker as well. Prototype collection is removed after spike evidence is retained.
2. Record exact versions, build command/output, Worker compressed bytes/CPU, DB connection behavior, upload verification and screenshots. Official support does not waive this spike. If free limits or exact combo fail, STOP dependent work, record reproducible blocker; no silent provider switch, paid plan or runtime downgrade.
3. Pin compatible researched releases; use Node 24 supported patch and matching @types/node, not latest major 26. Commit lockfile and verified CI action SHAs. Strict TS/lint, CSS Modules, Arabic root, environment schemas and import boundary. No Tiptap/Supabase Auth/custom CMS dependencies.
4. Scripts: dev/build/build:worker/preview:worker/lint/typecheck/test/test:db/test:e2e/check:frozen/check:copy/check:budgets/check. Local DB tests refuse remote production URLs. Linux CI builds actual OpenNext artifact; no ignored exits. One Worker entry exposes fetch plus scheduled handler, dispatching native Payload jobs and domain jobs later.

Proof: fresh frozen-lockfile install, lint/typecheck/build, actual Worker runtime smoke and recorded no-Sharp upload pass. No secrets in browser; hashes unchanged. All later packages depend on this result. Runtime spike is future execution work, NOT performed by this planning handoff.

## P01: Eight public rooms and new journal composition

Depends P00. Complexity high; risk prototype canvas vs real responsive layout. Owner C03/C04/C05/C07/C32.

Files: public route files from ARCHITECTURE for home/started/built/passed/book/shelf/scenes/contact/journal/journal slug/project slug/policies; `src/app/(public)/{not-found,error}.tsx`, `src/components/site/{Header,Footer,Navigation,MotionPreference}.tsx`, `src/components/public/{RoomPage,HomeSections,BookPage,SceneGallery,ContactForm,Journal}.tsx`, `src/components/public/public.module.css`, `src/components/site/site.module.css`, `src/styles/{tokens,globals}.css`, `src/lib/format.ts`, `src/lib/content.ts`, `src/lib/richtext.tsx`, `content/initial-content.json`, approved exact `public/fonts/` and `public/images/` manifest destinations, `tests/e2e/{public,visual}.spec.ts`, `tests/unit/format.test.ts`.

Transfer frozen compositions/copy/fonts/images into semantic React; book layout stays final. Replace .dc links with routes. Remove prototype customization/reference screens/runtime. Implement mobile menu, actual built tabs, gallery filter/lightbox, static shelf, motion preference and JS-off readable content. Journal default المجلس: lead story + dated readable list, categories, detail; no fake public articles. Initial fixtures are test/local only; production requires approved native Payload records. Purchase/form controls have truthful unavailable states until later wiring, never fake success. Use native accessible controls/Radix only where necessary.

Proof: every route, menu/tab/filter/lightbox real clicks; keyboard and focus restore; 360/768/1024/1440 screenshots, no horizontal overflow/cropped glyphs, reduced-motion/JS-off readable. Font licenses E06; copy/assets E05. Public design boundary and book comparison documented. No new content invention to fill missing photographs.

## P02: Authentic physical PDF reader

Depends P01. Complexity high; risks old flip dependency and missing final manuscript. Owner C06/C33.

Files: `src/components/book/{PdfBookReader,StaticPdfReader}.tsx`, `reader.module.css`, `src/lib/book-preview.ts`, book mounting component/page, `scripts/prepare-preview.py`, `content/book-source-manifest.json`, generated safe fixture PDFs under `tests/fixtures/reader/`, `tests/e2e/reader.spec.ts`, `tests/unit/reader-mapping.test.ts`, `docs/book-preview.md`, manifests/lockfile.

Inventory hashes/pages; supplied actual Khous fragments are 1–2 pages, not proven complete manuscript. Privately render a real fragment; public range/source approval E04 required. Export a separate approved excerpt with patched pypdf; strip actions/attachments, record input/output hashes. Lazy patched PDF.js/local matching worker, isEvalSupported:false; render actual canvases/text into direct page-flip leaves, correct right binding with no mirrored Arabic. Current+adjacent only (max 6 canvases, DPR<=2), cancel stale renders. Previous/next/page jump/count/fullscreen plus expanded fallback; RTL Right=previous, Left=next. Reduced-motion static pagination/selectable text, corrupt/network retry and approved excerpt alternative. No hidden full-paid PDF.

Proof: real source first/middle/last as applicable, odd/1-page synthetic fixtures, Arabic/Latin digits, resize/portrait/keyboard/touch/fullscreen/failure/static fallback and request log proving no manuscript transfer. Outside reader the book visual baseline remains unchanged. Phase 1 gate: all public pages faithful/responsive/console-clean and reader functionality proven; unresolved rights remain explicit launch blockers.

## P03: Native Payload auth, schemas and DB isolation

Depends P02. Complexity high; risk confusing Payload access with per-user RLS. Owner C21.

Files: `src/payload/collections/{Users,Pages,Posts,Projects,Scenes,ShelfEntries,Media,Taxonomies,Policies}.ts`, `src/payload/globals/SiteSettings.ts`, `src/payload/{access,hooks}.ts`, `src/payload.config.ts`, `src/payload/migrations/`, `src/{payload-types,payload-generated.schema}.ts`, `src/lib/{db,owner-mfa,validation}.ts`, `src/components/admin/OwnerMfa.tsx`, `src/app/api/admin/mfa/route.ts`, `scripts/bootstrap-owner.mjs`, `supabase/config.toml`, `tests/integration/{database-roles,payload-access,mfa}.test.ts`, `tests/e2e/auth.spec.ts`.

Configure native auth/login/reset/lockout; one out-of-band owner bootstrap, no public registration. Arabic native admin/translations/RTL. Field/collection access owner/editor/operations and active-user recheck, last-owner guard. Default Local API bypass overridden on ordinary operations. Native version/draft tables generated once, migrations not schema push. Implement service-principal grants/RLS as DATA contract; never Supabase Auth/auth.uid bridge. Add researched TOTP step-up if native version lacks it, encrypted seeds, hash recovery codes, 5-minute one-use action grants, revoke/rate-limit. Owner role changes/refunds consume MFA grant.

Proof: real Payload REST/GraphQL/Local API session tests deny anon/editor/operations misuse/revoked owner; direct SQL roles cannot cross schemas/execute unauthorized functions. Last owner can't be lost. No migrations credential in runtime. MFA enrollment/challenge/recovery/reset and return-URL/CSRF tested. All negative tests must pass before admin acceptance.

## P04: Native editorial workflows and published-site binding

Depends P03. Complexity medium; risk custom duplication or early draft leakage. Owner C08/C13/C14/C15/C16/C19.

Files: existing native content collection/global configs/access/hooks; `src/payload/jobs.ts`, `src/lib/{content,richtext}.tsx` (content.ts), `src/components/admin/AdminHome.tsx`, `src/components/admin/admin.module.css`, `src/app/api/jobs/route.ts`, `worker-entry.ts`, `tests/e2e/cms.spec.ts`, `tests/integration/publication.test.ts`, `tests/unit/richtext.test.ts`.

Configure Payload Pages typed sections, text/media/show/hide/order, projects room/status/logos/metrics, scenes/shelf, native taxonomies/authors. Native Lexical toolbar Arabic; safe public renderer uses explicit supported nodes. Native drafts/autosave/versions/restore/preview/scheduled publish/archive; don't implement second editors, revisions or publication database. Native scheduled jobs run through same Worker scheduled entry, never long-lived process timers. Public loaders honor access/published/time/visibility on all relation/metadata paths, invalidate within 60s. Preserve unsaved content on version conflicts.

Proof: Anas-style owner writes Arabic post, adds category/tag/author/image, drafts/previews/schedules/archives/restores; it never leaks early. Reorder/hide/edit public section without code/redeploy. Two session edits don't silently overwrite. Scheduler delay/public cache tested. CMS menu contains real useful native tasks, no unused generic forms exposed.

## P05: Native media with no-Sharp derivatives

Depends P04. Complexity medium; risk accidental native image processing/invalid derivative. Owner C17/C18.

Files: `src/payload/collections/Media.ts`, `src/payload/storage.ts`, `src/components/admin/MediaUpload.tsx`, `src/lib/{media,r2}.ts`, `src/app/api/media/{upload,complete}/route.ts`, `tests/e2e/media.spec.ts`, `tests/integration/media-security.test.ts`, `docs/media-rights.md`, required native migration/config.

Use native Payload media/folders/relationships. Thin upload extension generates WebP sizes/crop in authenticated browser, never upscale; no Sharp/imageSizes/cloud transforms. Preserve private original for future recrop. Tickets server-owned key/purpose/expiry; server magic-byte/type/dimensions/bytes checks plus ownership and preset bounds before promotion. Reject SVG/HTML/archives/oversize. Header checks not falsely described as full decode/sterilization. Require rights/alt, explicit dimensions, reuse same asset, where-used deletion guard. Handle unsupported encoder/corrupt file with usable error, never raw public fallback. Browser crop/encode quality/RTL controls tested.

Proof: actual crop visible publicly, normal EXIF removed by re-encode, spoof/size/key/expiry/cross-user failures, private original unreadable, native folder move/reuse/delete-in-use correct. No Sharp in Worker bundle or hidden transform costs. Re-encoding derivative is automatic, not a manual outside-design job.

## P06: Native settings/inbox/team, owner home/stats and backups

Required audit additions: allow `src/app/api/email/resend/webhook/route.ts`, `.env.example`, `docs/costs.md`, and `tests/integration/{email-delivery,privacy-requests}.test.ts` alongside the files below. Implement signed delivery-event verification, dedupe, recipient suppression and bounded/exhausted retries using the DATA contract and existing operations view. All mail paths share the policy; prioritize recovery/receipts over availability notices and reconcile uncertain sends before replay after provider idempotency expiry. Prove forged, duplicated and reordered events, quota exhaustion, suppressed recipients and safe replay; provider acceptance alone never passes a delivery assertion.

Select and document the off-site backup destination and key custodian, retention footprint, current allowances/overages, available alerts and measured restore cost/time. A missing free allowance blocks hosted proof/E07; continue safe local synthetic tests. Add the identity-verified privacy-request runbook to `docs/privacy-data-map.md`; test cross-customer isolation, export/correction/deletion, accounting exceptions and reapplication of deletions after restore. No new customer portal. P08/P10 complete checks against the financial schema once it exists; record those prerequisites explicitly rather than falsely accepting an unrun check.

Depends P05. Complexity high; risk invented analytics/PII leakage. Owner C09/C12/C22/C23.

Files: `src/payload/collections/{Contacts,Notifications}.ts`, `src/payload/globals/{SiteSettings,CommerceSettings}.ts`, Users/access/hooks/email/jobs, `src/components/admin/{AdminHome,StatsView,BackupsView}.tsx`, `src/lib/{stats,email,outbox,rate-limit,audit,jobs}.ts`, `src/app/api/{contact,notify,notify/confirm,notify/unsubscribe,health}/route.ts`, `src/app/api/admin/stats/route.ts`, `scripts/{backup,restore-check}.mjs`, `.github/workflows/backup.yml`, native migrations, `tests/e2e/owner-operations.spec.ts`, `tests/integration/{forms,outbox,stats}.test.ts`, `docs/{operations,privacy-data-map}.md`.

Native team/settings/inbox interfaces, not custom CRUD. Editable nav/footer/SEO/contact/store policy/domain/sender verification. WhatsApp normalized wa.me telephone link; no Business API. Native team invite/revoke with owner MFA; no unsolicited real invites in tests. Contacts persist with outbox even when mail down; Turnstile hostname/action/honeypot/throttles. Confirm/unsubscribe availability notices. Domain/email screens describe real DNS steps and verification, never editable secret fields.

Owner home: actual pending tasks and compact real DB order/paid/refund/net-collected/customer counts; payment tables arrive P07/P08, so initial state says not configured. Visits/top pages use server-side existing account Analytics API, verified dataset definition/range/freshness; missing permission/data says unavailable, not invented zero. SQL stats test after financial schema arrives in P08/P10. Owner-only 5-minute cache. Bonus board tasks attach in P12.

Backup native/custom view reports actual encrypted off-site database+binary manifest/restore. Nightly 7 daily/4 weekly/3 monthly retention, disposable restore first, manual owner confirmation for production restore. Proof: save/reload settings, real inbox despite email outage, dedupe/retry, unauthorized stats denied, analytics fixture reconciles response, restore includes assets/roles. Phase 2 gate: the orchestrator, acting as owner, adds/crops image, writes/publishes post, edits/reorders section without code, directly inspects native admin; no blank CRUD screens.

## P07: Native catalog plus transactional cart/checkout

Required audit additions: include `src/lib/rate-limit.ts` in the allowlist. Enforce the DATA contract's pre-reservation attempt/active-hold limits and Turnstile checks. Document concrete limits, expiry behavior and residual abuse risks. Test distinct idempotency keys and concurrent attempts against one scarce variant, retry reuse, expiry reclamation and legitimate shared-network buyers. Never extend an existing hold merely because the caller changes the key.

Depends P06. Complexity high; risk money/stock races. Owner C20/C26/C27 (C20 closure awaits supporting P08).

Files: `src/payload/collections/{Products,Variants,Coupons,Customers,ShippingRates}.ts`, CommerceSettings, native migrations (finance tables/functions and stock guards), `src/lib/{catalog,cart,checkout,db,jobs}.ts`, `src/components/store/{CartProvider,CartDrawer,CheckoutForm,EditionCards}.tsx`, `store.module.css`, public store/product/cart/checkout routes, `src/app/api/checkout/quote/route.ts` and `src/app/api/checkout/route.ts`, book purchase wiring, `tests/e2e/cart-checkout.spec.ts`, `tests/integration/checkout.test.ts`, `tests/unit/money.test.ts`.

Native Payload catalog/customer/coupon UI; no custom product editor. Owner product variants/price/stock/preorder/rights, supported cities/rates, tax/seller/invoice settings and policy revisions. Generic CRUD cannot change reserved/redeemed counters; SQL functions adjust shared native rows. Configure before selling; no historical demo prices. Persist cart IDs/qty only, session fallback if storage denied. Validate 1–20 qty/50 lines, all server totals, stale quotes, coupon eligibility, exact tax/discount allocation, dedication, address only physical, versioned policy consent. Atomic reserve/idempotent pending order under DATA protocol.

Proof: new non-book product reaches persisted pending order without code changes (paid flow P08). Concurrent last unit/coupon, unknown city/unconfigured tax/price, tampered total/stale quote, persistent cart/mixed physical+digital, duplicate idempotency and rollback/expiry. Empty store truthful. Actual paid stats/availability dispatch become testable P08, not falsely passed here.

## P08: Verified gateway and post-sale operations

Required audit additions: extend the existing payments runbook and reconciliation audit trail for owner-verified disputes, chargebacks and payout differences. Keep payment/refund history immutable and record explicit entitlement/fulfillment decisions. Test a synthetic dispute, fee/timing discrepancy and repeated reconciliation without double-counting. Explain that gross minus confirmed refunds excludes fees/chargebacks/payout timing and is not bank-settled cash. Recheck email failure/priority and privacy handling against real order/customer relations. Update the remaining-effort estimate after the first complete sandbox payment proof; no automatic change to the commercial commitment.

Depends P07. Complexity high; risk duplicate money/fulfillment. Owner C28/C29/C30.

Files: `src/lib/payments/moyasar.ts`, `src/lib/{orders,checkout,outbox,email,jobs,r2}.ts`, `src/components/admin/{OrderView,RefundView,ReconciliationView}.tsx`, admin custom view registration, payment/order/download API routes from ARCHITECTURE, public order-token route, native finance migrations, `tests/integration/{payment,download,stats}.test.ts`, `tests/e2e/orders.spec.ts`, `tests/support/moyasar-emulator.ts`, `docs/payments-runbook.md`.

Hosted invoice server-only; durable attempt before network; real secret_token webhook validation plus authoritative invoice/payment fetch checking identity/amount/currency/mode/status. Idempotent transactional stock/coupon/receipt/entitlement; redirect never paid. Creation/refund timeout remains uncertain until reconciled, not blindly retried. Provider minimum enforced. Custom admin views inside native panel show verified evidence, fulfillment/tracking/signed dedication/return/refund; owner MFA for financial refund. Expiring hashed order/download tokens and private ebook delivery. Availability change enqueues once per variant availability revision/confirmed subscriber; recheck unsubscribe on send. Low-stock/unresolved paid alerts.

Proof: negative/duplicate/out-of-order/retry/crash/late-stock-payment cases; refund reserve prevents overrefund; correct partial entitlement revocation. Full book AND new non-book sandbox purchase reaches real confirmed mail/admin; failed/3DS/cancel/refund tested with redacted provider IDs. Availability opt-in/restock/mail/unsubscribe actual journey; no notification to pending/unsubscribed users. Emulator is necessary but not substitute for real sandbox E02. Reconcile stats with ledger. Booking-specific late slot conflicts run P09.

## P09: Native services and availability, custom atomic bookings/ICS

Required audit additions: include `src/lib/rate-limit.ts` in the allowlist and reuse P07's hold protections for paid slots. Bound attempts for free bookings too. Test rotating-key and concurrent slot exhaustion, reclaimed expiry, duplicate retries and shared-network customers; retain the SQL exclusion guarantee independently of abuse controls.

Depends P08. Complexity high; risk overlap/timezone. Owner C24/C25.

Files: `src/payload/collections/{Services,AvailabilityRules,AvailabilityExceptions}.ts`, `src/lib/{booking,calendar,checkout,jobs,email}.ts`, `src/components/booking/BookingForm.tsx`, `booking.module.css`, public services routes, services slots/bookings/calendar API routes, native finance migrations, `tests/e2e/bookings.spec.ts`, `tests/integration/bookings.test.ts`, `tests/unit/calendar.test.ts`, `docs/calendar-setup.md`.

Native Payload service/weekly-hours/exceptions/manual busy CRUD. Riyadh presentation/UTC ranges, durations/buffers, free confirmed vs paid held booking, cancellation/reschedule/policy/customer mail. SQL exclusion and expiry guarantee one active slot; late paid conflict never bumps another booking. ics library produces stable UID/sequence/cancel events, revocable private subscription and per-booking export; no calendar-platform dependency, two-way claim or URL import/SSRF. Operations view uses native safe fields with controlled actions, not a separate admin app.

Proof: concurrent one-slot winner, buffer/back-to-back boundaries, expiry/free/paid/cancel/refund/rebook, late payment conflict, token rotation, CRLF escaping and actual calendar import/subscription. Owner understands client polling delay. Phase 3 gate: all money/sandbox/fulfillment/service journeys pass; missing E02 cannot be waived.

## P10: Whole-platform quality, monitoring and design audit

Required audit additions: repeat affected hosted Worker CPU/bundle/connection/scheduled-job measurements after the editor/media/commerce/monitoring dependencies are present. Run all follow-up checks in VERIFICATION, including email failures, hold abuse, dispute accounting, privacy/restore behavior and measured backup/quota evidence. A previous minimal P00 pass does not waive a later runtime regression.

Depends P09. Complexity high; risk partial audit claimed complete. Owner C10/C11/C31/C34.

Files: `src/app/{sitemap,robots}.ts`, `src/lib/seo.ts`, `src/instrumentation.ts`, `sentry.server.config.ts`, `src/instrumentation-client.ts`, `tests/e2e/{accessibility,security,journeys,visual}.spec.ts`, `tests/integration/retention.test.ts`, `scripts/check-{copy,budgets}.mjs`, `lighthouserc.cjs`, CI config, `docs/{security,qa-report,monitoring}.md`; bug-fix production paths enumerated by the orchestrator before dispatch.

Arabic per-route metadata/canonical/OG/Person/Book/Product/Article truthful from approved data. Private/draft/admin/board/token routes excluded. Cloudflare public cookieless analytics disclosed, no PII. Native/admin/custom complete empty/loading/validation/error/success flows. Sentry free checkout/webhook/scheduler errors with beforeSend redaction and no replay; one external free monitor (researched choice) checks coarse health, alert test to owner only on activation authorization. No paid operational dependency. Design audit every item; book outside reader faithful. Full unit/integration/real DB/e2e/axe/Worker performance/dependency/license/restore gates; real-device limitations labelled.

Proof: all VERIFY checks, no unexplained console/network errors, stats match provider+ledger, monitor/Sentry synthetic failure received without PII, no tool copy/fake price. Lighthouse >=90, LCP<2.5s/CLS<0.1, public initial budget measured, actual INP evidence distinguished from Lighthouse. Any failed security/runtime gate stops P11.

## P11: Client-owned launch, training and support

Required audit additions: E07 closes only with the actual destination/retention/key-custody and all-in operating cost sheet; alerts must not be represented as hard spending caps. E08 includes the tested privacy-request procedure. Owner training includes exhausted-email recovery, dispute/payout reconciliation and privacy/restore exceptions. Missing evidence stays an explicit launch gate.

Depends P10 and live E gates. Complexity medium. Owner C35/C36/C37/C38/C39/C40.

Files: `.github/workflows/deploy.yml`, `docs/{deployment,owner-guide.ar,account-inventory,launch-checklist,training-record,support-log,rollback,license-register}.md`, exact approved production config paths.

Confirm accounts/domain/DNS/TLS/mail verification, provider methods/webhooks, backups/jobs, real approved content/fonts/manuscript/tax/policy, monitor alerts, cost approval. No real orders on free pausable DB; approve approximately $30/month always-on baseline before enabling checkout. One deployment; tested migrations/rollback, no destructive rollback drops. Train owner by unaided native admin tasks: post/image/page/product/price/coupon/inbox/order/booking/team/backups/stats. Record actual date/steps, not a pretend training document. Export accepted work and client-owned account inventory at every phase.

Proof: live route/private boundary/domain/sender/job/backup/monitor smoke, actual training and owner acceptance. 30-day support contact/start/end/issue ledger remains an obligation until elapsed and delivered; launch acceptance and commercial closure differ. Missing external facts produce explicit blocked launch status, not omitted features. No live purchases are authorized by this plan.

## P12: لوحة أنس (BONUS SCOPE)

Depends P11 application baseline; may build after P10 if P11 is blocked only on external launch inputs, without changing offer acceptance/timeline. Complexity medium; risk privacy/RTL drag loss. No C-IDs.

Files: `src/payload/collections/{Boards,BoardColumns,BoardCards}.ts`, `src/components/admin/{WorkspaceView,AdminHome}.tsx`, `src/components/admin/workspace.module.css`, `src/payload/access.ts`, `src/payload.config.ts`, native migrations/generated types, `src/app/api/admin/workspace/move/route.ts`, `tests/e2e/workspace.spec.ts`, `tests/integration/workspace.test.ts`, `docs/workspace-guide.ar.md`, manifests/lockfile.

Native owner-only collections; one custom @dnd-kit kanban view registered inside admin. Boards/free-form named columns/cards, arbitrary life/work projects retained indefinitely. Card title/notes/order and optional due date/content relationship. No hardcoded idea-production-publish lifecycle. Optional per-card link to native post/project/shelf record; linking cannot create/publicize content and cannot change its status. Publishing only through a distinct explicit native content action. No teams, permission matrix, swimlanes, automations or external project tools.

Drag-drop pointer/touch/keyboard with RTL transforms, focus/announcements; move-menu fallback. Server verifies owner/board/column/card versions, moves/reorders transactionally; collision reload preserves edits; persisted after reload. Admin home adds actual due/pending board actions, with no fake workload metric. No public API grants, no sitemap, robots denied, no public caching.

Proof: anonymous/editor/operations direct native API/read and move calls denied; private strings absent from sitemap/public search/SEO. Link card to draft/published content, move/edit/archive board, verify target publication state NEVER changes. Free-form columns survive reorder/reload; RTL pointer/touch/keyboard/fallback operate; concurrent stale move returns conflict. Private notes are excluded from Sentry/analytics. Accept bonus separately, then stop.
