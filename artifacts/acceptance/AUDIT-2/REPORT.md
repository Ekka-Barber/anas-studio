# AUDIT-2: open-code-review deep audit of the current app (2026-09-30)

**Asked by the owner (2026-09-30):** find Alibaba's open-code-review skill, then use it to deep audit the current state of the app.

**Scope:** `main` at `4f22b78`, the tree AUDIT-1 left (its 241 fixes in `f38f04d`). Read-only: no product code changed. P08 to P12 are not started, so their absence is not counted.

## 1. The tool, and why delegation mode

open-code-review (`ocr`, github.com/alibaba/open-code-review) was already installed: the CLI `ocr` v1.12.2 and the skills `open-code-review` and `open-code-review-delegate` in `~/.claude/skills/`. Its own LLM setting points at GLM (z.ai), which D41 excludes. So the audit used OCR's **delegation mode**: OCR did the deterministic part and Sonnet 5.5 agents (effort xhigh, D41) did the review.

- **File selection:** `ocr scan --preview` picked 391 reviewable files. Frozen `deploy/`, `artifacts/`, book and font assets, images, `graft/` and `PLANS/evidence/` were set aside, leaving **265 source files (about 33,700 lines)**.
- **Rules:** `ocr delegate rule` resolved OCR's rule group for every file (code, JSON, workflow, package.json, Python, default).
- **Commit mode:** `ocr delegate preview -c f38f04d` selected the **123 files** of the AUDIT-1 fix commit, to hunt for regressions.

## 2. How it ran

One read-only workflow (`wf_2dbde205-515`), run twice. The first run lost its completeness critic to a network error. The resume re-ran the critic, the gap auditors and, because the pipeline order changed, about 60 of the verifiers, which gave a second independent verdict on many findings.

1. **32 reviewers:**
   - 23 OCR file slices, covering every one of the 265 files;
   - 4 slices of the `f38f04d` diff;
   - 5 cross-cutting lenses: end-to-end security and privacy, money and checkout integrity, data contracts and the publish pipeline, accessibility and RTL, and deterministic health checks.
2. **Verification:** every critical or high finding goes to three verifiers (code truth, reachability, intent against the decisions and AUDIT-1) and needs two confirmations. Every medium goes to a skeptic told to refute it. Lows are checked in batches.
3. **Completeness critic:** it named five gaps nobody had covered: the integration and e2e suites read as oracles, the Deno entrypoints, the runbooks and status records, validation parity across layers, and cross-function interleavings on shared rows. **Five gap auditors** covered them, and their findings were verified the same way.
4. **Orchestrator:** merged duplicates and ruled on every medium where the two runs disagreed. It also checked three findings against the code: the autosave regression, the clip-path keyframes and the `<html>` attribute. The 40001 hang was checked against the migrations and the hasql-transaction retry loop the verifier cites.

**Totals:**
- 247 agent runs (114 + 133).
- 265 of 265 selected files reviewed and 123 of 123 fix-commit files reviewed. No slice skipped a file.

## 3. Result in one table

| | Count |
|---|---|
| Raw findings | 254 |
| Critical / high | **0** |
| **Medium, distinct** (16 entries, 5 of them duplicates) | **11** |
| Low, confirmed entries (some defects found twice) | 147 |
| Before checkout opens (P08), latent today | 14 |
| Split verdicts (the two runs disagreed) | 16 |
| Environment (not app code: see 4.12) | 5 |
| Refuted | 56 |

**Health checks (all green):**

| Check | Result |
|---|---|
| `pnpm lint` | 0 errors |
| `pnpm typecheck` | 0 errors |
| `pnpm test` | 486 of 486 passed (34 files) |
| `pnpm check:frozen` | OK, 50 files |
| `pnpm check:copy` | OK, 188 files |
| `pnpm audit` (prod and all) | no known vulnerabilities |

`git status` was identical before and after the checks. Not run: build, `test:db`, e2e. They need the local Supabase stack, and e2e needs free memory. The integration and e2e suites were audited statically instead (gap G1).

**Verdict:** no critical or high defect. The app is in good shape. The eleven mediums are the fix round, and two of them are AUDIT-1 fixes that are incomplete (4.1 and 4.2).

## 4. Medium findings (11), and one environment finding (4.12)

### 4.1 A stale-version save of commerce settings or policy approval hangs instead of answering 409
`DB-commerce-set-2`, `GAP-G3-12`.

- **Where:**
  - [20260927130000_commerce_settings.sql:109](../../../supabase/migrations/20260927130000_commerce_settings.sql#L109)
  - [20260927170000_policy_approval.sql:39](../../../supabase/migrations/20260927170000_policy_approval.sql#L39)
  - [admin.ts:370](../../../supabase/functions/_shared/admin.ts#L370)
- **What happens:**
  - Both functions raise `serialization_failure` (40001) when the owner saves from a stale tab.
  - AUDIT-1's X2.3 moved `publish_version` and `schedule_version` off 40001, because PostgREST runs requests through hasql-transaction, which retries 40001 in an unbounded loop. Its comment says the call hangs (20260930120000_audit_fixes.sql:163-166). These two sibling functions were not changed.
  - The 409 «تغيّرت الإعدادات من جلسة أخرى» mapping in `admin.ts:370` and `:389` can therefore never fire. Each stale save instead pins a pooled PostgREST connection in a retry loop.
  - Tests miss it: the unit tests fake a 40001, and the integration tests call the SQL over a direct pg connection, not PostgREST.
- **Fix:**
  - Raise `unique_violation` (23505) in both functions, as `publish_version` does, and map it in `admin.ts`.
  - Update docs/operations.md:362.
  - Add one test through the Data API.

### 4.2 Saving while a local copy is on offer deletes that copy and turns autosave off
`ADMIN-editor-2`, `FIX-admin-1`. A regression of AUDIT-1 S08.2.

- **Where:** [CollectionForm.tsx:219](../../../src/components/admin/CollectionForm.tsx#L219) and [:171](../../../src/components/admin/CollectionForm.tsx#L171).
- **What happens:**
  - `save()` calls `clearStoredDraft()` unconditionally, so the offered copy is deleted from storage while the banner still offers it.
  - `save()` never clears `localOffer`, so the S08.2 guard `if (!hydratedRef.current || localOffer) return` keeps autosave off until the page reloads.
  - Anas ignores the banner, saves, keeps writing, and closes the tab: the old copy and everything typed since the save are both lost. This is the S08.2/S08.3 data loss back again.
- **Fix:** in `save()`, keep the stored copy while an offer is pending (`if (!localOffer) clearStoredDraft()`). Keep protecting new edits while the offer waits, for example with a second storage key, so a save never ends autosave.

### 4.3 A scheduled post that cannot go live loses its schedule silently
`DB-site-1`, `DB-core-2`. AUDIT-1 S01.2 residual.

- **Where:** [20260930120000_audit_fixes.sql:268](../../../supabase/migrations/20260930120000_audit_fixes.sql#L268).
- **What happens:**
  - `schedule_version` never checks the live post-slug unique index, so a post whose slug is already live schedules fine and shows «مجدول».
  - At the due time, `publish_due` catches the 23505, drops the schedule, and writes an audit row. No screen reads that row (COVERAGE C23), so the post just stays a draft.
- **Ruling:** one verifier refuted this, because AUDIT-1 called the schedule-time check optional. It is kept because the scheduled promise fails with no signal, and the fix is small.
- **Fix:** refuse the slug collision in `schedule_version` for posts (the UI already maps 23505 to the slug message). Show recent `content.publish_due_failed` rows on the owner home.

### 4.4 A schedule stays on the version it was set on, and the UI hides that
`ADMIN-publish-3`.

- **Where:** [PublishBar.tsx:128](../../../src/components/admin/PublishBar.tsx#L128).
- **What happens:**
  - `publish_due` publishes the scheduled `seq`, not the latest one.
  - The bar and the list show only «مجدول في …», with no version number.
  - An editor schedules version 3, fixes a factual error and saves version 4. Version 3, with the error, goes live.
- **Fix:** expose the scheduled seq, show «مجدول: نسخة N», and warn with a one-click reschedule when N is behind the latest version.

### 4.5 Pasting text with a tab blocks publishing with an unreadable error
`ADMIN-publish-1`, `X-CONTRACT-4`. AUDIT-1 S08.7 incomplete.

- **Where:** [RichTextEditor.tsx:201](../../../src/components/admin/RichTextEditor.tsx#L201) and [src/admin/richtext.ts:39](../../../src/admin/richtext.ts#L39).
- **What happens:**
  - Lexical turns a pasted `\t` into a `tab` node. The allowlist has no `tab`, and the transforms cover only headings and links.
  - Saving works, but publishing stays disabled with «النص: Invalid input», and the tab cannot be seen.
- **Fix:** add a TabNode transform that replaces the tab with spaces, plus a unit test that pastes `a\tb`.

### 4.6 The media library can write two images' details onto one image
`ADMIN-media-1`, `FIX-admin-4`.

- **Where:** [MediaLibrary.tsx:415](../../../src/components/admin/MediaLibrary.tsx#L415).
- **What happens:**
  - After the awaited update, `save()` writes the `selected` value it captured before the call back into state.
  - A click on another tile during the request mixes image A's name and folder with image B's alt text, caption and rights. A second «حفظ» stores that mix on image A: wrong rights attribution and wrong alt text on a public image.
- **Fix:** apply the result only if the selection is still the same id, or disable the tiles while a save runs.

### 4.7 A double click on «المزيد» duplicates a page and then skips 40 images
`ADMIN-media-2`. AUDIT-1 S09.3 incomplete.

- **Where:** [MediaLibrary.tsx:236](../../../src/components/admin/MediaLibrary.tsx#L236).
- **What happens:** two clicks fetch the same offset and both results are appended. The next page then starts 40 rows too far, so those images vanish from the library and from every picker.
- **Fix:** add an in-flight guard, and disable the button while a page loads.

### 4.8 Library images publish with an empty alt, and edited alt text is ignored
`PUBLIC-data-3`, `X-A11Y-RTL-3`, also `PUBLIC-ui-5`.

- **Where:** [media-notes.ts:44](../../../src/content/media-notes.ts#L44) and [ShelfRoomView.tsx:242](../../../src/components/public/rooms/ShelfRoomView.tsx#L242).
- **What happens:**
  - Vignette and story figures take their alt from a hard-coded table keyed by committed ids.
  - `mediaById` selects only `id, derivatives`, and anon cannot read `alt_ar`, so any library image placed there renders `alt=""`.
  - The moonlight-cup photos 3 and 4 ignore the alt Anas edits.
  - The result is a WCAG 1.1.1 failure on public pages, although alt text is required at upload.
- **Fix:** grant anon `alt_ar` and select it, carry alt with the resolved reference, and pass the CMS alt through `StoryFigure`.

### 4.9 Every CSS entrance "wipe" snaps at the halfway point instead of wiping
`PUBLIC-style-1`, also `PUBLIC-style-2` and `PUBLIC-style-3`.

- **Where:** [motion.css:61](../../../src/styles/motion.css#L61).
- **What happens:**
  - `motion-band`, `motion-media` and `motion-sign` declare only a `from` `inset()`. The element's own `clip-path: none` cannot be interpolated with `inset()`, so the browser flips discretely at 50%.
  - The home name bands, the portrait and the book cover stay invisible and then pop in whole.
  - The same keyframes appear in the menu weave (`site.module.css:183`) and in the scenes tiles and viewer (`scenes.module.css:61`).
- **Fix:** give each wipe an explicit `to { clip-path: inset(0 0 0 0) }`. This was checked against the code.

### 4.10 The book reader overshoots when a turn is requested while one is running
`BOOK-1`.

- **Where:** [PdfBookReader.tsx:198](../../../src/components/book/PdfBookReader.tsx#L198).
- **What happens:**
  - `go()` has no guard while page-flip is mid-turn.
  - Holding End (key repeat) queues a second turn in the same direction, so the book stops on the blank endpaper spread instead of the closing leaf.
- **Fix:** return early unless page-flip's state is `read`, and ignore `event.repeat` for Home and End.

### 4.11 A restore never proves the nine pg_cron schedules came back
`GAP-G3-5`.

- **Where:** [docs/operations.md:579](../../../docs/operations.md#L579) and `scripts/restore-check.mjs`.
- **What happens:**
  - Every schedule (outbox, site build, publish_due, media sweep, checkout expiry, three purges, buyer retention) exists only as a `cron.schedule(...)` inside a migration.
  - The restore marks the migrations applied, and the rehearsal compares only table row counts.
  - If the dump does not carry `cron.job`, a restored project runs with no schedules: no email, no rebuilds, no scheduled posts, and no retention purges. The 90-day promise then fails silently.
- **Fix:** add a runbook step and a `restore-check` criterion that compares `cron.job` with the nine names, and re-schedules any that are missing.

### 4.12 Not app code: graft rewrites committed agent configuration at every session start
`TOOLING-1`, `-2`, `-5`, `-6`, `FIX-rest-5`.

- **What happens:**
  - This session opened on a clean tree. At 17:25:09, the second it started, graft's `SessionStart` hook (`.claude/helpers/graft-hooks.cjs`, now resolved to an unpinned npx copy of `@nanonets/graft`) rewrote six tracked files:
    - `.mcp.json`: the graft pin `@0.21.1` removed, the same issue as AUDIT-1 S18.4;
    - `.claude/settings.json`: a second prompt hook and the `graft-dev` and `node dist/cli.js` allowlist entries back, the same issue as G4.6;
    - `.claude/helpers/*`, `.claude/skills/graft/SKILL.md` and `AGENTS.md`.
  - It also brought back the nine agent-config paths that `4f22b78` deleted: `.adal/`, `.cursor/`, `.gemini/`, `.grok/`, `.kiro/`, `.windsurf/`, `GEMINI.md`, `opencode.json` and `.github/copilot-instructions.md`.
  - Nothing is committed yet. Reverting the files alone will not last, because the hook runs again next session.
  - This needs the owner's call: stop graft's self-install from rewriting configuration, or pin it, before the working tree is restored.

## 5. Before checkout opens (P08): 14 entries

Checkout is off until P08 (`checkout_enabled` false, no Moyasar). These are real but latent; P08 must close them before the switch is turned on.

- `DB-commerce-set-1` [supabase/migrations/20260927170000_policy_approval.sql:42](../../../supabase/migrations/20260927170000_policy_approval.sql#L42) Approval pins the DB's published seq, but buyers read the static page built earlier, so acceptance can bind to text they were not shown (AUDIT-1 X1.1)
- `DB-catalog-2` [supabase/migrations/20260927160000_catalog_and_checkout.sql:676](../../../supabase/migrations/20260927160000_catalog_and_checkout.sql#L676) A coupon can make the order total 0, and checkout_create creates a pending order nothing can pay *(split verdict)*
- `DB-auditfix-1` [supabase/migrations/20260930120000_audit_fixes.sql:142](../../../supabase/migrations/20260930120000_audit_fixes.sql#L142) X1.1 fix leaves a window where buyers accept a policy revision whose text they were never shown (AUDIT-1 X1.1)
- `EF-money-2` [supabase/functions/_shared/checkout.ts:146](../../../supabase/functions/_shared/checkout.ts#L146) ACTIVE_HOLD refusal tells the buyer to complete or cancel an order the page cannot reach, and gives no wait (AUDIT-1 S14.9)
- `STORE-checkout-1` [src/components/store/CheckoutForm.tsx:434](../../../src/components/store/CheckoutForm.tsx#L434) Checkout form still renders when approval was reset (empty policyRevisions) or the seller is unset; the buyer only learns after typing everything (AUDIT-1 X1.1)
- `STORE-checkout-9` [src/components/store/CheckoutForm.tsx:367](../../../src/components/store/CheckoutForm.tsx#L367) A stored pending order can only be cleared by a successful cancel; a NOT_FOUND reply leaves the tab stuck on a hold view that no longer describes anything (AUDIT-1 S06.7)
- `STORE-checkout-10` [src/components/store/CheckoutForm.tsx:323](../../../src/components/store/CheckoutForm.tsx#L323) ACTIVE_HOLD from a hold whose token this tab does not have still tells the buyer to complete or cancel it, which the page cannot do (AUDIT-1 S14.9) *(split verdict)*
- `FIX-public-4` [src/components/store/CheckoutForm.tsx:323](../../../src/components/store/CheckoutForm.tsx#L323) ACTIVE_HOLD with no pending order in this tab still says «أكمله أو ألغه أولًا», which the page cannot do (AUDIT-1 S14.9)
- `X-SEC-4` [supabase/migrations/20260927160000_catalog_and_checkout.sql:880](../../../supabase/migrations/20260927160000_catalog_and_checkout.sql#L880) Anyone can lock a known email address out of checkout, and ACTIVE_HOLD confirms it has a live order (AUDIT-1 S06.4) *(split verdict)*
- `X-MONEY-1` [supabase/migrations/20260927160000_catalog_and_checkout.sql:769](../../../supabase/migrations/20260927160000_catalog_and_checkout.sql#L769) Quote reports checkoutEnabled true while checkout_create will refuse for seller or policy setup, so the buyer fills the whole form and gets a 503; after AUDIT-1's approval reset the consent line is empty (AUDIT-1 X1.1)
- `X-MONEY-3` [src/components/store/CheckoutForm.tsx:399](../../../src/components/store/CheckoutForm.tsx#L399) Hold view keeps claiming a live 20-minute hold after the hold has expired; the buyer is never told and cannot reorder until pressing cancel (AUDIT-1 S06.7)
- `X-CONTRACT-2` [supabase/migrations/20260927170000_policy_approval.sql:42](../../../supabase/migrations/20260927170000_policy_approval.sql#L42) Policy approval opens checkout before the site shows the approved text (AUDIT-1 X1.1)
- `GAP-G4-4` [supabase/functions/_shared/checkout.ts:68](../../../supabase/functions/_shared/checkout.ts#L68) Checkout name is not checked for control characters that checkout_create refuses, so the buyer gets a fieldless error (AUDIT-1 S06.6)
- `GAP-G5-3` [supabase/migrations/20260927170000_policy_approval.sql:42](../../../supabase/migrations/20260927170000_policy_approval.sql#L42) Policy approval can record a seq that is already being replaced; the reset trigger misses it because it only bites when the key is already approved

## 6. Low findings (147 confirmed entries)

Grouped by area. Several defects were found by two units and appear twice (for example the coupon length cap, the admin shell remount, the `in` id check); the id tells which unit found it. The full text, quote, failure scenario, fix and both verification runs are in `findings.json`.

### Database and Edge Functions (21)

- `DB-core-3` [supabase/migrations/20260927090000_static_site_and_functions.sql:131](../../../supabase/migrations/20260927090000_static_site_and_functions.sql#L131) Archive then republish resets first_published_at, rewriting the journal date and order
- `DB-media-1` [supabase/migrations/20260926090000_media_library.sql:131](../../../supabase/migrations/20260926090000_media_library.sql#L131) media_usage lists every published document twice: as live and as draft
- `DB-media-3` [supabase/migrations/20260926090000_media_library.sql:249](../../../supabase/migrations/20260926090000_media_library.sql#L249) The exactly-once claim invariant is tested only sequentially; operations denial of media_where_used and media_rename_folder is untested
- `DB-contacts-2` [supabase/migrations/20260926120000_contacts_and_email.sql:198](../../../supabase/migrations/20260926120000_contacts_and_email.sql#L198) Contact intake cap (200/day, one notice per recipient) exceeds the notice drain cap (80/day), so a Turnstile-passing flood backlogs the queue FIFO and delays real messages for days (AUDIT-1 S04.1)
- `DB-site-2` [supabase/migrations/20260927090000_static_site_and_functions.sql:213](../../../supabase/migrations/20260927090000_static_site_and_functions.sql#L213) Four every-minute pg_cron jobs and no purge of cron.job_run_details
- `DB-site-3` [supabase/templates/magic_link.html:2](../../../supabase/templates/magic_link.html#L2) Sign-in email declares RTL only on <html>, and the code paragraph flips to the left edge
- `DB-site-5` [supabase/migrations/20260927120000_rebuild_delivery_and_media_sweep.sql:84](../../../supabase/migrations/20260927120000_rebuild_delivery_and_media_sweep.sql#L84) A missing pages_deploy_hook makes publishing look successful while the site is never rebuilt, and the owner home cannot tell
- `DB-catalog-1` [supabase/migrations/20260927160000_catalog_and_checkout.sql:249](../../../supabase/migrations/20260927160000_catalog_and_checkout.sql#L249) Stock-only variant saves from the admin still request a site rebuild, contrary to the stated design and the test
- `DB-catalog-3` [supabase/migrations/20260927160000_catalog_and_checkout.sql:593](../../../supabase/migrations/20260927160000_catalog_and_checkout.sql#L593) The SQL cart-validation and money-bound branches have no database-level test
- `DB-auditfix-3` [supabase/migrations/20260930120000_audit_fixes.sql:456](../../../supabase/migrations/20260930120000_audit_fixes.sql#L456) A QUOTA give-back keeps first_attempt_at, so a long quota wait turns the next ambiguous send into a manual replay (AUDIT-1 S04.2)
- `EF-admin-1` [supabase/functions/staff-admin/index.ts:61](../../../supabase/functions/staff-admin/index.ts#L61) A JSON `null` body crashes staff-admin with an unhandled TypeError instead of BAD_JSON
- `EF-admin-2` [supabase/functions/_shared/admin.ts:448](../../../supabase/functions/_shared/admin.ts#L448) Settings status reports analytics as configured when fetchAnalytics treats it as NOT_CONFIGURED
- `EF-admin-3` [supabase/functions/_shared/admin.ts:93](../../../supabase/functions/_shared/admin.ts#L93) A transient Storage read error is reported as MISSING_PART and triggers cleanup of parts that were uploaded
- `EF-comms-3` [supabase/functions/_shared/turnstile.ts:83](../../../supabase/functions/_shared/turnstile.ts#L83) Operator-side Turnstile failures are reported to visitors as 'you are not human' with no log, so a wrong secret looks like every visitor failing the challenge
- `EF-comms-1` [supabase/functions/_shared/outbox.ts:182](../../../supabase/functions/_shared/outbox.ts#L182) Quota-held contact notices are recorded as an 'ok' run, so the owner home shows no warning; a contact flood then delays real notices by days (AUDIT-1 S04.1)
- `FIX-db-2` [supabase/functions/_shared/staff.ts:36](../../../supabase/functions/_shared/staff.ts#L36) S07.6 fixed only for the staff-row lookup; a transient Auth failure in getClaims is still reported as 401 UNAUTHENTICATED (AUDIT-1 S07.6)
- `FIX-db-3` [supabase/functions/_shared/analytics.ts:83](../../../supabase/functions/_shared/analytics.ts#L83) The 2xx-only filter also drops 304 revalidations, so repeat visits vanish from 'most requested pages' (AUDIT-1 S07.1)
- `GAP-G2-2` [supabase/functions/staff-admin/index.ts:61](../../../supabase/functions/staff-admin/index.ts#L61) A JSON `null` body crashes staff-admin with a bare 500 and no error envelope
- `GAP-G2-3` [supabase/functions/staff-admin/index.ts:85](../../../supabase/functions/staff-admin/index.ts#L85) Invite rollback ignores a failed deleteUser, leaving an orphaned auth user that blocks re-inviting the email
- `GAP-G5-4` [supabase/migrations/20260930120000_audit_fixes.sql:436](../../../supabase/migrations/20260930120000_audit_fixes.sql#L436) The S04.4 early-event fix misses a delivery or bounce event committed by a webhook transaction that overlaps the accept
- `GAP-G5-1` [supabase/migrations/20260930120000_audit_fixes.sql:261](../../../supabase/migrations/20260930120000_audit_fixes.sql#L261) publish_due and publish_version/archive_document take the same two locks in opposite order and deadlock on one document

### Admin (58)

- `ADMIN-editor-1` [src/components/admin/CollectionForm.tsx:137](../../../src/components/admin/CollectionForm.tsx#L137) Saved documents that lack a whole group are never defaulted, so the form cannot be made valid
- `ADMIN-editor-4` [src/admin/collections/rooms.ts:29](../../../src/admin/collections/rooms.ts#L29) pullLines/bandLines must repeat a paragraph exactly, but nothing enforces it, so editing a paragraph silently drops its styling
- `ADMIN-editor-5` [src/admin/collections/policies.ts:13](../../../src/admin/collections/policies.ts#L13) Publish gate accepts a blank policy title and an empty policy body
- `ADMIN-editor-3` [src/components/admin/CollectionForm.tsx:44](../../../src/components/admin/CollectionForm.tsx#L44) Unsaved drafts are keyed by document only: not per user, and not cleared on sign-out
- `ADMIN-editor-6` [src/admin/collections/taxonomies.ts:15](../../../src/admin/collections/taxonomies.ts#L15) A blank taxonomy label (and a blank post title) is publishable and reaches the journal
- `ADMIN-editor-7` [src/admin/collections/site-settings.ts:18](../../../src/admin/collections/site-settings.ts#L18) Menu items have no publish rule: a blank item is rendered and marks every page as current
- `ADMIN-editor-8` [src/admin/collections/site-settings.ts:45](../../../src/admin/collections/site-settings.ts#L45) «بريد التواصل» is validated at publish but nothing on the site or in the functions reads it
- `ADMIN-editor-9` [src/admin/collections/rooms.ts:53](../../../src/admin/collections/rooms.ts#L53) Each room's required «المعرّف» field is never read, so editing it changes nothing
- `ADMIN-editor-10` [src/admin/fields.ts:125](../../../src/admin/fields.ts#L125) Image and video id checks use `in`, so `constructor`/`toString` pass the publish gate (same class as S08.10)
- `ADMIN-editor-11` [src/components/admin/FieldInput.tsx:742](../../../src/components/admin/FieldInput.tsx#L742) Repeated «أعلى/أسفل/حذف» buttons have no per-item name, and delete has no undo
- `ADMIN-publish-4` [src/components/admin/VersionHistory.tsx:53](../../../src/components/admin/VersionHistory.tsx#L53) Version history does not reload after Save, so the newest version is missing from it
- `ADMIN-publish-5` [src/components/admin/CollectionList.tsx:57](../../../src/components/admin/CollectionList.tsx#L57) Posts list has no sort, so rows come out in random-UUID order
- `ADMIN-publish-6` [src/components/admin/RichTextEditor.tsx:46](../../../src/components/admin/RichTextEditor.tsx#L46) «فقرة», «عنوان 2/3» and «اقتباس» silently do nothing inside a list
- `ADMIN-publish-7` [src/components/admin/RoomPreview.tsx:159](../../../src/components/admin/RoomPreview.tsx#L159) Preview banner says «لم تُنشر بعد» even when the previewed version is the live one
- `ADMIN-publish-8` [src/components/admin/CollectionList.tsx:127](../../../src/components/admin/CollectionList.tsx#L127) a11y: slug validation and list-load errors are not announced
- `ADMIN-publish-10` [src/lib/richtext.tsx:49](../../../src/lib/richtext.tsx#L49) Nested lists render a wrapper `<li>` that shows a stray bullet
- `ADMIN-media-3` [src/components/admin/MediaLibrary.tsx:401](../../../src/components/admin/MediaLibrary.tsx#L401) Save reports 'حُفظ' when the update matched zero rows (image deleted by another staff member, or role revoked)
- `ADMIN-media-4` [src/components/admin/MediaLibrary.tsx:426](../../../src/components/admin/MediaLibrary.tsx#L426) Folder rename can run twice (button not disabled while the RPC is in flight); the second run overwrites the success message and double-moves a nested target (AUDIT-1 S09.2)
- `ADMIN-media-5` [src/components/admin/MediaLibrary.tsx:320](../../../src/components/admin/MediaLibrary.tsx#L320) Folder-list scan discards Supabase errors and publishes a partial (or empty) folder list without any message (AUDIT-1 S09.11)
- `ADMIN-media-6` [src/components/admin/MediaLibrary.tsx:399](../../../src/components/admin/MediaLibrary.tsx#L399) Edit and upload forms accept untrimmed folder paths (trailing/whitespace-only), while the rename tool trims; identical-looking folders and blank dropdown options result (AUDIT-1 S09.7)
- `ADMIN-media-7` [src/components/admin/MediaUpload.tsx:203](../../../src/components/admin/MediaUpload.tsx#L203) Only JPEG orientation is normalised server-side, so AVIF (irot) and PNG/WebP (EXIF orientation 5-8) uploads are rejected with DIMENSION_MISMATCH
- `ADMIN-auth-1` [src/components/admin/AdminShell.tsx:73](../../../src/components/admin/AdminShell.tsx#L73) Each admin page mounts its own AdminShell: every navigation blanks the screen, drops keyboard focus and repeats the role RPC twice
- `ADMIN-auth-2` [src/components/admin/AdminShell.tsx:58](../../../src/components/admin/AdminShell.tsx#L58) A transient failure while refreshing an expired session is treated as signed out and redirects to sign-in (AUDIT-1 S10.2)
- `ADMIN-auth-3` [src/components/admin/AdminHome.tsx:161](../../../src/components/admin/AdminHome.tsx#L161) S10.13 fix is partial: a coded failure of the admin stats call still shows «غير متاحة» instead of «تعذّر التحميل» (AUDIT-1 S10.13)
- `ADMIN-auth-4` [src/components/admin/AdminHome.tsx:188](../../../src/components/admin/AdminHome.tsx#L188) Editors always fire three owner/operations-only RPCs whose sections they never see (AUDIT-1 S10.12)
- `ADMIN-auth-5` [src/components/admin/TeamView.tsx:62](../../../src/components/admin/TeamView.tsx#L62) S10.9 fix is incomplete: once the table is loaded, a failed directory reload is swallowed and the table keeps showing stale state (AUDIT-1 S10.9)
- `ADMIN-auth-7` [src/components/admin/TeamView.tsx:60](../../../src/components/admin/TeamView.tsx#L60) A non-owner who opens /admin/team directly is told «تعذّر تحميل الفريق.» instead of that the page is owner-only
- `ADMIN-auth-8` [src/components/admin/SignIn.tsx:39](../../../src/components/admin/SignIn.tsx#L39) When the request never reaches the server, step 1 still says «أرسلنا إليه رمزًا» and moves to the code step
- `ADMIN-auth-9` [src/components/admin/SignIn.tsx:52](../../../src/components/admin/SignIn.tsx#L52) The three one-time-code fields send the raw text, so Arabic-Indic digits typed on an Arabic keyboard are rejected as a wrong code
- `ADMIN-auth-10` [src/components/admin/admin.module.css:83](../../../src/components/admin/admin.module.css#L83) Buttons have no disabled or busy styling: disabled controls look and feel exactly like live ones
- `ADMIN-auth-11` [src/app/(admin)/layout.tsx:9](../../../src/app/(admin)/layout.tsx#L9) Every admin screen shares the document title «لوحة أنس», so client-side navigation is never announced and history and tabs cannot tell the screens apart
- `ADMIN-ops-1` [src/app/(admin)/admin/store/StoreHome.tsx:61](../../../src/app/(admin)/admin/store/StoreHome.tsx#L61) Operations gets a «السياسات» tile that leads to a content page it cannot read, showing every policy as an unpublished draft
- `ADMIN-ops-2` [src/admin/tables/customers.ts:15](../../../src/admin/tables/customers.ts#L15) Customer phone has no client rule, so the S11.3 «generic message» failure remains for this table (AUDIT-1 S11.3)
- `ADMIN-ops-3` [src/components/admin/EmailView.tsx:82](../../../src/components/admin/EmailView.tsx#L82) A replay refused because the list is stale shows a generic error and never refreshes, so every retry fails the same way
- `ADMIN-ops-4` [src/components/admin/EmailView.tsx:167](../../../src/components/admin/EmailView.tsx#L167) The action column of the email problems table has an empty header cell
- `ADMIN-ops-6` [src/components/admin/TableForm.tsx:126](../../../src/components/admin/TableForm.tsx#L126) A failed role lookup leaves the store screens on «يحمّل...» forever with no error or retry
- `FIX-admin-2` [src/admin/fields.ts:125](../../../src/admin/fields.ts#L125) Image and video id checks still use `in`, the same inherited-key hole S08.10 fixed for room ids (AUDIT-1 S08.10)
- `FIX-admin-3` [src/components/admin/CollectionForm.tsx:267](../../../src/components/admin/CollectionForm.tsx#L267) Validation error labels drop the list index and the nested field, so the failing item cannot be found (AUDIT-1 X3.21)
- `FIX-admin-4` [src/components/admin/MediaLibrary.tsx:415](../../../src/components/admin/MediaLibrary.tsx#L415) save() and renameFolder() write the stale `selected` after an await, overwriting a different image chosen meanwhile (AUDIT-1 S09.2)
- `X-CONTRACT-11` [src/admin/collections/rooms.ts:60](../../../src/admin/collections/rooms.ts#L60) pullLines and bandLines must repeat a paragraph exactly, but nothing checks it and a typo fix silently drops the styling
- `X-A11Y-RTL-4` [src/components/admin/SignIn.tsx:123](../../../src/components/admin/SignIn.tsx#L123) Sign-in and TOTP code inputs do not fold Arabic-Indic digits, so a correct code is rejected
- `X-A11Y-RTL-1` [src/components/admin/AdminShell.tsx:73](../../../src/components/admin/AdminShell.tsx#L73) Every admin navigation remounts the shell: nav and page vanish, focus resets to body (AUDIT-1 S10.5)
- `X-A11Y-RTL-2` [src/app/(admin)/layout.tsx:9](../../../src/app/(admin)/layout.tsx#L9) All 17 admin screens share one document title
- `X-A11Y-RTL-5` [src/components/admin/TeamView.tsx:287](../../../src/components/admin/TeamView.tsx#L287) StepUp dialog is unmounted while open, so focus falls to body after verify or cancel (AUDIT-1 X3.18)
- `X-A11Y-RTL-7` [src/components/admin/MediaLibrary.tsx:458](../../../src/components/admin/MediaLibrary.tsx#L458) Deleting an image drops focus and announces nothing (AUDIT-1 S09.4)
- `X-A11Y-RTL-8` [src/components/admin/CollectionForm.tsx:188](../../../src/components/admin/CollectionForm.tsx#L188) Restore/discard buttons and other one-shot actions remove the control that has focus (AUDIT-1 X3.19)
- `X-A11Y-RTL-10` [src/components/admin/CollectionList.tsx:127](../../../src/components/admin/CollectionList.tsx#L127) Invalid taxonomy slug error is silent and not tied to its input (AUDIT-1 X3.5)
- `X-A11Y-RTL-11` [src/components/admin/TableForm.tsx:333](../../../src/components/admin/TableForm.tsx#L333) Save is disabled while invalid; the reasons are a static list that is never announced and inputs are not marked invalid (AUDIT-1 X3.4)
- `X-A11Y-RTL-13` [src/components/admin/FieldInput.tsx:651](../../../src/components/admin/FieldInput.tsx#L651) Reorder and delete buttons in admin lists have identical names on every item (AUDIT-1 X3.11)
- `GAP-G2-4` [src/components/admin/TeamView.tsx:38](../../../src/components/admin/TeamView.tsx#L38) TeamView re-implements callFunction without the 200-shape validation, so a non-envelope 200 throws
- `GAP-G4-1` [src/admin/fields.ts:157](../../../src/admin/fields.ts#L157) number fields have no ceiling, so int4 overflow reaches Postgres and shows only «تعذّر الحفظ.» (AUDIT-1 S11.3)
- `GAP-G4-2` [src/admin/tables/customers.ts:15](../../../src/admin/tables/customers.ts#L15) Customer phone has no client rule; a typo fails as the generic «تحقق من القيم.» (S11.3 not complete) (AUDIT-1 S11.3)
- `GAP-G4-3` [src/admin/fields.ts:140](../../../src/admin/fields.ts#L140) Catalog text fields lack the control-character rule the database enforces (AUDIT-1 S11.3)
- `GAP-G4-6` [src/admin/fields.ts:127](../../../src/admin/fields.ts#L127) Journal post slug has no length cap or first-character rule, unlike every other slug
- `GAP-G4-7` [src/components/admin/PublishBar.tsx:111](../../../src/components/admin/PublishBar.tsx#L111) Schedule: no future-time check, and a 5-digit year throws inside run() and leaves every publish button disabled
- `GAP-G4-8` [src/components/admin/MediaLibrary.tsx:422](../../../src/components/admin/MediaLibrary.tsx#L422) Folder rename checks only the new prefix, but the SQL check applies to every child path
- `GAP-G4-9` [src/admin/collections/site-settings.ts:17](../../../src/admin/collections/site-settings.ts#L17) Content schemas accept blank nav labels/hrefs, taxonomy labels and post titles, and publish them (AUDIT-1 S11.3)
- `GAP-G5-5` [src/components/admin/MediaLibrary.tsx:392](../../../src/components/admin/MediaLibrary.tsx#L392) Saving image details reports success when the row was deleted or RLS no longer lets the caller update it

### Store and checkout (client) (18)

- `STORE-checkout-2` [src/components/store/CheckoutForm.tsx:131](../../../src/components/store/CheckoutForm.tsx#L131) A failed quote refresh disables staleness detection, so the button stays enabled on an outdated summary and burns create attempts (AUDIT-1 S14.8)
- `STORE-checkout-4` [src/components/store/CheckoutForm.tsx:160](../../../src/components/store/CheckoutForm.tsx#L160) A confirm press that was answered with a Turnstile failure is still 'pending', so a later Turnstile recovery submits the order without a new press
- `STORE-checkout-5` [src/components/store/CheckoutForm.tsx:123](../../../src/components/store/CheckoutForm.tsx#L123) City list failures and an empty city list are silent: the buyer of a physical cart gets a dead select and only «اختر مدينة التوصيل»
- `STORE-checkout-6` [src/components/store/CheckoutForm.tsx:485](../../../src/components/store/CheckoutForm.tsx#L485) Coupon input has no length cap; a code over 64 characters makes every quote fail and, after a reload, leaves checkout as a dead end (AUDIT-1 S14.3)
- `STORE-checkout-8` [src/lib/cart.ts:292](../../../src/lib/cart.ts#L292) writeCart persists a whole-cart snapshot from React state, so a stale /cart tab silently deletes items added in another tab
- `STORE-cart-1` [src/components/store/CartView.tsx:161](../../../src/components/store/CartView.tsx#L161) Cart quote failure tells the buyer to retry but offers no retry, and nothing retries (AUDIT-1 S14.3)
- `STORE-cart-2` [src/components/store/CartView.tsx:272](../../../src/components/store/CartView.tsx#L272) Coupon field has no length bound; an over-long code makes every quote fail with a misleading message and survives reload
- `STORE-cart-4` [src/components/store/CartView.tsx:226](../../../src/components/store/CartView.tsx#L226) Dedication inputs on different lines share one accessible name (AUDIT-1 X3.11)
- `STORE-cart-5` [src/components/store/CartProvider.tsx:30](../../../src/components/store/CartProvider.tsx#L30) Cart is read once on mount and then written back whole, so another tab's additions are overwritten
- `STORE-cart-6` [src/components/store/AddToCart.tsx:36](../../../src/components/store/AddToCart.tsx#L36) S06.8 fix leaves the partial-cap case: an add clamped by addLine still says «أُضيف إلى السلة» (AUDIT-1 S06.8)
- `STORE-cart-7` [src/lib/money-input.ts:55](../../../src/lib/money-input.ts#L55) riyadhLocalToIso throws RangeError on valid datetime-local values with a 5+ digit year; PublishBar then stays disabled
- `STORE-cart-8` [src/components/store/store.module.css:65](../../../src/components/store/store.module.css#L65) Store grid paints unfilled cells solid aubergine when the product count is not a multiple of the column count
- `FIX-public-2` [src/components/store/CheckoutForm.tsx:484](../../../src/components/store/CheckoutForm.tsx#L484) Coupon field has no maxLength; a >64-char value makes every quote fail and the persisted value dead-ends /checkout (AUDIT-1 S14.3)
- `FIX-public-5` [src/components/store/AddToCart.tsx:36](../../../src/components/store/AddToCart.tsx#L36) A capped (partial) add is still confirmed as a full add (AUDIT-1 S06.8)
- `X-MONEY-2` [src/components/store/CartProvider.tsx:30](../../../src/components/store/CartProvider.tsx#L30) Cart page never re-reads storage, so an edit made on a stale cart tab overwrites items added in another tab (AUDIT-1 S06.1)
- `X-A11Y-RTL-6` [src/components/store/CartView.tsx:220](../../../src/components/store/CartView.tsx#L220) Removing a cart line deletes the focused button; focus is lost and the removal is not announced (AUDIT-1 X3.11)
- `X-A11Y-RTL-9` [src/components/store/CheckoutForm.tsx:441](../../../src/components/store/CheckoutForm.tsx#L441) Field errors sit in non-live spans, so pressing Enter in the field that is already focused announces nothing (AUDIT-1 X3.4)
- `GAP-G4-5` [src/components/store/CheckoutForm.tsx:421](../../../src/components/store/CheckoutForm.tsx#L421) A coupon over 64 characters makes every quote fail; after a reload checkout shows only a retry button that can never succeed (AUDIT-1 S14.3)

### Public site (25)

- `PUBLIC-data-4` [src/lib/content.ts:170](../../../src/lib/content.ts#L170) A blank journal menu label blanks the journal's name everywhere (?? does not catch '') (AUDIT-1 G3.1)
- `PUBLIC-data-5` [public/media/manifest.json:121](../../../public/media/manifest.json#L121) Committed totalBytes no longer matches the listed films after the five child films were removed (AUDIT-1 G4.2)
- `PUBLIC-data-6` [src/app/(public)/contact/page.tsx:30](../../../src/app/(public)/contact/page.tsx#L30) The admin's «بريد التواصل» is validated and published to anon, but no public page ever shows it
- `PUBLIC-data-7` [src/content/contact.ts:11](../../../src/content/contact.ts#L11) Misspelled Arabic in the public consulting copy
- `PUBLIC-ui-2` [src/components/public/rooms/PassedRoomView.tsx:37](../../../src/components/public/rooms/PassedRoomView.tsx#L37) Passed room drops a story picture entirely when the text has fewer blocks than pictures
- `PUBLIC-ui-3` [src/components/public/rooms/BuiltRoomView.tsx:90](../../../src/components/public/rooms/BuiltRoomView.tsx#L90) Built room poster is still dropped when the first band has no text after it (AUDIT-1 S13.2)
- `PUBLIC-ui-4` [src/components/public/contact/ContactForm.tsx:63](../../../src/components/public/contact/ContactForm.tsx#L63) «اطلب جلسة» swaps the message but keeps the submission key, so a lost-response retry reports a message as sent that was never stored (AUDIT-1 S16.5)
- `PUBLIC-ui-5` [src/components/public/rooms/ShelfRoomView.tsx:242](../../../src/components/public/rooms/ShelfRoomView.tsx#L242) The admin's alt text for the moonlight-cup factory and inside photos is accepted and ignored
- `PUBLIC-ui-7` [src/components/public/story/flow.ts:25](../../../src/components/public/story/flow.ts#L25) Band and pull lines are matched by exact text and nothing checks they still match a paragraph
- `PUBLIC-style-4` [src/styles/globals.css:135](../../../src/styles/globals.css#L135) html scroll-behavior:smooth without data-scroll-behavior makes every route change scroll-animate from the old offset
- `PUBLIC-style-2` [src/components/site/site.module.css:183](../../../src/components/site/site.module.css#L183) menu-weave has no `to` clip-path, so the menu opens empty and its bands pop in instead of wiping
- `PUBLIC-style-3` [src/components/public/scenes/scenes.module.css:61](../../../src/components/public/scenes/scenes.module.css#L61) tile-in, viewer-in, photo-next and photo-prev are from-only clip-path animations (discrete flip at 50%)
- `PUBLIC-style-5` [src/styles/globals.css:195](../../../src/styles/globals.css#L195) ::selection colours equal the aubergine band colours, so selected text is invisible on aub bands
- `PUBLIC-style-6` [src/styles/motion.css:41](../../../src/styles/motion.css#L41) .motion-scrub > * also animates Figure's corner caption
- `PUBLIC-style-7` [src/components/weave/section-nav.module.css:15](../../../src/components/weave/section-nav.module.css#L15) Section links' focus ring is clipped top and bottom by the scroller
- `PUBLIC-style-8` [src/components/weave/video.module.css:7](../../../src/components/weave/video.module.css#L7) The film's own focus ring is fully clipped, so the focus VideoTile moves to it has no visible indicator
- `PUBLIC-style-9` [src/components/weave/VideoTile.tsx:64](../../../src/components/weave/VideoTile.tsx#L64) An AbortError from the visitor's own pause is reported as a playback failure
- `PUBLIC-style-10` [src/components/weave/layout.module.css:51](../../../src/components/weave/layout.module.css#L51) .lattice paints its solid --line colour into unfilled cells; two 3-item lattices leave an aubergine hole at tablet widths
- `PUBLIC-style-11` [src/components/site/site.module.css:66](../../../src/components/site/site.module.css#L66) The current-room and current-section triangles vanish in forced-colors mode
- `PUBLIC-style-12` [src/components/public/journal/journal.module.css:20](../../../src/components/public/journal/journal.module.css#L20) The pressed filter is shown only by a background swap, which forced-colors mode erases
- `FIX-public-6` [src/components/public/rooms/BuiltRoomView.tsx:90](../../../src/components/public/rooms/BuiltRoomView.tsx#L90) The intro picture is dropped when the first band line is the last block of the intro (AUDIT-1 S13.2)
- `FIX-public-7` [src/components/public/journal/PostView.tsx:21](../../../src/components/public/journal/PostView.tsx#L21) Admin draft preview of a post still shows the stock «المجلس» crumb after the journal is renamed (AUDIT-1 G3.1)
- `X-CONTRACT-8` [src/lib/content.ts:170](../../../src/lib/content.ts#L170) A blank menu label passes publish and blanks the journal's name on every page (AUDIT-1 S11.3)
- `X-A11Y-RTL-14` [src/components/public/journal/JournalList.tsx:47](../../../src/components/public/journal/JournalList.tsx#L47) Journal category filter changes the list without any announcement (AUDIT-1 S16.7)
- `X-A11Y-RTL-15` [src/content/contact.ts:11](../../../src/content/contact.ts#L11) Spelling errors in published contact copy

### Book reader (6)

- `BOOK-3` [src/components/book/PdfBookReader.tsx:306](../../../src/components/book/PdfBookReader.tsx#L306) Resizing or rotating into portrait on the last spread strands the reader on an empty endpaper and arms a stale skip that hijacks the next turn
- `BOOK-4` [src/components/book/pdf.ts:39](../../../src/components/book/pdf.ts#L39) A failed getDocument() never destroys its loading task, so every failed load or «إعادة المحاولة» leaves a live pdf.js worker (S15.6 fixed only the measureFrame path) (AUDIT-1 S15.6)
- `BOOK-5` [src/components/book/PdfBookReader.tsx:448](../../../src/components/book/PdfBookReader.tsx#L448) Arrow/Home/End handling ignores modifier keys and steals Alt+← / Cmd+← (browser Back) while the book has focus
- `BOOK-6` [src/components/book/PdfBookReader.tsx:511](../../../src/components/book/PdfBookReader.tsx#L511) «انتقل إلى» is controlled by state that only updates after the 900ms turn, so the select snaps back and cannot be stepped with the arrow keys
- `BOOK-7` [src/components/book/reader.module.css:281](../../../src/components/book/reader.module.css#L281) The closing leaf's flex centring is dead: page-flip writes inline display:block on every shown leaf
- `FIX-public-8` [src/components/book/PdfBookReader.tsx:168](../../../src/components/book/PdfBookReader.tsx#L168) A second failed retry drops keyboard focus to <body> again (AUDIT-1 S15.3)

### Scripts (backup, restore, media) (6)

- `SCRIPTS-data-1` [scripts/lib/backup-format.mjs:158](../../../scripts/lib/backup-format.mjs#L158) A write error on the output file skips the catch: the .partial file stays and the process dies on an unhandled rejection
- `SCRIPTS-data-2` [scripts/restore-check.mjs:426](../../../scripts/restore-check.mjs#L426) Expected failures (wrong passphrase, damaged file, non-empty destination) crash with a raw Node stack trace
- `SCRIPTS-data-3` [scripts/restore-check.mjs:47](../../../scripts/restore-check.mjs#L47) Argument loop treats --help/-h and unknown flags as the backup file; a missing --extract value silently starts a full rehearsal
- `SCRIPTS-data-4` [scripts/lib/backup-format.mjs:219](../../../scripts/lib/backup-format.mjs#L219) --extract writes the plaintext dumps with default permissions (directory 0755, files 0644) on POSIX (AUDIT-1 S17.4)
- `FIX-rest-4` [scripts/prepare-media.mjs:453](../../../scripts/prepare-media.mjs#L453) A complete full run still rewrites both manifests without four committed image entries that no generator produces (AUDIT-1 S18.3)
- `X-CONTRACT-12` [scripts/check-export.mjs:11](../../../scripts/check-export.mjs#L11) check:export has no check that guardian-pending films are absent, though the status record says it does (AUDIT-1 G4.2)

### Tests (4)

- `GAP-G1-1` [tests/integration/buyer-retention.test.ts:77](../../../tests/integration/buyer-retention.test.ts#L77) Retention fixture has no coupon redemption, so the purge's third child delete is unproven
- `GAP-G1-4` [tests/integration/audit-fixes.test.ts:220](../../../tests/integration/audit-fixes.test.ts#L220) X1.1 reset test passes only if policies/store already has a version (hidden demo-catalog dependency)
- `GAP-G1-5` [tests/integration/outbox.test.ts:420](../../../tests/integration/outbox.test.ts#L420) The 'at the quota nothing is claimed' half never has a priority-0 row pending, so it cannot fail for the intended reason (AUDIT-1 S04.1)
- `GAP-G1-6` [tests/integration/media-security.test.ts:259](../../../tests/integration/media-security.test.ts#L259) 'operations sees nothing' became vacuous when S01.1 required visible: true (AUDIT-1 S01.1)

### Docs and plans (8)

- `GAP-G3-3` [PLANS/DATA-AND-SECURITY.md:53](../../../PLANS/DATA-AND-SECURITY.md#L53) check:export is cited as proof of 'no migration credential' but has no pattern for one
- `GAP-G3-4` [docs/operations.md:582](../../../docs/operations.md#L582) Restore step 4 does not list the Edge Function secrets, and TOKEN_HASH_PEPPER is not a throwaway value
- `GAP-G3-6` [docs/privacy-data-map.md:35](../../../docs/privacy-data-map.md#L35) The access/erase lookup misses visitors whose address has an internationalized domain
- `GAP-G3-7` [docs/privacy-data-map.md:23](../../../docs/privacy-data-map.md#L23) Data map omits Cloudflare as a recipient of the visitor's raw IP and misstates what the owner sees of staff
- `GAP-G3-8` [docs/operations.md:337](../../../docs/operations.md#L337) Runbook quotes admin strings that the screens do not show, and keeps pre-D31 package numbers
- `GAP-G3-9` [.env.example:62](../../../.env.example#L62) SUPABASE_PROJECT_REF is a name nothing reads; the backup script uses SUPABASE_PROJECT_ID (AUDIT-1 S23.8)
- `GAP-G3-10` [PLANS/EXECUTION-STATUS.md:11](../../../PLANS/EXECUTION-STATUS.md#L11) The 'Current state' table still says AUDIT-1 is not committed and stops at the wrong last commit (AUDIT-1 S22.1)
- `GAP-G3-11` [PLANS/COVERAGE.md:31](../../../PLANS/COVERAGE.md#L31) C25 says the WhatsApp link is live; no WhatsApp number exists anywhere in the content

### Tooling and configuration (1)

- `FIX-rest-1` [playwright.config.ts:18](../../../playwright.config.ts#L18) ACCEPTANCE_PACKAGE=DESIGN-B is rejected, so the DESIGN-B visual evidence can no longer be written (AUDIT-1 S21.1)

## 7. Split verdicts (16)

The two verification runs disagreed (one confirmed, one refuted). Treat each as unproven until it is rechecked when its area is next touched.

- `DB-auditfix-2` [supabase/migrations/20260930120000_audit_fixes.sql:342](../../../supabase/migrations/20260930120000_audit_fixes.sql#L342) RECIPIENT_INACTIVE rows are counted and offered for replay in the admin, yet can never be cleared or replayed (AUDIT-1 S03.5) — run1 confirmed, run2 refuted
- `EF-money-1` [supabase/functions/_shared/analytics.ts:81](../../../supabase/functions/_shared/analytics.ts#L81) Top-paths query takes 100 leading groups before the asset filter, so real pages fall out of the list (AUDIT-1 S07.1) — run1 refuted, run2 confirmed
- `ADMIN-publish-2` [src/components/admin/RichTextEditor.tsx:88](../../../src/components/admin/RichTextEditor.tsx#L88) Editor accepts any string starting with `https://`, but publishing needs a parseable URL (AUDIT-1 S08.12) — run1 refuted, run2 confirmed
- `ADMIN-auth-6` [src/components/admin/TeamView.tsx:38](../../../src/components/admin/TeamView.tsx#L38) callStaffAdmin duplicates callFunction but drops its 200-reply validation, so a non-JSON 200 crashes runAction with a TypeError — run1 refuted, run2 confirmed
- `ADMIN-ops-5` [src/components/admin/EmailView.tsx:65](../../../src/components/admin/EmailView.tsx#L65) Email and settings screens have no role check, so a role without access gets a misleading error and a useless retry button — run1 refuted, run2 confirmed
- `ADMIN-ops-7` [src/admin/tables/variants.ts:24](../../../src/admin/tables/variants.ts#L24) Integer fields (stock, sort_order, usage_limit, low stock threshold) have no upper bound, so an overflow saves as a generic failure (AUDIT-1 S11.3) — run1 refuted, run2 confirmed
- `ADMIN-ops-8` [src/components/admin/StatsView.tsx:37](../../../src/components/admin/StatsView.tsx#L37) «حدّث الصفحة» is advice that cannot work for up to 5 minutes because the server caches the failed answer — run1 refuted, run2 confirmed
- `PUBLIC-ui-6` [src/components/public/rooms/BuiltRoomView.tsx:179](../../../src/components/public/rooms/BuiltRoomView.tsx#L179) Built movements have an image and a «صورة عريضة» switch in the admin that the page never reads — run1 confirmed, run2 refuted
- `TOOLING-7` [.claude/settings.json:22](../../../.claude/settings.json#L22) Hook timeouts are written in milliseconds, but Claude Code reads them as seconds — run1 refuted, run2 confirmed
- `TOOLING-9` [eslint.config.mjs:18](../../../eslint.config.mjs#L18) The Edge Function entrypoints are never linted or type-checked by lint, typecheck, tests or CI — run1 refuted, run2 confirmed
- `FIX-public-3` [src/components/store/CheckoutForm.tsx:383](../../../src/components/store/CheckoutForm.tsx#L383) Hold and cancel results are still not conveyed: focus lands on a group named only by the order number (AUDIT-1 S14.5) — run1 refuted, run2 confirmed
- `X-SEC-5` [supabase/functions/_shared/rate-limit.ts:28](../../../supabase/functions/_shared/rate-limit.ts#L28) Per-IP throttles key on the full IPv6 address, so one /64 gets unlimited buckets — run1 refuted, run2 confirmed
- `X-SEC-6` [supabase/migrations/20260926090000_media_library.sql:201](../../../supabase/migrations/20260926090000_media_library.sql#L201) The upload-ticket cap is a concurrency cap, so an editor token can fill Storage faster than the sweep can empty it — run1 refuted, run2 confirmed
- `X-CONTRACT-6` [supabase/migrations/20260927120000_rebuild_delivery_and_media_sweep.sql:71](../../../supabase/migrations/20260927120000_rebuild_delivery_and_media_sweep.sql#L71) The failure counter is never reset by a new build request, so after exhaustion a later request gets one try and no retries — run1 confirmed, run2 refuted
- `X-CONTRACT-7` [src/lib/admin-publish.ts:87](../../../src/lib/admin-publish.ts#L87) The publish gate's media check still puts every id in one GET URL (AUDIT-1 S12.5) — run1 confirmed, run2 refuted
- `X-HEALTH-2` [vitest.config.ts:3](../../../vitest.config.ts#L3) Extensionless import in vitest.config.ts triggers Vite's native-loader deprecation warning — run1 refuted, run2 confirmed

### Environment findings behind 4.12 (5)

- `TOOLING-1` [.claude/settings.json:86](../../../.claude/settings.json#L86) AUDIT-1 G4.6 regression: allowlist again runs `node dist/cli.js` and `graft-dev` without a prompt (AUDIT-1 G4.6)
- `TOOLING-2` [.mcp.json:7](../../../.mcp.json#L7) AUDIT-1 S18.4 regression: graft MCP server is unpinned again (`npx -y @nanonets/graft`) (AUDIT-1 S18.4)
- `TOOLING-5` [.gitignore:2](../../../.gitignore#L2) Regenerated multi-agent config files are untracked and unignored, undoing commit 4f22b78's cleanup
- `TOOLING-6` [.claude/settings.json:50](../../../.claude/settings.json#L50) Graft's per-prompt hook is back next to codegraph's, against CLAUDE.md and the token-budget rule
- `FIX-rest-5` [.mcp.json:7](../../../.mcp.json#L7) The S18.4 pin is gone from the working tree, and the per-agent MCP configs 4f22b78 deleted are back unpinned (AUDIT-1 S18.4)

## 8. Where the project stands

About **64%** of the offered scope, P00 to P11, weighted by package complexity (high 3, medium 2). That is unchanged since AUDIT-1: no package moved today, and this audit found nothing that reopens a finished package. It excludes P12 (bonus) and the external E-gate inputs.

| Phase | Packages | Complete |
|---|---|---|
| Foundation | P00, P01 with DESIGN-B, P02 | about 96% |
| Administration | P03 to P07, CLEANUP-1, AUDIT-1 | about 95% |
| Store and payment | P08, P09 (P06/P07 store groundwork done) | about 29% |
| Launch | P10, P11 | about 5% |

## 9. What was done after the report (2026-09-30 to 10-01)

The owner, after reading the summary: "do all needed work, you decide for me … I TRUST YOU". Then, during the fixes (2026-10-01): "it is a bad thing to ask same model to audit same model work!! should be you OPUS 5.5 … the one who DO AUDITING AFTER THE WORK DONE", recorded as D43.

**graft (4.12).** Two copies of graft, a global CLI (0.16.0) and the version pinned for the MCP server (0.21.1), each found the other's version in the git-ignored wiring stamp (`graft/.cache/wiring-stamp.json`), which still listed eleven tools. Each start re-ran its setup for all of them. Fixed on this machine: the global CLI is now 0.21.1, the stamp names only Claude and `AGENTS.md`, and the six files and nine paths were restored from Git. Running the session-start hook and starting the MCP server afterwards left the tree clean.

**The fixes (package AUDIT-2-FIX, under the lock).**
- A workflow (`wf_c600ebdd-922`, 34 agents, about 7 hours) ran eleven sequential rounds: DB, Edge Functions, admin editor, publishing, media, admin operations, store, public site, book reader, scripts and tests, docs. Each round was one fresh `sonnet-worker` (Sonnet 5.5, xhigh) with its findings file (`rounds/<round>.json`) and an exact file allowlist, followed by a Sonnet pre-audit. R03 and R08 needed one re-fix; R10 and R11 needed two.
- 177 findings were handled: 166 fixed in the rounds, 3 already fixed by an earlier round, 8 handed to the orchestrator.
- One forward migration, `20260930140000_audit2_fixes.sql`:
  - the stale-version conflicts raise 23505 (4.1);
  - a schedule whose post slug is live elsewhere is refused at schedule time (4.3);
  - the document list carries the scheduled version (4.4);
  - anon may read `media.alt_ar` of published media (4.8);
  - one lock order for every writer of a document (no deadlock);
  - the first publication date survives an archive;
  - `media_usage` lists a live document once;
  - the contact form's daily cap fits the outbox;
  - the outbox attention list drops `RECIPIENT_INACTIVE`;
  - a quota wait restarts the idempotency window;
  - the accept and the webhook take one per-message lock;
  - a new build request resets the failure count;
  - a missing deploy hook is recorded;
  - stock-only variant saves no longer rebuild;
  - `cron.job_run_details` is purged daily.

**The orchestrator's audit (D43).** Every round's diff was read in full in the main session, and the problems found were fixed:
- **Build checks:** the build and typecheck failed on stale `.next` type files and the git-excluded `BOOK_ASSETS/` site copy (now excluded in `tsconfig.json`), and `check:copy` failed on an Arabic-Indic example in a comment.
- **Admin fixes:**
  - the date field threw on a five-digit year;
  - a folder typed with surrounding spaces became a new folder;
  - failed statistics were cached for five minutes (now 30 seconds; a good answer keeps five);
  - the draft preview lacked library alt text and the journal's own name;
  - blank home and room titles could be published;
  - the built room's per-movement image and «صورة عريضة» were edited but never shown, so both were removed from the admin and the seed.
- **Lattice grids:** a half-filled lattice painted a solid line-coloured block at tablet width. The tiles now draw the lines, in the band's own line colour.
- **Sign-out:** signing out deleted unsaved local copies without a word; it now asks first.
- **Reader:** its new turn guard dropped an arrow pressed during a turn. A move asked for during a turn now waits for it, so nothing overshoots and nothing is lost.
- **Tests:** four end-to-end tests that encoded the old behaviour were updated to the fixed behaviour: the editor's email screen, the error label naming the item, media used once, and the reader waiting for its own opening.

**Left open.**
- I48 (section 5, for P08).
- I49: the upload byte cap, rotated AVIF/WebP/PNG uploads, a Deno type check in CI, optional export patterns, budget headroom.
- I45 (3): whether the site shows a contact e-mail.
- TOOLING-7 is not fixed: graft generates those hook timeouts.

**Evidence** (`commands.txt`):

| Check | Result |
|---|---|
| lint, typecheck | 0 |
| unit | 632/632 |
| check:copy, check:frozen | OK |
| `supabase db reset` | every migration applies |
| test:db (edge runtime running) | 230/230 |
| build | OK |
| check:export | 51 required files, no secret, no child-film file |
| check:budgets | largest 147.4 KiB of 150 |
| e2e | **169/169** on each suite's last run: cart-checkout, checkout-api, store-admin, motion and visual 106 passed in batch 2; public and auth passed in the re-run after Mailpit's port was restored (an environment failure: the container ran, its forwarded port did not); cms, media, owner-operations and reader 52/52 after four tests that encoded the old behaviour were updated |

Progress stays at about 64% (section 8). The next package is P08.
