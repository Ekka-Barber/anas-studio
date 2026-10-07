# Orchestrator rulings on wave B (tests, supply chain, architecture, plan, docs, prior fixes, vendors), 2026-10-07

Finder: Opus 5.5 at effort max, one slice each (`find:*` in workflow `wf_136a6d2f-6b3`). Verifier: the orchestrator (Claude Fable 5.1). Where the evidence is a quoted document line or a vendor page, the orchestrator checked the quote against the repository text; where it is a code behaviour, the orchestrator read the cited lines before a fix was dispatched. Disposition names the fix round (T: tests and CI; S: supply chain and scripts; M2: a later SQL round; F3: a later functions/client round; D: the documents round) or the reason nothing was changed.

| Id (duplicates) | Verdict | Sev | Disposition |
|---|---|---|---|
| ARCH-09 = SUPPLY-07 = OPS-PRIVACY-01 = VENDOR-PLAT-06 | confirmed (the restore runbook, docs/operations.md:1332-1413, never deploys the functions, re-points the Pages build or moves the Resend endpoint; Supabase's guide lists them as separate steps) | high (a restore that looks finished and is not) | D: the runbook rewritten with the missing steps, in order; OPS-PRIVACY-02 (the ledger replay moved before any secret) folded in |
| SUPPLY-11 | confirmed (the CLI publishes the scratch stack on every interface with default credentials; `docker ps` on this machine shows 0.0.0.0 bindings) | high | S-5a (loopback-bound network, refusal unless every binding is 127.0.0.1) |
| VENDOR-PLAT-04 | confirmed as a vendor fact (Pages answers Range with 200; Safari needs 206); the plan's I33 option "commit the films to Pages" would break the films on Apple devices | high for launch | needs owner (I33 decision: a host that answers 206); recorded in ISSUES and the P10 hosted checks |
| ARCH-01 | confirmed (a build failure after the hook answered is silent; Cloudflare's free 'Deployment failed' notification exists) | medium | D: I34 and P11's hosted setup; the owner creates the notification |
| ARCH-02 = OPS-PRIVACY-09 = PLAN-GAPS 'Launching on Free' | confirmed (ARCHITECTURE.md:55 calls a pause harmless; images, forms, cart and rebuilds need the project) | medium | D (ARCHITECTURE, DECISIONS E07 input, costs, a 'paused project' runbook); needs owner (Pro before launch, or watch the pause mails) |
| ARCH-03 = PLAN-GAPS-01 | confirmed (order_items is variant-only; P09's file list omits every money path a paid booking must change) | medium | D: DATA-AND-SECURITY corrected; a P09 contract named as a plan gap before P09 starts (owner input on bookings) |
| ARCH-13 | confirmed (eleven cron jobs record no run; nothing reads cron.job_run_details) | medium | M2 (an owner/operations function over cron.job_run_details) + F3 (one owner-home line) |
| DOCS-02 = DOCS-03 = DOCS-04 = DOCS-05 = FIX-A1-04 = PLAN-GAPS-13 | confirmed (EXECUTION-STATUS lines 10-12 and 367 describe the state after 11c; 12a and 12b are committed) | medium | D (orchestrator) |
| DOCS-20, DOCS-21 | confirmed | medium | D |
| FIX-A1-09 = FIX-A2-03 = wave A DB-CORE-01 | confirmed | medium | already fixed in M1b-7 and F2b-2 |
| OPS-PRIVACY-02 | confirmed (ledger replay after secrets are live) | medium | D (step order) |
| OPS-PRIVACY-03 = PLAN-GAPS 'rotation runbook' | confirmed (no rotation procedure; vault.create_secret fails on an existing name) | medium | D: a 'Rotating a secret' section |
| OPS-PRIVACY-05 | confirmed (no outage or double-charge procedure; paid attempts are never re-read) | medium | D: the procedure, built on the existing recheck and external-refund actions |
| OPS-PRIVACY-08 = PLAN-GAPS 'PDPL' | confirmed (the data map omits media of people, the seller's own data, gateway logs, staff IPs; no PDPL elements) | medium | D: the rows added; the legal reading is the owner's with E08 (needs owner) |
| OPS-PRIVACY-12 = PLAN-GAPS 'owner access recovery' | confirmed (no hurry-removal or lost-authenticator procedure; a sole owner cannot be revoked) | medium | D: the procedure; the second-owner decision is the owner's |
| OPS-PRIVACY-16 | confirmed (no live proof step; hosted prerequisites missing) | medium | D: the runbook's 'Before live' gains the supervised live purchase and the prerequisites; E02 stays open |
| OPS-PRIVACY-19 | confirmed (orders paid after the last backup are lost; nothing says to reconcile against Moyasar) | medium | D: a restore step; D35's risk statement widened (needs owner for E07) |
| PLAN-GAPS-02 | confirmed from the sorted answers (the children's films' consent is owed) | medium | needs owner; recorded in ISSUES I33 and the E05 row |
| PLAN-GAPS-03 | confirmed (the certificate's speciality against the goods sold is an open eligibility question) | medium | needs owner (E02 input) |
| PLAN-GAPS-04 | confirmed (browser Sentry cannot fit the budget) | medium | D: P10 and D23 wording (decide before P10) |
| PLAN-GAPS-05 | confirmed (P10's hosted proofs need a hosted bootstrap nobody owns) | medium | D: a HOSTED-0 step before P10's hosted checks (needs owner authorisation) |
| PLAN-GAPS-07 | confirmed (the phase gate makes the launch wait for E02, against D34) | medium | D: WORK-PACKAGES wording (which proofs move to the E02 checkpoint) |
| PLAN-GAPS-11 | confirmed vendor/regulatory fact (National Address required by carriers since 2026-01-01) | medium | needs owner (E03: the field and the carrier); recorded as a plan gap; no code without Anas's carrier |
| PLAN-GAPS-12 | confirmed (no public seller disclosure) | medium | needs owner (E08 and an adviser); recorded |
| SUPPLY-01, SUPPLY-05, SUPPLY-10 | confirmed | medium | S-3, S-5b, S-1 |
| TEST-DB-01, TEST-DB-11 | confirmed | medium | T-2, T-3 |
| TEST-DB-02 | confirmed (nothing detects a stale edge runtime) | medium | open: a runtime-vs-tree check would need a probe endpoint; recorded with the exact HANDOFF step to keep (restart before HTTP tests) |
| TEST-E2E-06, TEST-E2E-11 | confirmed | medium | T-16, T-1 |
| TEST-UNIT-05, TEST-UNIT-06 | confirmed | medium | T-9, T-10 |
| VENDOR-PAY-01 | confirmed vendor fact (SADAD on by default in test; unrefundable through the API) | medium | needs owner (keep SADAD off live, or accept out-of-band refunds); D: contract section 2 and the runbook |
| VENDOR-PAY-02 | confirmed (no brake on bounces; Resend pauses at 4% bounce rate) | medium | M2 (a bounce brake on the visitor-triggered tier) |
| VENDOR-PAY-07 | confirmed vendor terms (3 business days to answer a chargeback) | medium | D: the dispute procedure |
| VENDOR-PLAT-01 | confirmed from Cloudflare's limits documentation (per-query time range by plan) | medium | F3 (read maxDuration once and split the window) |
| SUPPLY-02 = FIX-A1-05, SUPPLY-04, SUPPLY-06, SUPPLY-08, SUPPLY-09, SUPPLY-03 = VENDOR-PLAT-07 | confirmed | low | S-7, open (SUPPLY-04: normalising a passphrase could lock an existing backup), S-4, S-5c, S-5d, S-2 |
| TEST-DB-03, -06, -07, -08, -10 | confirmed | low | T-4, T-5, T-8, T-6, T-7 |
| TEST-DB-04 = TEST-UNIT-12, TEST-DB-05, TEST-DB-09 | confirmed | low | open (recorded with the finders' tests to add) |
| TEST-UNIT-01, -03, -08, -09, -11, -15 | confirmed | low | T-11, T-12, T-13, T-13, T-14, T-15 |
| TEST-UNIT-02, -04, -07, -10, -13, -14 | confirmed | low | open (recorded) |
| TEST-E2E-02, -03, -04, -07, -08, -09, -13, -16, -01 | confirmed | low / info | open (recorded; axe and the extra widths belong to P10) |
| TEST-E2E-05, -10, -12, -14, -15 | confirmed | low | T-18, T-17, T-18, T-18, D |
| FIX-A1-01, -02, -03, -06, -07, -08 | confirmed | low / info | S-8 (01, 03), F3 (02), D (06, 07, 08) |
| FIX-A2-01, -02, -04 | confirmed | low | open (01: the soon designs' height budget, cosmetic), M2 (04: the sweep's guard on the effective state; 02 recorded) |
| PLAN-GAPS-06, -08, -09, -10, -14, -15 | confirmed | low | D |
| DOCS-01, -06 to -19, -22 to -45 | confirmed staleness | low / info | D (every one with the finder's replacement text) |
| ARCH-04, -05, -06 = VENDOR-PLAT-08, -07, -08, -10, -12, -14, -11 | confirmed | low / info | D (04, 05, 06, 07, 08, 10); M2 (12: alt-text edits request a rebuild); open (14: staff tokens in localStorage, a P10 CSP question; 11 observation) |
| OPS-PRIVACY-04, -06, -07, -10, -11, -13, -14, -15, -17, -18, -20 | confirmed | low | D (04, 06, 10, 11, 13, 14, 15, 17, 18); M2 (20: sandbox orders erasable); open (07) |
| VENDOR-PAY-03, -04, -05, -06, -08, -09 | confirmed | low / info | M2 (03: an undetermined bounce does not suppress for good; 04: replay of an accepted-then-failed mail), D (05, 06), F3 (08: refund timing sentence), recorded (09) |
| VENDOR-PLAT-02, -03, -05 | confirmed vendor facts | low | D (02, 03: the plan's wording of what verify_jwt and secure_password_change do), S-6 (05) |
