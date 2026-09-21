# Data and security contract: Payload plus private transactions

Payload is the system of record for its collections; do not create parallel content_entries, content_revisions, published_content, staff_members or Supabase Auth tables. Schema names are cms (Payload) and finance (custom transactional data), both in the same Supabase PostgreSQL database. UUID IDs, UTC timestamps and checked-in migrations; all money integer SAR halalas. Exact generated table/FK names are recorded in P03 before custom SQL. Table names below are logical names configured with stable database names, not guesses about adapter defaults.

## Native Payload schema

| Collection/global | Required fields and invariants |
|---|---|
| Users | Native auth; displayName, role owner/editor/operations, active. No public signup; role/active owner-only; last active owner cannot be removed. Session revocation immediate. |
| Pages | slug unique, title_ar, typed sections (stable id/kind, texts, media, visible, sortOrder), SEO/share image. Fixed section shapes preserve visual identity. |
| Posts | slug/title/excerpt, Lexical body, author relation, categories/tags, cover, publishedAt, visible, archive state. Native drafts/versions/autosave/preview/schedule. |
| Projects | slug/title/plain description/story, room started/built/passed, category, logo/photos, approved metrics, status, sortOrder, rights approval. |
| Scenes / ShelfEntries | category/title/caption/media/sortOrder/visibility; scenes require alt/rights, shelf supports sketch/idea/future-project. |
| Taxonomies | kind category/tag, unique kind+slug, Arabic label. |
| Media | Native uploads/folders; purpose image/pdf/logo, original key/hash/bytes/verified MIME/dimensions, derivative keys/dimensions, alt_ar/caption/rights, crop coordinates, verification state. Original private; reuse native relationships; reject deletion while referenced. |
| Policies | type privacy/store/delivery/refund/cancellation/terms, immutable published revision, effectiveAt/approvedBy/approvedAt/body. |
| Products / Variants | Product slug/title/body/media/status; variant SKU unique, fulfillment digital/physical/signed, nullable configured price_halalas, SAR, enabled, finite physical stock, reserved_qty, low-stock threshold, private digital asset, preorder flag/capacity/delivery description, version. Counters readonly through native CRUD; SQL functions own reservations/stock adjustment. |
| Coupons | normalized code unique; percent basis points OR fixed halalas, date range/minimum/limit/product scope/enabled; redeemed/reserved counts readonly. Validate 0–10000 basis points and cap discount at subtotal. |
| Customers | normalized email unique/name/phone; private. Never overwrite immutable order contacts/addresses when updating profile. |
| ShippingRates | SA city key unique/Arabic name/configured halalas/enabled. Unsupported city never implies free delivery. |
| Services | slug/title/body/duration 15–240 minutes/buffer/nullable price/mode/availability owner/published. |
| AvailabilityRules / AvailabilityExceptions | Riyadh weekday/local range/date validity plus dated busy/available exceptions. Default no availability. |
| Contacts | name/email/message/status new/read/closed/spam/notes/assigned user/consent-policy/submission key/retention time. No public direct read/write. |
| Notifications | normalized email+variant unique, pending/confirmed/unsubscribed, hash token/expiry/consent revision, notified availability revision. |
| SiteSettings global | native versioned navigation/footer/SEO/room order/social channels including WhatsApp wa.me, nonsecret canonical/sender/verification settings. Public projection excludes inbox/provider metadata. |
| CommerceSettings global | owner-only/MFA: checkout_enabled=false, tax_state unconfigured/not_registered/registered, seller_legal_name/address/registration, vat_number nullable, tax_rate_basis_points, prices_include_tax, invoice_requirement unset/receipt/tax_invoice/e_invoice, invoice_integration_verified=false, policy revision IDs, currency SAR, configured_at/approved_by/version. Registered requires VAT data/rate; legal invoice requirement must be fulfilled before selling. Never assume exemption. Snapshot all applicable fields into each order. |
| Boards / BoardColumns / BoardCards (P12 BONUS) | owner-only board title; column board/name/sortKey; card board/column/title/body/optional dueAt/sortKey/version/optional typed relation post/project/shelf. No publication fields or automation; content publishing is a separate operation. Validate relation and column belong to this owner/board. |

Public read criteria: published AND visible AND publishedAt<=database/current server time AND not archived. Use native drafts/versions instead of duplicated editorial tables. Native collection access applies to HTTP, GraphQL and Local API. Any privileged Local API call must state why it bypasses access; ordinary reads/writes pass req and overrideAccess:false. Native relationship depth never bypasses child access.

## Private finance schema

| Tables | Fields/constraints |
|---|---|
| checkout_quotes | request_hash, server cart/price/version/tax/shipping/coupon snapshots, expires_at=5 minutes, optional booking hold. Revalidate at reservation. |
| orders / order_items | random UUID, public order_number, hash-only scoped access token, Payload customer FK, immutable customer/address/policy/tax/item/SKU/price snapshots; subtotal/discount/shipping/tax/total, SAR, environment, idempotency_key unique+request_hash, status/version/hold expiry. Item variant or service exactly one, qty 1–20, bounded dedication <=200 chars. |
| inventory_reservations / coupon_redemptions | unique item/order allocation, quantity/state held/committed/released/expiry. Same Payload variant/coupon rows locked and counters changed atomically, no duplicate financial catalog. |
| payment_attempts / payment_events | order FK, provider invoice unique/payment unique, amount/currency/mode/status/fetched time; event ID unique, redacted hash, received/verified/processed/error/attempts. No card details/webhook secret in logs. |
| refunds | owner/payment/order/amount/reason, idempotency key, provider ref, requested/submitting/uncertain/succeeded/failed. Confirmed+reserved refund balance cannot exceed captured amount. |
| fulfillments / return_requests | per-item preparing/shipped/delivered, carrier/tracking/dedication; requested/approved/rejected/received/refunded return states. Customer request cannot issue refund. |
| entitlements / download_tokens | unique order-item license, private asset version, granted/revoked timestamps; token hash/expiry/uses bound to entitlement. |
| bookings | Payload service/user FK, customer snapshot/order optional, UTC start/end/buffer range, held/confirmed/cancelled/completed, hold expiry/policy. btree_gist exclusion on owner+tstzrange('[)') for held/confirmed; expire holds under transaction before reserve. |
| calendar_tokens | owner/token hash/scope/rotation/revocation. Busy feed never includes customer notes. |
| email_outbox | dedupe key unique/type/object/recipient/minimal data, pending/sending/sent/failed, retry/next_at/lease/provider ID/error. Availability key includes variant+availability revision+subscriber; recheck consent at dispatch. |
| email_delivery_events / email_suppressions | Provider event ID unique, message ID/status/time and minimal redacted evidence; normalized recipient hash/reason/time for suppression. Provider acceptance (`sent` in outbox) is not confirmed delivery. Late delivery events cannot clear bounce/complaint suppression. |
| audit_events | immutable actor/action/entity/time/redacted change summary. Payload native versions cover editorial recovery; audit adds security/financial trail. |
| owner_mfa_grants | hashed single-use grant, active Payload owner/session/action, expires_at<=5 minutes, consumed_at. Enrollment secrets encrypted separately, recovery codes hashed/one-use. |
| backup_runs / job_runs / rate_limits | real operational state/hash/retention; leased work; expiring daily-salted throttle identifiers, no raw IP history. |

## Authorization and DB proof

DB logins are service principals, not staff identities. No public grants to cms/finance; schemas not exposed in Supabase API. Runtime roles are NOBYPASSRLS, non-owner, no DDL. payload_runtime can operate native CMS tables; finance_runtime has only EXECUTE on named transaction functions. NOLOGIN function-owner role has necessary narrow table rights. Revoke PUBLIC function execution and public schema creation. RLS on custom/owned tables denies unrelated roles; migration-only role applies policies to new native tables as part of each migration. Do not break required Payload internal version/job tables: explicitly enumerate required grants and negative tests.

Payload verifies staff roles and sessions before calls. Editor manages public content/media; operations sees orders/inbox/bookings and changes fulfillment; owner configures catalog/prices/coupons/shipping/team/policies and refunds. Owner statistics and boards are owner-only. Database privileged functions recheck active actor/allowed role and consume MFA grants on sensitive actions. Actor comes from verified server session, never a request's actor_id. No per-request SET ROLE/session identity left on pooled connections. No claim that Payload access hooks provide per-human RLS automatically.

Test direct DB connections as anonymous/unrelated runtime/CMS/finance/migration roles AND real Payload sessions as anon/editor/operations/owner/revoked. Generic Payload APIs cannot mutate financial counters or issue refunds. No service_role key or migration credential in Worker/browser. Restrict direct function inputs, fixed search_path='', fully qualified SQL, no caller-selected SQL/table names. All transaction invariants enforced in DB.

## Checkout transaction

1. Browser stores only variant IDs, quantities and cart schema version in localStorage. Never trust its totals; discard malformed/unknown variants. A cart can survive reload, but quote/prices are fetched again. Storage denial still permits session cart. No customer/address data in localStorage.
2. Quote resolves enabled product/variant and owner-set prices, policy/tax setup, city shipping and coupon eligibility. Empty cart, mixed booking plus physical items, unknown/disabled variant, too many lines (>50), quantity outside 1–20 or invalid dedication fails. One booking per order; ordinary physical/digital mixed cart is supported. Sum and discount in integers; no float rounding. Proportionally allocate discount/tax to lines with deterministic remainder so refunds reconcile exactly.
3. Final POST uses an idempotency key; same key+same payload returns same order, same key+different payload returns 409. Lock variant rows in sorted ID order, coupon row and booking reservation. Recheck versions and availability. Reserve all resources and write order/items/policy snapshots/outbox in one transaction or none. Hold default 20 minutes, invoice expiry no later than hold expiry. A paid booking has the same expiry rule.
4. Create the invoice outside the DB transaction with a durable attempt in `creating`. Store its ID and URL, then return it. Never hold SQL locks across network calls. On timeout mark `uncertain`; reconcile using the stored provider reference/idempotency contract, never blindly issue duplicate invoices. If provider creation has no documented idempotency support, do not invent a header: reconcile first or cancel/review the uncertain attempt. A second concurrent request cannot create a second active payable attempt for the order.
5. Redirect/success query parameters are display hints only. Until authoritative verification finishes, show «جارٍ التحقق من الدفع» with a safe refresh. Do not clear the cart or issue downloads on a callback status string.
6. Webhook: verify documented `secret_token` with constant-time comparison and validate `live` matches expected mode. Persist an event ID durably before ACK, then fetch gateway payment and invoice with secret credentials. Check exact invoice/attempt mapping, account/environment, payment status, expected full amount, currency and refund fields. The unique invoice mapping is the order binding; metadata alone is insufficient. Do not assume every webhook has the same payload shape. Invoices' callback endpoint is only a prompt to reconcile; use the same fetch checks, not an invented HMAC scheme.
7. `apply_verified_payment` locks order, attempt and reservations. The first fully verified paid result commits stock/coupon/booking, grants digital entitlement if asset ready, and queues one receipt; duplicate/reordered events do not repeat any of these. `authorized`, `verified` or merely `initiated` is not paid. Record partial/over/under currency or amount mismatch for review; never fulfill it.
8. If payment arrives after a reservation expired, reacquire stock/slot transactionally. If unavailable, set `paid_needs_resolution`, do not oversell or promise the appointment, and notify owner for refund/rebooking. The money remains recognized; it is never relabelled failed because fulfillment failed. Free an expired held slot before a new reservation; exclusion constraint prevents two active overlaps.
9. Reconcile pending/uncertain attempts every minute in bounded batches, backing off after repeated provider errors; keep manual retry on owner order view. Durable events/outbox survive Worker restarts. Webhook retries are finite, so webhook-only completion is not adequate.

## Unpaid reservation abuse

Unpaid-hold protection applies before both stock and booking reservation. Use server-validated Turnstile, bounded attempts and transactionally enforced active-hold limits by guest checkout session and normalized recipient/resource. Rotating idempotency keys cannot reset the existing hold's expiry or bypass those limits. Keep IP throttling secondary so shared networks remain usable; record concrete thresholds and residual distributed-abuse limits. Expired holds are reclaimed and same-request retries reuse the original order. No buyer account or paid fraud service is required.

## Refund, return and delivery

Owner MFA confirms amount/reason on the order. Create a refund intent under lock; reserve refundable balance including pending/uncertain intents so simultaneous refunds cannot exceed payment. Call gateway outside transaction. On response timeout remain uncertain and fetch authoritative payment/refund state before retry. Only confirmed gateway state marks financial refund succeeded. Duplicate events dedupe on provider ID and internal intent. Partial refunds allocate to order items; revoke only affected digital entitlement/booking, preserve unaffected items. Full refund revokes all entitlements. Do not automatically restock shipped/returned goods before owner marks them received and sellable.

Digital receipt links lead to scoped tokens, never the raw R2 key. Order-access links expire after 7 days and may be reissued after a generic email recovery request; a download token expires after 15 minutes, at most 3 issuances, with a 60-second object signature. Token hashes use a server pepper; rotate by version. A leaked already-issued signed object URL remains usable until its short expiry; do not promise instantaneous DRM. Use `Referrer-Policy: no-referrer`, attachment disposition with a safe UTF-8 filename and `X-Content-Type-Options: nosniff`. Refund/revocation prevents new links.

Physical orders require supported shipping address and phone; digital-only orders do not request address. Operations marks preparing, shipped and delivered; tracking and customer emails use dedupe keys. Signed edition supports dedication text and a fulfillment checklist. Returns start as customer requests and have a staff trail. Record all financial and stock changes in audit, not only the last status.

## Disputes and payout reconciliation

Disputes and payout discrepancies are separate from refund success. An owner verifies provider evidence and records an immutable, redacted audit entry with payment/payout reference, amount, reason, date and resolution. Changing fulfillment or entitlement requires an explicit recorded decision; never overwrite the original payment or manufacture a refund to represent a chargeback. The existing gross-minus-confirmed-refunds metric must disclose that it excludes gateway fees, chargebacks and payout timing; it is not bank-settled cash. Manual reconciliation reports those differences separately and avoids counting one adjustment twice.

## Privacy requests and restore obligations

Keep a minimal deletion ledger outside the database being restored, within the approved protected backup arrangement. It records identifiers and actions, not erased content, so restoring an older backup cannot also roll back the evidence needed to reapply later deletions.

Privacy requests require verified identity and an auditable access/export/correction/deletion procedure across customers, orders, contacts, subscriptions and logs. Export only that person's data, excluding staff notes and private boards. Preserve legally required accounting records and document the reason and approved retention. Record deletions so a backup restore reapplies them before reopening service; retained backup copies age out under the approved schedule. Test with synthetic records and document exceptions rather than promising immediate erasure from every backup.

## Email delivery and retries

All email senders consult suppression before dispatch. Verified hard-bounce/complaint events suppress further sends; other failures follow documented provider semantics and bounded backoff. Store retry limits, next retry and exhausted state; surface recovery in existing admin operations. A manual replay preserves business dedupe, rechecks unsubscribe/suppression and uses the documented provider idempotency lifetime. An ambiguous send outside that lifetime needs reconciliation before retry. Reserve capacity for authentication and receipts; defer availability notices when quotas are constrained. Never claim unlimited exactly-once delivery.

## Media and session boundaries

Native Payload media UI/folders/relationships remain. Upload extension generates bounded WebP derivatives in browser at 360/720/1200/1800px without upscaling, cropping through native/browser controls. No sharp import, imageSizes or Cloudflare Images dependency. Server-owned ticket/key (5-minute expiry), magic-byte/MIME/dimension/size checks and authenticated ownership gate promotion out of private quarantine. Permit JPEG/PNG/WebP/AVIF originals <=15MiB/40MP, PDF <=100MiB; reject user SVG/HTML/archives. Header validation is not full image decoding or a guarantee of metadata sterilization. Serve accepted public images on isolated origin with nosniff; original stays private. Regeneration/crop occurs in authenticated browser; failed/unsupported encode leaves actionable error, never raw fallback publication. Rights/alt required; references block destructive removal. Review real adapter direct-upload security in P00/P05.

PDFs remain private; patched PDF.js isEvalSupported:false, local version-matched worker, no PDF JS/actions/attachment auto-open. Approved excerpt is separate bytes, not client-hidden full manuscript. Manifest hash/range/rights required.

Native Payload auth/session/reset/lockout and CSRF protections; re-read active roles. Owner MFA is explicit TOTP step-up if native version lacks it. Short-lived action-bound grants, rate limits and one-use recovery codes; revoke on password/session/role change. Native versioned saves plus optimistic conflict checks preserve unsaved content and restore by creating a new native revision. No duplicate editor state store.

CSP consistent with Next/Payload local workers, restrictive admin frame-ancestors, same-origin mutations, no unsafe eval, nosniff and private no-store. Safe Lexical renderer allows known nodes/marks/HTTPS links/media IDs only, no arbitrary HTML/embeds. Bidi isolation, escaped email/calendar fields, request IDs, no secrets/payment/card/PII logging. Sentry beforeSend scrubs tokens, bodies, email and addresses; no replay. Backups encrypted and restored to disposable environment first. Automatic destructive purge never removes unapproved accounting records.
