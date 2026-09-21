# Offer-to-proof coverage ledger

Scope source is `offer-site-v3/index.html`; line references refer to the unchanged baseline. Every offer heading and actionable bullet appears below. Compound rows spell out their subrequirements; they are not satisfied by implementing only the heading. C IDs are stable acceptance identifiers. Plan coverage is complete; implementation status for every row is **NOT STARTED**.

| ID | Source and full requirement | Sole owner / supporting proof |
|---|---|---|
| C01 | 1539–1557: React + TypeScript inside Next.js; real PostgreSQL, admin, R2 and Saudi payments | **P00**; supporting proof: P00/P03/P08; real Worker build, DB integration and sandbox gateway; embedded Payload retained under D02; exact runtime spike first|
| C02 | 1529–1531,1699: versioned production repository; preserve existing design as input | **P00**; supporting proof: P00; keep current Git, frozen hashes, one accepted commit per package|
| C03 | 1464–1465,1817–1821: personal digital home, portrait/tagline and ordered rooms | **P01**; supporting proof: P01/P04/P06; home route + owner edits all visible texts/media/order|
| C04 | 1465,1825–1844: بدأت هنا, بُنيت هنا, مرّت من هنا; private projects and upcoming work; Rahha branches/campaigns/products/achievements; brands/philosophy/images and contribution stories | **P01**; supporting proof: P01/P04; three routes, project detail, room taxonomy, metrics/rights and working filters|
| C05 | 1465,1856–1867: shelf ideas/sketches/future projects; categorized scenes with descriptions and rights | **P01**; supporting proof: P01/P04/P05; shelf editor, scene CRUD/order/category, lightbox and Arabic alt|
| C06 | 1474–1475,1848–1852: complete Khous world, approved title/cover/signature, summary/characters/excerpts/photos/journey; Arabic right-bound reader | **P02**; supporting proof: P01/P02/P07; book visual comparison + actual PDF source mapping + edition data|
| C07 | 1392–1431,1458: locked color, type and coherent identity across home and projects | **P01**; supporting proof: P01/P10; DESIGN-AUDIT and visual baseline; no new public redesign|
| C08 | 1523–1525,1871–1875: new blog page designed in phase 1; editable name, first 3–5 posts, publishing rhythm | **P04**; supporting proof: P01/P04; journal/list/detail, owner setup, content approval E05; name default D11|
| C09 | 1578: menu, footer and social links editable | **P06**; supporting proof: P06; publish nav/order/footer/HTTPS channel changes without code|
| C10 | 1469–1470,1639,1699–1700: Arabic RTL mobile/desktop product and admin | **P10**; supporting proof: P01/P03/P10; 360/768/1024/1440 screenshots and pointer/keyboard flows|
| C11 | 1475,1699–1700 + compatible PRD §§7,12: restrained motion, real reader, legibility and accessibility | **P10**; supporting proof: P01/P02/P10; reduced motion, no-JS visibility, WCAG checks, no blank animation states|
| C12 | 1566–1568: owner can manage everything visible from any device without programmer | **P06**; supporting proof: P04–P09; end-to-end owner task suite covers every field/domain; no prototype-only control|
| C13 | 1574–1576: edit page text, headings and images | **P04**; supporting proof: P03/P04/P05; draft/publish edits reflected publicly|
| C14 | 1577,1579: show/hide/reorder sections; SEO and share image | **P04**; supporting proof: P04/P06/P10; reordered home and per-route metadata/OG reflect safe published data|
| C15 | 1583–1586,1588: blog and publishable ideas, article writing, drafts, preview, scheduling, archive | **P04**; supporting proof: P04; no early/public draft access, scheduled publish, archive cache removal, revision restore|
| C16 | 1587: categories, tags and author | **P04**; supporting proof: P04; author/taxonomy editing and working public filters, no fabricated author identity|
| C17 | 1592–1594: image library upload and folders | **P05**; supporting proof: P05; upload/rename/move/pagination and folder references persist|
| C18 | 1595–1597: crop, automatic web optimization, Arabic description, usage rights and reuse | **P05**; supporting proof: P05; browser crop/re-encode and bounded derivative output, sample EXIF-removal proof, server byte/type/dimension/key checks, alt/rights gates, multiple references, safe deletion; no claim of full server decoding or sterilization|
| C19 | 1601–1606: project CRUD/details, correct room, metrics/logos/photos/status and ordering | **P04**; supporting proof: P04/P05; owner creates new project with all fields, orders it, publishes to proper room|
| C20 | 1610–1615: editions/prices/stock, orders/payment/shipping, coupons/alerts, customers/confirmation emails | **P07**; supporting proof: P07/P08; catalog CRUD, low-stock/outbox evidence, customer history, full fulfillment|
| C21 | 1619–1621: multiple accounts and roles | **P03**; supporting proof: P03/P06; invites/revoke/MFA/last owner; DB negative authorization tests|
| C22 | 1622: domain and email settings | **P06**; supporting proof: P06/P11; editable canonical/sender data, DNS verification status/instructions, actual client domain/sender setup|
| C23 | 1623: change log and backups | **P06**; supporting proof: P03/P06/P11; append-only audit plus encrypted database/object backup and restore drill|
| C24 | 1624,1628–1632,1879–1883: contact settings/store policies; forms, paid services/consultations, appointment requests and availability | **P09**; supporting proof: P06/P09; actual inbox and service/availability editors, free/paid booking, approved policies|
| C25 | 1633: contact channel and calendar integration | **P09**; supporting proof: P06/P09; configured live links, private ICS subscription/export, cancellation update/import test; D12 defines one-way integration|
| C26 | 1646–1666: complete store for any later product; starts with e-book and signed paper | **P07**; supporting proof: P07/P08; add non-book product from admin; digital and signed fulfillment paths|
| C27 | 1669–1670: add/change quantity, persist cart, stock validation, coupons, customer, city, delivery cost, policy consent before payment | **P07**; supporting proof: P07; real reload/cart interactions plus concurrent reservation, quote/version and policy tests|
| C28 | 1673–1683: Saudi gateway Moyasar/Stream; mada/Apple Pay/Visa/Mastercard subject to merchant activation and eligibility | **P08**; supporting proof: P08; selected Moyasar hosted checkout, activated-method matrix, real test card and supported-device Apple Pay proof; E02|
| C29 | 1677–1678: paid only after confirmed gateway event; order number/email; order/preparing/shipping/return from one admin | **P08**; supporting proof: P08; no redirect trust, gateway fetch verification, duplicate/out-of-order tests, status/return/refund workflows|
| C30 | Mission hard line 4 and 1678: server money verification, every trust boundary validated, database access control | **P08**; supporting proof: P03/P07/P08/P09/P10; RLS/privileged-RPC tests, transaction races, token/file security|
| C31 | 1579,1720: SEO/social/discovery | **P10**; supporting proof: P10; route title/description/canonical/OG/sitemap/robots/JSON-LD, no draft/private leakage|
| C32 | 1420–1431,1699: actual licensed fonts and Arabic production fidelity | **P01**; supporting proof: P01/P10; local faces/shaping/digits, E06 license register, no remote font defaults|
| C33 | Mission hard line 3: only remaining book visual work is real-PDF physical 3D reader | **P02**; supporting proof: P02; actual pages, right binding, touch/keyboard/reduced-motion, fixed non-reader screenshot boundary|
| C34 | 1720: security and reliable operations | **P10**; supporting proof: P03/P06/P08/P10; dependency/grant/secret scans, no private cache, durable jobs, restore and provider failure tests|
| C35 | 1688–1727,1935–1936: four ordered phases, explicit acceptance, expected 7–9 weeks tied to inputs, stop after any phase with work delivered | **P11**; supporting proof: P00–P11; serial gated package ledger, the orchestrator audits every package, exported accepted commits|
| C36 | 1720–1721,1747: Arabic admin training and custom-domain launch | **P11**; supporting proof: P11; Anas performs tasks unaided, recorded training, live DNS/TLS/path checks|
| C37 | 1720,1747,1931: one month of post-launch support | **P11**; supporting proof: P11; named support contact, dates and real issue register; not marked complete on launch day|
| C38 | 1751,1891–1901,1945–1946: client owns code/design/assets/Git/accounts from day one; physical printing/signing/packing/carrier handoff belongs to Anas | **P11**; supporting proof: P11 + E01/E04; client account inventory/export; digital admin supports physical workflow without promising printing services|
| C39 | 1735–1802,1940–1959: Anas sets fee, four shares 20/35/30/15, no developer monthly fee, external domain/host/storage/email/gateway/shipping costs paid directly; domain estimate ~120 SAR/year | **P11**; supporting proof: DECISIONS cost gate + P11; no invented pricing or stale gateway quote; free-tier caveat explicitly escalated E07|
| C40 | 1810–1896,1964–1970: staged client homework for all rooms/blog/contact, approved assets/prices/accounts/merchant; prototype work already owned and borne by Majed | **P11**; supporting proof: E01–E10 and P11; content/rights input ledger, no old copy resurrected, no retrospective fee/tools-stat additions|

## Heading audit, including non-feature sections

The introduction/current stage (1334–1351), frank letter (1357–1384), existing examples/identity (1392–1447), completed work (1456–1485), timeline (1493–1518), blog gap (1523–1525), historical technical accounting (1529–1531), technical choice (1539–1557), admin (1563–1639), store (1644–1683), phases (1688–1727), price (1733–1757), external costs (1764–1802), homework (1810–1901), closing letter (1908–1912), printed offer clauses 1–7 (1930–1970) and signature/footer (1975–1986) were inspected.

Historical timelines, the one deliberate tools sentence at 1365, old prototype counts and signature spaces are offer content, not new site feature requests. Keep that file unchanged. The printed offer reinforces the same scope; its binding Payload requirement is retained in D02; the prior replacement proposal is withdrawn. Supporting DOCX text was extracted to `evidence/offer-docx-1.txt` and `offer-docx-2.txt`; v3 wins any difference. Supporting brand package is summarized in `SOURCE-NOTES.md`.

## Explicit deviations and gates, never silent omissions

1. Payload retained, with native CMS/catalog management, native staff auth and independently enforced database service-principal isolation. P00 proves exact Workers runtime before dependent work.
2. Free entry-tier claim is not an uptime guarantee: E07 requires cost acceptance or actual free-tier measurement/risk acceptance before live operation.
3. Calendar integration is a functioning one-way iCalendar feed and export, D12, not an unsupported claim of bidirectional provider synchronization.
4. Final manuscript, font/content rights, owner-configured prices/stock/tax/shipping/policies and merchant activation remain human inputs. Local implementations and tests continue, but these gates must not be marked closed without evidence.
5. A 30-day support obligation cannot be completed during implementation; P11 distinguishes launch handoff from subsequent commercial closure.

## Added scope and unique accountability

Second-pass reliability findings are binding acceptance clarifications within existing packages, not new contractual C-IDs:

| Finding | Accountable package | Supporting closure |
|---|---|---|
| Representative runtime proof | P00 | P04/P05/P08 and P10 rerun affected hosted measurements |
| Exact probe paths and dirty-baseline provenance | P00 | README lock protocol and pre-scaffold planning check |
| Backup destination, key custody and all-in quota/cost evidence | P06 | P10 restore proof; P11/E07 approval |
| Delivery failures, suppression, priorities and safe retries | P06 | P08 financial-mail integration and P10 failure journeys |
| Unpaid reservation abuse | P07 | P09 slot/free-booking protections and P10 concurrency checks |
| Disputes and settlement discrepancies | P08 | P11 owner runbook/training |
| Verified privacy requests and restore exceptions | P06 | P08 financial relations, P10 tests and P11/E08 approval |

The exact work and evidence are in WORK-PACKAGES.md, DATA-AND-SECURITY.md and VERIFICATION.md. RSS, remembered reading position and native sharing remain optional suggestions, not accepted package scope.

Each C-ID has exactly one bold owner package above. Supporting packages implement prerequisites; only the owner closes that C-ID after all proof exists. C20 is owned by P07 but cannot be closed until supporting payment/fulfillment P08 passes. Package acceptance and complete contract acceptance are separate states.

User-added owner statistics are implemented in P06/P10 with real DB and Cloudflare Analytics queries. User-added operational monitoring belongs to P10/P11. P12 private personal workspace is BONUS SCOPE, has no C-ID, changes no offer milestone/timeline, and has its own acceptance gate. It must not auto-publish linked content.
