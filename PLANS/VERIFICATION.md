# GLM verification gates

After EVERY package GLM inspects the integrated diff, independently runs checks and operates affected UI. Builder claims/screenshots are inputs, not approval. Record commit/environment/command/exit code/role/viewport/evidence. Unrun tests are not passed. External gate is blocked, not waived.

## Shared acceptance routine

1. git status/diff path check against exclusive lock, frozen hashes, dependency/license changes. No source/archive changes.
2. pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; package tests; pnpm build; pnpm check:frozen; pnpm check:copy. From P03 add real DB authorization/transaction tests. No masked nonzero exits.
3. GLM launches integrated app, clicks EVERY new control with real pointer, reloads to prove persistence/public change, tests keyboard/reduced-motion and phone+desktop, inspects console/network errors. No toast-only evidence.
4. Test invalid/empty/loading/error/success, fix defects, rerun affected tests. Commit only accepted package; record result then release lock.

Execution evidence: artifacts/acceptance/Pxx/<commit>/commands.txt, review.md, redacted logs/screenshots/traces. No real customer data/private manuscript/secrets in shared artifacts. Source comparisons stay client-private with hash/location references.

## Required command contract

P00 creates scripts described in its PRD. pnpm test uses Vitest; pnpm test:e2e uses Playwright; pnpm test:db runs real PostgreSQL role/policy/procedure tests and Payload-session integration against disposable local DB. Start local Supabase via pnpm exec supabase start; verify URL is local before reset; apply Payload migrations with pnpm exec payload migrate against that DB. Payload owns migration history, not a second handwritten Supabase schema migration stream. Tests refuse production URLs and require TEST_ENV=local. Linux CI runs pnpm build:worker and pnpm preview:worker for real OpenNext artifact. Freeze exact executable options after P00 verifies current tools.

P00 runtime.spec.ts proves native admin+collection+Hyperdrive/pooler+R2 without Sharp on Workers Free before any feature work. P01 public/visual, P02 reader, P03 auth/database-roles/payload-access/mfa, P04 cms/publication, P05 media/media-security, P06 owner-operations/forms/outbox/stats, P07 cart-checkout/checkout/money, P08 orders/payment/download/stats, P09 bookings/calendar, P10 full security/accessibility/journeys/performance, P11 live operational/training, P12 workspace/privacy/RTL. Exact filenames are in WORK-PACKAGES.md.

## Non-negotiable invariant tests

- Real Payload sessions anon/editor/operations/owner/revoked through REST, GraphQL and Local API; forbid self-promotion, private data access and owner-MFA bypass. Last owner protected. Explicit Local API overrideAccess:false. Direct SQL service-role tests separately prove deny-by-default public schemas, CMS/finance isolation, restricted functions and no runtime DDL. Do not describe this as per-human RLS.
- Native drafts/future/archived content absent from public HTML/API/relations/search/metadata/sitemap. Scheduled publishing and invalidation survive delayed jobs; no home section hidden behind JS. Versions/restore/conflicting edits preserve data.
- Images: wrong MIME/magic/size/dimensions/key/crop/ticket/owner reject; no user SVG/HTML. Genuine crop and automatic derivatives display; original/private PDF not public; native folder/reference deletion safe. No Sharp dependency or unapproved cloud transform. Header validation limits stated honestly.
- Checkout: ignore client totals; integer arithmetic/discount remainder; configured tax/seller/invoice/policies; cart reload; unsupported city; disabled/stale/unpriced SKU; true simultaneous last-stock/coupon requests; one idempotent order, changed-payload replay rejected. Generic native CRUD cannot write reserved counters.
- Payment: forged redirect/secret/wrong invoice/amount/currency/live/account/status cannot mark paid. initiated/authorized/verified is not paid. Duplicate/reordered events and crash before/after durable receipt settle once. Timeout after provider success remains uncertain; no duplicate invoice/refund. Expired hold late success reacquires resources or paid_needs_resolution.
- Refund: pending+uncertain intents reserve balance; concurrent refund cannot exceed captured funds. Partial entitlements correct, shipped stock not automatically restored. Price changes do not rewrite receipts. Tokens hash-stored/expiring/revocable, private downloads and generic recovery prevent enumeration.
- Availability notification: opt-in confirmation, sellable transition, once-per-revision dispatch, retry dedupe and unsubscribe-at-send. Contact/email persist through provider outage. Job leases prevent duplicate work.
- Booking: real exclusion constraint with buffers/end-exclusive ranges, concurrency/expiry/timezone/free/paid/cancel/reschedule/late conflict; private ICS token rotation, stable UID/cancel sequence, escaped CRLF, actual calendar import. No two-way claim.
- Stats: exact DB paid/refund/net totals exclude test/unpaid; compare Analytics response/time range/definition/freshness. Missing dataset shows unavailable. Owner-only and no PII transfer.
- P12: owner-only native API and custom move endpoint, no public search/sitemap/cache leakage. Board/title/notes/move/link operations NEVER change linked content publication. Free-form columns, persistence and version conflict. Pointer/touch/keyboard RTL and move-menu fallback.

## Visual and accessibility proof

360×800, 768×1024, 1024×768, 1440×900; also 320px fallback and 200% zoom. Logical order, visible focus, 44px targets, Arabic joining/diacritics/Latin dynamic digits, bidi email/order codes. Photo/PDF digits remain original. Stable-font screenshots plus separate real motion checks, no masking broken sections. JS-off and reduced motion readable. Book comparison masks only intended reader region and dynamic data; surrounding frozen composition remains faithful with documented responsive/a11y repairs. Follow every DESIGN-AUDIT row and record evidence; zoom clipped edges/centering/parallel buttons.

Axe: zero critical/serious findings; manual keyboard/screen-reader spots for native Payload, rich editor, media crop, dialog/cart, reader/fullscreen, checkout and bonus board. Test long Arabic/error copy, real failed states and every visible action. Disabled controls are not implemented behavior without a truthful dependency reason.

## Runtime/performance/operations

P00 follow-up proof: dirty baseline and planning hashes recorded; health route/catch-all exercised; native versioned Lexical save and scheduled job run; private object denied without authorization; rollback/read-after-write/pooler isolation verified. Record actual pooler mode, prepared-statement settings and connection limits. Measure hosted cold/warm requests and scheduled execution separately, with sample counts, observed CPU/bundle size and applicable provider limits. Local preview cannot close the hosted gate. Repeat affected measurements after dependency-heavy changes and in P10.

P06/P08 email proof: reject forged signatures; durably dedupe duplicated/reordered delivery events; hard bounce/complaint suppresses every sender; a late delivered event cannot clear suppression. Exhausted retries surface in admin, quota exhaustion defers availability notices before recovery/receipts, and manual replay cannot bypass suppression/consent or blindly resend an uncertain message after provider idempotency expiry. Provider acceptance and confirmed delivery have distinct evidence.

P07/P09 abuse proof: record concrete attempt/active-hold thresholds and test rotating idempotency keys, concurrent scarce-stock/slot attempts, unchanged expiry on retries, reclamation and legitimate shared-network customers. Distributed abuse limits remain documented; throttling is not a replacement for transactional inventory/booking invariants.

P08 dispute proof: owner-verified synthetic chargeback/payout discrepancy has an immutable audit trail, explicit fulfillment decision and no fabricated refund; repeated reconciliation does not double-count. Gross-minus-refunds is not mislabeled bank-settled cash.

P06/P08/P10 privacy proof: identity verification, cross-customer isolation, scoped export/correction/deletion, retained legal accounting exceptions, and deletion reapplication after backup restoration. Customer exports exclude private boards/staff notes. P11 checks the approved retention and actual owner procedure.

P06/P11 cost/recovery proof: named independent backup destination and key custodian, retained database/object footprint, applicable free quotas/overages/alerts, measured restore time and cost. Demonstrate restoration with retained assets and deletion records. Alerts are not caps; insufficient free capacity is a recorded gate. P11 cannot accept an unspecified backup destination or treat the hosting/database estimate as an all-in bill.

Public goals retained: Lighthouse >=90, LCP<2.5s, CLS<0.1, INP target<200ms measured with interactions/field data (not claimed from Lighthouse alone). Initial HTML+CSS+fonts+hero <1MiB, public initial hydrated JS <150KiB gzip. Lazy PDF/editor/board chunks measured separately. No silent relaxation of legacy target: measured Next baseline issue is escalated with evidence. Worker free CPU/compressed limits tested in P00, always-on/capacity approved before real orders.

Pagination/load test representative 100 scenes/500 posts/1000 synthetic orders; examine plans for critical queries, no unbounded browser downloads. pnpm check:budgets and pnpm exec lhci autorun in P10. pnpm audit plus license inventory; exact-version research OSV is not a transitive installed audit. No silently suppressed critical/high runtime vulnerability.

Restore includes native CMS/version/job tables, finance, roles/grants, original/private binaries and references. Encrypted off-site copies, keys separate. Target RPO<=24h/RTO<=4h proven on staging; missing target escalated. No production destructive reset/restore as test.

Sentry redacted synthetic checkout/webhook/scheduler error and UptimeRobot Free HTTPS failure/recovery alert actually observed; no tokens/customer bodies/session replay. P11 confirms TLS/DNS/sender/keys/provider methods/jobs/backups/monitor/client ownership/legal/rights/cost gates. Actual iOS/Android/Apple Pay and training are recorded honestly; emulator/docs alone do not prove client actions. Month support closure is later than launch. P12 receives separate bonus acceptance without changing offered scope or date.
