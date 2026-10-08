# Execution status

What has actually been run and accepted, not what is planned. Orchestrator per D28; one writer at a time under `.anasaq-execution.lock`. Preparation, account existence and passing structural checks never close a runtime, payment, rights, launch, training or support gate. Earlier detail (P00 measurements, the Oracle VM episode, audits) is in Git history before 2026-09-24.

## Current state (2026-10-03)

| Field | Value |
|---|---|
| Branch | `main`, the only long-lived branch locally and on GitHub (REPO-SWEEP, 2026-09-30). P08 is built on the short-lived `agent/p08` and fast-forwarded into `main` one accepted round at a time. Before REPO-SWEEP the five older branches (`agent/design-b`, `sync/local-2026-09-26`, `agent/p00-runtime-spike` and two cloud-session branches) were wholly contained in it and are deleted. **History rewritten on 2026-09-30 (D42)** to remove the WhatsApp export: every commit id changed, and the ids in these documents are the rewritten ones (commit messages were remapped too). A clone made before then must be re-cloned, not pulled. |
| Last commit | P08 round 11c `d27d05b` and the pause's plan update (2026-10-03), on rounds 10b `d8bffbe`, 11a `a4b17f9`, 11b `1e85284`, round 10a `994deb0`, on SOON-1 `0b915c5` (D46, D47) and P08 rounds 0 to 9 (ids in the P08 row below), on D45 `02198a6` (roles: Sonnet 5.5 workers at effort max, Opus 5.5 auditors; the P08 kickoff prompt), on top of FOUNDATION-1 `4dd8980` and its evidence `b173053` (Foundation finished, D44), themselves on `3c8228d` (AUDIT-2 evidence; its code and D43 `9bd72b8`); REPO-SWEEP `4f22b78`; AUDIT-1 code and docs `f38f04d`, its evidence `9f6f37f`, D42 untrack `397f4d3`, D41 `c222225`. |
| Packages | P00 (D29 `3c88331`; D32 `eb41c2e`, locally verified on the full stack 2026-09-27), P01 part 1 `70be5c9` with DESIGN-B `2f54f85`/`379790e`, P02 `42708f3`/`4e04ac1`, P03–P05, P06 (accepted 2026-09-27), P07 (accepted 2026-09-28), CLEANUP-1 (2026-09-29), AUDIT-1 (committed `f38f04d`, pushed), AUDIT-2 (audit and fixes, 2026-10-01), FOUNDATION-1 (2026-10-01): see the package ledger. P08 in progress (rounds 0 to 11c accepted and pushed; paused after 11c on 2026-10-03 for a compaction; 12a, 12b, checkpoint (c), the battery and the plan documents left; `PLANS/HANDOFF.md`). SOON-1 live and committed, MAINT-1 built (D46, D47). P09–P12 not started. |
| Lock | None: P08 released `.anasaq-execution.lock` on 2026-10-03 after round 11c, for the pause. It is taken again for round 12a (`PLANS/HANDOFF.md`, "How to continue P08"). |
| Hosted resources | Supabase Free project `amqcphsmnopandhoxzsr` (ap-south-1). Unused since D32 and the owner's to delete once the Pages site works (irreversible, his own action): Worker `anas-studio` (test), R2 `anas-studio-media-test`, Hyperdrive `anasaq-cms`, D1 `anas-studio-tag-cache`. Live on the owner's word (D46): the Worker `anas-studio-soon` in Anas's Cloudflare account, with the Custom Domains anas.studio and www (the soon page; P11 retires it at the launch). No other deploy until P11 (local-first). |

## DESIGN-B: direction B in the product (D39, orchestrator, 2026-09-28)

**Scope.** Anas picked direction B «أنساق», with cover B and standing mockup B. The owner assigned the design work to the orchestrator alone (no sub-agents, no GLM). The work is on branch `agent/design-b` from `41658d3`, under the lock; committed on the owner's word (`2f54f85`, `379790e`, 2026-09-28) and pushed with P02 (`origin/agent/design-b` at `4e04ac1`, 2026-09-29).

**What was built.**
- **Design system:**
  - tokens: the palette, the seven tones, type roles, spacing, motion and layering (`src/styles/`);
  - the weave components (`src/components/weave/`): bands, crenel and weave edges, the signature from Anas's own vector, actions, figures, films, room doors, section contents, and motion as enhancement only.
- **Site chrome:** a sticky header with the woven full-screen menu (native dialog), and the footer.
- **Pages:**
  - home; the four rooms; the book (cover B, standing B);
  - المجلس (list, article, empty state); المَشاهد (filter and lightbox);
  - تواصل (the real form on the `contact` function, services that fill it);
  - 404 and error;
  - the store, product, cart, checkout and policy pages restyled (D38);
  - the admin retokenized.
- **Content model:**
  - rooms: `jewel` is the room's colour, plus `tagline`, `bandLines`, built's and moonlight's `pullLines`, the started movements' `films`, the thura flavours' `regions` and item `status`;
  - `site_settings.home` holds the home page's words;
  - `content/initial-content.json` updated and re-imported locally;
  - words not yet in the CMS live in `src/content/` (the book page, the home doors and the services moved into the CMS in FOUNDATION-1, D44).
- **Truthful states:**
  - nothing is a placeholder;
  - the availability sign-ups (P08), booking (P09) and the reader (P02) were not shown (the reader shipped in P02 the same day);
  - the five films with children stay hidden until guardians consent (Anas consented; they are back since FOUNDATION-1, D44).
- **Docs:** `DESIGN.md` (the system and its recipes), `PRODUCT.md`, D39, the DESIGN-AUDIT recheck.

**Evidence.** `artifacts/acceptance/DESIGN-B/commands.txt` and `screenshots/`:
- check: unit 382, lint 0 errors;
- test:db 178;
- build, export and budgets (largest 145.3 KiB);
- e2e: public 26/26, cms 3/3, media 8/8, cart-checkout 11/11, visual 50/50;
- the motion-on scroll check: 0 held elements.

**Design audit (tasmeem, 2026-09-28).** Every finding of `artifacts/acceptance/DESIGN-B/tasmeem-audit/FINDINGS.md` is acted on, in two rounds (`after/FIXES.md`): P0 4 → 1, P1 14 → 0, P2 18 → 1. What is left:
- row 4, the local demo policies: a launch check (I40);
- row 5, the owner's kept «عبدالله» crossing: a note;
- row 19, the section bar's sticky `top` transition: a documented exception.

Round 2 re-proved check, build, export, budgets, e2e (public, cart-checkout, auth, visual, cms, media: 100/100) and the motion check.

**Open for the owner and Anas.**
- The paper edition's details and prices.
- The book's characters: done in FOUNDATION-1 (D44).
- The 2013 photo: there is none (D44).
- Session booking (P09). (The reader shipped in P02.)
- The services moving into the CMS: done in FOUNDATION-1 (D44). (The social links moved into `site_settings.social` in CLEANUP-1, C09.)
- Room versions saved before D39 lack the new fields: restoring one needs its colour and line filled before it can be published.

## Process note, 2026-09-26 (owner-authorized)

The two audit-fix passes (`36235e0` and this commit) were written by the ZCode
(GLM-5.3) coordinator session dispatching four parallel sub-agents per pass
with disjoint, enumerated file ownership — one agent per file, no overlaps —
plus coordinator-owned seam fixes and this ledger. This deviates from
CLAUDE.md's single-writer spawn rule (D28) and was explicitly ordered by the
owner ("make sure to run sub-agents 4 at a time... no more than one agent
work in one file at the same time"). Models: coordinator ZCode GLM-5.3;
sub-agents general-purpose on the session model; no glm-worker process was
involved. The CLI orchestrator's `.anasaq-execution.lock` (status: P06 round
2, building) was left untouched — it belongs to the CLI session, which will
reconcile on resume.

Migration `20260926120000` was edited in place under the same version during
both fix passes. This is safe: it has only ever been applied to the resettable
local database (P06 is local-only, no deploy per the lock), and the hosted
project receives migrations only at P11. The local DB is reset after each
edit; the hosted first-apply will get the final version.

Cloud audit pass (2026-09-26, owner-authorized): the cloud reviewer, which
had audited `4518520` and `36235e0` read-only, was made the writer for one
pass while the local machine stayed idle, so there was still one writer. It
audited `518fe19`, then fixed what it found in small labeled commits
`8935c62`…`25b90c0` on branch `claude/keen-mayer-iuyfz0` (cut from `518fe19`)
plus the commit that records this note; the model is named in each commit's
Co-Authored-By trailer. It edited the P06 migration in place once more
(`outbox_claim`'s quota count), under the same resettable-local-only
reasoning as above. It could not run the Supabase stack: the database, e2e
and screenshot items it lists as pending local verification were run after
its push by the local session and all passed (one timezone-dependent test
fixed on top, recorded in `artifacts/acceptance/P06/commands.txt`). The
cloud verification of that local pass (`488ff51`) found one more defect in
the cloud's own D13 fix and fixed it in `3fef85b` (D18, same file).

## Owner decisions, 2026-09-26: D32–D34, static site, Thmanyah only, no tax

- The owner asked why this project struggled on the free Cloudflare tier while his Ekka-Rekaz (100k+ lines) runs on Pages without issues. The difference is the build, not the host: Ekka is static files on Pages with Supabase Edge Functions; this project ran the whole Next server on a Worker (I21, I23, I30). He then asked for "THE BEST PLAN EVER / THE BEST STACK EVER" and approved the D32–D34 plan.
- D33 (`6fbf724`): Thmanyah is the only font; Lyon deleted from the site, the repo and the frozen reference copies (owner override for those files).
- D32 (`eb41c2e`): Next.js `output: 'export'` to `out/` for Cloudflare Pages; publishing from the admin calls the SQL functions as the signed-in staff member and requests a coalesced Pages rebuild through pg_cron; the draft preview is `/admin/preview`; the Edge Functions `contact`, `resend-webhook`, `outbox` (pg_cron through `outbox_kick()`) and `admin` (media tickets and checks, stats, settings status) over `supabase/functions/_shared/`; Supabase Storage buckets `media-private`/`media-public`; `service_role` replaces `app_server`, which is dropped. Removed: OpenNext, wrangler, Hyperdrive, the R2/D1 bindings, the Worker cron, `src/app/api/**`. I04, I05, I08, I09, I21, I23 and I30 closed as moot; I29 restated for Storage; I32 (hosted checks) and I33 (room videos) opened.
- D34: no tax anywhere; the site launches before payments with the store «قريباً»; E02 blocks paid operation only.
- Flag for Anas: the offer lists Cloudflare R2 for images and files (lines 1556, 1785, 1956). Supabase Storage fills that role now; like D29 for Payload, he is told, and R2 through its S3 API stays a bounded change behind `MediaStore` if he wants it.
- Cloud checks and the pending local list are at the end of `artifacts/acceptance/P06/commands.txt`.

## Owner decision, 2026-09-26: D31, the owner's mailbox is the inbox

- Anas uses his own Gmail; `help@anas.studio` is a Cloudflare Email Routing address forwarding to it (his launch step, no code). Building an email interface in the admin is not worth it.
- Done by the cloud writer after the owner approved the plan: the الوارد screen, its nav link and home count are removed; the contact notice carries Reply-To set to the visitor and no admin link; `public.contacts` is server-only (no API grant, no status/notes/assignment; the P06 migration edited in place, local-only, same precedent as above); settings lists the Email Routing step. Commits `979bfcc`, `cfe6bed` and the one recording this.
- Kept: the contact form and its protections, the outbox, Resend, the bounce webhook and the البريد failed-sends page, because automatic customer mail (receipts, download links, bookings, availability notices, Supabase Auth SMTP) still needs them. Email Routing cannot send.
- Moved: the availability opt-in routes (`notify`, `notify/confirm`, `notify/unsubscribe`) and the notifications collection go from P06 round 3 to P08, where products exist.

## Owner decisions, 2026-09-24

- D29 approved: custom Supabase admin at `/admin` in the same app; Payload removed; the Oracle VM withdrawn.
- Admin UI uses the site's main theme colors and design tokens.
- Staff sign-in is passwordless: Supabase email code, and Google sign-in once a Google OAuth client exists. Owner step-up (TOTP) stays only for refunds, role changes and invites (D13).
- Clean the repository before going further: remove stale docs, files and code.
- Design work is paused; the frozen handoff design stays the reference when it resumes (I25).

## P01 round 3 audit (orchestrator, 2026-09-24)

- `pnpm lint`, `typecheck`, `test` (5 files, 34 tests), `check:copy` and `check:frozen` exit 0.
- Code read of every round 3 edit. Fix 1: the thura grid shows 7 photos with no orphan, and the lead photo matches the portrait source. Fix 2: the next-room link gets section rhythm. Fix 3: `prefetch={false}` on the error and not-found links. Fix 4: the reel reload stays unconditional, with the measured reason documented in `VideoReel.tsx`.
- One `next dev` pass of `/shelf` and an unknown URL at 360 and 1440. No horizontal overflow; zero RSC requests in 3 s idle (the I23 loop is gone); unknown URL returns 404.
- Findings: I27 (default English 404 for unmatched URLs, missing favicon, inline-styled error button). None blocks a part 1 checkpoint commit.
- Under D29 everything in P01 part 1 stays: it reads `content/initial-content.json` and touches no Payload code. `sharp` is a devDependency used only by the offline `scripts/prepare-media.mjs`, not by the app. The P00 swap must confirm it stays out of the Worker bundle.
- `/started` holds the orchestrator's handoff-composition rework. The owner did not accept it, and the earlier worker version was overwritten, so the commit records it as "design pending", not accepted.

## P00 D29 swap audit (orchestrator, 2026-09-24)

- Orchestrator: `supabase/config.toml` (sign-up off, email code, TOTP, Google wired and off), migration `20260924130000_staff_and_app_server.sql` and local-only `seed.sql`. SQL checks pass: deny-by-default grants, own-row/owner-all staff reads, last-owner guard (deactivate, demote, delete), revocation on next query, `app_server` EXECUTE-only.
- Worker (fresh `sonnet-worker` after a 429 stop that wrote nothing): Payload, the VM target and the probe removed; `db.ts`/health on `app_server`; worker-entry keeps only the revalidate gate; env tests (I03); docs rewritten.
- Orchestrator fixes: pg client timeouts; I27 global 404.
- Evidence: `artifacts/acceptance/P00/d29-swap/` (commands.txt, migration checks, 404 screenshot). All checks exit 0; 48 unit tests; Linux Worker upload 5,494 KiB; no secret key, sharp or Payload in the upload. One unexplained, non-reproducing health 503 is recorded.

## P03 audit (orchestrator, 2026-09-25)

- Orchestrator: migration (audit_events, staff_directory, service_role grants), auth config and Arabic code email, `staff-admin` Edge Function and its TOTP-freshness check with unit tests.
- Worker (`sonnet-worker`, `claude-sonnet-5` on every call): admin shell (sign-in by email code, security/TOTP, team with step-up dialog), browser client, `db:env` and `bootstrap:owner` scripts, real-JWT integration tests, e2e.
- Defects found and fixed: two in the orchestrator's own files (missing service_role grants; email provider switched off) and three in worker output (admin page overflow, a wrong e2e expectation, parallel DB tests). Details in `artifacts/acceptance/P03/commands.txt`.
- Results: static checks and build exit 0; 53 unit and 11 integration tests; 5 e2e; 13 SQL checks; admin screenshots at 360 and 1440 without overflow. Google sign-in and hosted auth settings remain open (I28).

## P04 part 1 audit (orchestrator, 2026-09-25)

- Orchestrator: migration (versions, live copy, publishing functions for `app_server`, `publish_due()` on pg_cron, revalidation through pg_net with Vault values) and local Vault seed.
- Worker (`sonnet-worker`): collection configs and Zod field model, database-backed loaders with cache tags, server-side publish module, idempotent local importer, CI with the local stack, tests.
- Fixed by the orchestrator: the old verbatim test broke typecheck/build; the publish module skipped validation when it could not read the draft (now fails closed). Accepted: CI uses the official `supabase/setup-cli`, SHA verified against its v3.0.1 tag.
- Results: static checks and build 0; 65 unit, 28 integration, 23 e2e; 24 SQL checks; the scheduled-publish chain proven end to end on `next dev`. Production-cache revalidation stays for P10. Evidence: `artifacts/acceptance/P04/`.

## P04 part 2 audit (orchestrator, 2026-09-25)

- Orchestrator: rich-text allowlist and safe renderer, `/api/preview` (staff token and role checked, httpOnly cookie, draft mode), draft reads in the loaders, `/started` data wiring (art keyed by year, hidden reels honoured).
- Worker round 1: content screens, generic form, Lexical editor, publish bar, version history, server actions. It wrote `vitest.config.ts` outside the allowlist (reverted; the cause was an import style in the orchestrator's own file). Its e2e tests fell short of the brief and left test content live.
- Worker round 2 (fresh): e2e rewritten to the brief; duplicate React key in the form fixed.
- Results: static checks and build 0; 71 unit, 28 integration, 26 e2e. One unexplained, non-recurring e2e timeout is recorded. Evidence: `artifacts/acceptance/P04/`.

## P05 round 1 audit (orchestrator, 2026-09-26)

- Orchestrator: migration `20260926090000_media_library.sql` (media table with RLS; anon reads only id and derivatives of media a published document uses; server-owned tickets; claim, complete and delete functions for `app_server`; where-used over live, scheduled and latest versions; folder rename).
- Worker (`glm-worker`, GLM-5.3, first run under D30; 29 minutes): ticket, part upload and completion routes, magic-byte and dimension checks from bounded reads (`image-size`; `file-type` was dropped in the round 2 audit because it breaks the Worker bundle), promotion to the public bucket, the local `/media` stand-in with nosniff and a sandbox CSP, media references in the loaders and `Picture`, the publish check for missing media, tests and docs.
- Fixed by the orchestrator: a second completion could delete the first one's objects, and a part could be swapped between check and promotion (fix: a one-time claim, and each derivative verified and promoted from the same bytes); md5 stored as `{}`; an oversized range read; an unmeasured CPU claim. Hosted media origin and R2 housekeeping are recorded as I29.
- Results: `pnpm check` 0 (104 unit); `test:db` 0 (46); media and CMS e2e 8 passed on `next dev`. Evidence: `artifacts/acceptance/P05/commands.txt`.

## P05 round 2 audit and acceptance (orchestrator, 2026-09-26)

- Worker (`glm-worker`, 51 minutes): the library screen (folders, search, paging, details, where-used, guarded delete), the upload dialog (`react-easy-crop`, canvas WebP at 360/720/1200/1800 without upscaling, a new ticket on retry), the image picker in collection forms, the browser e2e proof and screenshots. It caught a wrong URL shape in the orchestrator's brief.
- Fixed by the orchestrator: the details column squeezed the grid to one column inside the reading-width admin page (details now sit above the grid and take focus); the next upload inherited the previous image's alt and rights; delete was enabled before where-used loaded; `file-type` broke the Linux Worker bundle (it imports `strtok3`), so `image-size` now does the type check alone.
- Results: `pnpm check` 0 (109 unit); `test:db` 0 (46); media, CMS and auth e2e 13 passed; screenshots at 360 and 1440 without overflow; Linux `build:worker` and dry-run 0, 10,460 KiB upload (P04 commit 9,653 KiB, so P05 adds 8%), no Sharp, no secret key. Every P05 proof item is mapped in `artifacts/acceptance/P05/commands.txt`. Open: I29 (hosted media origin and R2 housekeeping, P11); upload CPU and the grown Worker's startup, with I21 at P10.

## P06 round 1 audit (orchestrator, 2026-09-26)

- Orchestrator: migration `20260926120000_contacts_and_email.sql` (inbox table with RLS for owner and operations; private `finance` schema with the outbox, delivery events, suppressions, throttles and job runs; `contact_submit`, `outbox_claim`/`outbox_result`, `email_event_record` for `app_server`; `outbox_attention`/`outbox_replay`/`job_runs_latest` for staff).
- Worker (`glm-worker`, 64 minutes): the contact API (Turnstile, honeypot, throttles), the email adapter (Resend, Mailpit locally, plain text with bidi isolates), the outbox dispatcher, the Svix-verified Resend webhook, the jobs endpoint and Worker cron trigger, tests and `docs/operations.md`.
- Incident: the first local e2e run called the real Resend API with the key in `.env` (`next dev` loads it). Resend refused all ~31 requests (unverified sender); no email was delivered and all recipients were test addresses. Fixed in code: real email only from a production build with a non-local `SITE_URL`; regression tests added.
- Also fixed: the webhook acknowledged failed writes (lost bounces); malformed event fields could fail every redelivery.
- Results: `pnpm check` 0 (152 unit); `test:db` 0 (78); e2e 20 passed on `next dev` with no real provider call. Evidence: `artifacts/acceptance/P06/commands.txt`.

## P02: the book preview reader (orchestrator, 2026-09-28)

**Scope.** The owner: "P02 should done ... ANAS provide two or three PDF texts ... we only want to let users see these then had to buy the whole book to read ... you should do it". Built by the orchestrator alone (no GLM, no sub-agents) under its own lock.

**What was built** (details in `docs/book-preview.md`):
- **The public copy.** `scripts/prepare-preview.py` exports the three fragments (الإهداء، المقدمة، two pages of «صورة الروضة») into one 5-page `public/book/khous-preview.pdf`.
  - Page content and fonts are copied unchanged; metadata (Anas's email), actions, scripts, attachments, annotations and the structure tree are dropped.
  - It is checked before it is written, and it is pixel-identical to the sources.
  - Hashes and the approval are recorded in `content/book-source-manifest.json`.
- **The reader, on /book «صفحات من الكتاب».**
  - The closed book loads nothing; «افتح الكتاب» loads pdf.js 6.3.289 and page-flip 2.0.7 (pinned, D10) in their own chunk.
  - The book is physical and Arabic: bound on the right, the left page turns to the right, ← is next.
  - At most six canvases, and a stale render is cancelled.
  - Controls: keys, page jump, full screen. Pages change in place under reduced motion.
  - Phones open «صفحات متتالية», where two fingers zoom.
  - A closing leaf «بقية الحكاية في الكتاب» leads to the editions.
  - Failures say so, with a retry and the PDF link. Without JavaScript the button is the PDF link.
- **Two pdf.js findings, handled.**
  - Chrome drew Word's joined Arabic glyphs as unjoined letters through font faces, so the reader draws glyph outlines.
  - pdf.js reverses lam-alef ligatures in its text, so the selectable layer is fixed against pypdf's text, which is also what screen readers get.

**Evidence.** `artifacts/acceptance/P02/commands.txt` and `screenshots/`:
- `pnpm check`: unit 394;
- build, export (26 required files, the preview among them) and budgets (/book 141.2 KiB, largest 145.9);
- e2e: reader 12/12 on the dev server and 12/12 on the static export; public and visual 76/76.

**Round 2, after the owner's audit (2026-09-28).** The owner asked for a deep tasmeem audit ("it looks weak … I should see flipping action … the cover looks shorter than the actual pages"), read the 15 findings, then said "GO AHEAD DO THE BEST, VERY THOUGHTFULLY".
- The book is now a 4:5 hardcover (8×10 in, cover B's shape), with:
  - boards, endpapers, parts on left-hand pages;
  - page edges and the spine's shadow;
  - warm paper;
  - the closed book centred on one stage (no layout jump).
- Motion and phones:
  - under reduced motion, a fade instead of a rotation;
  - phones open the book;
  - «عرض للقراءة» shows the pages at reading size.
- Record: `artifacts/acceptance/P02/tasmeem-audit/FINDINGS.md` and `after/FIXES.md`. tasmeem after: PASS. e2e: reader 14/14 on dev and on the export; public and visual 76/76.

**Round 3, audit-2 (2026-09-28).** The owner asked for a new deep audit: some pages had no scroll animations, and the reader's bottom-right corner seemed not to turn. Then: "go, yes on 3", the money pages "serious and official", and "once all fixes done commit".
- **The cause of the missing animations.** On `next dev`, React's StrictMode double run made `MotionLayer` take every first visit for a return, so no reveal played. The export was right.
  - Fixed: a return now skips only the entrances.
  - Fixed: the cart, the checkout and the policies are calm and official, and have no reveals.
  - Added: motion for the store, a product and the scenes grid.
- **The reader.** One page at a time, a click now turns by its half and never stops on an empty leaf. There are corner hints both ways, and a corner click that closes the book slides with the turn.
- **Tests.** An opus-worker (Opus 5.5, effort xhigh, on the owner's word) wrote `tests/e2e/motion.spec.ts` and 4 reader tests, audited by the orchestrator; they caught one real bug in the first fix.
- **Proof.**
  - Unit 397/397.
  - e2e on dev: motion + reader 33/33 (the reader's timing tests 20/20 ×5), public + visual + cart-checkout 87/87.
  - e2e on the export: motion + reader 33/33.
  - Budgets: largest 146.1 KiB.
- Record: `artifacts/acceptance/P02/audit-2/FINDINGS.md` (findings and result) and `commands.txt`.

**Open.** E04's final manuscript, and with it the digital sale (the typeset interior, when it exists, replaces the Word pages through the same script). When Anas approves other pages, `docs/book-preview.md` "Updating it" is the recipe.

## CLEANUP-1 + PLAN-GAPS (orchestrator, 2026-09-29)

**Scope.** The owner (2026-09-29): a quick cleanup, the social links editable (C09), the scenes as an admin collection (C05), and the project-pages decision (C04, C19). Built on `agent/design-b` from `4e04ac1` under one lock by `opus-worker` rounds (Opus 5.5, effort max), each audited by a fresh `auditor`; the first orchestrator session died twice (a `/compact` sent while a background workflow ran) and a second session finished the package with foreground agents only.

**What changed.**
- **Cleanup (W1).** Every Edge Function passes `deno check`; the three admin lint warnings are gone (lint 0 problems); `pnpm check:export` now carries the I40 demo guard (`scripts/lib/demo-guard.mjs`).
- **Cleanup (orchestrator).** The site icon (`src/app/icon.svg`, `src/app/apple-icon.png`, `public/favicon.ico`) ends the `/favicon.ico` 404. On Windows the export scan now reads `out/_headers` too (a gap W1 reported), and it requires the scenes and policies edit shells.
- **Social links (W2, C09).** `site_settings.social` («روابط التواصل»): network, handle and an https-only link, added, ordered and removed in the admin; the footer shows the first, /contact all of them; `SOCIAL` left `src/content/site.ts`.
- **Scenes (W3, C05).** The collection `scenes` with one document `gallery` (migration `20260929120000_scenes_collection.sql`): each photo is an image, one of Anas's five categories (a select, checked at publish and again at build) and a caption; ordered, hideable. The 19 photos moved byte for byte into `content/initial-content.json`; /scenes reads the published gallery, skips hidden photos, unresolved images and empty categories, and says «لا توجد مَشاهد بعد.» before the first publish. `SceneGallery` and the D39 design are unchanged.
- **D40.** No separate project pages: Anas's projects are items of the room documents. C19 is met only in part: D40 lists what each room lets the admin add, order and hide. ARCHITECTURE, DATA-AND-SECURITY, WORK-PACKAGES and COVERAGE (C04, C19) follow it.
- **Test isolation.** `owner-operations.spec.ts` restores the settings version that was live at its start, not the oldest one (which predates the social links).

**Evidence.** `artifacts/acceptance/CLEANUP-1/commands.txt` (the proof map), the round reports `w1.md`–`w3.md`, the audit records `audit-w1.json`, `audit-w2.json`, `recheck-w2.json`, `audit-w3.json`, `final-audit.json` and its three rechecks `recheck-final*.json`, and `screenshots/`:
- check: lint 0 problems, typecheck, frozen, copy, unit 432/432;
- test:db 181/181;
- e2e with `ACCEPTANCE_PACKAGE=CLEANUP-1`: 168/168, visual 50/50 among them;
- build, export (the demo guard's line) and budgets (largest 146.1 KiB);
- the footer, /contact and /scenes from the export and the two admin screens at 360 and 1440, every changed control exercised, 0 overflow, 0 console errors, no favicon 404.

**Open.**
- The owner and Anas: a per-photo rights or credit field for the scenes (C05 names "rights"; the brief defined image, category and caption only); a new stage in بنيتُ هنا (a design for stages beyond the two, D39), a new shelf idea, text and a status for an added project, and per-project figures (D40, C19).
- P11: I41 (the hosted content bootstrap needs the social links and the gallery) and I40's launch steps.

## AUDIT-1: deep audit of everything built, and the fixes (orchestrator, 2026-09-30)

**Scope.** The owner (2026-09-30): "deep audit everything been built so far, find all issues, fix them all before proceeding … combine all findings in one full report, update all stale docs". Everything through `a93ccc2` plus the uncommitted D41 change was audited. The full report is `artifacts/acceptance/AUDIT-1/REPORT.md`, and every finding with its outcome is in `APPENDIX-findings.md`.

**Audit.** A read-only workflow (`wf_0902627f-f2d`) ran 29 specialist auditors (file slices plus security, concurrency, accessibility and RTL, visual design, plan coverage, dead code and performance lenses), a completeness critic, 5 gap auditors, deduplication and adversarial verification (three independent verifiers per critical or high finding). 324 raw findings became 258 unique and **253 confirmed**: 0 critical, 2 high (G4.2: the five films with children shipped in every export; S08.2: autosave erased the unsaved copy it offered), 62 medium, 172 low, 17 info. The verifiers refuted 5.

**Fixes.** Under the lock, one writer at a time: the orchestrator fixed G4.2 first, then a fix workflow (`wf_c80bdd18-a3a`) ran 11 sequential rounds of a fresh `sonnet-worker` plus an independent `auditor` (D41, model set explicitly), and the orchestrator closed what the rounds left. **241 fixed**, 7 wait for the owner (ISSUES I42–I45), 5 are recorded as open (I44, I46, I47, docs). The main changes:
- One forward migration, `20260930120000_audit_fixes.sql`, with these parts:
  - a Custom Access Token hook that refuses password sign-in (D08);
  - hidden posts no longer public through RLS;
  - a changed approved policy clears the approval;
  - publishing refuses a stale version under a per-document lock;
  - `publish_due` isolates each row;
  - the job-run purge keeps each job's newest run;
  - the outbox keeps a reserve for sign-in codes;
  - Resend quota answers wait for the next UTC day;
  - exhausted rows follow the replay rule;
  - notices to revoked staff are dropped;
  - early webhook events are applied;
  - the audit trail is complete;
  - a published product's cover is guarded;
  - functions are deny-by-default for future migrations too.
- The editor no longer loses text. Posts have a draft preview. Pasted content fits the allowlist. The media library covers products, renames and paging. Admin messages reach screen readers. The team, store and money forms follow the database rules.
- The public site:
  - the journal has an editable name (D11), dates and a tested list, filter and article;
  - the contact form cannot leak fields without JavaScript;
  - the store fixes cover the cart, coupon Enter, quote failures, consent links and dedications;
  - the reader's text layer is aligned, page-flip is patched for its loop leak, and focus is kept.
- Backups: the linked project is found, an empty last entry is readable, and `--extract` refuses the repository.
- Checks now fail when they should: `--passWithNoTests` removed, check:export's list widened, check:copy scans the content, budgets refuse an empty build.
- Tests that could not fail were fixed, and cleanup now runs in `finally`.
- 44 stale document statements were corrected.

**Evidence** (`artifacts/acceptance/AUDIT-1/commands.txt`):
- check: unit **486/486** (432 before), lint and typecheck 0;
- deno check 6/6;
- `supabase db reset` applies every migration from zero;
- test:db **205/205** on a clean reset (181 before);
- build, check:export (51 required files, no secret, no child-film file) and check:budgets (largest 147.0 KiB);
- e2e **168/168** on the reset database (the first run, 161/168, surfaced stale selectors and test-data pollution, both fixed).

**Owner decisions after the report (2026-09-30, D42).**
- Commit and push: done.
- The WhatsApp export is out of the repository and its whole history: untracked (`397f4d3`), then `git filter-branch` removed the folder from all 116 commits and every branch was force-pushed with a lease on its old value. Only that folder changed; commit ids in messages and documents were remapped. A full bundle of the old history and a copy of the folder are kept outside the repository at `../anas-studio-backup-2026-09-30/`, for the owner to delete when satisfied.
- Buyer retention of 90 days: `20260930130000_buyer_retention.sql` and its test (test:db 207/207).
- Preorder moves to P08.
- anas.studio is the only name.
- The seeded social links stay, edited by the owner in «روابط التواصل».

**Open.** I43 (the contact form and the privacy policy, E08), I44 (policy-approval and throttle residuals), I45 (Anas inputs), I46, I47. Nothing hosted was changed: I28 now also lists the password hook and "Secure password change" for P11.

## AUDIT-2: the open-code-review audit and its fixes (orchestrator, 2026-09-30 to 10-01)

**Scope.** The owner (2026-09-30): find Alibaba's open-code-review skill "then we want to use it to deep audit our current app status", then "do all needed work, you decide for me". The tree after AUDIT-1 (`4f22b78`) was audited. The report is `artifacts/acceptance/AUDIT-2/REPORT.md`; every finding with both verification verdicts is in `findings.json`, and the fix rounds' briefs in `rounds/`.

**Audit.** open-code-review (`ocr` v1.12.2) in delegation mode, because its own model setting is GLM (D41):
- `ocr scan --preview` chose 265 source files (about 33,700 lines) and `ocr delegate rule` their rules; `ocr delegate preview -c f38f04d` chose the 123 files of the AUDIT-1 fix commit for a regression hunt.
- A read-only workflow (`wf_2dbde205-515`, 247 agent runs over two runs): 27 OCR slices and 5 lenses (security, money, data contracts, accessibility and RTL, health checks), a completeness critic and 5 gap auditors, then adversarial verification; the second run re-verified about 60 findings independently, and the orchestrator ruled where the two disagreed.
- Result: 254 raw findings, **0 critical or high**, 11 distinct mediums, 147 low entries, 14 latent until P08 opens checkout, 16 split verdicts, 5 environment findings, 56 refuted. Two mediums were incomplete AUDIT-1 fixes: the stale-version 40001 that PostgREST retries forever (commerce settings and policy approval) and the S08.2 autosave path through «حفظ».
- Environment: graft's session-start upkeep rewrote six committed files and recreated the nine agent-config paths `4f22b78` deleted, because the global CLI (0.16.0) and the pinned MCP (0.21.1) disagreed with its wiring stamp. Fixed outside the repository: the global CLI is 0.21.1, the stamp lists only Claude and AGENTS.md, and the hook and MCP start were shown to leave the tree clean.

**Fixes (AUDIT-2-FIX).** Under the lock, a workflow (`wf_c600ebdd-922`, 34 agents, about 7 hours) ran 11 sequential rounds of one `sonnet-worker` each, with a Sonnet pre-audit and up to two re-fix rounds (R03, R08, R10 and R11 needed them). 177 findings were handled: 166 fixed in the rounds, 3 already fixed, 8 handed to the orchestrator. Then, per the owner's rule of 2026-10-01 (D43), the orchestrator audited the whole diff itself and fixed what it found:
- the typecheck and build failed on a stale `.next` type file and the git-excluded `BOOK_ASSETS/` site copy (now excluded in `tsconfig.json`);
- `check:copy` failed on an Arabic-Indic example in a comment;
- the admin's date field threw on a five-digit year; a media folder of spaces became a new folder; failed statistics were cached for five minutes (now 30 seconds);
- the draft preview showed no library alt text and the stock journal name; blank home and room titles could be published; the built room's movement image fields were edited but never shown (removed); half-filled lattices painted a solid line-colour cell at tablet width;
- signing out deleted unsaved local copies without a word (now it asks);
- the reader's turn guard dropped an arrow pressed during the opening turn (the e2e caught it); a move asked for during a turn now waits for it.
Left open: I48 (the checkout items for P08), I49 (upload byte cap, rotated AVIF/WebP/PNG, Edge Function type check in CI, optional export patterns, budget headroom), and I45 (3) (whether the site shows a contact e-mail).

**Evidence** (`artifacts/acceptance/AUDIT-2/commands.txt`): lint and typecheck 0; unit **632/632** (486 before); check:copy and check:frozen OK; `supabase db reset` applies every migration including `20260930140000_audit2_fixes.sql`; test:db **230/230** with the edge runtime running (207 before); build, check:export (51 required files, no secret, no child-film file) and check:budgets (largest 147.4 KiB of 150); e2e **169/169** on each suite's last run (on the way: an environment failure, Mailpit's dead forwarded port; one reader regression, fixed in the code; four tests that encoded the old behaviour, updated; see `commands.txt`); screenshots of the changed lattice at 360, 768 and 1440.

## FOUNDATION-1: finishing Foundation (orchestrator, 2026-10-01)

**Scope.** The owner (2026-10-01): "finish foundation / there is no 2013 photo / the characters use only what in the first pages anas provided / the five films are consented as per ANAS / yes make pages editable / yes I told anas about supabase instede of cloudflare" (D44). The report is `artifacts/acceptance/FOUNDATION-1/REPORT.md`.

**Built** (workflow `wf_a57c6e1c-19d`: four sequential rounds of one `sonnet-worker` each, each with a Sonnet pre-audit; then the orchestrator's own audit of the whole diff, D43):
- the book page is the `rooms/book` document («كتبتُ هنا») in the admin, with a draft preview; its new «الشخصيات» section shows four characters quoted exactly from Anas's first pages, each with its source;
- the home's room doors (`site_settings.home.doors`) and the contact page's words and services (`site_settings.contactPage`) are edited in «الإعدادات»; `src/content/book.ts`, `home.ts` and `contact.ts` are deleted;
- the five films with children are back in «بدأتُ من هنا» with their posters, and the export check no longer refuses them;
- CI type-checks every Edge Function with Deno 2.9.6 (I49 item 3); a new JavaScript-off spec; a new e2e test edits and publishes the book page, the doors and the contact page;
- the orchestrator's audit fixes: a blank contact title or services title could be published (both are now required); and in the editor two overlapping loads of a document could land one after the other, so an edit made in between was offered as an "unsaved local copy" and the form hidden (the acceptance run caught it; only the newest load applies now);
- docs: D44; E06 withdrawn; COVERAGE C03, C13 and C32 met, C01, C06, C12 and C14 updated; ISSUES I33, I41, I45 and I49; HANDOFF, DESIGN.md and the docs that described the old state.

**Evidence** (`artifacts/acceptance/FOUNDATION-1/`): lint and typecheck 0; unit **648/648**; check:copy and check:frozen OK; `supabase db reset` and the imports (7 documents); test:db **232/232** with the edge runtime; build, check:export (51 required files, no secret) and check:budgets (largest 147.4 KiB of 150); e2e **174/174** (the first attempt crashed Chrome: about 60 headless Chrome processes left from an earlier session were running; they were stopped and the run repeated from a fresh reset). The Phase 1 gate and the P00 D32 proof map are in the report.

## Package ledger

| Package | Status | Evidence |
|---|---|---|
| P00 | public runtime accepted; D29 swap audited and committed `3c88331` | `artifacts/acceptance/P00/`, `docs/runtime-spike.md` (rewritten by the swap) |
| P01 | part 1 committed (`70be5c9`); D39 direction B ported for every public page (DESIGN-B, committed `2f54f85`, `379790e`) | `artifacts/acceptance/P01/`, `artifacts/acceptance/DESIGN-B/` |
| DESIGN-B | committed on the owner's word (2026-09-28: "commit"): `2f54f85` (code and docs), `379790e` (evidence); lock released | `artifacts/acceptance/DESIGN-B/` |
| P02 | committed on the owner's word (2026-09-28: "once all fixes done commit") on `agent/design-b`, after audit-2: the book preview reader on /book with Anas's three approved fragments, plus the audit-2 site fixes (motion on dev, calm money pages); E04's preview range approved by the owner, the final manuscript still open; lock released | `artifacts/acceptance/P02/`, `docs/book-preview.md` |
| CLEANUP-1 | built and audited on `agent/design-b` (2026-09-29): cleanup (deno check, lint, I40 demo guard, favicon), social links in the admin (C09), the scenes collection (C05), D40 (projects stay in the room documents, C04/C19); acceptance battery green (unit 432, test:db 181, e2e 168/168, build, export, budgets); committed on the owner's word (2026-09-29: "I authorize the commits"), not pushed; lock released | `artifacts/acceptance/CLEANUP-1/` |
| P03 | accepted, committed `0da3910` | `artifacts/acceptance/P03/` |
| P04 | accepted, committed `62a958c` and `54f46fc` | `artifacts/acceptance/P04/` |
| P05 | accepted, committed `df0d5a9` | `artifacts/acceptance/P05/` |
| P06 | accepted by the owner (2026-09-27, "yes commit changes"): acceptance battery green at `a192e3f` (2026-09-27: test:db 141, unit 237, e2e 71/71, build, export, budgets, Linux CI), round 3 done, phase 2 walk-through done (`a192e3f`); earlier: rounds 1–2 in `4518520` (round 1 audited by the orchestrator); fix passes `36235e0`/`518fe19`; cloud audit fixes `8935c62`…`25b90c0` locally verified (db 93, unit 215, e2e 22/22, screenshots reviewed; one TZ-dependent test fixed on top); card-label fix `3fef85b` locally verified (17/17, computed-content probe, screenshots re-captured); round 2 closed except the Linux build items; D31 no-inbox change `979bfcc`/`cfe6bed` and the D32 replatform locally verified 2026-09-27 | `artifacts/acceptance/P06/` |
| P07 | accepted by the owner (2026-09-28: "I accept p07 for now"); acceptance record at `92c69da`; C20 closes only after P08, and E02/E03 stay open (D37, D38). History: round 1 done (2026-09-27): the orchestrator's catalog and checkout migration (`4c80459`), then glm-worker's `checkout` function, demo catalog seed (D37) and tests, audited with six fixes (unit 327, test:db 172, e2e 24/24); round 2 done (2026-09-27): the store admin (products with variants, delivery, coupons, customers) and owner-approved policies, built by glm-worker, audited with five fixes (unit 356, test:db 177, e2e 16/16); round 3 built by glm-worker (store, product, cart, checkout, policy pages), audited in two sessions (budget, lint, em dashes, the empty-catalog build, I39 with the owner's approval; then `7607a17`: eight fixes, among them the spent Turnstile token that failed every retry, cart-checkout e2e 11/11, I38's cause found); acceptance battery green: at `7607a17` every step (build empty and seeded, test:db 178, unit 375, export, budgets), and the e2e, cut short there by a memory crash, rerun to completion on 2026-09-28 at `7d6c766`: 95/95; one test-isolation fix on top (P06's owner-operations spec now restores the settings row, 20/20); proof map in `commands.txt` | `artifacts/acceptance/P07/` |
| AUDIT-1 | committed and pushed on the owner's word (2026-09-30: "yes"): the deep audit (253 confirmed findings) and 241 fixes, independently audited round by round, `f38f04d` (with D42) and the evidence `9f6f37f`; acceptance battery in `commands.txt`; lock released | `artifacts/acceptance/AUDIT-1/` |
| AUDIT-2 | the open-code-review audit (0 critical or high, 11 medium) and AUDIT-2-FIX (177 findings handled in 11 rounds, then the orchestrator's own audit per D43); acceptance battery green (unit 632, test:db 230, e2e 169/169, build, export, budgets); committed on the owner's word (2026-09-30: "do all needed work, you decide for me"); lock released | `artifacts/acceptance/AUDIT-2/` |
| FOUNDATION-1 | Foundation finished on the owner's D44 decisions: the book page, home doors and contact page in the admin, the characters, the five films, the CI Deno check, JS-off tests; the orchestrator's audit per D43; acceptance battery green (unit 648/648, test:db 232/232, e2e 174/174, build, export, budgets); committed on the owner's word (2026-10-01: "finish foundation"); lock released | `artifacts/acceptance/FOUNDATION-1/` |
| P08 | in progress, under D38 and D45, on `agent/p08`: the contract `PLANS/P08-CONTRACT.md` (section 12 lists the rounds). Accepted and pushed, each built by a Sonnet 5.5 worker, audited by an Opus 5.5 auditor and ruled on by the orchestrator: rounds 0 and 1 `f308c97` (the emulator and the Moyasar client), 2 `69b7940` (the payment core), 3 `538e716` (the `payments` function and the reconciliation job), 4 `b8fbf2f` (checkout with the invoice step), 4b `bdc57a0` (the hold view and the return page), 5 `c04525f` (order mail), the sandbox evidence and emulator alignment `ced46d4`, 6 `fef5119` (refunds), 7 `217a74b` (delivery), 7b `febd469` (order operations), 8 `157d725` (availability notifications), 9 `3dbe25a` (statistics, disputes, the buyer's privacy functions), 10a `994deb0` (the order page and the notification link pages), 10b `d8bffbe` (the product page's availability and preorder states, the sign-up form, the preorder notes before payment, the lazy hold view, `payment_view` without an expired invoice's link), 11a `a4b17f9` (the admin's orders list and order view), 11b `1e85284` (refunds with the step-up, rechecks, external refunds, the reconciliation screen, disputes), 11c `d27d05b` (`variant_admin_info`, the variant form's preorder fields and paid file, the sign-ups list, the commerce figures), 12a `75a845f` (`tests/e2e/orders.spec.ts`: ten journeys at 360 and 1440 on the real stack and the emulator, no mocks; the cart no longer offers the checkout while a line is refused, and the product title wraps a long unbreakable run), 12b (the payments runbook with "When the Moyasar keys arrive", `docs/operations.md`, `docs/privacy-data-map.md`, `docs/development.md`). From 10b on, auditors run Opus 5.5 at effort max (the owner's word, 2026-10-03). Paused after 12b on 2026-10-03 on the owner's word; every round is built and the lock is released. Left: the auditor's checkpoint (c), the acceptance battery from a fresh reset and the plan documents; briefs in `artifacts/acceptance/P08/tools/`. Moyasar: the owner's test keys are in `.env` and the one sandbox pass he approved is done (it created, read, listed and cancelled eight test invoices, with no payment) (`artifacts/acceptance/P08/moyasar-sandbox-2026-10-02.md`); everything else is proven against the local emulator. E02 and E03 stay open | `artifacts/acceptance/P08/rounds/` |
| SOON-1 | live on the owner's word (2026-10-02, D46), a side package outside the product and the P08 lock's paths: a one-screen soon page on https://anas.studio and www, the Worker `anas-studio-soon` (static assets, Custom Domains) in Anas's Cloudflare account, `noindex`. The first version repeated the home page and the owner rejected it; three new designs were built by Opus designers (the brand's colours and Thmanyah, none of the main site's compositions), «الحصير» (a palm mat still being woven), the word «قريباً» as a poster, and Anas at an open door; on the owner's word the domain shows one of the three at random, never the same twice in a row (`worker.js`), with the name as «أنس القرني» and «تجدني هنا:» over the links. Checked: no horizontal overflow from 320 to 1920 wide and one screen from 360 wide (design C scrolls about 50px at 320x568, found by the orchestrator's second review on 2026-10-03), no hidden text with motion on, no console error on the live domain, a tasmeem render at 360, 768, 1024 and 1440 with 0 findings (of the first version of design A, before the name and the label changed: `shots/gate/`). Committed as `0b915c5` on `agent/p08` on 2026-10-03, while P08 held the lock; it touched `PLANS/EXECUTION-STATUS.md`, on P08's allowlist, and the orchestrator accepted the change and pushed the commit with round 10a. MAINT-1 is built the same day (D47): three maintenance designs (`site/m/`), 503 with `Retry-After`, switched by `deploy.cjs --mode=`, proven on the live domain (on: 503 and the maintenance title; off: 200), and shown at `/m/` without switching. An Opus review of the six pages, the Worker and the contract (three auditors, each finding re-checked by a second) confirmed 20 findings and rejected 5; the page, Worker and deploy-script ones are fixed and live (design B fits short screens, design C's door leaf no longer covers the words, plain HTTP is redirected for the pages the script serves (files are served by the assets layer first: the zone's "Always Use HTTPS" covers them, the owner's dashboard switch), HSTS, the deploy script passes wrangler nothing else from `.env` and pins its version), and the contract ones are written into `PLANS/SITE-STATE-CONTRACT.md`. Open: the X link (the seeded `x.com/anasa.aq` cannot be a handle); the owner's approval of the maintenance words; SITE-STATE-1, the switch in the admin | `artifacts/soon/` (README, `shots/`) |
| P09–P12 | not_started | — |

## Next work, in order

**Now (2026-10-03, P08 paused after round 11c for a compaction; the same session continues it with round 12a).**
1. DONE 2026-10-01: FOUNDATION-1, Foundation (P00 to P02) finished on the owner's D44 decisions; the Phase 1 gate holds, with the rights gates (E04, E05) open. DONE 2026-10-01: AUDIT-2, the open-code-review audit and its fixes, with D43 (the orchestrator audits every worker diff itself) and the graft wiring repair. DONE 2026-09-30: AUDIT-1 and the owner's D42 decisions (committed, history rewritten, pushed), then REPO-SWEEP: `main` is the only branch, the redundant branches and the Codex app's local checkpoint refs are deleted, and the configuration files for other AI tools (Cursor, Gemini, Grok, Kiro, Windsurf, Adal, Copilot, OpenCode, ZCode) are removed, because `AGENTS.md` and `CLAUDE.md` are the only agent instructions. DONE 2026-10-02: SOON-1 live on anas.studio and MAINT-1 built (D46, D47), committed as `0b915c5`.
2. P08, under the lock taken again (`PLANS/HANDOFF.md`, "How to continue P08"): the auditor's checkpoint (c) (every round through 12b is built), the acceptance battery from a fresh reset, the plan documents (COVERAGE C20, C26, C28, C29, C30; ISSUES with I48 and I44; HANDOFF; ARCHITECTURE; DATA-AND-SECURITY; VERIFICATION's file count), then the owner's acceptance. E02 stays open until the real sandbox runs listed in the runbook's "When the Moyasar keys arrive" are recorded with the rest of the evidence E02 names; E03 is Anas's own values (D37), which no sandbox run closes.
3. SITE-STATE-1 (D47, `PLANS/SITE-STATE-CONTRACT.md`): the owner's «حالة الموقع» control on `/admin/settings` (مفتوح, قريباً, صيانة) and the gate that follows it. Product code: the first work after P08 releases the lock, or a P08 round on the owner's word; never beside a P08 worker, since it edits `_shared/admin.ts`.
4. If Anas wants only «أنس القرني» on the home page (owner's question, 2026-10-02): the name is his own field in the admin (site settings, the home page), and the hero draws one band per word, so no deploy is needed for the words. Two small code changes go with it, after P08 releases the lock: the two name bands must fill the portrait's height on wide screens (`home.module.css`: today they keep their own height and leave the page colour showing under them), and the two fixed titles (`src/app/(public)/layout.tsx`, `src/app/global-not-found.tsx`) follow the name he chose. The book's author line and the seller's legal name are separate fields and stay as he wants them.
5. P09 (services and bookings; depends on P08).
6. P10 (whole-platform quality); its design audit also covers the soon and maintenance pages.
7. P11 when the owner authorizes hosting: I28 (with the password hook), I32, I33, I40 and I41 in ISSUES; where the site-state gate stands in front of the Pages site, its hosted proof and the launch sequence (`PLANS/WORK-PACKAGES.md`, P11); then the owner deletes the old Worker, Hyperdrive, D1 and R2 test resources himself.
8. P12 «لوحة المشاريع» (bonus; D22 as amended by D50): after P10's acceptance, in the window where P11 waits on Anas's launch inputs, so it joins P11's training and handover; if P11 waits on nothing, after P11. I52 is asked at its start.
9. Owner and Anas inputs that reopen small admin work when they arrive: a rights or credit field per scene (C05), a new stage in بنيتُ هنا (a design for stages beyond the two, D39), a new shelf idea, text and a status for an added project, and per-project figures (D40). Also: the X link of the soon page, the owner's approval of the maintenance words, and the zone's "Always Use HTTPS" in the Cloudflare dashboard (plain HTTP on the soon page's files).
