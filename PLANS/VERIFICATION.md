# Acceptance protocol for GLM

Builder reports are inputs, never acceptance. After **every** PRD, GLM checks the actual diff, runs its commands in the integrated checkout and personally operates the affected UI. GLM records exact command/exit code, commit, environment, evidence path, role and viewport. A test that was not run is not passed. Skips require an explicit open issue and cannot satisfy contractual phase gates.

## Every-package gate

1. Read `git status --short` and `git diff --stat`; verify paths against the active lock. Check frozen manifest before and after. No `_archive/` access or source modification. Check lockfile diff and licenses when dependencies change.
2. Run `pnpm lint`, `pnpm typecheck`, package tests and `pnpm build`. From P03 onward run the relevant real-database policies/integration tests. Run `pnpm check:frozen` and `pnpm check:copy`. A clean typecheck is not an authorization test.
3. Start actual app with local/test data. GLM operates all new controls with a real pointer, checks keyboard/reduced-motion and directly inspects phone plus desktop. Browser automation counts as pointer operation; a mocked unit test alone does not.
4. Inspect validation/empty/loading/success/failure states. Confirm a real persisted change and its public effect by reload; never accept a toast alone as save proof. Inspect browser console and failed network responses without logging secrets.
5. Record issues; fix before acceptance. Re-run affected failing cases after a fix; do not rerun unrelated suites endlessly. Mark package accepted only when its full checks pass; commit it; release lock; dispatch next builder.

Evidence directory at execution: `artifacts/acceptance/Pxx/<commit>/` with `commands.txt`, `review.md`, redacted logs, screenshots and relevant trace/report links. Keep real customer data, private PDF content and credentials out of shared Git artifacts. Public/synthetic screenshot fixtures may be committed; private source comparisons stay in client-controlled local storage with hashes/locations in the report.

## Commands and expected proof

P00 creates scripts; later packages add named tests rather than relying on nonexistent commands. Required installation baseline: `pnpm install --frozen-lockfile`. Database baseline: `pnpm exec supabase start`, `pnpm exec supabase db reset`, `pnpm exec supabase test db`; reset only a verified local disposable database, never remote production. `pnpm test:db` wraps SQL plus REST authorization tests against that local URL. Test setup must refuse production URLs and require explicit `TEST_ENV=local`.

| Gate | Commands/tests | Evidence required |
|---|---|---|
| Foundation | `pnpm check`; `pnpm build:worker`; `pnpm preview:worker` on Linux | True Next/OpenNext artifact, cookie/action/API/static smoke; actual Worker compressed bytes and CPU |
| Public routes | `pnpm exec playwright test tests/e2e/public.spec.ts tests/e2e/visual.spec.ts` | All public destinations + new journal, usable navigation/filters/tabs, no broken paths/console errors |
| Reader | `pnpm exec playwright test tests/e2e/reader.spec.ts`; reader mapping unit test | Actual PDF first/middle/last comparisons, correct RTL sequence, odd count/resize/touch/keyboard/static fallback, no full-manuscript transfer |
| Staff security | `pnpm test:db`; `pnpm exec playwright test tests/e2e/auth.spec.ts` | Denied direct anonymous/editor/operations/revoked/MFA-bypass requests and allowed authorized owner tasks |
| CMS | `pnpm exec playwright test tests/e2e/cms.spec.ts`; publication integration | Draft not public anywhere; due publication works with cron delayed; archived content disappears; conflict preserved |
| Media | `pnpm exec playwright test tests/e2e/media.spec.ts`; media-security integration | Real cropped derivative, private original, size/MIME/rights/alt/reuse rejection tests |
| Operations | owner-operations E2E, forms/outbox integration, restore-check script | Stored contact despite provider outage; retries/deduplication, owner settings, actual disposable restore |
| Commerce | cart-checkout E2E, checkout/money tests, commerce SQL | Concurrent last-stock/coupon limit, price tamper/stale quote, city/shipping/policy/tax validation, persistent cart |
| Payments | payment/download integration, orders E2E, real sandbox run | Wrong secret/status/amount/currency/live/account/order rejected; duplicate/reordered/late/crash/retry cases, confirmed refund/delivery |
| Appointments | bookings E2E/integration/SQL, calendar unit/import | One winner under overlapping requests, paid hold flow, cancel/rebook/expiry, timezone and private ICS token |
| Final | all tests; `pnpm build:worker`; `pnpm check:budgets`; `pnpm exec lhci autorun`; dependency audit | Full acceptance matrix, no suppressed critical/high runtime advisory, owner risk record for unresolved findings |

## Mandatory adversarial scenarios

Keep tests around observable invariants rather than mirroring implementation. Table-driven cases may share fixtures; each trust boundary must have a failing negative case. Tests create synthetic amounts at setup and never seed actual product prices.

- Anonymous direct REST cannot select drafts, inbox, orders, emails, staff, private media keys or audits; cannot call privileged SQL functions. Editor cannot self-promote, access orders or issue refunds; operations cannot change prices/roles; revoked staff loses access immediately.
- Guest order tokens are unguessable and hash-stored; order number/email alone cannot disclose status. Response timing/text avoids account enumeration. Expired/revoked/refunded tokens deny downloads, including reissue attempts.
- Server quote ignores submitted totals; stock and coupon final-unit requests run truly concurrently against PostgreSQL and produce one eligible reservation. Idempotency replays identical payloads, rejects changed payloads and never duplicates email/entitlement.
- Payment initiated/authorized/verified is not paid. Wrong order invoice, partial/overpayment, wrong currency/mode, forged redirect and webhook fail; valid delayed duplicate eventually settles once. Test provider timeout after successful remote operation, process crash before/after event persistence, outbox retry and finite webhook retry exhaustion.
- Refund balance counts pending/uncertain refunds. Two refund requests cannot exceed original paid total. Partial refund revokes only correct assets, does not restock shipped goods automatically. Price changes after purchase do not change receipts/refunds.
- Malicious rich-text tags/attributes/URL schemes, CRLF email/calendar injection, upload spoof/oversize/decompression-bomb dimensions, path traversal/object-key substitution, hostile crop coordinates and PDF JavaScript/attachment actions are rejected or disabled.
- Appointments reserve ranges including buffers; two clients cannot win same slot, timeout releases it, late paid reservation cannot silently bump another customer. End-exclusive UTC ranges prevent back-to-back false overlap.
- Jobs use leases and database constraints; two workers processing same due work do not duplicate emails, releases or publications. Errors surface in admin; failed provider calls never delete durable state.

## Visual and Arabic gate

Run at 360×800, 768×1024, 1024×768 and 1440×900. Also inspect 320px narrow fallback and 200% zoom for accessibility. Automated axes: no horizontal overflow, tap targets, focus visibility, logical DOM order, Arabic shaping, Latin digits in dynamic UI, bidi-safe email/order numbers, no English vendor errors in user UI. Source PDF images/historic signage are not rewritten to normalize their numerals.

Use screenshots at stable fonts/image completion with animations settled, then separately test real motion and JS-disabled rendering. Mask only nondeterministic test timestamps/order IDs, never an entire broken section. Book comparison isolates reader rectangle; surrounding layout must match frozen baseline except explicit responsive/a11y/data substitutions. Verify section boundaries, long titles, descenders, button alignment and exact clipped corners at magnification. New journal/admin/store/services use the same identity and the new-work rules in `DESIGN-AUDIT.md`.

Run axe on public routes and representative admin/editor/checkout/modal states. Zero critical/serious issues; manual keyboard and screen-reader spot checks remain necessary. Test mobile menu, gallery, cart, rich editor, cropper, reader fullscreen, quantity controls, policy links, filters, forms and all admin actions. Disabled controls have a truthful reason and are not counted as implemented interaction.

## Performance and operations gate

Preserve PRD public goals: Lighthouse mobile >=90 on each public route, LCP <2.5s, CLS <0.1, target INP <200ms; initial HTML/CSS/hot fonts/hero images <1 MiB and initial hydrated public JS <150 KiB gzip. INP needs field or real interaction measurement; Lighthouse score alone is not proof. Lazy reader/PDF worker/editor/lightbox code must not enter home initial payload. Measure each chunk separately; report reader activation bytes and peak canvas memory. Cache public images, preconnect only needed services, reserve dimensions and preload only hot fonts. If Next baseline prevents a stated legacy budget, record measured evidence and escalate the exact budget rather than silently raising it.

Use representative long Arabic content and at least 100 scenes/500 posts/1,000 synthetic orders to check pagination/query behavior. No performance theater with only three rows. Explain cache TTL/invalidation and index choices from query plans for critical lookups.

Backup restore is part of security acceptance: database dump, roles/grants, private objects, published derivatives/reference manifest and secrets-recreation checklist. Target RPO <=24 hours for nightly snapshots and RTO <=4 hours for a small production dataset, proven in staging; if actual restore exceeds target, fix/run again or escalate. Backups are encrypted with keys kept outside the backup destination. Off-site means independent from the active bucket; object versioning and DB metadata alone are not a complete backup.

P11 requires domain TLS, client-owned accounts, verified mail sender, jobs/backup monitoring, provider test proof, policy/content/license/cost approvals, training and rollback. Real device results and client actions are recorded honestly. A blocked external prerequisite remains open in the final report; a screenshot of a setup guide does not close it.
