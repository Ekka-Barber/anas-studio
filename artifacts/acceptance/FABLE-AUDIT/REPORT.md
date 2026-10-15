# FABLE-AUDIT: the report (2026-10-05 to 2026-10-15)

**Asked by the owner (2026-10-05):** an independent deep audit of everything built at `3a30a91` (P08 through round 12b), then fix rounds with red and green proofs. After the audit's session died (2026-10-07), the owner moved the rest of the work to a cloud session (D48) and ruled that `main` moves only "after independent deep audit and verfication done by another agent better than you like FABLE", and on his word.

**Scope.** The audit read `main` at `3a30a91`. The fixes run from there to `b3fa932`, the last commit that changed code; `main` holds it, and this report, since 2026-10-14. This report closes no E-gate and no owner decision.

**In short.** Thirty-three finders wrote 508 entries, none critical; the orchestrator rated twelve findings high. Ten of the twelve are fixed or written into the plan. One waits for a round with a browser (the scenes lightbox's fit, DSN-PAGES-10), and one waits for the owner (a host for the films that answers Range requests with 206, VENDOR-PLAT-04). The audit's own fix rounds made defects too: its third wave traced six to them, five now fixed (one except for the wording of the `policies_reset` alert, ISSUES I55 (3)) and one recorded open, and two more were caught between rounds and fixed (section 6). The deep audit before `main` found no critical or high finding; its fixes were verified. CI is green on `main`. On the owner's machine (the local close, 2026-10-14) the after-battery's database and e2e half ran green on the code CI verified: `test:db` 874 of 874 with the eight HTTP files, and 512 e2e tests with none failed, the admin's eight suites and the deep audit's two cases among them (section 4). The backup with a paid file worked there, but its restore rehearsal stops at its own loopback guard on Docker Desktop, safely, before restoring anything (ISSUES I56). Five things wait:
- the restore rehearsal's fix (ISSUES I56), a round of its own on the owner's word;
- the owner's review of the admin redesign (its suites are green);
- the round with a browser, for round D1's visual items and the visual pass's findings (ISSUES I55 (2));
- the owner's decisions;
- 154 entries recorded open, almost all low.

## 1. How it ran

| # | When | What | Who | Record |
|---|---|---|---|---|
| 1 | 2026-10-05T19:20Z to 2026-10-07T00:27Z | The before-battery at `3a30a91` | the audit's orchestrator, Claude Fable 5.1 | `before/` |
| 2 | 2026-10-05 and 10-06 | Three attempts lost to the usage limits and an app exit: about 11M sub-agent tokens; what they persisted went to waves A and B as leads (`work/leads/`, 104 leads) | — | `work/report-notes.md` |
| 3 | 2026-10-07 | Three waves of finders, one slice each, with no verifier agents (the owner's rule of 2026-10-06): A, 11 money and security slices; B, 12 slices on the tests, the supply chain, the architecture, the plan, the documents, earlier audits' fixes and the vendors; C, 10 slices on the admin, code quality, the store, the design, the reader, accessibility, the soon pages and performance | 33 Opus 5.5 finders at effort max | `work/wave{A,B,C}/digest.md`, `findings.json` |
| 4 | 2026-10-07 | Every finding ruled: verdict, severity, disposition (four were missed, section 2.4) | the orchestrator | `rulings-wave{A,B,C}.md` |
| 5 | 2026-10-07 | Fix rounds M1a, M1b, F1, F2a, F2b, T, M2 and a one-line fix of the orchestrator's (section 3) | Opus 5.5 workers at effort max; the orchestrator read every diff | `work/briefs/`, `HANDOFF-2026-10-07.md` section 4 |
| 6 | 2026-10-07, 15:30Z | The session died at the account's weekly limit, at the pause after M2 | — | `HANDOFF-2026-10-07.md` section 1 |
| 7 | 2026-10-07, evening | The work committed to `main` and handed over; the first CI run failed, the second passed | a packaging agent at the owner's request, which wrote no product code | `HANDOFF-2026-10-07.md` and its addendum |
| 8 | 2026-10-07 to 10-13 | The cloud continuation (D48): rounds F3, D1 (its non-visual part), S, the admin redesign (D49), D and the plan files | orchestrator Opus 5.5 at effort max; workers Sonnet 5.5 at effort max, a fresh one per round; auditors Opus 5.5 at effort max | `cloud/`, `artifacts/acceptance/ADMIN-DESIGN/README.md` |
| 9 | 2026-10-08 | The ratification of `e800fc5` (after F3 and D1, before S) on the owner's machine: the database suite, the unit suite, the build checks and seven Playwright specs, all green; pushed to origin's branch `cloud-ratify` with a resume note for this session | ZCode (GLM-5.3), the owner's local agent, at his dispatch | `ratify-e800fc5/RECORD.md`, `CLOUD-RESUME-2026-10-08.md` |
| 10 | 2026-10-13 | The deep audit before `main`, then a verification of its fixes | four Fable 5.1 auditors at effort max, then a fifth | `cloud/DEEP-AUDIT.md` |
| 11 | 2026-10-14 | `main` fast-forwarded from `d4fa953` to `b3fa932` on the owner's word; the after-battery's CI part; the ratification merged into the branch (`30db0f3`) | the orchestrator | `cloud/DEEP-AUDIT.md`, `after/` |
| 12 | 2026-10-14 to 10-15 | The local close on the owner's machine at `5107afa`: the stack-free checks, the database and e2e batteries from fresh resets, the backup rehearsal with a paid file, round S's other proofs, the visual pass, the records | the orchestrator, Claude Opus 5.5 at effort max in Claude Desktop; through the Workflow tool, a Sonnet 5.5 capture worker and Opus 5.5 auditors, reviewers and verifiers, all at effort max | `after/RECORD.md` |

The ratification ran on the owner's machine at `e800fc5` on 2026-10-08: `test:db` 874 of 874 in 31 files, the eight HTTP files included; unit 2,536 of 2,536, the content drift check included; lint, typecheck, the build, `check:export`, and `check:budgets` at 149.4 KiB; and seven Playwright specs, the six F3 and D1 had changed and `reader.spec.ts` (D1 changed the reader's end buttons), 185 passed and none failed. Its record and its resume note sat on origin's branch `cloud-ratify`, which this session did not read until the check of this report found it on 2026-10-14; they are merged into the branch now (`30db0f3`), after an audit of the record against its logs. The code changed after `e800fc5` (S, the admin redesign, D and the deep audit's fixes), so the after-battery runs everything again.

What the finders and the fix workers cost (the workflow tool's own count of sub-agent tokens): wave A 6.77M, wave B 8.00M, wave C 5.68M (its second run; the cut-off first run was not counted); M1a 0.53M, M1b 0.60M, F1's resumed run 0.39M, F2a 0.46M, F2b 0.60M (`work/report-notes.md`). The cloud continuation did not count its tokens.

## 2. The findings

### 2.1 In numbers

| Wave | Slices | Entries | High | Medium | Low | Info | Rows in the rulings |
|---|---|---|---|---|---|---|---|
| A | 11 | 141 | 4 | 29 | 93 | 15 | 49 |
| B | 12 | 177 | 3 | 43 | 121 | 10 | 48 |
| C | 10 | 190 | 4 | 33 | 141 | 12 | 39 |
| All | 33 | 508 | 11 | 105 | 355 | 37 | 136 |

The severity here is the finder's; the orchestrator's own rating is in the rulings, row by row, and differs for some. A defect that two finders reported counts twice here; the rulings join the two ids with "=". Each digest also holds the finders' plan gaps (54, 76 and 20 entries, many repeated across slices), their checks of earlier audits' fixes, and the vendor claims they found false or could not verify.

### 2.2 Where each entry stands on 2026-10-14

| Status | Entries | Finder's severity | Where |
|---|---|---|---|
| Handled (code, tests, documents or the plan): by the round its ruling names, as that round's record shows, or by the round section 2.4 names (this one for DOCS-30) | 286 | 9 high, 70 medium, 196 low, 11 info | the rulings; section 3 |
| Held for a round with a browser (round D1's visual items, the owner's split of 2026-10-08) | 38 | 1 high, 17 medium, 19 low, 1 info | Appendix A; ISSUES I55 (2) |
| Recorded open, for P08's close, a residuals round or P10 | 154 | 6 medium, 136 low, 12 info | Appendix B; each one's evidence and proposed fix are in `work/wave*/digest.md`, under its id |
| Observations: nothing to change | 13 | 13 info | Appendix C |
| The owner's decision | 15 | 1 high, 11 medium, 3 low | Appendix D; `PLANS/DECISIONS.md`, "Owner decisions FABLE-AUDIT and its continuation leave open" |
| Skipped on the owner's word | 1 | 1 medium | SUPPLY-01: S-3 (2026-10-08, "Skip S-3") |
| Not a defect on a second look | 1 | 1 low | VENDOR-PLAT-05: round S read the Supabase CLI's own source, which shows the finding's premise false for this code (`cloud/S.md`, S-6) |

Some rows of the first three statuses also leave a decision to the owner. Examples: the Resend plan beside DB-POST-04's fix, and «المتجر» in the navigation beside DSN-PAGES-08's fix. Those decisions are in the same DECISIONS list.

### 2.3 The twelve findings the orchestrator rated high

| Finding | What it was | Where it stands |
|---|---|---|
| CLIENT-SEC-01 | No CAPTCHA on the sign-in code request | F2a-1: Turnstile, locally; the hosted switch is a P11 step (ISSUES I28) |
| CLIENT-SEC-06 | A six-digit code with 30 tries per five minutes per IP and no per-account lockout | F2a-2: an eight-digit code; the hosted setting at P11 (I28) |
| EF-ACCESS-03 | The functions allow one origin, and the plan put www on the same Pages project with no redirect | The plan: at P11 www is only a redirect to the apex (I32) |
| EF-ADMIN-01 | The functions read only the legacy service key | F1-1: the secret keys first, the legacy key as the fallback |
| DB-OPS-02 = P08-CKPT-10 | «إيقاف الشحن» stopped nothing, so goods could ship after a chargeback | M1b-2; then F3-3, for a follow-up that lifted the stop (ADMIN-COMMERCE-01) |
| ARCH-09 = SUPPLY-07 = OPS-PRIVACY-01 = VENDOR-PLAT-06 | The restore runbook never redeployed the functions, re-pointed the build or moved the mail endpoint | Round D rewrote it in 21 steps; the deep audit moved the ledger's revokes to step 5 (FD-D-01) |
| SUPPLY-11 | The restore rehearsal's scratch stack listened on every interface with default keys | S-5a: a loopback-only network, and the rehearsal refuses anything else; on Docker Desktop the network option is not applied, so there the rehearsal refuses before restoring anything (the local close, 2026-10-14; ISSUES I56) |
| VENDOR-PLAT-04 | Pages answers a Range request with 200, and Safari needs 206 to play the films | The owner's decision (I33) |
| ADMIN-COMMERCE-01 | A dispute follow-up's default decision lifted the stop | F3-3 |
| ADMIN-COMMERCE-04 | M1a-5 read Moyasar's `refunded` status as a full reversal, though it also follows a partial refund (a defect of this audit's own round) | M2-1 |
| DSN-PAGES-08 | /book never led to the store | D1-11: an edition names its store variant by SKU and shows that variant's price; «المتجر» in the navigation is the owner's |
| DSN-PAGES-10 = A11Y-RTL-03 | The scenes lightbox does not fit the photo (17 of 19 overflow the stage at 1440) | Held: the fit waits for the round with a browser; D1-1's caption part is done |

### 2.4 Corrections made while writing this report

Each of these was checked at its source on 2026-10-14.

- **Four wave C entries have no row in `rulings-waveC.md`.**
  - ADMIN-CMS-21 (info) is closed by F3-12 and F3a's A2. A failed ban now says the member's state did not change. SESSIONS_FAILED, ROLLBACK_FAILED and BAN_INCOMPLETE offer «حاول مرة أخرى» on the row (`supabase/functions/staff-admin/index.ts:172-179`, `src/components/admin/TeamView.tsx:32-42`).
  - READER-01 (info) is the defect CLIENT-SEC-13 also reported, fixed by F2a-8: nothing under `src/` imports the book's source manifest any more (`src/lib/book-preview.ts:14-21`).
  - READER-09 (low) was done in D1-8 (d) (`cloud/D1.md`).
  - QUALITY-20 (low) is ADMIN-CMS-20's defect, which `rulings-waveC.md` rules open; it is confirmed again here. The security page names only the team actions as needing the authenticator, while the admin function also asks for it before refunds, disputes, the commerce settings, the policies' approval, the checkout switch and an order link sent to another address. It is in ISSUES I55 (9) and Appendix B.
- **QUALITY-05**, ruled with QUALITY-16 under M2-13, is no entry of the final wave. Its finder drafted a QUALITY-05 (the cart fingerprint's drift) and withdrew it as a duplicate of CONTRACT-12. The cut-off first attempt's lead QUALITY-05 (`work/waveC-partials/QUALITY/findings.jsonl`), an order view that does not read the order again after a lost reply, became the final wave's QUALITY-17 (`work/waveC/digest.md:1291`), fixed by F3-16 (d). Neither is an M2-13 matter.
- **DB-COMMERCE-05 and DB-CORE-03**, in wave A's list of open lows, are one race (AUDIT-2 GAP-G5-3, the race of ISSUES I48 (1)). M2-8 fixed it with DB-CORE-03's own proposed fix: `policies_reset_approval` locks the settings row first (`supabase/migrations/20261007120000_fable_audit_second_pass.sql:1121-1123`).
- **STORE-UI-05**, in wave C's list of open lows, is wave A's CONTRACT-08 (its record: "planned as F2b-10 (not applied in today's tree)"). F2b-10 applied it: the return page releases the stored order and its key for review, needs_resolution and refunded (`returnRelease`, `src/lib/cart.ts:502-506`), and the hold view's received state links there. Left: the hold view says «وصلتنا دفعة هذا الطلب.» for a refunded order until that link is followed.
- **EF-MONEY-07, -13 and -14** were ruled "docs: listed under the E02 items; emulator left as it is", and round D listed them (`docs/payments-runbook.md:157-159`, `b46f174`): handled, not observations. **FIX-A2-02 and VENDOR-PAY-09** were ruled confirmed and recorded, each with a fix to make: recorded open (Appendix B), not observations.
- **DB-OPS-01 (F1-12)** was skipped in F1, as its brief allowed, and done in F3-13.
- **EF-ACCESS-08 (F1-15)** was not done. Its brief made it conditional, and the orchestrator deferred it to P11's hosted setup, because the 32-character check would stop the owner's local functions (`cloud/S.md`). It is in Appendix B.
- **Rulings changed later, or never carried out.**
  - SUPPLY-01 (S-3): skipped on the owner's word.
  - VENDOR-PLAT-05 (S-6): reverted, because its premise is false.
  - VENDOR-PAY-08 (F3-16 (g)): left to the owner, because Moyasar's pages disagree and Anas words the sentence (I55 (7)).
  - SOON-09: not taken by round S, recorded in I55 (5); QUALITY-14 was not taken by round S either.
  - PLAN-GAPS-05 and PLAN-GAPS-07, ruled to round D: left to the owner by the plan-files round (DECISIONS, "Plan changes the audit proposes"); Appendix D.
  - PLAN-GAPS-04, ruled to round D: written into "Next work" item 9 as a decision before P10; P10's file list and D23 are unchanged; Appendix B.
  - VENDOR-PLAT-03, ARCH-05 and CLIENT-SEC-02's correction of P03's proof, ruled to round D or the documents: no brief carried them and they are not done (I55 (4) holds VENDOR-PLAT-03); Appendix B.
  - DOCS-30, ruled to round D, whose brief left the plan files to the orchestrator, and missed by the plan-files round: done in this round. The P08 row of `PLANS/EXECUTION-STATUS.md` now records that `agent/p08` reached `main` at `3a30a91` and was deleted after the pause, and that the next P08 session cuts it again from `main`.
- **VENDOR-PAY-01** is counted with the owner's decisions, as DB-COMMERCE-02 is: round D did its ruling's document part (the contract's section 2 and the runbook), and SADAD on the live account is the owner's (Appendix D; I54 (3)).
- **SOON-08** (Workers Paid for a launch period) is the owner's; it is in the DECISIONS list.
- **DSN-HOME-26**, the unused `.splitCenter`, is listed among round D1's held items in `cloud/D1.md` (2026-10-08), but round S's S-8 deleted it afterwards, as FIX-A1-01 asked (`4543c99`, 2026-10-13).
- **DSN-PAGES-10's ruling** names D1-1, which did only its caption part.

### 2.5 Plan gaps, earlier fixes, vendor claims

- **Plan gaps.** Each digest's "Plan gaps" section (54, 76 and 20 entries) is their record. Round D, the plan-files round and P11's launch lines took many of them. Others are in no plan file yet; from wave C alone: an owner control to rebuild the site after a failed build, re-pointing buyers to a replaced paid file, one buyer's two checkout sessions, the visual pass at 1366, 1536 and 1920 wide, and Lighthouse's form factor (`work/waveC/digest.md:1171-1225`). They wait for the package each entry names. What only the owner can settle is in the DECISIONS list and in ISSUES I54: the National Address and the carrier, the seller's disclosure, SADAD on the live account, and a usage alert with a flood response.
- **Earlier audits' fixes.** Each digest lists the earlier fixes its finders found not holding (wave A 7, wave B 22, wave C 15: the sections "Prior-fix checks not holding"). Wave B's FIX-A1 and FIX-A2 slices are ruled in `rulings-waveB.md`. `rulings-waveC.md` rules three of wave C's (ADMIN-COMMERCE-16, STORE-UI-12, DSN-HOME-05), recorded open in Appendix B. The others are entries of their own (for example ADMIN-CMS-05, ADMIN-CMS-13, STORE-UI-03, STORE-UI-11, DSN-HOME-14) or were fixed in F3 (QUALITY-01, QUALITY-03).
- **Vendor facts.** Every fix that rests on one names its date in its record. This container's network refuses developers.cloudflare.com, moyasar.com and docs.moyasar.com, so the continuation worked from the audit's recorded evidence and said where a field name stayed unconfirmed (`cloud/F3.md`).

## 3. The fix rounds and their proof

On `main` since the packaging (`840d92d` holds the rounds; CI green on `d4fa953`, run 37680053882):

| Round | What | Proof |
|---|---|---|
| M1a | The payments SQL (`20261007100000_fable_audit_payments.sql`) and `payments.ts` | 255 integration and 196 unit tests green on the files it touched |
| M1b | The operations SQL (`20261007110000_fable_audit_operations.sql`) | 372 integration tests in 10 files |
| F1 | The Edge Functions: 17 items, of which F1-12 and F1-15 were skipped under their briefs' conditions (section 2.4) | 652 unit and 99 integration tests on the files it touched; the first `deno check` of its edits ran in CI, green |
| F2a | Sign-in hardening: Turnstile on the code request, the eight-digit code, PKCE, HSTS | 280 unit tests in 23 files, the build, `check:export`, `auth.spec` |
| F2b | The admin's commerce screens and the store client | 593 unit tests in 11 files, `orders-admin.spec` 52 of 52 |
| T | Tests and CI: CI runs the database invariants | 20 items with red proofs; a CI-like local run, 692 of 693 (one clock flake, fixed in M2) |
| M2 | The second SQL pass (`20261007120000_fable_audit_second_pass.sql`): 16 items, three of them defects of M1a and M1b (ADMIN-COMMERCE-04 and -18 in M2-1 and M2-2; the new alert kinds' order number, QUALITY-16, in M2-13) | 489 of 489 integration tests in 14 files on a fresh reset |
| The orchestrator's one line | The product page passes `digital` to its variant action | lint and typecheck |
| The packaging | The evidence (`81efe8d`), the handoff and D48 (`073c672`), CI's demo seed (`8edca59`), CI's addendum (`d4fa953`) | The first CI run failed: CI never seeded the demo catalog that M2-8's test reads (run 37678228356). `8edca59` seeds it, as the battery always did, and the next run passed (37679295474) |

The cloud continuation, on `claude/amazing-planck-qv3f7a`, then on `main` from 2026-10-14. Every worker diff was audited by Opus 5.5 at effort max. In rounds F3a, D1, S, the admin redesign and D the orchestrator's own fixes were checked again by a fresh auditor, and fixes taken from that last check's own text were not audited again; each record says so. F3-4 and F3b's fixes went in on the orchestrator's own checks (`cloud/F3.md`), and the deep audit's slices A and B read them later. The owner's machine ran the database suite and the specs F3 and D1 had changed at `e800fc5`, all green (section 1). CI is green on every run that finished; two runs were cancelled by the next push, whose run covers their tree (`after/ci-runs.txt`).

| Round | What | Audits and proof | Commits (CI runs) |
|---|---|---|---|
| F3-4 | «تصحيح بيانات الشحن» calls `fulfillment_correct`, which M2 had added and nothing called | Unit tests | `60b6aff` (37690412621) |
| F3a | The functions and money: 5xx log lines, `expectedRefunded` and STALE, the read-only recheck, Cloudflare's query window, staff-admin's rollbacks | Audit A1 to A9 (two majors), re-audit R1 to R5; the contact notice's cleaning proven over every Unicode scalar value | `ddbf92b` (37698313006), `913b3af` (37700513202) |
| F3b | The admin and store screens: the dispute follow-up, the content editor, the hold view against the cart, focusable busy buttons, sign-in errors, HTTPS links only, failing scheduled jobs on the owner home | Audit B1 to B6 | `16397e5` (37706544382) |
| D1, its non-visual part | The public site's logic, accessibility, content and caching; the visual items held (the owner's split) | Audit A1 to A11 (one major), re-audit R1 to R6; the re-auditor checked the reader's stall clock with its own fake-timer tests | `df642fe` brief (37716782586), `79a1e9c` (cancelled; covered by 37722653200) |
| D49, D50 | The plan of the admin redesign and of «لوحة المشاريع» | The plan's own checks | `66c5744` (37722653200) |
| S | The supply chain (pnpm 10.34.6, Next.js 16.3.8, Sass dropped, CI's audit gate at level high), the restore rehearsal's safety, `.gitattributes`, the graft helpers | Audit S-A1 to S-A8, re-audit S-R1 to S-R3, focused audit S-F1 to S-F3; every new test killed its mutants (15 in the fix round, 21 in the re-audit) | `e800fc5` brief (37723662461), `4543c99` (38399336312), `107054c` (38406727481) |
| The admin redesign (D49) | Every admin screen in direction B «أنساق»; what each screen does unchanged | Four audits (AD-A1 to AD-A12, AD-R1 to AD-R6, AD-F1 to AD-F8, AD-G1 to AD-G3); renders from 320 to 1440 with mock data | `e8072e5` (38425748094), `bc9c743` (38441417553), `873a479` (38452892063), `e5e9aef` (cancelled; covered by 38454672657) |
| D | The operations documents and the P08 contract | Audit D-A1 to D-A6 (one major) and N1 to N5, a focused check D-F1 to D-F9 | `4001ee7` brief (38454672657), `b46f174` (38468642741) |
| The plan files | EXECUTION-STATUS, ISSUES, HANDOFF, DECISIONS (D48 formalized; the owner's open decisions), P11's launch lines | Audit PF-A1 to PF-A12 (two majors), PF-N1, PF-N2 | `264360e` (38476067045) |
| The deep audit's fixes | The checkout after a lost reply and a corrected address, the owner home's overdue count, the rehearsal's pre-clean pinned by a test, the restore's revokes at step 5, the gate's `open`, the restore's upsert, the records | Four Fable 5.1 slices: no critical or high; four medium, three low and one info fixed; a fifth Fable 5.1 verified the fixes, and its six findings (none above low) were fixed; mutants (`cloud/DEEP-AUDIT.md`) | `b3fa932` (38483042049; on `main` 38548605552) |
| The records | `main`'s move and the after-battery's CI part | — | `8d390b7` (38550077324) |

## 4. The battery, before and after

Before: `3a30a91` on the owner's machine, 2026-10-05T19:20Z to 2026-10-07T00:27Z, the unit run while 33 finders were starting and the stack and e2e runs while wave A's finders ran (`before/summary*.txt`). Ratified: `e800fc5` on the owner's machine, 2026-10-08 (`ratify-e800fc5/`). After: `b3fa932`, 2026-10-14, the stack-free checks in the cloud container (`after/summary.txt`) and CI on `main` (`after/summary-ci.txt`). After, the owner's machine: `5107afa` (no product code, test or migration changed since `b3fa932`), 2026-10-14, the local close on a quiet machine from fresh resets on the owner's word (`after/RECORD.md`; `after/summary-local.txt`, `summary-db.txt`, `summary-e2e.txt`).

| Check | Before | Ratified | After | After, the owner's machine |
|---|---|---|---|---|
| lint, typecheck | 0 | 0 | 0, here and in CI | 0 |
| Unit tests | Exit 1: 6 timeouts of 2,213 tests under the load of 33 starting agents (restore-check five, reader-mapping one; both files pass alone) | 2,536 of 2,536 in 69 files, the content drift check included | 2,587 passed, 1 skipped (the content check that needs the local book assets), here and in CI | 2,562 passed and 29 skipped in 70 files: the skips are the two suites that need a POSIX shell (`graft-helpers.test.ts:44`, 8; `restore-check.test.ts:281`, 21); the content drift check and the two link suites, through real junctions, ran |
| `check:frozen`, `check:copy` | 0 (50 files; 232 files) | not run | 0 (50; 232) | 0 (50; 232); `PLANS/verify-plan.ps1` PASS |
| The Deno check of the ten functions | CI only, green | CI only, green | 0, here and in CI | CI only |
| `pnpm audit --prod` | not yet a gate | red, as expected before round S: 1 critical, 4 high | CI's gate at level high: no known vulnerabilities | CI's gate |
| The migrations from scratch | 27, by `supabase db reset` | 30, by `supabase db reset` | 30, by every CI run | 30, by `supabase db reset`, twice |
| The database tests | `test:db`: 31 files, 814 of 814 | `test:db`: 31 files, 874 of 874, the eight HTTP files included | CI: the 23 files that need no Edge Function, 712 of 712; the other eight wait for the owner's machine | `test:db`: 31 files, 874 of 874, the eight HTTP files included |
| Build and `check:export` | 0; 59 required files, 372 text files, no secret | 0; 59, 377, no secret | 0; 59, 377, no secret | 0; 59, 377, no secret |
| `check:budgets` | largest 148.9 KiB of 150 | largest 149.4 KiB | largest 149.7 KiB (`checkout.html`): 0.3 KiB left (ISSUES I49 (5), I50 (2)) | largest 149.7 KiB (`checkout.html`) |
| e2e | Batch 1, 170 of 170. Batch 2, 7 failed and 302 passed: one `store-admin` step timed out under load and the tests after it failed with it. `orders.spec`, 12 passed and 8 not run at its 15-minute limit. All on a loaded machine | Seven specs, the six F3 and D1 had changed and `reader.spec.ts`: 185 passed, none failed (`orders.spec` in 6.2 minutes) | Not run here: the owner's machine | All 17 spec files: 512 passed, none failed, skipped or flaky (batch 1, 181; batch 2, 311; `orders.spec`, 20 in 6.4 minutes) |

**What ran on the owner's machine, and what stays** (`after/RECORD.md`):
- `work/scripts/battery-db.sh after` and `work/scripts/battery-e2e.sh after`, from fresh resets on the owner's word: green, as above.
- The cases the rounds wrote, green again after the later rounds: F3's (`orders-money.spec.ts`, `orders-admin.spec.ts`, `cart-checkout.spec.ts`, `cms.spec.ts`, and `tests/integration/refunds-http.test.ts`) and D1's (`no-js.spec.ts`, `cart-checkout.spec.ts`, `orders.spec.ts`); the deep audit's two cases (`cart-checkout.spec.ts:900` and `:919`), run for the first time and passed; and the admin's eight suites (186 tests) against the redesigned admin (D49).
- The backup rehearsal with a paid file: `pnpm backup --local` worked; `pnpm restore-check` refused before restoring anything, because Docker Desktop does not apply the loopback option the scratch stack rests on (adjudicated by two Opus auditors as a product defect; ISSUES I56, recorded on the owner's word "Record it, fix later (Recommended)"). Round S's other two proofs are green: a real junction refused by both scripts, and graft at 0.21.1. Ctrl+C and a closed console during a rehearsal stay the owner's to try (I53 (3)).
- The visual pass of every screen F3 and D1 changed (`after/visual/visual-pass.md`): 62 screenshots, 84 findings, none high, 32 defects and 4 states to capture confirmed against their images, for the round with a browser (ISSUES I55 (2)); none fixed here.

## 5. What stays open, and where

- **The owner's machine:** the after-battery ran there green except the restore rehearsal (section 4, ISSUES I55 (1)). What stays is the restore rehearsal (ISSUES I56 and I53 (3)), the Ctrl+C and closed-console check of a rehearsal, and a tap and a mouse click on the admin's strip on his own devices (I55 (6)).
- **The round with a browser:** Appendix A, 38 entries with one high (DSN-PAGES-10), ISSUES I55 (2). Round D1's held items:
  - D1-1: the lightbox's fit;
  - D1-2: the 320px header, and the header without JavaScript;
  - D1-3: the scroll padding under the sticky header;
  - D1-4: the home doors' grid;
  - D1-5: the journal's title size, its quotes, bold in Serif Display, and each block's direction;
  - D1-6 (b) to (d) and D1-7: the money pages' layout shift, the font preloads, the tagline's entrance, the fallback faces;
  - D1-8 (a) and (b), D1-9, D1-10: the reader's full-screen centring, reading order, idle loop and touch release;
  - D1-12: ten small public defects;
  - and the findings of the visual pass of every screen F3 and D1 changed, made on the owner's machine on 2026-10-14 and 10-15, 23:15Z to 00:45Z (`after/visual/visual-pass.md`: 32 defects and 4 states to capture, none high, and 41 nits).
- **Recorded open:** Appendix B, 154 entries. Almost all are low. The six medium ones are EF-MONEY-12 (with E02), TEST-DB-02 (a stale edge runtime goes unnoticed), ADMIN-CMS-01 and ADMIN-CMS-02 (the editor's local copy across tabs; a post never saved), CLIENT-SEC-02 (the Auth API still tells a staff address from any other, against P03's proof) and PLAN-GAPS-04 (browser Sentry against the public budget, to settle before P10). "Next work" item 5 routes them. They are the material for P08's close, a residuals round and P10's passes (security, accessibility, performance).
- **The continuation's follow-ups:** ISSUES I53 and I55 (3) to (9).
- **The admin redesign:** the owner's marks on its private review page (none on 2026-10-15); its admin suites ran green on his machine on 2026-10-14 (section 4); a tap and a mouse click on its strip on his own devices (I55 (6)).
- **The owner's decisions:** `PLANS/DECISIONS.md`, "Owner decisions FABLE-AUDIT and its continuation leave open"; Appendix D.
- **The gates:**
  - every gate (E01 to E05, E07 to E11) stays open, those FABLE-AUDIT touched included (E02, E03, E05, E07, E08);
  - nothing in FABLE-AUDIT closes one;
  - nothing Moyasar moved after D48 (3).
- **The lock:** the cloud continuation released its lock on 2026-10-14, after pushing the local close's prompt (`LOCAL-CLOSE-2026-10-14.md`). On the owner's machine the local close released the lock paused on 2026-10-07 on his delegation (his answer: "you decide , do the best"), with its recovery recorded in the new lock, took its own (2026-10-14T17:03:43Z) and releases it once its last record is written (`after/RECORD.md`).

## 6. Incidents and lessons

- **Usage limits.**
  - What was lost:
    - three attempts, about 11M tokens;
    - the audit's session itself, at the pause after M2;
    - the first audit of round S (2026-10-08), run again on 2026-10-13.
  - What carried the work across each loss:
    - partial results persisted;
    - one wave at a time;
    - the state written before every pause. It let the packaging agent and the cloud session take over without guessing.
- **The owner's machine.**
  - Another project's Supabase stack held the local ports. Its containers were stopped for the battery and started again (`before/paused-containers.txt`).
  - The local stack binds every service to every address, the CLI's default. The restore rehearsal's scratch stack is meant to be loopback-only since S-5a, through a Docker network option, but on the owner's machine Docker Desktop does not apply that option, so the rehearsal refuses there before restoring anything (the local close, 2026-10-14; ISSUES I56).
  - A process listing printed part of a Supabase personal access token that an MCP server on the owner's machine receives on its command line. The value is outside the repository and recorded nowhere here, but any process on that machine can read it and part of it went into the session's output: the owner should revoke and reissue the token in the Supabase dashboard, and give it to the MCP server through an environment variable or its configuration, not its command line.
  - In the local close (2026-10-14), while looking for the source of a stray empty file, a `sed` meant to hide values printed a part of the owner's global Claude settings into the session's output with two credentials unmasked: that MCP server's Supabase token and a Context7 API key. Nothing reached the repository, a log or a commit. The owner was told at once to revoke and reissue both. Print key names only, never a settings file through a mask.
  - The F1-resume worker's search printed the local placeholder pepper, a fixed development string and not a secret.
- **The audit's own mistakes.**
  - F2a's brief widened the rich-text link rule to `http:` and `mailto:`, against the plan; F3-11 restored HTTPS only.
  - Wave C traced six defects to the audit's own rounds:
    - M1b-2's latest-row rule let a dispute follow-up's default decision lift a stop (ADMIN-COMMERCE-01): fixed in F3-3;
    - M1a-5 read Moyasar's `refunded` status as a full reversal (ADMIN-COMMERCE-04): fixed in M2-1;
    - M1b-4 inferred a shipping correction, so a stale second «تم الشحن» could rewrite a shipment (ADMIN-COMMERCE-18): fixed in M2-2 and F3-4;
    - F1-9's rollback left the BAN_FAILED sentence saying the state had changed (QUALITY-01 = ADMIN-CMS-21): fixed in F3-12;
    - the alert kinds M1a and M1b added reached the owner without their order number (QUALITY-16): fixed in M2-13, except that `policies_reset` still has no wording of its own, nor has `confirm_mail_braked`, a kind M2 itself added (ISSUES I55 (3));
    - M1a-3 put the attempts the job parks as MODE_CHANGED (a parking P08 built) on «المطابقة» and into «تحتاج مطابقة», and after the switch to live nothing clears them, so they stay there for good (ADMIN-COMMERCE-08; its finder wrote M1a-6, the number of M1a-3's section in the migration): still open (Appendix B).
  - Two more were caught between rounds, not by a wave: M1a-3 made the parked attempts visible, but nothing cleared their mark even when the provider answered (fixed in M1b-13); and F2a-1's Turnstile let a refused captcha read as «أرسلنا…» on the sign-in page, so a wrong hosted key would have locked staff out without a word (fixed in F3-10).
  - The packaging push's first CI run failed on a step round T had added and never seen run in CI.
- **The cloud container.**
  - It has no Docker and no database, so no e2e suite runs there. The screens F3 and D1 changed are recorded as built and not visually verified; the admin redesign was rendered there with mock data for the owner's review.
  - graft's session-start upkeep rewrote six tracked files; they were restored on the owner's word.
  - The network refuses some vendor documentation.
- **Hand-offs.** The ratification of 2026-10-08 and its resume note waited on origin's branch `cloud-ratify` for six days. This session resumed on 2026-10-13 from its own notes and never listed the remote's branches, so its records called the specs F3 and D1 wrote never run until the check of this report found the branch. A resuming session lists the remote's branches first.
- **Lock slips.** Four writes went outside the lock's recorded paths:
  - round T's `tests/unit/service-client-errors.test.ts` was never mirrored into the local lock (`HANDOFF-2026-10-07.md` section 2);
  - `PLANS/WORK-PACKAGES.md` was written a moment before the plan-files round recorded it (`cloud/PLAN-FILES.md`);
  - `tests/e2e/cart-checkout.spec.ts` was written a moment before the deep audit's fixes recorded it; only the git-ignored cloud lock records this;
  - the ratification's local RATIFY round named only its own folder, and the ratification also wrote its two `STATE.md` updates and the resume note beside it (`ratify-e800fc5/RECORD.md`).
- **Budget.** The checkout page's initial JavaScript is 149.7 of its 150 KiB. The next public addition there must load the checkout form's body on demand (I50 (2)).

## Appendix A: held for the round with a browser (38)

The finder's severity; the location the finder gave. Each entry's evidence and proposed fix are in `work/waveC/digest.md`.

- `A11Y-RTL-01` (medium): At 320 CSS px the header does not fit: «القائمة» runs 22px past the left edge, its label is clipped, and on a phone the whole page pans sideways (every public page) `src/components/site/site.module.css:39`
- `A11Y-RTL-02` (medium): Shift+Tab lands controls under the sticky header: the focused «أضف إلى السلة» and its quantity field are fully hidden (WCAG 2.4.11) `src/styles/globals.css:130`
- `A11Y-RTL-03` (medium): The scenes lightbox does not fit photos to the screen on desktop and tablet: portrait photos overflow by up to 1,495px and cover the caption and category. `src/components/public/scenes/scenes.module.css:192`
- `A11Y-RTL-06` (low): Without JavaScript the wrapped header stays sticky at 200px on a 320px phone, more than a third of a 568px screen on every page. `src/components/site/site.module.css:99`
- `A11Y-RTL-12` (low): Rich-text blocks lose their direction on the site: a Latin paragraph, heading or list item that the editor shows left to right is drawn right to left with its punctuation at the wrong end. `src/lib/richtext.tsx:41`
- `DSN-HOME-01` (medium): Header bar needs 342px: below that the «القائمة» button slides off the left edge (cut at 320px, label gone at 280px) and the page overflows sideways. `src/components/site/site.module.css:16`
- `DSN-HOME-02` (medium): Home room doors break into an uneven grid at the two commonest desktop widths: 6 doors + 2 triple-width doors at 1920px, 5 + 3 at 1536px, 3 + 3 + 2 at 1024px. `src/components/public/home/home.module.css:92`
- `DSN-HOME-03` (low): بدأتُ من هنا: the seventh family film is stretched alone on its row, up to twice the size of the other six (768-1920px) `src/components/public/rooms/rooms.module.css:30`
- `DSN-HOME-04` (low): The gap-free photo mosaic leaves empty cells: ذرى at 1280px is 5 photos and one alone beside four sand holes; مررتُ من هنا's products are 3+3+2 at 1024-1359px and 5+3 at 1920px. `src/components/weave/layout.module.css:69`
- `DSN-HOME-10` (low): Without JavaScript the header wraps to 200px on a phone and stays sticky, covering about a third of the screen on every page. `src/components/site/site.module.css:99`
- `DSN-HOME-12` (low): Home name band: the dots of «ي» in «القرني» hang over the weave strip from about 1024px up (half of each dot drawn on the pattern) `src/components/public/home/home.module.css:14`
- `DSN-HOME-15` (low): Font swap moves the first screen of مررتُ من هنا on a slow phone connection (CLS 0.126): no metric-matched fallback, and the room hero's Serif Display Regular is not preloaded. `src/app/(public)/layout.tsx:34`
- `DSN-HOME-17` (low): Home first screen on a laptop shows two of Anas's three names: the name bands are sized by width only, so «القرني» falls below the fold at 1366x657 and is half cut at 1440x789. `src/styles/tokens.css:43`
- `DSN-HOME-25` (low): مررتُ من هنا: both doors at the end of the room are paper, so «بنيتُ هنا» and «على الرف» merge into one undivided band (on a phone, one block with two links) `src/components/public/rooms/PassedRoomView.tsx:130`
- `DSN-HOME-27` (info): The skip link's focus ring is saffron drawn outside it on the sand header (1.32:1), against DESIGN.md's rule that a self-toned control draws its ring inside. `src/styles/globals.css:362`
- `DSN-PAGES-01` (medium): At 320px the header bar is 42px too wide: «القائمة» is cut 22px past the left edge, and on a phone every page opens panned left with the start of each line cut. `src/components/site/site.module.css:39`
- `DSN-PAGES-02` (low): The Turnstile widget (fixed 300px) is wider than a form column at 320px, so the contact form (and the other three Turnstile forms) lose their left gutter. `src/lib/turnstile.ts:22`
- `DSN-PAGES-05` (medium): A journal post title never gets its own size (--size-post-title): .t-title wins the cascade, so titles render at 68-200px with no overflow-wrap, and ordinary long Arabic words overflow on phones. `src/components/public/journal/journal.module.css:167`
- `DSN-PAGES-06` (medium): In an article a quotation is set exactly like a section heading: same face, size, weight and colour as h2, with no mark, rule or indent. `src/components/public/journal/journal.module.css:211`
- `DSN-PAGES-07` (low): Bold inside a heading, a quote or an emphasis in rich text is a browser-synthesized bold of Thmanyah Serif Display, which smears Arabic letterforms. `src/components/public/journal/journal.module.css:226`
- `DSN-PAGES-10` (high): The scenes lightbox does not fit the photo to the screen: on desktop, tablet and a phone held sideways most photos spill far past the stage, show only their top and cover the caption. `src/components/public/scenes/scenes.module.css:199`
- `DSN-PAGES-11` (low): The rich-text renderer forces every block right-to-left, while the editor shows each top-level block with dir=auto: an English paragraph or quote in a post (or a policy) prints its full stop or question mark on the wrong side. `src/lib/richtext.tsx:39`
- `DSN-PAGES-12` (low): With JavaScript off the header wraps to 200px on a phone and stays sticky, covering about a third of the screen on every page. `src/components/site/site.module.css:99`
- `DSN-PAGES-15` (low): The 404 room links paint their unfilled cells solid aub-800: on a phone the block ends in dark holes (the lattice defect AUDIT-2 fixed elsewhere) `src/components/public/lost.module.css:17`
- `PERF-04` (medium): The cart, checkout and order pages are static shells only 50vh tall, so the footer starts in the first screen and the client island pushes it away: CLS 0.35 (cart), 0.42 (checkout), 0.12 (orders) on a phone. `src/components/store/store.module.css:29`
- `PERF-05` (medium): The public layout preloads two 80 KB fonts on every page: on a phone they take the bandwidth of the hero picture (LCP 1.4-1.7 s later on /, /journal and /book), while the face every page sets its text in is not among them. `src/app/(public)/layout.tsx:34`
- `PERF-13` (medium): The room tagline enters by fading in from opacity 0, so when it is the largest text of the first screen (/started on a phone) the LCP is recorded only after the entrance and the hydration task end: 1.1 to 2.3 s late. `src/components/public/RoomHero.tsx:38`
- `PERF-15` (low): At 320 px every public page scrolls sideways by 22 px: the header bar (mark, «أنس», anas.studio and «القائمة») needs about 342 px. `src/components/site/site.module.css:39`
- `PERF-16` (medium): The room heroes move when Thmanyah replaces the fallback face: /passed reaches CLS 0.111 on a phone (over the 0.1 goal), /contact 0.060, /started 0.036. `src/styles/tokens.css:38`
- `PERF-18` (medium): Once the book is open, page-flip redraws every frame for as long as it stays open, idle or scrolled out of sight: 60 style recalculations a second, half or more of a phone-class CPU. `src/components/book/PdfBookReader.tsx:289`
- `READER-02` (medium): While the book is open, page-flip's never-idle 60fps loop rewrites every leaf's inline style each frame: a 4x-throttled phone's main thread stays ~85-90% busy, even scrolled away from the reader. `patches/page-flip@2.0.7.patch:7`
- `READER-06` (medium): On touch screens a press on the book held 250 ms or more ends in page-flip's own turn: scrolling the page with a finger that starts on the open book turns a page, and a slow tap turns two. `src/components/book/PdfBookReader.tsx:307`
- `READER-10` (medium): Two pages at a time, screen readers read each spread left page first: the leaves are in page-flip's reversed DOM order. `src/components/book/PdfBookReader.tsx:310`
- `READER-12` (medium): In full screen, «عرض للقراءة» centres a column taller than the screen, so the tools and the first pages sit above the scroll origin and cannot be reached. `src/components/book/reader.module.css:522`
- `STORE-UI-02` (low): On a product page the title's descenders run into the summary line under it (768 to 1440) `src/components/store/store.module.css:140`
- `STORE-UI-06` (low): «تطبيق» sits 18px below the coupon field it belongs to (cart and checkout, wide screens) `src/components/store/store.module.css:383`
- `STORE-UI-07` (low): An unbreakable run in a product or variant title still widens the checkout summary and the order page's return form past a phone screen. `src/components/store/store.module.css:488`
- `STORE-UI-15` (low): A tracking number with hyphens is broken across lines on a phone and reads «-SMSA-290012345678» then «RUH» `src/components/store/OrderPage.tsx:146`

## Appendix B: recorded open (154)

The finder's severity; the location the finder gave. Each entry's evidence and proposed fix are in its wave's digest, under its id.

### Wave A (`work/waveA/digest.md`)

- `CLIENT-SEC-02` (medium): The sign-in page hides whether an address is staff, but the Auth API it calls answers 422 otp_disabled for every non-staff address. `src/components/admin/SignIn.tsx:43` Mitigated by F2a-1 (Turnstile on the code request); the ruling's correction of P03's proof was never made: `PLANS/WORK-PACKAGES.md:47` still says an unknown email gets the same response as a staff email.
- `CLIENT-SEC-09` (low): Password recovery stays a sign-in-by-link path: /recover is anonymous, the template is Supabase's English default with a login link, and the hook lets 'recovery' through. `supabase/migrations/20260930120000_audit_fixes.sql:27`
- `CONTRACT-03` (low): refund_settle's stale-read branch has no clock: a refund whose fetched total stays between its origin and its raised `before` is re-leased every minute for ever. `supabase/migrations/20261002130000_refunds.sql:610`
- `CONTRACT-04` (low): A refund of the other payment mode can never leave flight after the switch to live: refund_ref has no mode guard and «أعد الفحص» answers 'provider unreachable, try later' for ever. `supabase/migrations/20261002130000_refunds.sql:797`
- `CONTRACT-10` (low): payments_kick gives the reconciliation run 15 s while one run may spend 60 s on provider calls and records itself only at the end. `supabase/migrations/20261002100000_payment_core.sql:1671`
- `CONTRACT-13` (low): «تحتاج مطابقة» is documented in code as the sum of what the reconciliation screen lists, but leaves out a paid attempt the provider voided (PROVIDER_STATUS) and the transient rows. `src/lib/admin-orders.ts:244`
- `DB-COMMERCE-04` (low): The commit stock-checks and decrements a line by the variant's current stock column, not by the line's snapshot or reservation. `supabase/migrations/20261002100000_payment_core.sql:651`
- `DB-COMMERCE-06` (low): Coupon uses and committed preorder units are counted across test and live, so hosted sandbox runs spend live coupon limits and preorder capacity for good. `supabase/migrations/20260927160000_catalog_and_checkout.sql:451`
- `DB-COMMERCE-07` (low): The customer profile keeps the name and phone of whoever first typed the address at checkout, paid or not, for as long as any order of it exists. `supabase/migrations/20261002110000_checkout_payment.sql:538`
- `DB-COMMERCE-08` (low): Every product save requests a site build, including a draft product, an unchanged save and a stale save that matched no row. `supabase/migrations/20260927160000_catalog_and_checkout.sql:245`
- `DB-COMMERCE-09` (low): A coupon code typed with Arabic-Indic digits is refused as invalid: the code is folded for case and spaces only. `supabase/migrations/20261002110000_checkout_payment.sql:56`
- `DB-CORE-04` (low): outbox_attention's 200-row cap fills up with rows nobody can act on, which pushes older replayable mail out of the admin. `supabase/migrations/20261002120000_order_emails.sql:421`
- `DB-CORE-05` (low): service_role's default table privileges are never revoked, so it may hold DELETE and TRUNCATE on the append-only and content tables the migrations describe as insert-only. `supabase/migrations/20260924130000_staff_and_app_server.sql:7` Partly fixed in M2-16: `audit_events` refuses TRUNCATE and service_role lost TRUNCATE on it; the default privileges on the other tables stay.
- `DB-CORE-06` (low): media_is_published(uuid) stays executable by anon although no policy or code calls it any more. `supabase/migrations/20260926090000_media_library.sql:88`
- `DB-CORE-07` (low): outbox_replay treats a null p_accept_duplicate_risk as consent past the 23-hour window. `supabase/migrations/20261002120000_order_emails.sql:382`
- `DB-CORE-09` (low): A contact message whose notice never reaches a staff mailbox is kept for ever, unread and unreadable. `supabase/migrations/20260927140000_privacy_requests.sql:201`
- `DB-OPS-03` (low): A confirmation the hourly backlog queues late gets a link that dies early: the purge's 7 days run from the last request, the link's 7 days from the queued mail. `supabase/migrations/20261002150000_notifications.sql:423` Round D wrote what is true in the runbook.
- `DB-OPS-04` (low): A sign-up that queues behind the purge's lock on an orphan availability row goes on without the row: the subscriber is stored but the sweep can never see him. `supabase/migrations/20261002150000_notifications.sql:205`
- `DB-OPS-06` (low): The hourly confirmation backlog can deadlock with a visitor re-signing up for a row it is about to queue (shared rate_limits rows) `supabase/migrations/20261002150000_notifications.sql:147`
- `DB-OPS-07` (low): A suppressed (bounced or complained) subscriber stays confirmed: every restock queues a notice that is closed 'suppressed' and sits in the mail attention list for good, and a sign-up of such an address spends a day's confirmation slot. `supabase/migrations/20261002150000_notifications.sql:374`
- `DB-OPS-09` (low): The per-address caps on confirmation mail key on the literal address, so one Gmail inbox can be sent the day's whole budget through dot and plus aliases. `supabase/migrations/20261002150000_notifications.sql:111`
- `DB-POST-06` (low): refund_settle's stale-read branch has no time limit: a provider total stuck between origin and before keeps a refund in flight indefinitely, fetched every minute, with no alert. `supabase/migrations/20261002130000_refunds.sql:609`
- `DB-POST-08` (low): The owner's «تحتاج مطابقة» count leaves out rows that need a person: refunds stuck in submitting and paid attempts the provider voided. `supabase/migrations/20261002145000_order_operations.sql:493` Partly fixed in M1a-3c.
- `DB-POST-09` (low): A full refund of a preorder line that has already shipped releases its reservation, so capacity for a copy that has left the shelf can be sold again. `supabase/migrations/20261002170000_stats_disputes.sql:200`
- `EF-ACCESS-02` (low): The 60-second file link is only a token expiry: on Supabase Pro the Smart CDN keeps serving a fetched signed URL after it expires and after a refund. `supabase/functions/_shared/download.ts:38`
- `EF-ACCESS-04` (low): After a pepper change, link recovery renews the dead stored hash instead of replacing it, so a buyer who keeps recovering is locked out of his order. `supabase/functions/_shared/orders.ts:95`
- `EF-ACCESS-05` (low): A confirmation mail the backlog queues late dies before its promised 7 days: the purge ages pending rows by updated_at, which queueing never moves. `supabase/migrations/20261002150000_notifications.sql:124`
- `EF-ACCESS-08` (low): TOKEN_HASH_PEPPER is accepted at any non-empty length, though it is the only secret behind every buyer and subscriber token. `supabase/functions/_shared/env.ts:122` F1-15, deferred by the orchestrator to P11's hosted setup (`cloud/S.md`).
- `EF-ACCESS-10` (low): A return request carries no idempotency key, so a retry after a lost reply files a second request. `src/components/store/OrderPage.tsx:214`
- `EF-ADMIN-04` (low): paid-file-complete replaces the file every future buyer downloads at aal1: no TOTP step-up. `supabase/functions/_shared/admin.ts:253`
- `EF-ADMIN-05` (low): The media upload ticket expires 5 minutes after creation, so a large upload over a slow uplink can never complete. `supabase/migrations/20260926090000_media_library.sql:107`
- `EF-ADMIN-06` (low): An AVIF whose ftyp major brand is not literally 'avif' (for example 'mif1') is refused as UNKNOWN_TYPE. `supabase/functions/_shared/media.ts:179`
- `EF-ADMIN-09` (low): The settings status calls the Resend webhook configured for any non-empty secret, so a mis-pasted secret fails every delivery event silently. `supabase/functions/_shared/admin.ts:622`
- `EF-ADMIN-13` (low): A row that turns 'pending' after an uncertain attempt escapes the 23-hour idempotency window and can be resent blindly days later. `supabase/migrations/20260930140000_audit2_fixes.sql:593`
- `EF-MONEY-04` (low): The webhook settles the payment (two provider fetches of up to 10 s each) before it answers, against Moyasar's rule to return 2xx before any complex logic. `supabase/functions/_shared/payments.ts:462` Waits for E02 (sandbox run 1).
- `EF-MONEY-10` (low): payments_kick gives pg_net 15 s while a reconciliation run is budgeted 60 s plus one row; whether the run survives the disconnect is unproven. `supabase/migrations/20261002100000_payment_core.sql:1671`
- `EF-MONEY-12` (medium): Nothing handles an invoice that a declined card turns 'failed': pay keeps handing out its URL, cancel answers 409 for the rest of the hold, and the return page reads 'pending' for up to 24 hours; the emulator never produces that state. `supabase/functions/_shared/checkout.ts:394` Waits for E02 (sandbox run 3).
- `P08-CKPT-04` (low): payment_attempt_begin answers HOLD_EXPIRED before it answers the order's pending invoice, so a reload of the hold view in the hold's last 60 seconds ends the view and forgets the token while the invoice is still payable. `supabase/migrations/20261002100000_payment_core.sql:772`
- `P08-CKPT-07` (low): refund_result racing refund_settle for the same refund is serialized by finance.refund_lock but no test races the pair. `supabase/migrations/20261002130000_refunds.sql:512`
- `P08-CKPT-09` (low): dispute_record treats any call at an occupied seq as a repeat whatever it says, so a follow-up typed in a second tab is dropped and the owner is told «هذا السجل مسجّل من قبل؛ لم يتغير شيء.» `supabase/migrations/20261002170000_stats_disputes.sql:495`

### Wave B (`work/waveB/digest.md`)

- `ARCH-05` (low): Every Pages deployment stays publicly reachable at its own hash URL, so a post archived for a legal reason (or superseded policy text, or a pre-launch build) is never really unpublished; no plan step restricts or deletes old deployments. `PLANS/WORK-PACKAGES.md:139` Ruled to round D; neither round D's brief nor the plan-files round carried it.
- `ARCH-14` (low): Staff sessions live in localStorage on the same origin as every public page, under a planned script-src 'unsafe-inline': any script that ever runs on a public page can read an owner's refresh token. `src/lib/supabase/browser.ts:21`
- `FIX-A2-01` (low): Soon/maintenance design B still scrolls 4-17 px at 520-700 px widths: the word's height budget assumes the smallest clamps. `artifacts/soon/site/v/b/style.css:49`
- `FIX-A2-02` (low): A contact-form flood fills the whole priority-1 mail band P08 now shares with order_link, holding every order-recovery link to the next UTC day. `supabase/migrations/20261002120000_order_emails.sql:323` Confirmed and recorded, not changed (`rulings-waveB.md`).
- `OPS-PRIVACY-07` (low): A sign-up purged after 7 or 30 days leaves its address in the sent confirmation and availability mail rows for ever; no job purges sent outbox rows. `supabase/migrations/20261002150000_notifications.sql:426`
- `PLAN-GAPS-04` (medium): P10 plans browser Sentry in `src/instrumentation-client.ts` on every page, but the public pages have 1 to 3 KiB of a 150 KiB budget left and the SDK alone is about 25 to 35 KiB gzip. `PLANS/WORK-PACKAGES.md:127` P10's file list and D23 are unchanged; "Next work" item 9 asks for the decision before P10.
- `SUPPLY-04` (low): The backup passphrase is not Unicode-normalized before scrypt, so a visually identical Arabic passphrase can fail to open the backup. `scripts/lib/backup-format.mjs:71`
- `TEST-DB-02` (medium): HTTP integration tests run against whatever code the edge runtime last loaded; nothing detects a stale runtime. `tests/integration/support.ts:26`
- `TEST-DB-04` (low): The local-only guard checks only that DATABASE_URL is loopback; nothing ties it to the stack `supabase status` reports, and three spec files never consult that stack. `src/lib/env.ts:38`
- `TEST-DB-05` (low): outbox.test.ts re-dates every other pending, uncertain or sending mail in the shared database and never restores it. `tests/integration/outbox.test.ts:67`
- `TEST-DB-09` (low): The privacy of the paid files (and the private originals) is proven only from catalog text: a broad storage policy that never names the bucket passes, and nothing tries to read a private object without a signed URL. `tests/integration/payment.test.ts:636`
- `TEST-E2E-01` (info): No automated accessibility check exists: VERIFICATION promises axe with zero critical/serious findings, but nothing installs or runs axe. `PLANS/VERIFICATION.md:37` P10 owns the axe run.
- `TEST-E2E-02` (low): The overflow check cannot see content cut off at the right (inline-start) edge of an RTL page. `tests/e2e/visual.spec.ts:55`
- `TEST-E2E-03` (low): The team screen silently drops the newest staff past 1,000 rows: the auth.spec failure on a polluted database is a product truncation, not only pollution. `supabase/migrations/20260925090000_audit_and_staff_directory.sql:71`
- `TEST-E2E-04` (low): Tests in store-admin.spec.ts and owner-operations.spec.ts read module variables that only an earlier test sets: none of them can run alone, and one failure cascades. `tests/e2e/store-admin.spec.ts:104`
- `TEST-E2E-07` (low): The notify double-press check counts calls the instant the click returns, before a second request could reach the route. `tests/e2e/order-page.spec.ts:1190`
- `TEST-E2E-08` (low): "Every public page" at four widths is 13 routes: policies, cart, checkout, return, product, article and 404 are never measured at 768/1024, the policies at no width, and 320px or 200% zoom nowhere. `tests/e2e/visual.spec.ts:13`
- `TEST-E2E-09` (low): Conditional checks that the acceptance database always sends the same way, so the branch with the real behaviour never runs. `tests/e2e/orders-admin.spec.ts:427`
- `TEST-E2E-13` (low): Each owner-operations run leaves a due priority-1 notice for every active test staff member, which a later run must send before any priority-2 mail. `tests/e2e/owner-operations.spec.ts:101`
- `TEST-E2E-16` (low): CI's export has no product page and no journal article, so the public JavaScript budget never measures them on a push. `scripts/check-budgets.mjs:32` Half fixed by `8edca59`: CI seeds the demo catalog before the build, so the three demo product pages are measured (`after/ci-check-budgets.log`); no article is published in CI, so no article page is.
- `TEST-UNIT-02` (low): The stats test that claims 'only the analytics part stays cached' cannot fail: the clock is frozen and analytics is unconfigured. `tests/unit/admin-function.test.ts:719`
- `TEST-UNIT-04` (low): Nothing pins each form's Turnstile widget action to the action its function expects, and local keys skip the check. `src/lib/turnstile.ts:47`
- `TEST-UNIT-07` (low): preorderCurrent compares a date string against the browser's en-CA locale format; its unit test proves only Node's ICU. `src/components/store/VariantAction.tsx:91`
- `TEST-UNIT-10` (low): The backup reader's own refusals (unsafe path, duplicate, manifest first, size/sha256) are never exercised; only the writer's are. `tests/unit/backup-format.test.ts:324`
- `TEST-UNIT-12` (info): The test:db guard accepts any loopback Postgres, so three integration files would run against another project's local stack on the same port. `vitest.config.ts:15`
- `TEST-UNIT-13` (low): 'writes only columns the migration grants' compares the table configs with a hand-copied list, not with the migrations. `tests/unit/collections.test.ts:342`
- `TEST-UNIT-14` (info): 'compares each bucket with the restored database's own rows' only greps the script's source text. `tests/unit/restore-check.test.ts:43`
- `VENDOR-PAY-09` (info): The Svix verifier is tested only against the test file's own re-implementation of the signing scheme; it does match Svix's published vector, but no test pins that. `tests/unit/resend-webhook.test.ts:51` Confirmed and recorded; the test to add is the finder's.
- `VENDOR-PLAT-03` (low): secure_password_change is described as closing the password-change path, but Supabase Auth lets any session younger than 24 hours set a password without reauthentication; only the access-token hook stops password sign-in. `supabase/config.toml:235` Ruled to round D, whose brief never carried it (ISSUES I55 (4)).

### Wave C (`work/waveC/digest.md`)

- `A11Y-RTL-14` (low): The store settings report «تم فتح الشراء.» / «تم إغلاق الشراء.» in a status line that is inserted with its text already in it. `src/components/admin/CommerceSettingsForm.tsx:275`
- `ADMIN-CMS-01` (medium): Two tabs of one document share one local-copy key: a save, an edit or «تجاهل» in one tab deletes or overwrites the other tab's unsaved copy, so the conflict path loses the text it says is kept. `src/components/admin/CollectionForm.tsx:209`
- `ADMIN-CMS-02` (medium): A new post that was never saved is autosaved only under its random id and no screen lists it: leaving the page (for example to upload its cover in «المكتبة») orphans the whole draft. `src/components/admin/CollectionList.tsx:90`
- `ADMIN-CMS-05` (low): AUDIT-1 S08.6 holds only for non-empty bodies: a click into an empty rich-text body still marks the document changed, turns «نشر» off and leaves a false «unsaved» copy. `src/components/admin/RichTextEditor.tsx:249`
- `ADMIN-CMS-06` (low): The owner home's failed-schedule warning names a post by its raw uuid (a room by its English slug), gives no reason, and keeps showing for 7 days after the document was published. `src/components/admin/AdminHome.tsx:410`
- `ADMIN-CMS-07` (low): Validation parity: the site settings and room publish rules run only in the browser; neither the database nor the build re-checks them. `src/lib/admin-publish.ts:139`
- `ADMIN-CMS-10` (low): The email problems screen shows only the newest 200 problem rows with no note; bounced 'sent' rows never leave the list, so an older exhausted mail can vanish while «تحتاج تدخل» says there is nothing to do. `src/components/admin/EmailView.tsx:188`
- `ADMIN-CMS-12` (low): A rich-text body over a size limit cannot be published, and the form explains it in English after a raw schema path. `src/admin/richtext.ts:19`
- `ADMIN-CMS-13` (low): AUDIT-2 ADMIN-editor-11 half fixed: «حذف» on a list item or paragraph still removes it at once with no confirm or undo, and the autosave stores the deletion. `src/components/admin/FieldInput.tsx:737`
- `ADMIN-CMS-14` (low): Text typed while the editor reloads after «نشر», «جدولة», «إلغاء الجدولة», «أرشفة» or «استعادة» is silently replaced: the form stays editable but autosave is off until the reload lands. `src/components/admin/CollectionForm.tsx:138`
- `ADMIN-CMS-15` (low): On a slow uplink a large photo can never be uploaded: the original and every derivative must arrive within the ticket's 5 minutes, and «إعادة المحاولة» repeats the same race. `src/components/admin/MediaUpload.tsx:252`
- `ADMIN-CMS-16` (low): Changing a published article's «المعرّف» silently moves it to a new address: the old /journal/<slug> page disappears at the next build with no warning. `src/admin/collections/posts.ts:8`
- `ADMIN-CMS-18` (low): The documents list has no loading, failure or empty state: until the query answers, and for good when it fails, every room, policy and the settings read «مسودة لم تُنشر» and «لم يُحفظ بعد», and the articles list is a bare table. `src/components/admin/CollectionList.tsx:168`
- `ADMIN-CMS-19` (low): The book photo's «نقطة التركيز» is free text written into an inline style; a value with ';' adds any CSS declaration to the public /book page. `src/admin/collections/rooms.ts:244` The ruling lists it for P10's security pass; no plan file names it yet.
- `ADMIN-CMS-20` (low): The security page tells the owner the authenticator is needed only for team actions; since P08 it also gates refunds, disputes, the store settings, the policy approval and the checkout switch. `src/components/admin/MfaEnroll.tsx:105` = QUALITY-20; ISSUES I55 (9).
- `ADMIN-CMS-23` (low): «معاينة» opens the last saved version even while the form holds unsaved edits, and nothing says the edits are missing. `src/components/admin/PublishBar.tsx:107`
- `ADMIN-COMMERCE-03` (low): The statistics line «دفعات قيد المراجعة: مفتوحة N، مبالغها X» shows as X the amounts of every review payment that arrived in the range, closed ones included, next to the count of open ones. `src/lib/admin-commerce.ts:267`
- `ADMIN-COMMERCE-06` (low): Review payments are drawn, refunded and summed as riyals whatever their currency; no screen shows `currency`. `src/components/admin/ReconciliationView.tsx:324`
- `ADMIN-COMMERCE-08` (low): After the switch to live, every test attempt the job parked as MODE_CHANGED stays on «المطابقة» and in «تحتاج مطابقة» for good: its only control, «أعد الفحص», answers «لم نجد محاولة الدفع هذه.» `src/components/admin/ReconciliationView.tsx:289` Traced to this audit's own round M1a: M1a-3 lists and counts the attempts the job parks as MODE_CHANGED, and after the switch to live nothing clears them (its finder wrote M1a-6, the number of M1a-3's section in the migration; section 6).
- `ADMIN-COMMERCE-09` (low): The order view offers «إعادة المبلغ» on a paying payment Moyasar already shows voided; the refund is sent, refused, and worded as a gateway refusal with no pointer to «تسجيل استرداد خارجي» `src/components/admin/OrderView.tsx:396`
- `ADMIN-COMMERCE-11` (low): The refund confirmation never says what a refund does besides moving money: a line refunded in full loses its file for good (and stops shipping), and an unshipped unit does not go back to stock. `src/components/admin/RefundView.tsx:339`
- `ADMIN-COMMERCE-12` (low): The reconciliation screen's dispute form silently loses «سحب الملفات» and «إيقاف الشحن» when the order's lines cannot be read, and an earlier form's late answer leaves a newer form 'loading' for good. `src/components/admin/ReconciliationView.tsx:202`
- `ADMIN-COMMERCE-14` (low): Changing a digital variant that has a paid file to «ورقي» or «موقّع» fails with the bare «تحقق من القيم.», and no admin action can remove the file. `src/admin/tables/variants.ts:73`
- `ADMIN-COMMERCE-15` (low): A digital variant can be put on sale with no paid file and the variant form neither warns nor refuses: buyers pay for a download that does not exist yet. `src/components/admin/VariantCommerce.tsx:246`
- `ADMIN-COMMERCE-16` (low): Store forms still never mark the offending input invalid: AUDIT-2 X-A11Y-RTL-11 holds for the summary and the Save button only. `src/components/admin/TableForm.tsx:349`
- `ADMIN-COMMERCE-17` (low): Once the site runs live, every money control on a sandbox order («أعد الفحص», «إعادة المبلغ», «تسجيل استرداد خارجي», «تسجيل اعتراض») is still offered and each answers that the payment does not exist. `src/components/admin/OrderView.tsx:515`
- `DSN-HOME-05` (low): The committed image derivatives lack the source-width step prepare-media.mjs promises: the Moonlight Cup render is drawn 1000px wide from a 720px file (2.8x upscale on retina); I49(6) records this as optional and misstates the cause. `public/images/manifest.json:953`
- `DSN-HOME-06` (low): The two photo mosaics declare `sizes` smaller than the tiles they fill: مررتُ من هنا's products are drawn up to 1.84x their file at 1280px, ذرى's 1.42x on a 1024px retina screen. `src/components/public/rooms/PassedRoomView.tsx:118`
- `DSN-HOME-07` (low): Seven coloured bands in the rooms open on a raw straight seam, against DESIGN.md's edge rule and the D39 recheck that says «never a raw seam» `PLANS/DESIGN-AUDIT.md:194`
- `DSN-HOME-08` (low): كوب ضوء القمر's render wipes in as a stark white rectangle, then snaps to the paper tint when the reveal ends. `src/components/public/rooms/shelf.module.css:172`
- `DSN-HOME-09` (low): Home: the book cover's solid ink shadow (B's only depth) is clipped during the cover's 1.1s wipe and pops in when it ends. `src/components/public/home/HomeView.tsx:121`
- `DSN-HOME-11` (low): The «band» wipe clips every glyph part outside the line box, so tails and dots of large display lines are cut flat during the wipe and drop in when it ends («ذرى», «خوص», the band lines, «عبدالله», «القرني») `src/components/weave/motion.ts:20`
- `DSN-HOME-13` (low): بنيتُ هنا: on a laptop-height window the opening drone film is capped to 94vh and pushed to the right, leaving a dark slab of up to 316px on the left. `src/components/public/rooms/built.module.css:64`
- `DSN-HOME-14` (low): Once a film plays, its keyboard focus ring is one colour drawn over the moving picture: on بنيتُ هنا an aubergine 3px line on a dark frame, nearly invisible. `src/components/weave/video.module.css:14`
- `DSN-HOME-18` (low): بدأتُ من هنا: the family films are drawn once per movement ticked «تظهر المقاطع هنا»: two ticks show all seven films twice, no tick (or hiding that movement) drops them silently. `src/components/public/rooms/StartedRoomView.tsx:116`
- `DSN-HOME-22` (info): The «three small triangles» mark renders as a crown: its 12px square tiles make the conic wedge spill into a solid base, unlike the crenel edges' separate triangles. `src/components/weave/action.module.css:97`
- `DSN-HOME-23` (low): A film started with the native controls before hydration keeps playing afterwards but loses its controls and gets the «تشغيل» overlay on top. `src/components/weave/VideoTile.tsx:77`
- `DSN-HOME-24` (low): Printed, the home page's «فلنتحدث» and «إلى الكتاب» actions, the muted door facts and the footer links come out pale sand or saffron on white paper. `src/styles/globals.css:370`
- `DSN-PAGES-03` (low): /scenes with no visible photo shows a dead «الكل» filter and a 50vh woven block above a small unstyled «لا توجد مَشاهد بعد.»; one category also gets a pointless filter. `src/components/public/scenes/SceneGallery.tsx:67`
- `DSN-PAGES-04` (low): grid-auto-flow: dense reorders the scene tiles, so on phones and tablets the tab order and the lightbox next/previous do not follow the visual order. `src/components/public/scenes/scenes.module.css:50`
- `DSN-PAGES-13` (low): No global-error file: an error in the public root layout's client code falls through to Next's built-in English page without lang or dir. `src/app/(public)/error.tsx:11`
- `DSN-PAGES-14` (low): The contact form's two stop notices send visitors to «القنوات المجاورة» even in the designed state with no channels at all. `src/components/public/contact/ContactForm.tsx:219`
- `DSN-PAGES-19` (info): Proposal for the article page inside direction B: at desktop the 33em column hugs the start edge under a full-width title, and the meta line runs author, date and reading time together. `src/components/public/journal/journal.module.css:188`
- `PERF-02` (low): Every film poster is downloaded at page start, at its single full size, even far below the fold: 278 KB on /started and 239 KB on /built of a phone's first load. `src/components/weave/VideoTile.tsx:87`
- `PERF-03` (low): Every public page downloads the whole application's CSS as one render-blocking file: the admin, the book reader, the store and every room (76 KB raw, 12.6 KB gzip) `next.config.ts:36`
- `PERF-06` (low): check:budgets enforces only the JavaScript budget; the plan's second public budget, initial HTML+CSS+fonts+hero under 1 MiB, is checked nowhere. `scripts/check-budgets.mjs:22`
- `PERF-07` (low): check:budgets counts only first-party chunks: the Turnstile script that /contact, /orders and the checkout load at hydration (27.6 KB gzip) is never counted, so the checkout's real initial JS is about 176 KiB against the 150 KiB goal. `scripts/check-budgets.mjs:68`
- `PERF-08` (low): prepare-media adds a source-width derivative for every source wider than 1800 px (2048, 2160, 2688), against its own comment; I49 (6) blames sources that grew wider instead. `scripts/prepare-media.mjs:246`
- `PERF-09` (info): The film tile bundles the whole video manifest into the room pages' JavaScript. `src/components/weave/VideoTile.tsx:5`
- `PERF-11` (low): check:export accepts an export whose pages reference files that are not in it: the CI and Pages builds have none of the 18 films the rooms link to. `scripts/check-export.mjs:100`
- `PERF-12` (low): Opening the book on a phone costs about 0.8 MB and 10 s before the first page shows, and the plan's promised separate measurement of the lazy PDF chunks does not exist. `scripts/check-budgets.mjs:56`
- `PERF-14` (low): Film posters exist in one size only, and /scenes uses four of them as photos: on a phone its preloaded first row downloads 147 KB of posters where 70 KB would do. `scripts/prepare-media.mjs:291`
- `PERF-17` (low): The cart re-lays itself out when the quote arrives: the line total and the delivery-city field appear only then and move the summary 60 px on a phone. `src/components/store/CartView.tsx:318`
- `QUALITY-06` (low): CheckoutForm's manual quote refresh records a failure without the stale-run guard its sibling effect uses. `src/components/store/CheckoutForm.tsx:279`
- `QUALITY-07` (low): The buyer's order page refuses a reply with any extra key, so an additive SQL change to order_summary or payment_view takes every order page down until the site is rebuilt. `src/lib/orders.ts:305`
- `QUALITY-08` (low): The cart page still swallows a failed city list into an empty select: AUDIT-2's fix reached only the checkout's copy of the same line. `src/components/store/CartView.tsx:116`
- `QUALITY-09` (low): Two of the admin's three step-up implementations read a failed factor lookup as 'no authenticator', and send an enrolled owner to enrol. `src/components/admin/TeamView.tsx:84` Half fixed: F3-5 (c) (ADMIN-COMMERCE-13) fixed the commerce settings' copy; TeamView's (`TeamView.tsx:137-143`) is left.
- `QUALITY-12` (low): CollectionForm still tracks the session's access token after D32 removed its only use, and hides the publish bar whenever it is null. `src/components/admin/CollectionForm.tsx:362`
- `QUALITY-13` (low): A book page's draw cannot be cancelled once its canvas is done, so a resize or a scroll-away during the text read leaves a stale text layer. `src/components/book/pdf.ts:180`
- `QUALITY-14` (low): The restore rehearsal swallows a failed content-type read, uploads every object as octet-stream, and never checks the types it claims to restore. `scripts/restore-check.mjs:236`
- `QUALITY-18` (low): The staff order search checks an address without the punycode step every server copy applies, so an Arabic-domain buyer cannot be found by his address. `src/lib/admin-orders.ts:132`
- `QUALITY-20` (low): The security page says the authenticator guards team actions only; it now also guards refunds, disputes, the seller details, the policies and the checkout switch. `src/components/admin/MfaEnroll.tsx:105` = ADMIN-CMS-20 (ruled open); confirmed again while writing this report (ISSUES I55 (9)).
- `QUALITY-21` (low): The book reader handles a failed reader chunk and a failed PDF but not a failed page-flip chunk: an empty stage with dead controls. `src/components/book/PdfBookReader.tsx:286`
- `QUALITY-22` (info): rooms.ts builds eight Zod schemas nobody uses, one of them a hand copy of the jewel options. `src/admin/collections/rooms.ts:22`
- `QUALITY-23` (info): Two helpers survive only for their unit tests: cart.ts removeLine and money-input.ts riyadhLocalToIso. `src/lib/cart.ts:140`
- `QUALITY-24` (info): The Riyadh day is written three times and the dispute form's day check is weaker than the catalog's: it accepts 2026-02-30. `src/lib/admin-money.ts:422`
- `QUALITY-25` (info): Comments and branches left from earlier architectures point maintainers at code that no longer exists. `supabase/functions/_shared/outbox.ts:121`
- `QUALITY-26` (info): staff-admin is the last function that reads its whole body before the size check, and measures it in UTF-16 units. `supabase/functions/staff-admin/index.ts:59`
- `READER-03` (low): Going from two pages to one (rotating a tablet, narrowing the window) lands on the left-hand page of the spread and skips the right-hand page the reader has not read. `src/components/book/PdfBookReader.tsx:351`
- `READER-05` (low): Above a 1125px stage (full screen on a 1440p display, any 4K window) page-flip caps pages at 900px while the CSS boards and the cover slide assume the stage's size: oversized boards, off-centre closed book. `src/components/book/PdfBookReader.tsx:295`
- `READER-07` (low): PageSurface.draw has no guard for a newer draw that starts while it awaits getPage or getTextContent, so two draws can both finish and stack two text layers (or two renders) in one leaf. `src/components/book/pdf.ts:180`
- `READER-13` (low): In full screen the reading view's IntersectionObserver gets no look-ahead, so each page shows as blank paper until it scrolls in. `src/components/book/StaticPdfReader.tsx:45`
- `READER-14` (low): The e2e guard for 'closed, it loads nothing' cannot see the pdf.js chunk, so an eager pdf.js import would pass. `tests/e2e/reader.spec.ts:103`
- `READER-16` (low): The phone reading view never redraws for pinch zoom: the zoom its own hint asks for magnifies a 2x bitmap of 6.9px text. `src/components/book/StaticPdfReader.tsx:32`
- `READER-17` (low): The preview's 'no email may remain' check scans the raw PDF bytes, so it cannot see an address inside the compressed page or font streams. `scripts/prepare-preview.py:118`
- `SOON-09` (low): deploy.cjs takes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the shell when they are set there, not from .env, so a shell set up for another account deploys there. `artifacts/soon/deploy.cjs:28` ISSUES I55 (5).
- `STORE-UI-03` (low): The return, cart and checkout pages bake a loading line into the static HTML that nothing ends without JavaScript (the rule R10A-5 applied to /orders only) `src/components/store/PaymentReturn.tsx:138`
- `STORE-UI-08` (low): After a reload, a `pay` that fails (throttle, lost connection, unreadable reply) leaves «نجهّز صفحة الدفع…» on screen beside the failure. `src/components/store/HoldView.tsx:44`
- `STORE-UI-09` (low): «نجهّز صفحة الدفع…» never moves on by itself: the hold view asks `pay` again only when pressed or at the hold's end. `src/components/store/HoldView.tsx:141`
- `STORE-UI-10` (low): Reloading a notification link page says «الرابط غير مكتمل.»: the page removed the token from the address and kept it nowhere. `src/components/store/NotifyAction.tsx:106`
- `STORE-UI-11` (low): A name with a pasted TAB is refused by the function and the form answers «أدخل الاسم.» under the filled name (GAP-G4-4 only half fixed) `src/components/store/CheckoutForm.tsx:640`
- `STORE-UI-12` (low): The cart still swallows a failed city list: an empty select and «اختر مدينة التوصيل.» with no failure note or retry (STORE-checkout-5 fixed in the checkout only) `src/components/store/CartView.tsx:116`
- `STORE-UI-13` (low): After its 30-second schedule the return page still says «جارٍ التحقق من الدفع…» when nothing is being checked. `src/components/store/PaymentReturn.tsx:138`
- `STORE-UI-16` (low): With storage blocked, leaving the checkout and coming back forgets the held order and mints a new checkout session, so the same cart is ordered again while the first order holds its stock. `src/lib/cart.ts:474`
- `STORE-UI-18` (low): A press made before Turnstile has a token turns «تأكيد الطلب» into a disabled «جارٍ الإرسال…» while nothing is sent and the visitor may still have a check to complete. `src/components/store/CheckoutForm.tsx:792`

## Appendix C: observations (13)

Nothing to change; recorded as the rulings say.

### Wave A (`work/waveA/digest.md`)

- `CONTRACT-11` (info): finance.fulfillments.version is bumped by every fulfilment write but nobody sends or checks it. `supabase/migrations/20261002145000_order_operations.sql:628`
- `CONTRACT-12` (info): cart.ts says its create fingerprint is normalized 'exactly as the Edge Function' does; the phone and the checkout session differ. `src/lib/cart.ts:193`
- `DB-COMMERCE-10` (info): Bidi override and isolate characters pass the name, address and dedication checks; the displays contain them, so only the buyer's own value is affected. `supabase/migrations/20261002110000_checkout_payment.sql:471`
- `DB-CORE-10` (info): The last-owner guard's concurrency claim has no test: only sequential demotions are exercised. `tests/integration/staff-admin.test.ts:106`
- `DB-CORE-11` (info): Edits to a library image's name, folder, alt text, caption and rights leave no audit row. `supabase/migrations/20260926090000_media_library.sql:50`
- `DB-CORE-12` (info): The contact retention purge leaves no trace: no count-only audit row and no job run, so a failing purge goes unnoticed. `supabase/migrations/20260927140000_privacy_requests.sql:191`
- `DB-POST-12` (info): The refund step-up lives only in the admin Edge Function; the SQL rechecks the owner role and the Data API cannot reach it. `supabase/functions/_shared/admin.ts:225`
- `DB-POST-13` (info): Refund amount boundaries hold in the ledger; the provider's minimum is undocumented, and a refusal ends cleanly as failed. `supabase/migrations/20261002130000_refunds.sql:349`
- `EF-ACCESS-11` (info): Observation: the per-IP throttle key is salted with the UTC date, so every hourly per-IP window starts again at UTC midnight. `supabase/functions/_shared/rate-limit.ts:135`
- `EF-ADMIN-14` (info): An owner revoked between the role check and the commerce SQL is told the action is for 'an owner or an active editor'. `supabase/functions/_shared/admin.ts:452`
- `EF-ADMIN-15` (info): Storage and Auth calls through supabase-js in admin/staff carry no timeout; only the platform's 150 s limit ends a hung media-complete. `supabase/functions/_shared/admin.ts:135`
- `EF-MONEY-11` (info): The return page's verify answers an order's payment state to anyone who knows its 8-character number, with no token. `supabase/functions/_shared/payments.ts:526`

### Wave B (`work/waveB/digest.md`)

- `ARCH-11` (info): Observation: the product and store pages show the build's price while the cart and checkout show and charge the live one; nothing tells the buyer when they differ. `src/app/(public)/store/[slug]/page.tsx:104`

## Appendix D: the owner's decisions (15)

Each is in `PLANS/DECISIONS.md`, "Owner decisions FABLE-AUDIT and its continuation leave open", or the ISSUES entry named.

### Wave A (`work/waveA/digest.md`)

- `DB-COMMERCE-02` (medium): No per-resource unpaid-hold limit: one address holds 200 units of a scarce variant for 20 minutes an hour (about 60 continuously), three hold them around the clock; the recorded residual understates it. `supabase/migrations/20261002110000_checkout_payment.sql:484`
- `EF-ACCESS-14` (medium): Any script can spend the project's Edge Function invocation quota with refused requests, and any buyer its Storage egress: no control runs before the metered resource. `docs/operations.md:1154`
- `EF-MONEY-01` (medium): A paid Moyasar invoice that is not the store's (a dashboard invoice, a payment link, another integration on the same account) becomes an UNMAPPED_INVOICE review payment with an owner alert. `supabase/functions/_shared/payments.ts:315`

### Wave B (`work/waveB/digest.md`)

- `PLAN-GAPS-02` (medium): D44 records the five children's films as consented, but the consent Anas said he would send is not in hand and no plan item tracks it. `PLANS/DECISIONS.md:51`
- `PLAN-GAPS-03` (medium): Gate E02 still reads 'freelance certificate ready', but the certificate's speciality is graphic design and the shop will sell a book and family food products. `PLANS/DECISIONS.md:75`
- `PLAN-GAPS-05` (medium): P10's hosted proofs need the hosted project the plan only sets up in P11, and no package owns a way to put the first owner and the first content on it. `PLANS/WORK-PACKAGES.md:123` Ruled to round D; the plan-files round left it to the owner (DECISIONS, "Plan changes the audit proposes").
- `PLAN-GAPS-07` (medium): The package chain makes the launch wait for the Moyasar sandbox: P09's phase gate cannot pass without E02, and P10 and P11 depend on P09, contradicting D34. `PLANS/WORK-PACKAGES.md:119` Ruled to round D; the plan-files round left it to the owner (DECISIONS, "Plan changes the audit proposes").
- `PLAN-GAPS-11` (medium): Physical orders take a free-text address with no National Address, which Saudi parcel carriers must refuse since 2026-01-01. `src/components/store/CheckoutForm.tsx:713`
- `PLAN-GAPS-12` (medium): No public page names the seller: the store shows no seller name, registration, address or contact means, which the E-Commerce Law asks an e-store to disclose. `src/app/(public)/store/page.tsx:25`
- `VENDOR-PAY-01` (medium): SADAD is on by default in Moyasar test mode and appears on the hosted invoice page; its payments cannot be refunded or voided through the API, and nothing in the plan, runbook or code knows it. `docs/payments-runbook.md:298` Round D wrote the facts into the contract and the runbook; SADAD on the live account is the owner's (ISSUES I54 (3)).
- `VENDOR-PAY-08` (low): The refund mail and the order page tell the buyer the money «تم استرداد» / «أُعيد» with no timing, while Moyasar says a card refund takes up to 3 business days on mada and 7 to 14 business days on credit cards. `supabase/functions/_shared/email.ts:496` F3-16 (g): Anas words and approves the sentence (ISSUES I55 (7)).
- `VENDOR-PLAT-04` (high): The 18 room films are served from the Pages origin, which answers Range requests with 200 and the whole file; Safari on iPhone and Mac needs 206 to play MP4, so the films are likely to fail on Apple devices. `src/components/weave/VideoTile.tsx:97`

### Wave C (`work/waveC/digest.md`)

- `A11Y-RTL-08` (low): The one film that keeps its soundtrack (the Raha drive-thru reel, whose slogan is spoken) has no captions track. `src/components/weave/VideoTile.tsx:97` The captions are the owner's (DECISIONS, "Content").
- `SOON-01` (medium): After the launch, «اعرض صفحة قريباً» answers every page 200 with X-Robots-Tag: noindex, so one press removes the launched site from Google. `PLANS/SITE-STATE-CONTRACT.md:18`
- `SOON-08` (low): The soon page rides on the Workers Free daily allowance: past 100,000 script runs in a UTC day, anas.studio/ shows Cloudflare error 1027 until midnight UTC. `artifacts/soon/wrangler.toml:24` Workers Paid for a launch period (DECISIONS).
