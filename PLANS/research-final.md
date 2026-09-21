# Final implementation research

Research cutoff: 2026-09-21. Planning only. No package was installed, no app was scaffolded and no production file was changed.

## Recommendation and first gate

Build one embedded Payload 3 application: one Next.js/React/TypeScript codebase, one Supabase PostgreSQL database and one Cloudflare Workers deployment. Use `@payloadcms/db-postgres` through a Hyperdrive binding aimed at the Supabase pooler. Use a second least-privilege runtime credential/binding for financial functions in the same database, not a second database or service. Payload native auth is the only staff identity.

P00 is the first and blocking implementation step. Pin the compatible Payload 3.90.1 set, run the real admin route on Workers, log in, CRUD one collection row through Supabase Postgres/Hyperdrive, upload and read one private object through `@payloadcms/storage-r2`, and prove the bundle contains no Sharp/native image resize or filesystem persistence. Measure Worker CPU, compressed bundle, route compatibility, migrations and connection behavior on Free. Failures stop dependent work; they do not authorize a silent paid plan, D1 switch, custom CMS or separate deploy.

Cloudflare's 2025-09-30 Payload article is unusually strong feasibility evidence: the official Postgres adapter worked on Workers, with `maxUses: 1`, and Hyperdrive restored pooling/query cache. It is still a demonstration, not proof of this project's Supabase path or free CPU budget.

## Selected platform

| Area | Selection and boundary | Evidence snapshot |
|---|---|---|
| CMS/runtime | `payload@3.90.1`, `@payloadcms/next@3.90.1`, `@payloadcms/db-postgres@3.90.1`; OpenNext `1.20.6` is the starting adapter because Payload's official Workers port used it. P00 also records current Cloudflare guidance, where vinext is beta and OpenNext remains documented. | MIT; 8,335,126 B, 2,313,164 B, 58,556 B and 472,302 B unpacked. Payload repo and releases were active in Sep 2026. |
| CMS behavior | Native collections/globals, admin, access controls, versions, drafts, preview, `schedulePublish`, jobs, folders/media and generated types/migrations. Native Lexical through `@payloadcms/richtext-lexical@3.90.1`. | Lexical adapter MIT, 6,225,893 B, released 2026-09-18. Jobs persist in DB, but schedules require an actual runner. One Worker scheduled handler invokes them. |
| Storage | `@payloadcms/storage-r2@3.90.1` with native R2 binding. Private originals, paid files and quarantine; approved public derivatives use separate keys/origin. | MIT, 93,931 B, released 2026-09-18. Payload docs identify it as the Workers-only R2 adapter. |
| Staff auth | Payload sessions/cookies, password reset, verification and lockout. Disable public registration; re-read active role per request. | Current Payload auth pages document these features but not MFA/TOTP. |
| Database authorization | Private `cms` and `finance` schemas; no Supabase anon/authenticated grants and no Data API exposure. Payload access controls human authorization. DB roles/grants/RLS isolate service principals. Financial runtime gets EXECUTE only on fixed-search-path functions. | Do not claim Payload hooks propagate each human identity into Postgres RLS. Avoid pooled `SET` identity. Use checked-in migrations and direct role-negative tests. |
| Email/abuse | `resend@6.28.1` over HTTP with durable outbox/idempotency; Turnstile plus bounded DB throttles. | Resend MIT, 282,178 B, Sep 2026. Free development quotas exist; sender/domain setup remains external. |
| Validation/tests | Payload field validation internally, Zod at custom boundaries; Vitest 5.0.1, Playwright 1.63.0, axe and LHCI. | Licenses are MIT, Apache-2.0, MPL-2.0 and Apache-2.0 respectively. Test exact Worker preview, DB roles, browser RTL and payment replay. |

Payload, Lexical and their exact patch set move together. A later `latest` tag is not authorization to upgrade. P00 may select a different mutually supported patch only with recorded compatibility, licenses, advisories and lockfile.

## Media without Sharp or Images

Baseline is upload-time browser processing, not on-request optimization. `react-easy-crop@6.2.3` provides the crop UI; native `createImageBitmap` plus canvas `toBlob('image/webp')` generates the required bounded widths without upscaling. Generate automatically before upload, fail with an actionable message when the browser cannot encode, and never publish the raw original as a fallback. Preserve crop coordinates for deliberate regeneration.

The server does not trust browser claims. Direct pins `file-type@22.1.1` and `image-size@2.0.4` check magic bytes and bounded dimensions before promotion; enforce authenticated short-lived upload ticket, byte limit, pixel limit, allowed exact widths/aspect ratios, server-generated keys and ownership. Reject SVG, HTML, archives and mismatched declared MIME. Canvas output normally removes source metadata, but header/type checks do not fully decode or sterilize a hostile image. Keep originals private, serve derivatives from an isolated origin with `nosniff`, and require alt text/rights.

Package evidence: `react-easy-crop@6.2.3` is MIT, 281,101 B, published 2026-07-24 and its repo was active 2026-09-10. `file-type` is MIT, 138,897 B, published/repo-pushed 2026-09-17. `image-size` is MIT, dependency-free, 95,510 B, published 2026-09-14. Exact-version OSV queries returned no known advisories at cutoff.

Do not add Sharp, Cloudflare Images, a WASM codec or an image proxy to baseline. Sharp is unsupported in the Workers path under discussion #16937. A pure WASM encoder moves trust server-side but adds large code, codec maintenance and CPU risk against Free's 10 ms request budget. Test one only if P00 proves browser encoding cannot meet supported-browser/quality requirements. Cloudflare Images remains a separately cost-approved post-launch choice.

## Auth and owner operations

Current Payload docs expose sessions, reset, verification, lockout and custom strategies, but no native MFA/TOTP. Check installed 3.90.1 once more in P03. If still absent, add only `otpauth@9.5.2`: MIT, 997,251 B unpacked, one `@noble/hashes` dependency, published 2026-09-03, repo active 2026-09-18, no exact-version OSV result. Encrypt TOTP seeds, hash single-use recovery codes, rate-limit challenges and issue a short-lived one-use grant bound to owner, session and action. Refunds and role grants consume it transactionally. This extends Payload auth; it does not introduce Supabase Auth.

Owner statistics combine factual sources: orders/revenue/customers from the database; traffic from Cloudflare's GraphQL Analytics API using a server-only least-privilege token. The official selected-dataset example documents `httpRequestsAdaptiveGroups.sum.visits`; use it only after P06 introspects the connected account's schema/entitlement. A second bounded query may group `dimensions.clientRequestPath`, ordered by request count, filtered to `requestSource: "eyeball"`, production hostname and an explicit UTC range. P06 must first prove a documented response content-type/status filter in that account, then include HTML success responses and exclude admin, API, asset and health paths. Label the result **most requested public pages**, not unique page views. If those fields/filters are absent, data is delayed/unauthorized, or any returned `avg.sampleInterval > 1`, exact visit and page KPIs are **unavailable**. Never present extrapolated/sampled figures as exact and never turn missing into zero.

The bonus kanban uses private owner-only Payload `Boards`, `BoardColumns` and `BoardCards`. `@dnd-kit/core@6.3.1` and `@dnd-kit/sortable@10.0.0` are already exact dependencies of `@payloadcms/next@3.90.1`; direct imports should still be declared. Both are MIT, 1,066,148 B and 234,022 B unpacked. Packages were published Dec 2024, but the non-archived repo was active 2026-09-12; OSV exact-version checks were empty. Dnd-kit operates in physical coordinates and does not prove RTL by itself. Use logical CSS, explicit horizontal-order mapping, keyboard sensor/announcements, non-drag move controls, and test pointer plus keyboard in RTL. Publishing linked content stays a separate explicit action.

## UI, reader, commerce and booking choices

| Keep | Why | Candidate not selected |
|---|---|---|
| Payload native admin with existing Radix, plus React Aria only for accessibility gaps | Smallest custom surface and native access/editor behavior. `@radix-ui/react-dialog@1.1.23` is MIT, 99,377 B. `react-aria-components@1.21.1` is **Apache-2.0**, 6,586,272 B, active Sep 2026 and has broad locale/direction behavior. Preserve Apache notices. | Request's React Aria MIT label was false. Base UI is MIT but 9,628,362 B and would add another primitive system. A custom dashboard duplicates CMS behavior. |
| Payload Lexical adapter | Native typed rich text, admin integration and versioning. Allowlist renderer, no arbitrary HTML/embed. | Tiptap 3.31.3 is maintained/MIT but adds a second editor and SSR/configuration surface. |
| Patched `pdfjs-dist@6.3.289` plus direct `page-flip@2.0.7` | PDF.js is maintained, Apache-2.0, 34,781,083 B and had no exact OSV result. Direct page-flip gives physical RTL ordering without React wrapper indirection. Lazy-load both and retain accessible static fallback. | `react-pageflip@2.0.3` is only 37,672 B but adds a stale wrapper. `page-flip` itself is MIT, 9,391,581 B, last published 2021 and repo-pushed 2024, so pin it, isolate it and keep a removable fallback. Three.js/R3F is much larger and unnecessary. |
| Moyasar hosted invoice + server fetch verification | Existing official evidence covers invoice creation, webhook token, status, payment fetch, refunds, test/live separation and Apple Pay registration. Card data never touches app. | Stream is credible and documented, but changing gateway reopens payment proof. Payload ecommerce plugin is not a payment/inventory correctness layer. Medusa/Saleor create another commerce service and violate one app/deploy. |
| Native booking tables/functions plus `ics@3.12.0` | One Riyadh calendar, DB exclusion, holds, exceptions and a private one-way feed need little code. `ics` is ISC, 71,873 B, published Apr 2026, repo active Sep 2026. | Cal.com is an oversized second product. `ical.js@2.2.1` is MPL-2.0 and 1,200,090 B; use only if parsing/import becomes approved scope. |
| CSS Modules and existing licensed fonts | Matches frozen design and avoids a second styling system. Use logical properties and Arabic browser/device checks. | Tailwind/dashboard templates, custom CMS editor and Tiptap are duplication. |

## Operations, costs and security

Use Sentry Free for checkout, webhook and scheduler failures: `@sentry/nextjs@10.75.1`, MIT, 1,967,109 B, active/published 2026-09-21, exact OSV empty. Disable replay. Scrub tokens, request bodies, payment payloads, emails and addresses in `beforeSend`. Sentry's current Developer allowance is one user/unlimited projects/5,000 errors; quotas can change.

Use one UptimeRobot Free HTTPS check against a read-only health endpoint. Current offer is 50 monitors at five-minute intervals; configure exactly one. The endpoint checks app, bounded DB and job freshness without exposing secrets. Monitor availability is neither an SLA nor proof of payment correctness.

Development target is Workers Free, R2 Free, Resend Free, Turnstile Free and local Supabase, with one free hosted Supabase project for synthetic preview only. No Cloudflare Images dependency. Free allocations are test envelopes, not launch economics. Workers Free currently allows 100,000 requests/day but only 10 ms CPU/invocation. Production order acceptance waits for explicit recurring-cost approval, non-pausable DB/backups and measured Worker headroom.

Security snapshot is limited: direct exact-version OSV returned no known advisories for researched pins. That does not cover every transitive package, malicious updates, configuration flaws or future disclosures. Commit lockfile/integrities, run dependency/secret/SAST checks, review Payload/Next advisories at each release and make runtime proof outrank marketing claims.

Detailed source URLs, dates and caveats are in `evidence/final-official-sources.txt`; normalized package evidence is in `evidence/final-package-snapshot.json`. Older platform/runtime/commerce captures remain the source for losing candidates and provider protocols.
