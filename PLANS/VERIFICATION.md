# Orchestrator verification gates

After EVERY package the orchestrator inspects the integrated diff, independently runs checks and operates affected UI. Builder claims/screenshots are inputs, not approval. Record commit/environment/command/exit code/role/viewport/evidence. Unrun tests are not passed. External gate is blocked, not waived.

## Shared acceptance routine

1. git status/diff path check against exclusive lock, frozen hashes, dependency/license changes. No source/archive changes.
2. pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; package tests; pnpm build; pnpm check:frozen; pnpm check:copy. From P03 add real DB authorization/transaction tests. No masked nonzero exits.
3. The orchestrator launches integrated app, clicks EVERY new control with real pointer, reloads to prove persistence/public change, tests keyboard/reduced-motion and phone+desktop, inspects console/network errors. No toast-only evidence.
4. Test invalid/empty/loading/error/success, fix defects, rerun affected tests. Commit only accepted package; record result then release lock.

Execution evidence: artifacts/acceptance/Pxx/commands.txt (proof map), audit records, redacted logs/screenshots/traces. No real customer data/private manuscript/secrets in shared artifacts. Source comparisons stay client-private with hash/location references.

## Required command contract

P00 creates the scripts described in its PRD. pnpm test uses Vitest; pnpm test:e2e uses Playwright; pnpm test:db runs real PostgreSQL role/policy/function tests and real-JWT Data API tests against the disposable local stack. Start it with `pnpm exec supabase start`, verify the URL is local, then `pnpm exec supabase db reset` applies `supabase/migrations/`, the only migration history. Tests refuse non-local URLs and require TEST_ENV=local. Linux CI builds the static export (`pnpm build`) and runs `pnpm check:export` and `pnpm check:budgets` on it (D32). `check:export` requires 51 files in `out/` (every public page and every admin page); `check:budgets` fails on an empty export or a page with no `/_next/static` script; `check:copy` scans `src`, `supabase/functions`, `content` and `scripts` (`.ts`, `.tsx`, `.json`, `.mjs`); a full `prepare-media` run exits 1 when any source file is missing. Freeze exact executable options once the P00 D29 swap verifies current tools.

P00 measured the Worker runtime; D32 replaces it with a static export and Supabase Edge Functions, proven locally on the full stack. P01 public/visual, P02 reader, P03 auth/roles/rls/staff, P04 cms/publication, P05 media/media-security, P06 owner-operations/forms/outbox/stats, P07 cart-checkout/checkout/money, P08 orders/payment/download/stats, P09 bookings/calendar, P10 full security/accessibility/journeys/performance, P11 live operational/training, P12 workspace/privacy/RTL. Exact filenames are in WORK-PACKAGES.md.

## Non-negotiable invariant tests

- Real JWTs for anon/editor/operations/owner/revoked through the Data API and every Edge Function; forbid self-promotion, private data access and owner-aal2 bypass. Last owner protected. Direct SQL tests separately prove deny-by-default public access, `finance` isolation, server-only functions executable by `service_role` alone, and no runtime DDL.
- Drafts, future and archived content absent from public HTML/API/relations/search/metadata/sitemap. Scheduled publishing and invalidation survive delayed jobs; no home section hidden behind JS. Versions/restore/conflicting edits preserve data.
- Images: wrong MIME/magic/size/dimensions/key/crop/ticket/owner reject; no user SVG/HTML. Genuine crop and automatic derivatives display; original/private PDF not public; folder/reference deletion safe. No Sharp dependency or unapproved cloud transform. Header validation limits stated honestly.
- Checkout: ignore client totals; integer arithmetic/discount remainder; configured seller/policies (no tax, D34); cart reload; unsupported city; disabled/stale/unpriced SKU; true simultaneous last-stock/coupon requests; one idempotent order, changed-payload replay rejected. Generic Data API writes cannot change stock, holds or totals.
- Payment: forged redirect/secret/wrong invoice/amount/currency/live/account/status cannot mark paid. initiated/authorized/verified is not paid. Duplicate/reordered events and crash before/after durable receipt settle once. Timeout after provider success remains uncertain; no duplicate invoice/refund. Expired hold late success reacquires resources or paid_needs_resolution.
- Refund: pending+uncertain intents reserve balance; concurrent refund cannot exceed captured funds. Partial entitlements correct, shipped stock not automatically restored. Price changes do not rewrite receipts. Tokens hash-stored/expiring/revocable, private downloads and generic recovery prevent enumeration.
- Availability notification: opt-in confirmation, sellable transition, once-per-revision dispatch, retry dedupe and unsubscribe-at-send. Contact/email persist through provider outage. Job leases prevent duplicate work.
- Booking: real exclusion constraint with buffers/end-exclusive ranges, concurrency/expiry/timezone/free/paid/cancel/reschedule/late conflict; private ICS token rotation, stable UID/cancel sequence, escaped CRLF, actual calendar import. No two-way claim.
- Stats: exact DB paid/refund/net totals exclude test/unpaid; compare Analytics response/time range/definition/freshness. Missing dataset shows unavailable. Owner-only and no PII transfer.
- P12: owner-only RLS and custom move endpoint, no public search/sitemap/cache leakage. Board/title/notes/move/link operations NEVER change linked content publication. Free-form columns, persistence and version conflict. Pointer/touch/keyboard RTL and move-menu fallback.

## Visual and accessibility proof

360×800, 768×1024, 1024×768, 1440×900; also 320px fallback and 200% zoom. Logical order, visible focus, 44px targets, Arabic joining/diacritics/Latin dynamic digits, bidi email/order codes. Photo/PDF digits remain original. Stable-font screenshots plus separate real motion checks, no masking broken sections. JS-off and reduced motion readable. Book comparison masks only intended reader region and dynamic data; surrounding frozen composition remains faithful with documented responsive/a11y repairs. Follow every DESIGN-AUDIT row and record evidence; zoom clipped edges/centering/parallel buttons.

Axe: zero critical/serious findings; manual keyboard/screen-reader spots for the admin, rich editor, media crop, dialog/cart, reader/fullscreen, checkout and bonus board. Test long Arabic/error copy, real failed states and every visible action. Disabled controls are not implemented behavior without a truthful dependency reason.

## Runtime/performance/operations

Runtime proof: P00 recorded pooler mode, prepared-statement settings, connection limits, rollback/read-after-write and hosted public-route CPU. P10 repeats hosted cold/warm function requests, scheduled pg_cron execution and the public JS budget, with sample counts and the applicable provider limits. Local preview cannot close a hosted gate.

P06/P08 email proof: reject forged signatures; durably dedupe duplicated/reordered delivery events; hard bounce/complaint suppresses every sender; a late delivered event cannot clear suppression. Exhausted retries surface in admin, quota exhaustion defers availability notices before recovery/receipts, and manual replay cannot bypass suppression/consent or blindly resend an uncertain message after provider idempotency expiry. Provider acceptance and confirmed delivery have distinct evidence.

P10 security headers: `public/_headers` (or a build step writing `out/_headers`) sends the full CSP listed in DATA-AND-SECURITY (last section), without `unsafe-eval`; `tests/e2e/security.spec.ts` asserts it on the static export, and the same headers are checked against the hosted Pages preview, including the Turnstile widget, the PDF.js worker and the Supabase calls under it.

P07/P09 abuse proof: record concrete attempt/active-hold thresholds and test rotating idempotency keys, concurrent scarce-stock/slot attempts, unchanged expiry on retries, reclamation and legitimate shared-network customers. Distributed abuse limits remain documented; throttling is not a replacement for transactional inventory/booking invariants.

P08 dispute proof: owner-verified synthetic chargeback/payout discrepancy has an immutable audit trail, explicit fulfillment decision and no fabricated refund; repeated reconciliation does not double-count. Gross-minus-refunds is not mislabeled bank-settled cash.

P06/P08/P10 privacy proof: identity verification, cross-customer isolation, scoped export/correction/deletion, retained legal accounting exceptions, and deletion reapplication after backup restoration. Customer exports exclude private boards/staff notes. P11 checks the approved retention and actual owner procedure.

P06/P11 cost/recovery proof: the owner-run local backup (D35), retained database/object footprint, applicable free quotas/overages/alerts, measured restore time and cost. Demonstrate restoration with retained assets and deletion records. Alerts are not caps; insufficient free capacity is a recorded gate. P11 cannot accept a hosted project with no first owner backup or treat the hosting/database estimate as an all-in bill.

Public goals retained: Lighthouse >=90, LCP<2.5s, CLS<0.1, INP target<200ms measured with interactions/field data (not claimed from Lighthouse alone). Initial HTML+CSS+fonts+hero <1MiB, public initial hydrated JS <150KiB gzip. Lazy PDF/editor/board chunks measured separately. No silent relaxation of legacy target: measured Next baseline issue is escalated with evidence. P10 measures Edge Function cold starts/durations, pg_cron jobs, Pages build time/monthly count and the public page budget (D32; Worker limits moot), always-on/capacity approved before real orders.

Pagination/load test representative 100 scenes/500 posts/1000 synthetic orders; examine plans for critical queries, no unbounded browser downloads. pnpm check:budgets and pnpm exec lhci autorun in P10. pnpm audit plus license inventory; exact-version research OSV is not a transitive installed audit. No silently suppressed critical/high runtime vulnerability.

Restore includes content and version tables, auth users and staff, finance, roles/grants, original/private binaries and references. Encrypted copies on the owner's machine, the passphrase with the owner (D35); the recovery point is the owner's backup cadence, and RTO<=4h is proven on a disposable stack; a missing target is escalated. No production destructive reset/restore as test.

Sentry redacted synthetic checkout/webhook/scheduler error and UptimeRobot Free HTTPS failure/recovery alert actually observed; no tokens/customer bodies/session replay. P11 confirms TLS/DNS/sender/keys/provider methods/jobs/backups/monitor/client ownership/legal/rights/cost gates. Actual iOS/Android/Apple Pay and training are recorded honestly; emulator/docs alone do not prove client actions. Month support closure is later than launch. P12 receives separate bonus acceptance without changing offered scope or date.
