# AUDIT-1: deep audit of everything built, and the fixes (2026-09-30)

**Asked by the owner (2026-09-30):** "deep audit everything been built so far, find all issues, fix them all before proceeding on our plan … combine all findings in one full report, update all stale docs, let me know where we are in percentages."

**Scope audited:** everything committed through `a93ccc2` plus the uncommitted D41 change: P00 (runtime, D29 swap, D32 static replatform), P01 with DESIGN-B, P02, P03 to P07, CLEANUP-1; about 27,000 lines of product code (`src/`, `supabase/`, `scripts/`), 17,000 lines of tests, and every plan and guide document. P08 to P12 are not started, so their absence was never counted as a defect.

## 1. Result in one table

| | Count |
|---|---|
| Auditor agents (29 specialists + 1 completeness critic + 5 gap auditors) | 35 |
| Raw findings | 324 |
| Unique after merging duplicates | 258 |
| Confirmed by adversarial verification | **253** (0 critical, 2 high, 62 medium, 172 low, 17 info) |
| Refuted by the verifiers | 5 |
| **Fixed** (11 single-writer rounds, each independently audited, plus the orchestrator) | **241** |
| Waiting for an owner decision (ISSUES I42 to I45) | 7 |
| Recorded as open work (ISSUES I44, I46, I47; docs) | 5 |

Every one of the 253 is listed with its location and outcome in [APPENDIX-findings.md](APPENDIX-findings.md); the full evidence, failure scenario, fix and each verifier's reasoning are in `audit-result.json` and `findings/<ROUND>.json`.

## 2. How the audit ran

One read-only workflow (`wf_0902627f-f2d`, 224 agents, about 67 minutes):

1. **29 specialist auditors**, each owning a slice of files or a cross-cutting lens:
   - database security and publishing; media and the `admin` function; email, contacts, privacy and settings SQL; the email, contact and webhook functions; money SQL; the checkout function and client money libraries; the staff-admin, stats and core functions;
   - the admin editor; admin media; the admin shell, auth and operations screens; the store admin;
   - the build loaders and public routes; rooms, weave and chrome; the public store; the book reader; scenes, contact and journal;
   - backups and restore; tooling, CI and configuration;
   - integration, unit and e2e test quality;
   - plan documents; guides;
   - cross-cutting: security threat model, a second opinion on concurrency and idempotency, accessibility and RTL (with the `designing-arabic-frontends` skill), a visual design audit of the latest screenshots (with the `tasmeem` skill), plan coverage and progress, dead code and over-engineering (with `ponytail-audit`), performance and SEO.
2. **A completeness critic** compared the files every auditor read with `git ls-files` and the finding titles, and named five gaps nobody had covered: buyer personal data over its whole lifecycle, the baseline check, the content fixture, tracked personal data in the repository, and the interactive public pages without JavaScript. **Five gap auditors** covered them.
3. **Deduplication** merged the same defect found by several auditors (324 → 258).
4. **Adversarial verification**: every critical or high finding went to three independent verifiers (code truth, reachability through RLS, grants and UI gating, and intent against the decisions and recorded exceptions), and survived only with two confirmations. Every medium or low finding went to a skeptic told to refute it. 253 survived; 5 were refuted.

Rules every auditor kept: read-only; settled decisions D01–D41, open ISSUES, documented design exceptions and brand decisions (palette, Thmanyah, the «عبدالله» crossing, calm money pages, the local demo catalog, no tax) are not defects; each finding needs a file, a line, a verbatim quote and a concrete failure scenario.

## 3. How the fixes ran

Under `.anasaq-execution.lock` (package AUDIT-1, base `a93ccc2`), with exactly one writer at a time (D18):

- **The orchestrator** fixed G4.2 first (the only high-privacy finding).
- **The fix workflow** (`wf_c80bdd18-a3a`, 38 agents, about 4.9 hours) ran 11 sequential rounds: DB → Edge Functions → admin editor → admin fields and media → admin operations → store → public site → book reader → scripts and configuration → tests → docs. Each round was one fresh `sonnet-worker` (Sonnet 5.5, effort xhigh, D41) with its findings file and an exact file allowlist. The worker's first act was `git stash create`, so an independent `auditor` (Sonnet 5.5) could diff only that round. The auditor re-ran the checks and passed or failed the round; a failed round got up to two fresh re-fix workers. Nine rounds ended `pass`; ADMIN_FIELDS failed on a CRLF rewrite of one file and PUBLIC on four items in a file outside its allowlist.
- **The orchestrator** then closed every remaining item: the CRLF rewrite, the journal post view (name, arrow, date), the coupon list amount, the product and customer form rules, the unused `date` field type and table `nullText`, the dead vignette exports, the admin editor's italic, the media in-use text, the `esbuild` direct dependency, the reader test's link name, and the one unit test that expected the removed child films. The orchestrator also reviewed the new migration's security-critical parts (the password hook, the RLS split, the per-document locks, `publish_due`'s per-row isolation) and the page-flip patch (two insertions).

One process fact, recorded as S18.6: the audit workflow's agents did not get the Sonnet model that `.claude/settings.json` forces (one auditor reported running on Opus 5.5). The fix workflow set `model` explicitly on every agent, so it ran on Sonnet 5.5 as D41 requires.

## 4. The two high findings

- **G4.2 (privacy). The five films with children were public.** D39 promised "hidden until guardians consent", but `hidden: true` only stops rendering: the five posters were committed under `public/images/started/`, their ids sat in both manifests and in client JavaScript, and a local `out/` held the mp4s. Every Pages build would have published them at guessable URLs. **Fixed:** the posters were untracked, the mp4 copies were deleted (the sources stay in the git-excluded `BOOK_ASSETS/SORTED_2026-09-21/`), the manifest keys and content reels were removed and the local published document was re-imported. `prepare-media.mjs` now leaves the five out and says how to add them back after consent. The rebuilt `out/` has no `-kid-` file or string. **Still for the owner:** the five posters remain in Git history on the pushed branches (see I42 for the same history question).
- **S08.2 (data loss). Autosave erased the unsaved copy it was offering.** Editing a field before answering «يوجد تعديل غير محفوظ محليًا» overwrote the older unsaved text a second later. **Fixed:** no autosave while an offer is pending. Its siblings were fixed too: a pending save was lost on navigation or tab close (S08.3, now written synchronously); restoring a local copy based on an older version silently reverted newer work (S08.5, now warned); and a click into the rich-text body marked the document changed and blocked publishing (S08.6, now a key-order-insensitive comparison).

## 5. Medium findings (62) and their outcome

**Security and privacy**
- S01.1: anon could read hidden posts through the Data API. RLS is now split: anon sees only visible posts; staff see everything.
- S01.4: staff could set and use a password (D08 says none). A Custom Access Token hook, `public.deny_password_tokens`, refuses every password grant (403), and `secure_password_change` is on. Proven locally; the hosted steps are in I28.
- S04.1: a contact-form flood could spend the Resend quota that sign-in codes need. Contact notices now stop at 80 a day; the last 20 are kept for codes and receipts.
- S17.4: `restore-check --extract` could write decrypted data into the repository. It now refuses a repository path before asking for the passphrase.
- G5.1: without JavaScript, the contact form put the name, email and message in the URL. Submit is now disabled until hydration, with a `<noscript>` notice.
- G1.1, S23.3: the privacy runbook said buyers do not exist, and a restore could revive revoked staff. The data map now lists buyer records, and revokes are ledger lines that are reapplied first after a restore.
- G4.1 (owner): the WhatsApp export with third parties' data is in Git history. See I42.

**Money and store**
- S11.2: invalid price text kept the old price, and Save stayed on. The form value is now NaN, so the schema disables Save.
- S06.1: with storage denied, cart edits never reached checkout. The memory cart is always written.
- S06.2: re-adding a variant erased its dedication. The merge keeps it.
- S14.2: Enter in the coupon field submitted the whole order. It now applies the coupon.
- S14.3: one failed quote refresh replaced the form. The form stays, with a retry button.
- S14.4: the consent links wiped the typed details. They open in a new tab.
- S14.5, S14.6, X3.2: the hold and cancel results, the coupon errors and totals now reach screen readers, and the address field has an autocomplete token.
- X1.1: publishing a changed policy after the owner's approval showed buyers unapproved terms. A trigger now clears the approval on any change to an approved policy, so checkout closes until the owner approves again.
- S11.1, S11.3: the coupon list showed «لا يوجد» for fixed amounts, and the form rules did not match the database. The list reads the amount, and the rules are mirrored on the client.

**Correctness and data**
- S01.2: one bad scheduled post stopped all scheduled publishing. Each row now runs in its own subtransaction and a failure is audited.
- X2.3 (low, same area): a stale tab could revert newer live content. Publishing refuses an older seq, with a per-document lock.
- S04.2: a Resend daily or monthly quota exhausted notices within about 4 hours. A quota answer now waits for the next UTC day without spending retries.
- X1.3: replaying an exhausted, possibly-sent email skipped the duplicate-risk confirmation. Exhausted rows now follow the 23-hour rule too.
- S17.1: the 30-day purge deleted the last backup row just when its warning should show. The purge keeps each job's newest run.
- S17.2, S17.3: `pnpm backup --linked` could not find the linked project, and a backup whose last entry was empty could never be restored. Both are fixed, with a test.
- S08.1, X5.1: room previews called every library image invalid, and posts had no draft preview. Validation now runs before the media swap, and posts preview through a shared `PostView`.
- S08.7: pasted h1/h4–h6 headings and non-https links blocked publishing. Transforms now map the headings and unwrap such links.
- G3.1, S16.3, X5.4: the journal name was hard-coded, the journal had no dates, and nothing tested the journal. The name (D11) now comes from the /journal menu label on every page, the list and the post carry a Riyadh date, and cms.spec covers the list, the filter and the article.
- G3.4: some required room and footer fields were never drawn. They are removed from the configs and the content.
- S09.1, S09.2, S09.3: the media library ignored product covers in where-used, sent a renamed folder's image back, and appended stale pages. All three are fixed.
- S10.2: a transient role-check error on tab refocus threw the owner out of the open screen. The gate no longer downgrades on an error.
- S13.1, S13.3: the brand link left the menu open, and the started room's films could vanish. Both are fixed.
- S15.1, S15.2, S15.3: the reader's selectable text sat off the drawn words, page-flip leaked a 60 fps loop after each close (patched), and «عرض للقراءة» dropped focus. All three are fixed.
- S16.1: long Arabic messages failed after Turnstile was spent. The byte check now runs first.
- X7.1: the book hero downloaded the 1200w file on phones. `sizes` is corrected and the image gets `fetchPriority=high`.
- Accessibility (X3.4, X3.5, X3.8, S09.4, S10.4, S10.6, S11.5): admin errors and results are live and tied to their inputs, image-picker focus returns to its opener, the journal cards get an inset focus ring, and the team role select has a name.

**Documentation (S22.1, S22.3, S22.5, S22.16, S22.18, X5.9):** the stale current-state table, the glm-worker and opus-worker rules, the 180-day contact retention (D36 says 90), the reserved-counter and stored-quote contract P07 never built, the policies model, and COVERAGE saying every C-ID was not started. All are rewritten.

**Owner or recorded:** X5.7 (the home order, the book page and the services are code, not CMS: I45) and X5.5 (the /book baseline outside the reader: I47).

The 172 low and 17 info findings (164 + 16 fixed) are in the appendix: smaller correctness edges, 20 dead-code removals, test quality (tests that could not fail, cleanup outside `finally`, screenshots overwriting evidence), 44 stale document statements, tooling pins, and minor accessibility.

## 6. Decisions only the owner can make

**Decided by the owner on 2026-09-30 (D42), after this report:**
1. Commit and push D41 and AUDIT-1: done.
2. Remove the WhatsApp export from the repository and its whole history: done. The folder is untracked and ignored, history is rewritten, and every branch is force-pushed (ISSUES I42, closed).
3. Buyer retention of 90 days: built as `20260930130000_buyer_retention.sql` (a daily job for expired and cancelled holds and orphaned customers) with an integration test; test:db 207/207.
4. Preorder moves from P07 to P08 (WORK-PACKAGES, DATA-AND-SECURITY, COVERAGE).
5. anas.studio is the only name. The earlier V1 domain is gone from the product and the living documents; the frozen v1 design, the signed offer and the pinned v1 sources keep their text as history. The seeded social links stay, and the owner edits them in «الإعدادات» → «روابط التواصل».

The table below is the state as first reported.

| Id | What | Recommendation |
|---|---|---|
| G4.1, G4.4 (I42) | A WhatsApp export, four third-party contact cards and voice notes are tracked and pushed on about ten refs; the frozen manifest pins the transcript. | Untrack it, remove its manifest entry, rewrite history with `git filter-repo`, force-push every branch, and re-clone. This is irreversible and outward-facing, so it was not done. |
| G1.2, S03.4 (I43) | Expired and cancelled holds keep buyer data forever; the contact form neither links nor records the privacy policy. | Set a retention period (for example 30 days for unpaid holds) with E08; the job lands with P08. |
| X5.6 (I44) | Preorder is in P07's text but not built. | Move it to P08, or drop it until Anas has a preorder product. |
| X5.7 (I45) | The home's door order, the book page's words and the services are code. | Keep them in code until Anas asks; COVERAGE marks C03, C12, C13 and C14 partial. |
| G3.3 (I45) | The seeded X handle `anasa.aq` cannot exist. | Anas gives the real handle. |

Recorded as open work: X2.4 (approve the revisions the owner read: I44), S06.4 (the store-wide throttle residual: I44 and `docs/operations.md`), S12.2 beyond the safe baseline (the full CSP is P10: I46), X5.5 (I47), S18.6 (the model routing of workflow agents, section 3).

## 7. Verification (acceptance battery, 2026-09-30, working tree on `a93ccc2`)

| Check | Result |
|---|---|
| `pnpm check` (lint, typecheck, frozen, copy, unit) | exit 0; unit **486/486** (432 before) |
| `deno check` of the six Edge Functions | 6/6 exit 0 |
| `pnpm test:db` (local stack, real JWTs) | exit 0; **205/205** (181 before) |
| `pnpm build` (static export) | exit 0 |
| `pnpm check:export` | exit 0: 51 required files, 320 text files, no secret; the demo guard notes the loopback build |
| `pnpm check:budgets` | exit 0: largest initial JS 147.0 KiB (budget 150) |
| Child films in the export | none (`out/` has no `-kid-` file or string) |
| `pnpm test:e2e` with `ACCEPTANCE_PACKAGE=AUDIT-1` | exit 0: **168/168** in 9.7 min (on a DB reset from zero, content and demo catalog re-imported) |
| `supabase db reset` | exit 0: all 15 migrations, `20260930120000_audit_fixes.sql` included, apply from zero |
| `PLANS/verify-plan.ps1` | every check passes (C-IDs, ownership, frozen hashes with AGENTS.md refreshed for D41, links); its last step, `git diff --check`, flags only the CR bytes of the CRLF `source-manifest.json` while that edit is uncommitted (`git -c core.whitespace=cr-at-eol diff --check` exits 0), as after `b7e0591` |

How the battery got green: the first full e2e run gave 161/168. Four failures were selectors the accessibility fixes had made stale (the reader's arrow is now `aria-hidden`, cart quantities are named after their line, and validation paths are in Arabic); the specs were updated. One was the reader drag, which passes alone 18/18 and in the final run. `auth.spec` failed because repeated test runs had left 1,730 test staff, and the team list stops at PostgREST's 1,000 rows. That exposed an order dependence in a new outbox test, which needed an active owner that only a polluted database had. The test now creates its owner, and the database was reset from zero before the final run. Commands and results are in `commands.txt`.

## 8. Where the project is

Offered scope P00–P11, each package weighted by its complexity in WORK-PACKAGES (high 3, medium 2) and counted at its real completion from code, tests and evidence. P12 (bonus) and the external E-gate inputs are left out. The per-package judgement started from the plan-coverage auditor's reading (X5), then was adjusted for what AUDIT-1 closed: the journal's dates, name and tests; the post preview; the operations and revoked-member tests.

| Package | Weight | Done | What is left |
|---|---|---|---|
| P00 runtime and foundation | 3 | 100% | Hosted re-measurement belongs to P10. |
| P01 public rooms (direction B) | 3 | 93% | The home's door order and the book page in code (I45); a rights field per scene; E05 content and E06 font approvals. |
| P02 book reader | 3 | 95% | The /book baseline outside the reader (I47); E04's final manuscript. |
| P03 staff auth and RLS | 3 | 98% | Google sign-in (no OAuth client); hosted Auth settings (I28). |
| P04 collections and publishing | 2 | 92% | Home reorder (C14, I45); SEO fields used at P10; C19's remainder when Anas asks (D40). |
| P05 media library | 2 | 97% | Hosted `nosniff` on Storage (I32); the unsupported-encoder path has no e2e. |
| P06 settings, home, email, backups | 3 | 93% | Hosted probes, the first hosted backup, the Analytics token (E11); the restore-then-reapply drill. |
| P07 catalog and checkout | 3 | 88% | Preorder (I44); C20 closes with P08; E02 and E03. |
| P08 payments | 3 | 0% | Not started. |
| P09 bookings | 3 | 0% | Not started. |
| P10 quality, SEO, monitoring | 3 | 5% | Structural checks exist; the rest is P10. |
| P11 launch | 2 | 5% | Checklists and scripts prepared; nothing hosted. |

**Overall: about 64%** of the offered scope (2,104 of 3,300 weighted points). It was about 63% before the fixes: the audit mostly raised quality rather than scope. The last reported figure was 44% on 2026-09-27, before P07, DESIGN-B, P02 and CLEANUP-1.

| Phase | Packages | Done |
|---|---|---|
| Foundation | P00–P02 | 96% |
| Administration | P03–P06 | 95% |
| Store and payment | P07–P09 | 29% |
| Launch | P10–P11 | 5% |

The remaining weight is mostly P08 and P09 (the gateway against the local emulator, then bookings), then P10's whole-platform quality pass, then P11's hosting, which needs the owner's authorization and the E gates.

## 9. What was not verified

- Nothing hosted: the password hook, `secure_password_change`, the new migration and the `_headers` rules must be applied and checked on the hosted project at P11 (I28, I32).
- The Resend monthly quota's reset date was not verified. The quota retry probes once a day, so each probe is a single send that answers 429.
- The page-flip patch covers `page-flip.browser.js`, the file the package's `main` resolves to; `page-flip.module.js` is untouched.
