# Decisions and launch gates

Authoritative revision: 2026-09-21, incorporating the user's resume attachment. This replaces the earlier custom-Supabase-admin proposal. Implementation remains NOT STARTED.

## Settled decisions

| ID | Decision | Implementation consequence |
|---|---|---|
| D01 | Payload 3 embedded in Next.js, React and TypeScript; one app, one Supabase PostgreSQL database, one Workers deployment. | Postgres adapter uses Hyperdrive to the Supabase pooler. P00 first proves this exact runtime, including admin, collection and R2 upload without Sharp. |
| D02 | **Retain Payload**, explicitly named by the printed offer at 1931 and reaffirmed by the user. | Native collections/admin/Lexical/editor/drafts/versions/preview/scheduling/taxonomies/media. The prior replacement decision is withdrawn, not an approved substitution. |
| D03 | R2 private originals and paid files; separately served approved public derivatives. | No full manuscript in public build output. Authorization metadata and entitlements stay in PostgreSQL. |
| D04 | CSS Modules, licensed Lyon/Thmanyah, no Tailwind/dashboard template. | Preserve Payload's native admin behavior; thin Arabic/RTL overrides. Radix for existing dialogs, React Aria for gaps. React Aria's fetched license is Apache-2.0, not the MIT label in the request; both are permissive, preserve actual notices. |
| D05 | Moyasar hosted invoices, server verification, one gateway. | Stream researched alternative only; change requires rerunning payment proof. No card details reach our server. |
| D06 | SAR integer halalas; owner configures every price, shipping fee, stock, service rate, coupon and tax setting. | No production seed selling prices. Test amounts are synthetic fixtures. Unconfigured means unavailable, never free by accident. |
| D07 | Payload products/variants/coupons/customers, with narrow SQL checkout/payment transactions. | Support digital, signed physical and optional plain physical editions plus future general products without code changes. |
| D08 | Guest buyers; Payload staff authentication only. | No Supabase Auth, duplicate identity system or mandatory buyer account. Private order links use expiring hash-stored tokens. |
| D09 | Saudi city/rate shipping, manually managed carrier/tracking/returns. | No fabricated shipping SLA/rates or carrier-label purchase integration. |
| D10 | Patched PDF.js + direct pinned page-flip, actual approved excerpt, physical RTL reading. | Lazy load; static accessible fallback; never download full paid PDF then hide pages. |
| D11 | Blog defaults to المجلس at /journal; editable name. | Native Payload posts; new public journal composition within frozen identity. |
| D12 | Settled native booking: Riyadh weekly hours, exceptions/manual busy blocks, free/paid slots, DB exclusion, private one-way ICS using ics. | No Cal.com/cal.diy, external project management or bidirectional calendar OAuth. Public availability is platform-authoritative. |
| D13 | Staff roles owner/editor/operations, active membership checked per request. | Payload access controls plus restricted DB roles/grants/RLS. Owner step-up MFA for refunds/role grants; never claim Payload hooks automatically enforce per-person RLS. |
| D14 | Zod at custom boundaries; Payload field validation in native collections; native forms first. | No custom CMS editor/forms framework. Lexical JSON allowlist for public rendering, no arbitrary HTML/embed. |
| D15 | **No Sharp or Cloudflare Images baseline dependency.** Native browser crop/encode generates bounded WebP derivatives at upload time. | Server checks bytes/type/dimensions/size/key ownership before promotion. Original private. No claim that header checks fully decode or sanitize a hostile image. Images is a post-launch option only after E07 approval. |
| D16 | Resend HTTP email adapter/outbox, Turnstile and bounded DB throttles. | Durable writes precede email. Availability notifications actually dispatch to confirmed subscribers, once per availability revision, with unsubscribe. |
| D17 | Frozen public design overrides generic stylistic defaults; new work follows supplied design law. | Book composition remains final; only reader and data/behavior wiring change. Nothing edits deploy/design/. |
| D18 | One writer at a time, exclusive lock; the orchestrator (Fable on Claude Max) personally runs/looks after every PRD; builders are Opus 5 sub-agents dispatched one at a time. | No shared-file races. Read-only reviews may run concurrently. Audit fixes return to workers as bounded tasks; the orchestrator direct-writes only lock/status/issues paths. |
| D19 | Exact researched package pins and lockfile. | P00 verifies compatible supported patch versions; no unexamined latest tags or disabled checks. |
| D20 | Published Payload documents only in public reads; native draft preview/auth. | Explicit overrideAccess:false for user/public Local API calls; private no-store; publication/cache invalidation <=60 seconds. |
| D21 | Owner home has actual pending work and actual statistics. | DB orders/revenue/customers; visits/top pages through existing Cloudflare Analytics API. Null/unavailable is shown as unavailable, never zero or invented. |
| D22 | P12 لوحة أنس is **BONUS SCOPE**, outside offer C-IDs and 7–9-week estimate. | Private owner-only Payload boards/columns/cards; free-form columns, optional content link, separate explicit content publishing. No teams/swimlanes/automations. |
| D23 | Sentry free for checkout/webhook/scheduler errors and one UptimeRobot Free HTTPS health monitor at 5-minute intervals. | Strip PII/tokens/payment payloads; no session replay. Record real alert test. WhatsApp is editable wa.me link only. |
| D24 | Execution platform (2026-09-21): Claude Max subscription — Fable orchestrates/audits, Opus 5 sub-agents build at xhigh effort, one active writer under the exclusive lock. | Worker definitions live in repo `.claude/agents/` (`opus-worker`, `opus-worker-lite`); orchestrator contract in AGENTS.md. FIRST-GLM-PROMPT.md keeps its filename so verify-plan.ps1 stays green; its wording is orchestrator-neutral. |
| D25 | Canonical production domain (2026-09-21): anas.studio, purchased in the client-owned Cloudflare account. anasaq.me remains the legacy V1 identity; redirect disposition is Anas's launch decision. | SITE_URL, Resend sender domain, Turnstile hostname and E01 evidence target anas.studio. |
| D26 | P00's "separate migration credentials" means a distinct non-pooled connection and credential, not the restricted database roles that P03 owns. | The spike applies DDL over the Supabase session/direct endpoint while runtime traffic uses the Hyperdrive binding aimed at the transaction pooler, and records both endpoints. Creating `payload_runtime`, `finance_runtime` and `migration_owner` with their grants and RLS stays in P03; P00 neither pre-empts nor weakens that design. |

## Recorded assumptions

The second-pass audit's seven reliability findings are incorporated into the accountable packages and verification gates. Its RSS, reading-position and sharing suggestions remain optional, outside accepted implementation scope. Do not silently add new providers or paid features to resolve these findings; any new operating commitment requires E07 approval. Re-estimate remaining effort after P00 and the first end-to-end sandbox payment proof; preserve contractual scope and the offered timeline unless the client agrees to a change.

- Arabic only, RTL first, Latin digits via ar-SA-u-nu-latn; isolate URLs/emails. Do not rewrite photographed signage or PDF source digits.
- Existing texts are design baseline, not proof of photo/logo/metric/font rights. Seed unapproved material as drafts. No fake customers, claims or business metrics.
- Physical inventory finite; preorder disabled until capacity/date/policy configured. Signed copy supports dedication. Digital delivery is access control, not DRM.
- One owner calendar, UTC storage, Asia/Riyadh presentation. One booking per order; ordinary physical+digital mixed carts supported.
- Tax remains unconfigured until approved. Configure seller legal name/address/registration, VAT status/number/rate, inclusive/exclusive prices and invoice obligations. A normal receipt is not claimed ZATCA compliant. Applicable e-invoicing is an explicit legal launch gate.
- Contact retention defaults 180 days after closure, unsubscribed notify records 30 days; accounting orders are retained until approved legal retention. No automatic destructive order purge.
- Client owns all accounts. Admin edits nonsecret domain/sender/settings and shows verification; credentials remain deployment secrets. DNS changes require owner access.
- No marketing beyond explicitly confirmed availability notices. Transactional receipts remain separate.
- Browser-produced derivatives strip normal source metadata as part of re-encoding; a malicious uploader is still constrained by server validation and isolated media origin. Do not promise server sterilization.

## External gates: continue local work, never invent closure

| Gate | Input / owner | Blocks and closure evidence |
|---|---|---|
| E01 | Anas: client-owned domain, Cloudflare/R2/Supabase/mail access | Live domain/account setup; account inventory, DNS/TLS and verified sender proof |
| E02 | Anas: Moyasar eligibility, test/live account, enabled methods | Real sandbox acceptance/live payments; redacted transaction/refund IDs and Apple Pay supported-device proof |
| E03 | Anas: prices/stock/city rates/services/tax settings/policies | Live checkout; configured approved values and policy revision |
| E04 | Anas: final manuscript and approved preview rights/range | Public authentic preview/digital sale; private file hash/page count/approval manifest |
| E05 | Anas: portrait/project stories/photos/logos/metrics, first 3–5 posts, channels | Content-complete launch; per-record rights/content approvals |
| E06 | Anas: font web/subsetting license evidence | Licensed font launch; private license register, not public license PDFs |
| E07 | Anas: operating cost approval | Live orders require always-on DB, measured Worker capacity and an accepted all-in cost sheet before provisioning; include the selected off-site backup destination, retention footprint, key custody, quotas, overages and available alerts |
| E08 | Anas: privacy/refund/shipping/cancellation/legal retention and tax obligations | Live data collection/paid operation; versioned approved text, processor/location review, required invoice integration and a tested identity-verified access/export/correction/deletion procedure with accounting and backup exceptions |
| E09 | Anas: availability and calendar subscription installed | Live services; book/cancel/import proof |
| E10 | Anas/Majed: actual training and 30-day support | Commercial closure; dated owner task/training and support records |
| E11 | Existing Cloudflare account Analytics access/dataset | Visits/top-page statistics; least-privilege API token, verified dataset/timezone and live query proof. Empty dataset stays empty. |

Build/staging policy: $0, local Supabase Docker primary, ONE free live Supabase project with synthetic preview data; Workers Free, R2/Resend/Turnstile free quotas. No paid Images and no fake heartbeats. P00 measures Worker free CPU/size; a failed free-tier spike blocks dependent work and is escalated, never bypassed by silently buying a plan. Local work may continue only on independent analysis while runtime is unresolved.

Before live orders: E07 approves Workers Paid (from $5/month) and Supabase Pro (from $25/month), roughly $30/month plus actual domain/storage/email/gateway overages/tax. No real orders on a pausable free DB. Domain estimate remains ~120 SAR/year, not a quote. Anas sets project fee; offered phase shares 20/35/30/15 and ownership/month support remain unchanged. P12 adds no promise to that offered timeline. Research/tool/provider implementation detail stays out of user-facing product copy. Preserve offer line 1365 unchanged.
