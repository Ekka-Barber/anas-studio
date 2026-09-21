# Decisions, assumptions and launch dependencies

These decisions remove execution questions. They do not grant rights, invent commercial facts or authorize spending. Every change to this register needs a reason, affected package IDs and a test impact.

## Settled decisions

| ID | Decision and evidence | Consequence |
|---|---|---|
| D01 | The mission grants technology choices within React + TypeScript + Next.js and a real database. Use Next App Router, React, TypeScript, Supabase PostgreSQL/Auth, Cloudflare Workers through OpenNext, and R2. | No Astro, static-only CMS, or duplicate backend framework. |
| D02 | Offer 1551 calls its component list proposed; 1554 names Payload. After comparing Payload, Strapi, Directus and a focused Supabase admin, choose the latter. Payload's useful drafts/localization do not enforce PostgreSQL RLS for per-staff operations automatically. | This is an explicit replacement of a proposed implementation component, not a removed CMS capability. Retain every promised owner action, drafts, preview, scheduling, taxonomy, media, roles and audit. If the client later requires Payload specifically, reopen this decision rather than pretending it was built. |
| D03 | Preserve R2 from the offered stack. Public derivatives, private originals, private paid files and backup copies have different access paths. | Never use a public bucket for purchased PDFs or originals. All authorization metadata remains in PostgreSQL. |
| D04 | Use CSS Modules and the existing licensed fonts/tokens. Adopt Radix Dialog for modal focus/keyboard behavior, native controls elsewhere; Tiptap for rich text. | Do not add Tailwind or an unrelated dashboard template. No general visual page builder. |
| D05 | Moyasar hosted invoice checkout is the primary gateway. Stream is researched but not implemented in parallel. It remains the offered alternative if Anas selects it before live onboarding. | Same domain order/payment protocol; no two-provider abstraction. A switch must redo P08 sandbox evidence. |
| D06 | All money is integer halalas in SAR. Prices, stock, delivery fees, coupons, service rates and tax settings come from owner-managed rows. | No production seed prices. Tests generate synthetic values and label them fixtures. Missing price means unavailable, not zero or a historical demo price. |
| D07 | General products support digital, physical and signed physical variants; services use the same order/payment ledger with appointment reservations. | The current book is initial content, not a hardcoded single-product store. No subscription billing. |
| D08 | Guest checkout; staff accounts only. Customers receive order access through an emailed expiring token. | No mandatory customer signup; customer records and order histories still exist in admin. |
| D09 | Default domestic shipping: Saudi Arabia, owner-entered supported cities and rates; physical shipment processing is manual in admin with carrier/tracking details. | No fabricated delivery rate or SLA; unsupported city is rejected before payment. Carrier integrations and label purchases are not promised. |
| D10 | Book preview uses an approved excerpt PDF rendered by PDF.js in a page-flip physical reader. Direct page-flip reuse fits the existing reader; no WebGL rewrite. | Never send a full paid PDF to the browser and hide pages. Reduced-motion mode is an accessible paginated/stacked reader. |
| D11 | Blog public name defaults to «المجلس», route `/journal`; the label is editable in admin. | Resolves offer 1523–1525 without a question. No literary name invented for services; label «الخدمات والمواعيد». |
| D12 | Calendar integration means a revocable private iCalendar subscription and per-booking ICS export/import into calendar clients. Admin can add busy periods. | No claim of two-way Google/Outlook synchronization. Availability in this platform is authoritative. Full bidirectional provider OAuth is not promised; expand only if the client rejects this documented interpretation. |
| D13 | Staff: owner, editor, operations. Owner grants roles; editors manage public content/media; operations handle orders/inbox/bookings, never roles or gateway secrets. | Enforce the matrix in database grants/RLS and route checks, not navigation alone. |
| D14 | Native form controls plus shared Zod schemas; use React form state without a form framework initially. | Avoid RHF/Formik dependency until actual complex field-array behavior demands it. Tiptap and image crop are the needed complex controls. |
| D15 | Standard images use Cloudflare Images transformations through bounded preset URLs over private source access; browser crop UI supplies coordinates. | Automatic server-side optimization and metadata stripping cannot rely on a user's browser. Cloudflare Images is a costed service; raw native sharp is not assumed to run in Workers. |
| D16 | Email: Resend HTTP API with a persistent PostgreSQL outbox, stable idempotency keys and retry status in admin. Turnstile plus honeypot and database-backed throttling for public submission. | A failed email cannot erase an order/contact; confirmed database writes define submission success. |
| D17 | Honor the full supplied design law on new work. Specific locked design overrides its generic stylistic defaults on existing public pages. | Cream, jewel room colors, Lyon/Thmanyah and existing section compositions remain. Improve broken behavior/visibility/accessibility in production without editing frozen input. |
| D18 | One writer, serial package execution, GLM's independent audit after each PRD. | No concurrent shared-file edits; no acceptance based solely on builder screenshots or claims. |
| D19 | Use current stable pinned versions from the evidence snapshots; no `@latest` in committed scripts. | P00 resolves missing transitive peer pins with the registry, checks compatibility/advisories, and commits exact lockfile. Evidence does not substitute for a real install/build. |
| D20 | Public content is request-rendered with bounded cache TTL and explicit invalidation; private/admin/order routes always no-store. Publishing is time-filtered in SQL even if the scheduler is late. | No rebuild required for edits. Scheduled drafts never leak through list/detail/search/metadata. |

## Safe assumptions while building

| ID | Assumption | Exact execution behavior |
|---|---|---|
| A01 | Existing copy is the design baseline, subject to rights and owner revisions. | Seed drafts with provenance; publish only records marked approved. Keep public route scaffolds testable with unmistakably synthetic local fixtures. |
| A02 | Stock is finite for physical/signed variants; no physical preorder is enabled by default. | Owner must set stock or explicitly set preorder capacity, delivery description and policy. All stock reservations expire, with late-payment handling. |
| A03 | Digital entitlement grants one order-item license, not DRM. | Time-limited signed delivery, revocation on refund and no public PDF. Explain that an authorized downloaded file can be copied. |
| A04 | One owner calendar, timezone `Asia/Riyadh`, timestamps UTC. | Weekly availability plus dated exceptions and fixed service duration; one booking per slot. No multi-provider scheduling engine. |
| A05 | No cancellation policy has been approved. | Implement versioned policy editor and preview; block paid selling until policy version is approved. Staff can review cancellation/return requests and issue verified refunds. |
| A06 | VAT registration and invoice obligations are unknown. | Tax setup is `unconfigured`, not assumed exempt. Checkout disabled until owner records applicable status/rate/tax-inclusive handling and legally required identity fields. A receipt is not described as a ZATCA compliant tax invoice. If e-invoicing applies, add its integration as an explicit launch gate, not a fake implementation. |
| A07 | Arabic numerals means the mission's Latin `0–9`. | Format with `ar-SA-u-nu-latn`; convert Arabic-Indic input digits at form boundary before numeric validation; do not alter photographed historic signs or PDF source artwork. |
| A08 | Account provider operations need secrets controlled by Anas. | Admin edits nonsecret domain/email/links and displays verified status/instructions. Credentials use deployment secrets, never editable text settings. Owner DNS/onboarding actions are documented. |
| A09 | No automated outbound marketing campaign was promised. | Availability notifications go only to confirmed opt-ins, use unsubscribe, and record consent. Transactional receipts remain separate. |
| A10 | Contact retention defaults to 180 days after closure; unsubscribed notify records to 30 days; operational orders to a configurable retention hold until legal/accounting requirements are confirmed. | No automated order deletion before approved retention configuration. Minimize raw IP storage; daily rotating salted throttle keys expire within 24 hours. |
| A11 | Existing book cover images are web assets, not press files. | Never infer binding dimensions/page count or upload approval comps as print production files. Physical printing/signing/packing belongs to Anas (offer 1946). |

## External dependency register

All entries remain OPEN until actual evidence is supplied. They do not block local implementation. Escalation means record the missing fact and its launch impact in `PLANS/ISSUES.md`, continue independent work, and include it in the human handoff. Do not repeatedly ask the same question or invent an answer.

| Gate | Owner/input | Blocks | Evidence that closes it |
|---|---|---|---|
| E01 | Anas: ownership/DNS access for anasaq.me; client-owned Cloudflare, Supabase, R2 and mail accounts | P11 live domain | Account inventory, DNS/TLS smoke and ownership receipt with no credentials in repo |
| E02 | Anas: merchant eligibility, Moyasar sandbox/live keys, enabled payment methods and settlement account | P08 real sandbox acceptance if sandbox missing; live payments | Sandbox transaction/refund IDs; live configuration review; Apple Pay test on supported Apple hardware |
| E03 | Anas: product/service prices, stock, shipping cities/rates, fulfillment timing, coupon rules and tax status | Live checkout | Owner-configured values and approved policy revision; no prices taken from prototype |
| E04 | Anas: final book manuscript, approved preview page range and rights | Authentic reader content and digital selling | Private source manifest with filename, SHA-256, page count, rights approval and preview artifact hash |
| E05 | Anas: portrait, project stories/photos/logos/metrics rights, scene categories, first 3–5 articles, social links | Content-complete launch | Asset/content checklist signed off in admin; no NDA or unverified business metric published |
| E06 | Anas: font web-use license proof; repository asserts held but source binaries alone are not proof | Licensed public font launch | Private rights record; never deploy license PDFs or raw originals unnecessarily |
| E07 | Anas: budget acknowledges measured hosting needs | Paid provisioning/live launch | Cost sheet accepted before paid upgrade; no purchases in this plan |
| E08 | Anas: privacy, refund/delivery/cancellation and tax/legal text approval | Live data collection/paid operations | Dated versioned Arabic policies; processor/location review; external accounting integration if legally required |
| E09 | Anas: availability, contact channel and private calendar subscription installed | Live services | Book/cancel test reflected in chosen calendar, owner confirms imported/subscribed calendar behavior |
| E10 | Anas and Majed: actual training and month of support | Final commercial completion | Owner performs tasks unaided; dated training record and support window with issue register |

## Cost decision and deviation made visible

The offer describes free entry tiers, not a license to conceal paid runtime needs. Current evidence: Workers Free has CPU/bundle limits, paid begins at $5/month; Supabase Free can pause after 7 days and does not provide downloadable managed backups. Production target is Workers Paid plus Supabase Pro (listed starting $25/month), approximately $30/month before storage/image/email overages, tax, domain renewal and gateway fees. This is an explicit E07 approval gate because it exceeds the offer's free-start expectation. Local and isolated preview work uses free/local resources. If the owner elects free launch, GLM must present measured Worker CPU/size evidence, backup restore proof and documented pause/outage risk; never silently downgrade reliability or fabricate uptime. No synthetic heartbeat is claimed to guarantee Supabase service.

Do not put these internal dollar amounts or tool/research names in product copy. Keep the offer's deliberate tools sentence at line 1365 unchanged. Anas sets the project fee; four phase payments remain 20% / 35% / 30% / 15%, all delivered work client-owned, month of support included. No invented project price, gateway fee or delivery charge.
