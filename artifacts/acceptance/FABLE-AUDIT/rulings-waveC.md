# Orchestrator rulings on wave C (admin UI, quality, store UI, design, reader, accessibility, soon pages, performance), 2026-10-07

Finder: Opus 5.5 at effort max, one slice each (`find:*` in workflow `wf_804f7d39-d9a`), with the cut-off attempt's partial findings handed over as leads. Verifier: the orchestrator (Claude Fable 5.1), from the finders' quoted evidence and measurements (screenshots and scripts under `work/waveC/`); the two findings against this audit's own rounds were re-read in the migrations. Disposition names the fix round (M2: SQL; F3: functions and admin/store client; D1: public design, reader, performance; T, S, D as before) or the reason nothing was changed.

| Id (duplicates) | Verdict | Sev | Disposition |
|---|---|---|---|
| ADMIN-COMMERCE-01 | confirmed (a follow-up's default «بلا إجراء» lifts the stop that M1b-2 made the latest row decide) | high | F3-3 |
| ADMIN-COMMERCE-04 | confirmed: a defect of this audit's M1a-5 (Moyasar's status 'refunded' also follows a partial refund; the vendor page is quoted) | high | M2-1 (decide by money and 'voided' only) |
| ADMIN-COMMERCE-18 | confirmed: a defect of this audit's M1b-4 (the inferred correction let a stale second «تم الشحن» rewrite a shipment) | medium | M2-2 (explicit `fulfillment_correct`; BAD_TRANSITION restored) + F3-4 |
| ADMIN-COMMERCE-05 | confirmed (a stale view refunds the same money again; the catalog forms have a version check, the refund has none) | medium | M2-3 + F3-2 (`expectedRefunded` → STALE) |
| DSN-PAGES-08 = DSN-HOME plan gap | confirmed (/book hard-codes «قريباً»; P07's «book purchase wiring» was never built; no page links /store) | high for the commerce launch | D1-11 (edition → store product slug, price and link at build time); the nav item «المتجر» is the owner's (needs owner) |
| DSN-PAGES-10 = A11Y-RTL-03 | confirmed by measurement (17/19 photos overflow the stage at 1440) | high | D1-1 |
| A11Y-RTL-01 = DSN-HOME-01 = DSN-PAGES-01 = PERF-15 | confirmed by measurement (342 px header at 320; WCAG 1.4.10) | medium | D1-2 (+ 320 in the visual suite) |
| A11Y-RTL-02 | confirmed (no scroll-padding; WCAG 2.4.11) | medium | D1-3 |
| A11Y-RTL-04 = STORE-UI-14, A11Y-RTL-07/09/10, DSN-PAGES-16, READER-04/08/11 | confirmed (buttons disable themselves under focus; focus falls to body) | medium / low | F3-9, D1-8c |
| ADMIN-CMS-01 | confirmed (one local-copy key per document across tabs) | medium | open: a per-tab key is a careful change to the autosave; recorded with the finder's design and proof recipe; candidate for the P08 close or P10 |
| ADMIN-CMS-02 | confirmed (a never-saved post is listed nowhere) | medium | open (recorded; same area as ADMIN-CMS-01) |
| ADMIN-CMS-04 | confirmed | medium | F3-6a |
| ADMIN-CMS-08 | confirmed (new posts start hidden; publish says success) | medium | F3-6b |
| ADMIN-CMS-09 | confirmed (blank alt publishes; WCAG 1.1.1) | medium | F3-6c |
| DSN-HOME-02 | confirmed by measurement (6+2 at 1920, 5+3 at 1536) | medium | D1-4 |
| DSN-PAGES-05, DSN-PAGES-06 | confirmed (dead token; quotes set like headings) | medium | D1-5 |
| PERF-01, PERF-04, PERF-05, PERF-13 | confirmed by measurement (lazy LCP image; CLS 0.35/0.42 on the money pages; font preloads delay the hero; an opacity entrance delays LCP) | medium | D1-6 |
| PERF-16 = DSN-HOME-15 | confirmed (CLS 0.111 on /passed from the font swap) | medium | D1-7 (metric-matched fallbacks; the numbers are re-measured) |
| PERF-18 = READER-02 | confirmed by measurement (page-flip renders every frame while open) | medium | D1-9 (the loop renders only when dirty; AUDIT-1 S15.2 holds) |
| READER-06 | confirmed in CDP emulation (a scroll that starts on the book turns a page) | medium | D1-10 (release taken from page-flip unless folding; a real device must confirm) |
| READER-10, READER-12 | confirmed | medium | D1-8 |
| QUALITY-04 | confirmed (51 silent 5xx paths; the requestId correlates with nothing) | medium | F3-1 |
| SOON-01 | confirmed (soon after the launch = 200 + noindex on every page; Google's pause guidance quoted) | medium | needs owner (D47's three states; which answer soon gives after the first opening); D: the contract names the choice |
| SOON-02, SOON-03, SOON-04 | confirmed from the contract text and Cloudflare's docs | medium | D: SITE-STATE-CONTRACT.md and the launch sequences (MODE=open step; `open` only in front of Pages; close «الشراء» before a restore or migration) |
| STORE-UI-01 | confirmed (the UI still sells digital ×2; the quote's sentence names 1..20) | medium | F2b-8/-12 (in flight) + M2-4 (`maximum: 1`) + F3-7 (wording) |
| STORE-UI-04 | confirmed (the hold view pays an order the cart no longer matches; `paid` empties the whole cart) | medium | F3-8 |
| ADMIN-COMMERCE-02, -07, -10, -13, -19, -20; ADMIN-CMS-03, -11, -17, -22 | confirmed | low | F3-5, F3-6d |
| ADMIN-COMMERCE-03, -06, -08, -09, -11, -12, -14, -15, -16, -17; ADMIN-CMS-05, -06, -07, -10, -12, -13, -14, -15, -16, -18, -19, -20, -23 | confirmed from the finder's evidence | low | open (recorded with fixes; ADMIN-CMS-19's inline-style injection is sanitised at the renderer? not re-proved: listed for P10's security pass) |
| QUALITY-01, -02, -03, -10, -11, -15, -17, -19 | confirmed | low | F3-10, F3-12, F3-16 |
| QUALITY-06, -07, -08 = STORE-UI-12, -09, -12, -13, -14, -18, -21, -22 to -26 | confirmed | low / info | open (recorded); QUALITY-14 belongs with round S's restore-check if time allows |
| STORE-UI-02, -06, -07, -15, -17 = A11Y-RTL-05 | confirmed | low | D1-12 |
| STORE-UI-03, -05, -08, -09, -10, -11, -13, -16, -18 | confirmed | low | open (recorded; STORE-UI-16 and the two-session plan gap need a design decision) |
| READER-03, -05, -07, -13, -14, -16, -17; READER-15 | confirmed | low | open (recorded); READER-15 doc in D1-8e |
| DSN-PAGES-02, -09, -11 = A11Y-RTL-12, -12 = A11Y-RTL-06 = DSN-HOME-10, -15, -17 = A11Y-RTL-11, -18; DSN-HOME-03, -04, -12, -16, -17, -19, -20, -21, -25, -26, -27; A11Y-RTL-13 | confirmed | low / info | D1-1, D1-2, D1-5, D1-12 |
| DSN-PAGES-03, -04, -07, -13, -14, -19; DSN-HOME-05 to -09, -11, -13, -14, -18, -22, -23, -24; A11Y-RTL-08 (captions: owner), -14 | confirmed | low / info | open (recorded; DSN-HOME-05/-06 need a prepare-media run, I49 (6)) |
| PERF-02, -03, -06, -07, -08, -09, -10, -11, -12, -14, -17 | confirmed | low / info | D1-6e (PERF-10); the rest open (recorded for P10's performance pass; PERF-06/-07 name what check:budgets does not measure) |
| SOON-05, -06, -07, -08 (owner), -09 | confirmed | low | D (contract and README wording); SOON-09 to round S if time allows |
| QUALITY-05, QUALITY-16 | confirmed | low | M2-13 |
| ADMIN-COMMERCE prior-fix: AUDIT-2 X-A11Y-RTL-11 partly holds; STORE-UI/QUALITY: AUDIT-2 STORE-checkout-5 holds in the checkout only; DSN-HOME: P01 round-3 fix 1 not applied to the committed derivatives | confirmed | low | recorded (ADMIN-COMMERCE-16, STORE-UI-12, DSN-HOME-05) |
