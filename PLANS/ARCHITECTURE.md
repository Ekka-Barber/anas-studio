# Architecture: Payload retained

This is the final architecture, replacing earlier custom CMS/Supabase Auth drafts. One Next.js app at repo root, one Supabase PostgreSQL DB and one Cloudflare Worker deployment. Payload 3 is embedded, not a separate service. Nothing in this plan authorizes implementation or installation during the planning session.

## First proof, before building

The P00 probe also includes one native versioned Lexical record, a bounded native scheduled job, private-object denial, and a concrete `src/app/api/health/route.ts` beside Payload's catch-all. Measure cold and warm requests and scheduled execution separately against their current hosted limits. Record Supabase pooler mode, driver/prepared-statement configuration, connection limits, transaction rollback and read-after-write with Hyperdrive caching disabled. Local Worker preview is not proof of hosted-Free behavior. Repeat affected runtime measurements after dependency-heavy packages; a passing spike does not pre-accept the final application.

P00 must run the exact Payload+Next+Postgres adapter+Hyperdrive-to-Supabase-pooler+R2 combination on Workers Free: native admin login, create/read/update one collection row, upload/read one private R2 object, no Sharp imports/native resize and no filesystem persistence. Compare normal Next development and Worker preview. Record compatibility/CPU/compressed size/connection reuse. The official support evidence is necessary but not a substitute for this project-specific spike. No later package starts until it passes.

Use supported Node compatibility and generate binding types. Postgres adapter: UUID IDs, explicit schemaName `cms`, push:false, checked-in migrations. schemaName is documented experimental: the spike must verify schema qualification and migrations. DDL uses separate migration credentials, never runtime pooler credentials. No unsafe pooled SET session variables; no presumed request-user propagation through Payload/Drizzle.

## File map and responsibilities

| Exact path | Responsibility |
|---|---|
| `src/payload.config.ts` | Embedded Payload, Arabic locale/translations, Lexical, adapter, native versions/drafts/jobs, R2 storage and access hooks |
| `src/payload/collections/Users.ts` | Native Payload auth; active owner/editor/operations, field access, last-owner guard |
| `src/payload/collections/Pages.ts`, `Posts.ts`, `Projects.ts`, `Scenes.ts`, `ShelfEntries.ts`, `Media.ts`, `Taxonomies.ts`, `Policies.ts` | Complete content CMS; native admin fields, relationships, drafts/version history/preview/scheduling and media folders |
| `src/payload/collections/Products.ts`, `Variants.ts`, `Coupons.ts`, `Customers.ts`, `ShippingRates.ts`, `Services.ts` | Native commercial CRUD; sensitive field validation; financial mutations routed to transaction functions |
| `src/payload/collections/Contacts.ts`, `Notifications.ts`, `AvailabilityRules.ts`, `AvailabilityExceptions.ts` | Native inbox/subscriber/settings/availability CRUD, private access |
| `src/payload/globals/SiteSettings.ts`, `CommerceSettings.ts` | Public identity/navigation/footer/SEO/channels; owner-only nonsecret commerce/tax/policy setup |
| `src/payload/access.ts`, `hooks.ts`, `jobs.ts`, `email.ts`, `storage.ts` | Centralized roles/visibility, invalidate/audit hooks, native scheduled tasks, Resend adapter, R2 mapping |
| `src/payload/migrations/` | One migration history includes generated Payload schema and hand-reviewed finance/security SQL; never a second conflicting migration system |
| `src/payload-types.ts`, `src/payload-generated.schema.ts` | Generated native types/schema, single-writer ownership |
| `src/app/(payload)/admin/[[...segments]]/page.tsx`, `src/app/(payload)/layout.tsx`, `src/app/(payload)/api/[...slug]/route.ts`, `src/app/(payload)/admin/importMap.js` | Official Payload Next routes/import map; route layouts do not collide with public app |
| `src/components/admin/AdminHome.tsx`, `StatsView.tsx`, `admin.module.css` | Owner pending tasks and real statistics, Arabic/RTL thin layer; reuse native admin navigation |
| `src/components/admin/OrderView.tsx`, `RefundView.tsx`, `ReconciliationView.tsx`, `BackupsView.tsx`, `OwnerMfa.tsx` | Custom views registered inside Payload admin for evidence-sensitive operations only |
| `src/lib/payload.ts`, `content.ts`, `richtext.tsx`, `format.ts`, `validation.ts`, `env.ts` | Payload initialization/context-safe Local API reads, published loaders, safe Lexical rendering, formatting/input/env schemas |
| `src/lib/db.ts`, `checkout.ts`, `orders.ts`, `payments/moyasar.ts`, `booking.ts`, `calendar.ts`, `outbox.ts`, `jobs.ts`, `stats.ts`, `owner-mfa.ts` | Restricted financial SQL client, money/state protocols, bookings/ICS, durable jobs, factual stats and step-up MFA |
| `src/lib/media.ts`, `r2.ts`, `src/components/admin/MediaUpload.tsx` | Native Payload upload extension for automatic browser derivatives, byte validation and private storage; no replacement media library |
| `worker-entry.ts`, `wrangler.jsonc`, `open-next.config.ts` | One deployment wraps generated OpenNext fetch and scheduled handler; scheduled jobs invoke native Payload tasks and domain reconciliation |

Every shorthand sibling filename in this table and WORK-PACKAGES is relative to the fully named directory at the beginning of its cell. Builders enumerate the expanded exact paths in the lock before starting. Asset destinations are exact basename-preserving copies from evidence/source-manifest.json, restricted to approved runtime faces/images, never whole source folders.

## Public routes and identity

Integration choices are pinned in `research-final.md` and `evidence/final-package-snapshot.json`. Storage uses `@payloadcms/storage-r2` with the native Worker binding; do not substitute the S3 adapter. The upload extension uses `react-easy-crop`, `file-type` and `image-size`; owner step-up uses `otpauth` only if the selected Payload release lacks native MFA. Preserve actual licenses and notices.

Disable Hyperdrive query caching for both CMS and finance bindings. Authorization, publication, inventory and payment reads must reach the database; application caching is limited to the explicit public-content and statistics policies. P00 verifies read-after-write, transaction/pooler compatibility and that revoked access cannot survive a cached database response. Migration DDL uses its separate connection and credentials.

Under `src/app/(public)/`: `page.tsx`, `started/page.tsx`, `built/page.tsx`, `passed/page.tsx`, `book/page.tsx`, `shelf/page.tsx`, `scenes/page.tsx`, `contact/page.tsx`, `journal/page.tsx`, `journal/[slug]/page.tsx`, `projects/[slug]/page.tsx`, `store/page.tsx`, `store/[slug]/page.tsx`, `cart/page.tsx`, `checkout/page.tsx`, `orders/[token]/page.tsx`, `services/page.tsx`, `services/[slug]/page.tsx`, `policies/[slug]/page.tsx`. Use separate root layouts at `src/app/(public)/layout.tsx` and `src/app/(payload)/layout.tsx`; do not add `src/app/layout.tsx` around Payload's HTML-emitting RootLayout. Public `not-found.tsx` and `error.tsx` live in `(public)`. Metadata endpoints are `src/app/sitemap.ts` and `src/app/robots.ts`.

Use `src/components/site/{Header,Footer,Navigation,MotionPreference}.tsx`, `src/styles/{tokens,globals}.css`, and page CSS Modules. Existing eight room compositions/copy/assets are frozen visual references; new journal uses same literary voice and a readable dated list. Do not ship design runtime support.js, customization controls, fixed demo prices or dead form handlers. Arabic lang/dir, licensed typography, Latin digits and logical CSS throughout. Book changes stay within reader plus necessary real data/control wiring.

Public loaders call Payload with explicit `overrideAccess:false`, `draft:false`, depth limited to required relations and conditions `_status=published`, `visible=true`, `publishedAt<=now`, archived=false. Relationship access is also checked; no draft leaks through search/metadata/assets. Request-local session, no global mutable user. Cache public content max 60 seconds with publish invalidation; all admin/preview/order/download/board routes no-store/noindex. Native Payload previews require staff session. No hand-built parallel draft/revision/publishing store.

## Database and authentication domains

Payload native authentication is the only staff identity. Native auth covers password/login/logout/reset/verification/lockout; disable public registration and bootstrap one owner out of band. Native API access functions re-read active role; direct REST/GraphQL and Local API must enforce the same permissions. Do not assume Local API default access checking: explicitly pass req/user and overrideAccess:false. Custom endpoints verify Payload session server-side and CSRF/origin before every mutation.

DB is private: Supabase anon/authenticated have no grants to `cms` or `finance`; do not expose these schemas in Data API. `payload_runtime` is a non-superuser/non-owner/NOBYPASSRLS login restricted to CMS tables and required sequences. RLS gives this service principal only explicitly permitted CMS access; it has no direct finance table DML. `finance_runtime` is a second server-only login via a separate Hyperdrive binding to the SAME database, EXECUTE-only on named functions. `migration_owner` is CI-only. Finance functions have fixed search_path, validate all amounts/state/active actor roles, and append audit. The privileged function owner is NOLOGIN and is never the app connection.

Per-human authorization occurs at Payload/API boundary; DB independently enforces service-principal isolation, deny-by-default public access, roles on privileged procedures and transaction invariants. This is honest layered authorization, NOT an invented per-user Supabase JWT/RLS bridge. Test roles directly with PostgreSQL and also test real Payload sessions. Never use Supabase service_role in browser or generic staff CRUD.

Owner MFA: if installed Payload has no native MFA, add the researched TOTP library only, private encrypted seed and hashed single-use recovery codes. Fresh server-verified step-up issues a short-lived, hashed, one-use grant bound to owner/session/action. Refund/role changes consume grant transactionally. Password reset/session revocation invalidates grants. P03 verifies enrollment/challenge/recovery and rate limits; no invented MFA support.

## Financial/content ownership boundary

Payload owns product/variant prices, stock display, coupons and customer records. Do not duplicate those tables in finance. Native field access forbids generic writes to reserved_qty, redemption counters, totals, payment/fulfillment status or entitlement. Stock adjustment and coupon-capacity changes call named SQL functions locking the same Payload rows used by checkout. Immutable order snapshots prevent later CMS edits rewriting history. Finance tables hold orders/items/reservations/payments/refunds/fulfillment/entitlements/bookings/outbox/operational audit only. Generated Payload migration table names are recorded before writing SQL FKs; stable dbName identifiers are configured and tested.

Public form routes feed private Payload Contacts/Notifications using validated server context, never anonymous unrestricted collection create. Keep durable outbox and availability transitions. Native schedules/versions supply editorial workflows; one scheduled Worker entry runs native jobs and bounded domain jobs, no second deployed worker and no cron-in-memory timer.

## Custom API routes

P06 also owns `src/app/api/email/resend/webhook/route.ts`. Verify the provider's documented signature against the raw bounded request body, then durably deduplicate delivery/bounce/complaint events. Do not use the Moyasar shared-secret protocol for Resend. The signing secret is `RESEND_WEBHOOK_SECRET`, server-only. All outbound mail paths, including native Payload authentication mail, use the same suppression and quota policy; delivery state is distinct from provider acceptance.

Under `src/app/api/`: `contact/route.ts`, `notify/route.ts`, `notify/confirm/route.ts`, `notify/unsubscribe/route.ts`, `media/upload/route.ts`, `media/complete/route.ts`, `checkout/quote/route.ts`, `checkout/route.ts`, `payments/moyasar/webhook/route.ts`, `payments/moyasar/return/route.ts`, `orders/access/route.ts`, `orders/[token]/request/route.ts`, `download/[token]/route.ts`, `services/[id]/slots/route.ts`, `bookings/route.ts`, `calendar/[token]/route.ts`, `jobs/route.ts`, `health/route.ts`, `admin/stats/route.ts`, `admin/mfa/route.ts`, `admin/refunds/route.ts`. These are specific verified workflows, not replacements for Payload CRUD. Register their exact routing precedence against Payload's REST catch-all in P00.

JSON contract `{ok:true,data}` or `{ok:false,error:{code,message,fields?},requestId}`; Arabic messages, ASCII codes, no stack/secrets. Limit JSON 64KiB, contact 8KiB, webhook 256KiB. Use 400/401/403/404/409/413/422/429/503 appropriately. Check content type/origin/schema; forms verify Turnstile action+hostname. Direct upload tickets limit purpose/key/size/expiry. Token recovery responses are generic.

## Media and statistics

Use the account's verified `httpRequestsAdaptiveGroups` schema: `sum.visits` for visits and a separate path-grouped request count for successful public HTML pages, filtered to the production hostname and eyeball traffic. Exclude admin, API, assets and health paths. Label the latter as most requested public pages, never unique visitors or unique page views. Follow `research-final.md` for the account-schema probe and filters. If required fields/filters are unavailable, data is delayed, or `avg.sampleInterval` exceeds 1, show unavailable for the exact KPI. Never substitute sampled estimates. Keep UTC query bounds and display the range in Riyadh time.

No runtime Sharp import or Payload imageSizes/focal-point resize path. Extend native media upload with browser crop and automatic 360/720/1200/1800 maximum-width WebP derivatives (never upscale). Preview/reopen outputs before sending; server validates actual signatures, dimensions, sizes, allowed preset set and ticket ownership, serves images from an isolated origin with nosniff. Originals private. Corrupt output is rejected/kept quarantined, not publicly promoted. A client assertion is not validation; no claim of server decode/metadata sterilization. Crop edit regenerates derivatives from the private original through the authenticated browser. No cloud image service baseline.

Owner stats: paid order count, gross paid, confirmed refunds, net collected and distinct purchasing customers from database ledger in selected UTC range, presented in Riyadh time. Pending/cancelled/test-mode payments excluded; gross-minus-refunds excludes fees, chargebacks and payout timing; it is neither bank-settled cash nor accounting profit. Cloudflare visits/top pages fetched server-side from the actual account's supported Analytics dataset with read-only token; document definition, granularity, time range, freshness and sampling. No invented visitor count from request logs. Absent dataset/permission shows Arabic unavailable with setup status. Cache stats 5 minutes and display last updated; no PII sent to Cloudflare.

## Bonus P12

Payload collections `Boards.ts`, `BoardColumns.ts`, `BoardCards.ts`; one custom `WorkspaceView.tsx` under admin. Owner-only; private forever unless Anas separately publishes linked content. Free-form named columns and stable sort positions; card title/body/due date optional content relationship to post/project/shelf. @dnd-kit with pointer/touch/keyboard sensors, RTL mapping and accessible move-menu alternative; transactional version-checked moves, reload persistence. No implicit workflow, auto-publication, teams or project-platform dependency. Owner home links actual board tasks; no public route/sitemap entry.

## Environment and operations

P06 records the selected off-site backup destination, encryption-key custodian, retention and measured database/object storage footprint in `docs/operations.md`; `docs/costs.md` records current allowances, overage behavior and available alerts for Workers/Hyperdrive, R2, email, CI, backups and monitoring. Measure restoration using retained objects and independent keys. An alert is not a spending cap. Missing free capacity blocks the affected hosted proof and E07, never authorizes paid provisioning or skipping recovery tests. Local synthetic restore work may continue.

Email retries are bounded and exhausted work is visible in the existing operations view. Password recovery and transactional receipts take precedence over availability announcements. Manual replay rechecks suppression, consent and the provider's idempotency window; an uncertain expired-window send is not blindly resent. Owner dispute/payout reconciliation and verified privacy requests use documented operations and existing audit facilities, not another dashboard or service.

`.env.example` names only: SITE_URL, PAYLOAD_SECRET, Hyperdrive CMS/finance bindings, CI-only DATABASE_URL, R2 bindings/credentials as required by adapter, RESEND_API_KEY/EMAIL_FROM, TURNSTILE site+secret keys, MOYASAR_SECRET_KEY/WEBHOOK_SECRET/PAYMENTS_MODE, JOBS_SECRET, TOKEN_HASH_PEPPER, MFA_ENCRYPTION_KEY, CLOUDFLARE_ACCOUNT_ID/ANALYTICS_TOKEN, SENTRY_DSN. No secret NEXT_PUBLIC variables. Separate test/live buckets/keys/domains; one free synthetic preview DB; local Docker primary.

Backups nightly through Linux CI, encrypted and independent of active R2, include database/roles plus binaries; owner view reports real restore status. Sentry free for bounded redacted errors, no replay; one UptimeRobot Free HTTPS health monitor at 5-minute intervals, no PII in public health. Live orders blocked until paid always-on DB/capacity and other E gates approved. No dependency on paid Images. P00 resolves runtime feasibility before feature implementation.
