# AUDIT-1 appendix: every confirmed finding and what happened to it

Generated from `audit-result.json` (the verified findings) and the two workflow results. Status: **fixed** (by the named round, ORCH = the orchestrator), **owner** (waits for an owner decision, see ISSUES I42 to I45), **recorded** (kept open in ISSUES or docs). Full evidence, failure scenario, fix and verifier notes per id: `audit-result.json` and `findings/<ROUND>.json`.

| Id | Severity | Category | Location | Finding | Status | By |
|---|---|---|---|---|---|---|
| G4.2 | high | privacy | `public/images/manifest.json:1055` | The five child-featuring films 'hidden until guardians consent' are in every static export, and their paths appear in a public manifest and the client JS | fixed | ORCH |
| S08.2 | high | data-loss | `src/components/admin/CollectionForm.tsx:168` | Autosave overwrites the unsaved local copy on offer as soon as the user edits before answering the banner | fixed | ADMIN_EDIT |
| S23.3 | medium | privacy | `docs/privacy-data-map.md:3` | privacy-data-map says buyers do not exist, but P07 already stores buyer name, email, phone, address and dedications | fixed | DOCS |
| G1.1 | medium | security | `docs/privacy-data-map.md:48` | A restore of an older backup brings back revoked or erased staff access, and the ledger's privacy_erase_staff line then fails instead of reapplying | fixed | DOCS |
| X5.9 | medium | docs | `PLANS/COVERAGE.md:3` | COVERAGE says every C-ID is NOT STARTED | fixed | DOCS |
| S22.18 | medium | docs | `PLANS/DATA-AND-SECURITY.md:16` | Data contract lists a `policies` table (six types, own approval columns) but policies are a content collection with approval in commerce_settings | fixed | DOCS |
| S22.16 | medium | docs | `PLANS/DATA-AND-SECURITY.md:34` | Data contract describes reserved counters and a stored checkout_quotes table that P07 deliberately did not build | fixed | DOCS |
| S22.5 | medium | docs | `PLANS/DECISIONS.md:59` | DECISIONS recorded assumption keeps contact retention at 180 days; D36 and the purge job use 90 | fixed | DOCS |
| G4.1 | medium | privacy | `PLANS/evidence/source-manifest.json:418` | A WhatsApp chat export, third-party contact cards and voice notes are tracked in git and pushed to GitHub on 10 refs | owner | - |
| S22.1 | medium | docs | `PLANS/EXECUTION-STATUS.md:9` | EXECUTION-STATUS 'Current state (2026-09-26)' table is stale on every row KICKOFF tells each session to read | fixed | ORCH |
| S22.3 | medium | docs | `PLANS/HANDOFF.md:135` | HANDOFF keeps glm-worker and opus-worker as current working rules after D41 removed both | fixed | DOCS |
| S17.2 | medium | ops | `scripts/backup.mjs:170` | `storage cp --linked` runs with cwd set to the OS temp dir, outside the linked project, so the default `pnpm backup` cannot resolve the linked project ref | fixed | SCRIPTS |
| S17.3 | medium | data-loss | `scripts/lib/backup-format.mjs:340` | The reader rejects a valid backup whose last entry is zero bytes (`Entry data is truncated`), so the file can never be extracted or rehearsed | fixed | SCRIPTS |
| S17.4 | medium | security | `scripts/restore-check.mjs:309` | `restore-check --extract` writes the decrypted plaintext (auth users, TOTP secrets, customer data) into any directory, including inside the repository | fixed | SCRIPTS |
| G3.4 | medium | correctness | `src/admin/collections/rooms.ts:61` | Room and footer fields the admin requires are never rendered, so edits to them change nothing on the site | fixed | ADMIN_EDIT |
| S11.1 | medium | correctness | `src/admin/tables/coupons.ts:47` | Coupons list shows «لا يوجد» as the value of every fixed-amount coupon (amount_halalas is never selected) | fixed | ORCH |
| G3.1 | medium | correctness | `src/app/(public)/journal/page.tsx:34` | D11/C08 'editable name' for the journal is not implemented: المجلس is hard-coded on every surface except the menu | fixed | PUBLIC |
| S10.2 | medium | correctness | `src/components/admin/AdminShell.tsx:43` | A transient current_staff_role() failure (including on every tab refocus) switches the whole admin to «لا تملك صلاحية الوصول» and unmounts the open screen | fixed | ADMIN_OPS |
| S08.5 | medium | concurrency | `src/components/admin/CollectionForm.tsx:143` | A restored local copy based on an older version overwrites the newer saved version without warning; StoredDraft.baseSeq is written but never compared | fixed | ADMIN_EDIT |
| S08.3 | medium | data-loss | `src/components/admin/CollectionForm.tsx:172` | Pending autosave is cancelled on unmount or tab close, and nothing warns about leaving with unsaved edits | fixed | ADMIN_EDIT |
| X5.1 | medium | correctness | `src/components/admin/CollectionForm.tsx:37` | Journal posts cannot be previewed as drafts (C15 'preview', D20) | fixed | ADMIN_EDIT |
| S09.4 | medium | a11y | `src/components/admin/FieldInput.tsx:101` | Choosing an image in the picker drops keyboard focus to <body> | fixed | ADMIN_FIELDS |
| S11.2 | medium | money | `src/components/admin/FieldInput.tsx:281` | Invalid money text keeps the old stored amount and Save stays enabled, so the owner saves a price other than the one shown | fixed | ADMIN_FIELDS |
| X3.4 | medium | a11y | `src/components/admin/FieldInput.tsx:313` | Admin field errors are not tied to their inputs (no aria-invalid / aria-describedby / alert) | fixed | ADMIN_FIELDS |
| S09.3 | medium | correctness | `src/components/admin/MediaLibrary.tsx:210` | «المزيد» appends pages from a stale query and swallows errors | fixed | ADMIN_FIELDS |
| S09.1 | medium | correctness | `src/components/admin/MediaLibrary.tsx:296` | The library's where-used list and delete guard ignore product covers; media_product_usage is never called | fixed | ADMIN_FIELDS |
| S09.2 | medium | data-loss | `src/components/admin/MediaLibrary.tsx:377` | Renaming a folder leaves the open details form on the old folder; the next save moves the image back | fixed | ADMIN_FIELDS |
| X3.5 | medium | a11y | `src/components/admin/PublishBar.tsx:355` | Admin save/publish/verify results render in non-live paragraphs, so outcomes are never announced | fixed | ADMIN_EDIT |
| S08.7 | medium | correctness | `src/components/admin/RichTextEditor.tsx:178` | Pasting from the web creates rich-text nodes the allowlist rejects (h1/h4–h6 headings, non-https links), and the toolbar shows an h1 as «عنوان 2» | fixed | ADMIN_EDIT |
| S08.6 | medium | correctness | `src/components/admin/RichTextEditor.tsx:220` | Clicking into a rich-text body marks the document as changed: Publish and Schedule turn off, and a false «unsaved» copy is offered on the next visit | fixed | ADMIN_EDIT |
| S08.1 | medium | correctness | `src/components/admin/RoomPreview.tsx:95` | Room preview checks the draft after swapping library image ids for media refs, so every room that uses a library image shows as invalid | fixed | ADMIN_EDIT |
| S11.3 | medium | correctness | `src/components/admin/TableForm.tsx:203` | Client validation does not match the catalog's DB checks; every violation surfaces as one generic «تحقق من القيم.» with no field named | fixed | ADMIN_OPS |
| S11.5 | medium | a11y | `src/components/admin/TableForm.tsx:318` | Save results and field errors are not announced to screen readers | fixed | ADMIN_OPS |
| S10.4 | medium | a11y | `src/components/admin/TeamView.tsx:164` | Team table role <select> has no accessible name | fixed | ADMIN_OPS |
| S10.6 | medium | a11y | `src/components/admin/TeamView.tsx:268` | Action errors on team/step-up/MFA screens are not announced to assistive tech | fixed | ADMIN_OPS |
| S15.1 | medium | correctness | `src/components/book/pdf.ts:181` | Selectable text layer is offset from the drawn words by the 4:5 frame's origin (selection and find land on the wrong lines) | fixed | BOOK |
| S15.2 | medium | performance | `src/components/book/PdfBookReader.tsx:390` | page-flip's requestAnimationFrame loop never stops after destroy(): each close of the book leaks a perpetual 60fps loop and the whole leaf DOM | fixed | BOOK |
| S15.3 | medium | a11y | `src/components/book/PdfBookReader.tsx:503` | «عرض للقراءة» drops keyboard focus to <body>: the focused toggle is unmounted when the tree changes shape | fixed | BOOK |
| X7.1 | medium | performance | `src/components/public/book/BookView.tsx:44` | Book page hero cover (the page's LCP image) states the wrong `sizes`, so phones and tablets download the 1200w file (399 KB) when the 720w file (133 KB) is enough; it also has no fetchPriority | fixed | PUBLIC |
| G5.1 | medium | privacy | `src/components/public/contact/ContactForm.tsx:118` | With JavaScript off, or before hydration, the contact form sends the visitor's name, email and message in the URL, then silently loses the message | fixed | PUBLIC |
| S16.1 | medium | correctness | `src/components/public/contact/ContactForm.tsx:164` | Contact textarea allows 5,000 characters, but the function rejects bodies over 8 KiB, so long Arabic messages fail after the visitor has written them | fixed | FN |
| X3.8 | medium | a11y | `src/components/public/journal/JournalList.tsx:45` | Journal card focus ring is drawn outside the card in the card's own ring colour (1.32–1.58:1 on its neighbours) | fixed | PUBLIC |
| S16.3 | medium | correctness | `src/components/public/journal/JournalList.tsx:62` | The journal shows no publication date anywhere, though PLANS requires a dated list | fixed | PUBLIC |
| S13.3 | medium | correctness | `src/components/public/rooms/StartedRoomView.tsx:95` | بدأتُ من هنا: the «تظهر المقاطع هنا» films can silently disappear, depending on the movement's first text block | fixed | PUBLIC |
| S13.1 | medium | correctness | `src/components/site/SiteHeader.tsx:139` | Tapping the «أنس» brand link inside the open menu leaves the modal menu open over the new page | fixed | PUBLIC |
| S06.1 | medium | correctness | `src/components/store/CartProvider.tsx:35` | Storage-denied cart: edits made on /cart never reach the memory cart, so /checkout shows and orders the stale cart | fixed | STORE |
| X3.2 | medium | a11y | `src/components/store/CartView.tsx:251` | Cart coupon errors, quote failures and new totals appear silently (no live region) | fixed | STORE |
| S14.5 | medium | a11y | `src/components/store/CheckoutForm.tsx:337` | The order hold and cancel results are not announced, and focus is lost to <body> in the core checkout flow | fixed | STORE |
| S14.3 | medium | correctness | `src/components/store/CheckoutForm.tsx:377` | One failed quote refresh replaces the whole checkout form, with no way to retry except a reload that loses the typed details | fixed | STORE |
| S14.4 | medium | correctness | `src/components/store/CheckoutForm.tsx:403` | The consent sentence's policy links navigate away in the same tab and wipe the typed checkout details | fixed | STORE |
| S14.2 | medium | correctness | `src/components/store/CheckoutForm.tsx:428` | Pressing Enter in the checkout coupon field submits the whole order instead of applying the coupon | fixed | STORE |
| S14.6 | medium | a11y | `src/components/store/CheckoutForm.tsx:556` | The delivery-address textarea has no autocomplete token (WCAG 1.3.5, Identify Input Purpose) | fixed | STORE |
| X5.7 | medium | correctness | `src/content/home.ts:20` | Home door order and facts, the book page and the services are code, not CMS; C03/C12/C13/C14 promise owner edits and a 'reordered home', and only the services are tracked as open | owner | - |
| S06.2 | medium | data-loss | `src/lib/cart.ts:94` | Re-adding a variant from the product page silently erases the dedication typed in the cart | fixed | STORE |
| S01.4 | medium | security | `supabase/config.toml:226` | Password sign-in is still possible for staff, although D08 says there are no passwords | fixed | DB |
| S04.2 | medium | correctness | `supabase/functions/_shared/email.ts:63` | A Resend daily or monthly quota 429 counts as a bounded retry, so notices are exhausted about 4 hours later, long before the quota resets | fixed | DB |
| X1.1 | medium | correctness | `supabase/migrations/20260925120000_content_versions_and_publishing.sql:147` | Publishing a policy after the owner's approval silently replaces the text buyers see and "accept"; approval is never invalidated | fixed | DB |
| S01.1 | medium | security | `supabase/migrations/20260925120000_content_versions_and_publishing.sql:88` | Anon RLS on published_documents ignores the D20 'visible' predicate, so hidden posts are publicly readable | fixed | DB |
| S17.1 | medium | correctness | `supabase/migrations/20260926120000_contacts_and_email.sql:166` | The 30-day job_runs purge deletes the last backup row at the moment D35's 30-day flag should appear, so the owner home shows «لا توجد نسخة بعد.» instead of the warning | fixed | DB |
| S04.1 | medium | security | `supabase/migrations/20260926120000_contacts_and_email.sql:291` | Staff contact notices can use the whole Resend daily quota, so a contact-form flood locks the owner out of sign-in codes | fixed | DB |
| X1.3 | medium | correctness | `supabase/migrations/20260926120000_contacts_and_email.sql:521` | Replay treats only 'uncertain' rows as ambiguous; an 'exhausted' row that ended on an uncertain send replays after 24h with its expired idempotency key and no confirmation | fixed | DB |
| S01.2 | medium | correctness | `supabase/migrations/20260927090000_static_site_and_functions.sql:159` | publish_due() stops all scheduled publishing when one scheduled post hits the post-slug unique index | fixed | DB |
| X5.4 | medium | tests | `tests/e2e/public.spec.ts:10` | Journal list, category filter and article page are never exercised by any suite (P01 proof, C16 'working public filters') | fixed | TESTS |
| X5.5 | medium | tests | `tests/e2e/visual.spec.ts:51` | P02 proof 'outside the reader the book baseline remains unchanged' has no evidence; the committed /book baseline predates the reader | recorded | - |
| G4.6 | low | security | `.claude/settings.json:78` | Claude settings allow `node dist/cli.js` with no prompt, and the graft hook falls back to importing <repo>/dist/claude/hooks.js, both copied from graft's own repository | fixed | SCRIPTS |
| S23.8 | low | config | `.env.example:53` | .env.example still lists MFA_ENCRYPTION_KEY, which nothing reads since TOTP moved to Supabase Auth | fixed | SCRIPTS |
| S18.4 | low | security | `.mcp.json:5` | Tooling runs unpinned latest npm packages (npx -y) in every session, contrary to D19 | fixed | SCRIPTS |
| S22.7 | low | docs | `CLAUDE.md:18` | 'Preserve the frozen design' and other frozen-design statements contradict D39 without a marker | fixed | DOCS |
| G3.3 | low | correctness | `content/initial-content.json:68` | The seeded X link https://x.com/anasa.aq cannot be a real account: X usernames do not allow '.' | owner | - |
| X4.5 | low | docs | `DESIGN.md:100` | DESIGN.md claims a single breakpoint, but the store, reader and admin have their own | fixed | DOCS |
| S23.1 | low | docs | `docs/development.md:128` | Guide's db:import and db:demo-catalog steps fail: DATABASE_URL is never set by db:env and the scripts read only process.env | fixed | DOCS |
| S23.7 | low | docs | `docs/development.md:14` | development.md names a nonexistent pin location for the Supabase CLI version | fixed | DOCS |
| X1.7 | low | docs | `docs/media-rights.md:47` | media-rights doc says public media is served with nosniff and a sandboxing CSP; since D32 nothing sets either | fixed | DOCS |
| S03.7 | low | docs | `docs/operations.md:320` | operations.md states checkout is locked by a check constraint and that sign-in codes use outbox priority 0, and both are outdated | fixed | DOCS |
| S23.9 | low | docs | `docs/operations.md:424` | operations.md says the store pages are plain until a v2 direction is accepted; D39 accepted B and they were restyled | fixed | DOCS |
| S23.5 | low | docs | `docs/operations.md:94` | operations.md says sign-in codes are priority 0 outbox rows, but they never enter the outbox | fixed | DOCS |
| G2.2 | low | tests | `package.json:15` | `--passWithNoTests` lets the unit and DB suites pass with zero tests, contradicting 'no exit code is masked' | fixed | SCRIPTS |
| X6.18 | low | dead-code | `package.json:53` | esbuild devDependency is a leftover of the OpenNext/Workers spike with no importer | fixed | ORCH |
| S22.20 | low | docs | `PLANS/ARCHITECTURE.md:78` | ARCHITECTURE plans the order page as a dynamic `orders/[token]` route, contradicting its own fragment rule and the static export | fixed | DOCS |
| S12.7 | low | docs | `PLANS/ARCHITECTURE.md:80` | ARCHITECTURE names public files that do not exist and leaves out the ones that do | fixed | DOCS |
| S22.21 | low | docs | `PLANS/ARCHITECTURE.md:91` | ARCHITECTURE lists the built `checkout` function as planned and omits it from the file map; names nonexistent files | fixed | DOCS |
| S22.19 | low | docs | `PLANS/DATA-AND-SECURITY.md:11` | Data contract's content enum and ops tables differ from the migrations (no policies/scenes, a nonexistent backup_runs) | fixed | DOCS |
| S22.17 | low | docs | `PLANS/DATA-AND-SECURITY.md:49` | Data contract promises a NOLOGIN function-owner role that no migration creates | fixed | DOCS |
| X5.16 | low | docs | `PLANS/DECISIONS.md:3` | DECISIONS and README revision stamps are stale (D35–D41 added through 2026-09-30) | fixed | DOCS |
| S22.6 | low | docs | `PLANS/DECISIONS.md:37` | D30 row reads as current (no 'Superseded by D41'); D28 row still names Sonnet 5 and Opus sub-agents; header revision is D32-D34 | fixed | DOCS |
| X4.4 | low | docs | `PLANS/DESIGN-AUDIT.md:196` | DESIGN-AUDIT D39 recheck still says the header's 'you are here' triangle is coral and that the reader is not shown | fixed | DOCS |
| G4.4 | low | tests | `PLANS/evidence/source-manifest.json:928` | verify-plan's frozen hash for the chat transcript matches only this machine's skip-worktree copy, so the plan check fails on any clean checkout | owner | - |
| S22.27 | low | docs | `PLANS/EXECUTION-STATUS.md:22` | DESIGN-B package section still says the work is uncommitted and lists the P02 reader as open | fixed | ORCH |
| S22.4 | low | docs | `PLANS/EXECUTION-STATUS.md:282` | Push state is wrong: DESIGN-B and P02 are on origin, yet the docs say nothing is pushed | fixed | ORCH |
| S22.2 | low | docs | `PLANS/HANDOFF.md:55` | HANDOFF 2026-09-27 'Start' block checks out the stale sync branch, and the top section routes readers into it | fixed | DOCS |
| S22.8 | low | docs | `PLANS/ISSUES.md:3` | ISSUES 'Open items only' list still holds seven resolved issues | fixed | ORCH |
| S22.10 | low | docs | `PLANS/ISSUES.md:45` | I34 still says the TOCTOU e2e proof is pending and the I29 sweep does not exist | fixed | ORCH |
| S22.9 | low | docs | `PLANS/ISSUES.md:85` | ISSUES 'Small UI items' lists an inline-styled error button that no longer exists | fixed | ORCH |
| S22.24 | low | docs | `PLANS/research-final.md:22` | research-final still covers the Free-plan backup risk with an off-site P06 backup that D35 dropped | fixed | DOCS |
| G4.8 | low | docs | `PLANS/SOURCE-NOTES.md:23` | SOURCE-NOTES still points to the pre-D39 cover set, v1 deploy/images and self-hosted Lyon, and gives a stale frozen-source count | fixed | DOCS |
| S22.23 | low | docs | `PLANS/VERIFICATION.md:53` | VERIFICATION still re-tests Worker Free CPU/size in P10 and uses an evidence path layout nobody follows | fixed | DOCS |
| S22.13 | low | docs | `PLANS/WORK-PACKAGES.md:127` | P10 file list puts Sentry in Next server instrumentation, which a static export never runs | fixed | DOCS |
| X5.14 | low | docs | `PLANS/WORK-PACKAGES.md:25` | WORK-PACKAGES P01 still asks for 'actual built tabs' and lists v1 component files that design B does not have | fixed | DOCS |
| S22.14 | low | docs | `PLANS/WORK-PACKAGES.md:91` | Store/booking admin configs are planned under src/admin/collections, but P07 built them as table configs in src/admin/tables | fixed | DOCS |
| S12.2 | low | security | `public/_headers:3` | No Content-Security-Policy anywhere, although DATA-AND-SECURITY requires one, and no work package owns it | fixed | SCRIPTS |
| S17.7 | low | security | `scripts/backup.mjs:114` | Closing the terminal window (SIGHUP on Windows) skips the 'exit' cleanup and leaves the plaintext dumps in %TEMP% | fixed | SCRIPTS |
| S18.2 | low | tests | `scripts/check-budgets.mjs:81` | check:budgets passes when out/ contains no public page (Math.max of an empty list is -Infinity) | fixed | SCRIPTS |
| G3.5 | low | tests | `scripts/check-copy.mjs:23` | check:copy never scans content/initial-content.json, the source of most public copy, or the demo seed | fixed | SCRIPTS |
| G2.4 | low | tests | `scripts/check-export.mjs:46` | check:export's REQUIRED list omits 24 of the 31 admin pages built since P05, so a dropped admin screen passes the export gate | fixed | SCRIPTS |
| G2.3 | low | tests | `scripts/check-export.mjs:81` | check:export crashes with a raw ENOENT when a required public page is missing, so it never prints its own list of failures | fixed | SCRIPTS |
| S17.6 | low | correctness | `scripts/lib/backup-format.mjs:197` | writeBackup adds one 'error' listener to the framing stream per entry, so every real backup prints a MaxListenersExceededWarning 'memory leak' notice | fixed | SCRIPTS |
| S17.5 | low | correctness | `scripts/lib/passphrase.mjs:33` | The hidden prompt drops only the ESC byte of arrow, Home and Delete key sequences and adds their tails (e.g. "[D", "[3~") to the passphrase | fixed | SCRIPTS |
| S18.3 | low | data-loss | `scripts/prepare-media.mjs:446` | prepare-media full run overwrites the committed manifests without the entries whose (git-excluded) sources are missing, then exits 0 | fixed | SCRIPTS |
| S15.4 | low | docs | `scripts/prepare-preview.py:150` | prepare-preview.py stamps the fixed 2026-09-28 approval onto whatever inputs it builds and never checks inputs against the recorded hashes | fixed | SCRIPTS |
| G1.4 | low | security | `scripts/restore-check.mjs:313` | `restore-check --extract` and the real-restore runbook leave a decrypted copy of the whole database on disk, with no step to remove it | fixed | SCRIPTS |
| S08.11 | low | correctness | `src/admin/collections/index.ts:68` | A room saved with an empty title gets an empty link in the room list and an empty editor heading | fixed | ADMIN_EDIT |
| X6.4 | low | dead-code | `src/admin/fields.ts:27` | `date` field type is supported everywhere but no field uses it (Payload leftover) | fixed | ORCH |
| S11.7 | low | correctness | `src/admin/tables/coupons.ts:23` | A new coupon with an empty percentage/amount passes form validation and fails in the DB with the generic message | fixed | ADMIN_OPS |
| S12.6 | low | docs | `src/app/(public)/book/page.tsx:7` | Stale code comments: the book page says the reader 'arrives with P02', and content.ts talks about runtime 500s | fixed | PUBLIC |
| X3.15 | low | a11y | `src/app/(public)/journal/[slug]/page.tsx:55` | Arrow glyphs inside link names are read aloud («سهم لليمين المجلس») | fixed | PUBLIC |
| X7.3 | low | seo | `src/app/(public)/policies/[slug]/page.tsx:28` | The policy pages' <title> ignores the published policy title while the <h1> uses it, so the two drift apart as soon as Anas edits a title | fixed | STORE |
| X6.14 | low | dead-code | `src/app/(public)/policies/[slug]/page.tsx:31` | Policies page re-implements content.ts's published-document fetch | recorded | - |
| S12.4 | low | correctness | `src/app/(public)/store/[slug]/page.tsx:79` | A published product with no enabled variant shows an empty list on its page, with no «unavailable» line | fixed | STORE |
| S12.3 | low | a11y | `src/app/(public)/store/page.tsx:49` | Each store card link's accessible name repeats the product title | fixed | STORE |
| X3.17 | low | a11y | `src/components/admin/admin.module.css:19` | Admin nav links are text-height targets despite the stated 44px target rule | fixed | ADMIN_OPS |
| S10.12 | low | correctness | `src/components/admin/AdminHome.tsx:116` | Owner home 'problems needing attention' counts rows that need no action and never clear | fixed | ADMIN_OPS |
| S10.13 | low | correctness | `src/components/admin/AdminHome.tsx:244` | Owner home shows a failed stats call as «غير متاحة», and a failed staff lookup as an empty page | fixed | ADMIN_OPS |
| S10.5 | low | a11y | `src/components/admin/AdminShell.tsx:96` | Admin screens have no <main> landmark and no skip link | fixed | ADMIN_OPS |
| X3.21 | low | rtl-i18n | `src/components/admin/CollectionForm.tsx:260` | Content form validation errors show raw English schema paths to Anas | fixed | ADMIN_EDIT |
| S08.10 | low | correctness | `src/components/admin/DocumentEditor.tsx:14` | Room ids are checked with `in`, so ?id=constructor (or toString, __proto__) passes and crashes the editor instead of showing «المستند غير موجود» | fixed | ADMIN_EDIT |
| S10.3 | low | rtl-i18n | `src/components/admin/EmailView.tsx:32` | Email problems table shows the raw English status 'sent' (and 'pending'/'sending') for bounced/complained rows | fixed | ADMIN_OPS |
| X4.3 | low | design | `src/components/admin/FieldInput.tsx:142` | Admin «المَشاهد» editor shows each photo as a bare file id with no thumbnail | fixed | ADMIN_FIELDS |
| S08.13 | low | correctness | `src/components/admin/FieldInput.tsx:508` | Taxonomy relation field hides selected slugs that are no longer published, so they cannot be unticked, and a failed taxonomy load reads as «none published» | fixed | ADMIN_FIELDS |
| X3.6 | low | a11y | `src/components/admin/FieldInput.tsx:582` | Reordering list/paragraph items leaves focus on the old index, so repeated «أعلى» swaps items back and forth | fixed | ADMIN_FIELDS |
| S09.8 | low | a11y | `src/components/admin/MediaLibrary.tsx:189` | Picker tiles are announced as unpressed toggle buttons | fixed | ADMIN_FIELDS |
| S09.11 | low | correctness | `src/components/admin/MediaLibrary.tsx:281` | The folder list is silently capped at PostgREST max_rows (1000) | fixed | ADMIN_FIELDS |
| S09.7 | low | a11y | `src/components/admin/MediaLibrary.tsx:425` | The folder filter lists the root folder as a blank, unlabeled option | fixed | ADMIN_FIELDS |
| S09.9 | low | correctness | `src/components/admin/MediaLibrary.tsx:555` | A failed delete's error stays and shows up when deleting another image | fixed | ADMIN_FIELDS |
| S09.10 | low | correctness | `src/components/admin/MediaLibrary.tsx:76` | Where-used shows a post as its raw UUID | fixed | ADMIN_FIELDS |
| S09.12 | low | docs | `src/components/admin/MediaLibrary.tsx:8` | Stale header comments point to code that no longer exists | fixed | ADMIN_FIELDS |
| S09.6 | low | performance | `src/components/admin/MediaPicker.tsx:39` | Every image field mounts a hidden MediaBrowser that queries the library on form load | fixed | ADMIN_FIELDS |
| S09.5 | low | correctness | `src/components/admin/MediaUpload.tsx:36` | The WebP error tells Safari users to use Safari | fixed | ADMIN_FIELDS |
| X6.6 | low | dead-code | `src/components/admin/PublishBar.tsx:20` | PublishBar re-implements `riyadhLocalToIso` that money-input.ts already exports | fixed | ADMIN_EDIT |
| X3.7 | low | rtl-i18n | `src/components/admin/RichTextEditor.tsx:133` | Rich-text «مائل» renders as <em> with browser-synthesised oblique on Arabic (no italic face exists) | fixed | ADMIN_EDIT |
| S08.12 | low | correctness | `src/components/admin/RichTextEditor.tsx:85` | «تطبيق الرابط» with a non-https URL silently removes the existing link | fixed | ADMIN_EDIT |
| S10.14 | low | correctness | `src/components/admin/SettingsView.tsx:49` | Settings WhatsApp preview shows «غير مُعدّ بعد» when the settings read fails | fixed | ADMIN_OPS |
| S10.11 | low | correctness | `src/components/admin/SignIn.tsx:44` | Sign-in code step has no way to request a new code or change the email (codes expire in 10 min) | fixed | ADMIN_OPS |
| X3.19 | low | a11y | `src/components/admin/SignIn.tsx:44` | Sign-in step change and reader mode toggle drop keyboard focus to <body> | fixed | ADMIN_OPS |
| X3.18 | low | a11y | `src/components/admin/StepUp.tsx:59` | Admin modal dialogs have no accessible name | fixed | ADMIN_OPS |
| S11.8 | low | correctness | `src/components/admin/TableForm.tsx:207` | RLS-denied updates and failed secondary loads are reported as the wrong state | fixed | ADMIN_OPS |
| S11.9 | low | correctness | `src/components/admin/TableForm.tsx:223` | TableForm ignores config.read and config.insert, so direct URLs show misleading pages | fixed | ADMIN_OPS |
| S11.4 | low | correctness | `src/components/admin/TableForm.tsx:225` | Every edit page flashes the red error «تعذّر تحميل السجل.» while the row is still loading | fixed | ADMIN_OPS |
| X3.20 | low | correctness | `src/components/admin/TeamView.tsx:118` | Team invite: email field lacks dir="ltr", and the fields are cleared even when the invite failed | fixed | ADMIN_OPS |
| S10.8 | low | correctness | `src/components/admin/TeamView.tsx:199` | Owner can revoke or demote himself with one click, no confirmation | fixed | ADMIN_OPS |
| S10.9 | low | correctness | `src/components/admin/TeamView.tsx:83` | Team table shows a revoked member as «نشط» after a BAN_FAILED reply | fixed | ADMIN_OPS |
| S15.6 | low | performance | `src/components/book/PdfBookReader.tsx:151` | A PDF document (and its worker) that finishes loading after the reader closes, or whose frame measuring fails, is never destroyed | fixed | BOOK |
| S15.7 | low | correctness | `src/components/book/PdfBookReader.tsx:46` | From full screen, «النسخ ←» does not scroll to the editions when the URL already ends in #editions | fixed | BOOK |
| S16.5 | low | correctness | `src/components/public/contact/ContactForm.tsx:41` | «اطلب جلسة» on a second service keeps the first service's prefilled message | fixed | PUBLIC |
| S16.2 | low | correctness | `src/components/public/contact/ContactForm.tsx:96` | When the server rejects an email the form accepted (422), the visitor gets a generic error with no field marked | fixed | PUBLIC |
| X4.1 | low | design | `src/components/public/home/home.module.css:111` | Home room doors: «ادخل ←» sits one line higher on the «على الرف» door when its meta wraps (1440) | fixed | PUBLIC |
| X7.4 | low | a11y | `src/components/public/journal/JournalList.tsx:35` | The journal category filter is announced as role="toolbar" but has no arrow-key roving focus, unlike the scenes filter which correctly uses role="group" | fixed | PUBLIC |
| X7.2 | low | performance | `src/components/public/journal/JournalList.tsx:57` | Images that are in the first viewport and are likely the LCP element are lazy-loaded (journal lead card, store grid first cards, product cover) | fixed | PUBLIC |
| X4.2 | low | design | `src/components/public/rooms/built.module.css:72` | /built team films start about 40px apart because only one of them has a caption (1440) | fixed | PUBLIC |
| S13.2 | low | correctness | `src/components/public/rooms/BuiltRoomView.tsx:106` | بنيتُ هنا: the drone film and the intro picture depend on the number of intro band lines (0 lines drops both, 2 lines duplicates both) | fixed | PUBLIC |
| S13.6 | low | rtl-i18n | `src/components/public/rooms/rooms.module.css:65` | The «وشيء لم يبدأ بعد.» display line wraps on phones at line-height 1.15, below DESIGN.md's 1.25 floor for Arabic display lines | fixed | PUBLIC |
| S13.4 | low | correctness | `src/components/public/rooms/StartedRoomView.tsx:91` | بدأتُ من هنا: the room's closing (signature, closingLine, signature text) is dropped when the last movement ends on a band line | fixed | PUBLIC |
| G5.4 | low | correctness | `src/components/public/scenes/SceneGallery.tsx:102` | With JavaScript off, every scenes tile is a zoom-in button that does nothing, and captions are never visible | fixed | PUBLIC |
| G5.5 | low | correctness | `src/components/public/scenes/SceneGallery.tsx:67` | With JavaScript off, the scenes and journal category filters render as dead toggle buttons | fixed | PUBLIC |
| S16.7 | low | a11y | `src/components/public/scenes/SceneGallery.tsx:84` | Switching the scenes filter back to «الكل» announces nothing | fixed | PUBLIC |
| X3.14 | low | a11y | `src/components/public/scenes/scenes.module.css:205` | Lightbox step arrows sit on the photo with no backing on phones | fixed | PUBLIC |
| G5.2 | low | correctness | `src/components/site/SiteHeader.tsx:117` | Below 1024px with JavaScript off, «القائمة» does nothing and the header shows no room links | fixed | PUBLIC |
| S06.8 | low | correctness | `src/components/store/AddToCart.tsx:22` | «أضف إلى السلة» confirms an add that addLine refused or capped | fixed | STORE |
| G5.3 | low | correctness | `src/components/store/AddToCart.tsx:349` | With JavaScript off, the product page's «أضف إلى السلة» does nothing and nothing says why | fixed | STORE |
| X3.12 | low | a11y | `src/components/store/AddToCart.tsx:46` | «أُضيف إلى السلة» status is inserted already filled and never re-announced | fixed | STORE |
| S14.11 | low | correctness | `src/components/store/CartLink.tsx:18` | The «السلة (n)» count on store and product pages goes stale after adding to the cart | fixed | STORE |
| X6.8 | low | dead-code | `src/components/store/CartProvider.tsx:43` | CartProvider computes `count` that no consumer reads | fixed | STORE |
| X3.11 | low | a11y | `src/components/store/CartView.tsx:168` | Cart line controls have identical names on every line («الكمية», «إنقاص الكمية», «حذف») | fixed | STORE |
| S14.10 | low | correctness | `src/components/store/CartView.tsx:169` | Cart and product quantity inputs cannot be cleared to type a new value | fixed | STORE |
| S14.13 | low | correctness | `src/components/store/CartView.tsx:191` | When the server refuses a signed line's dedication, the dedication input is hidden, so the buyer can only delete the line | fixed | STORE |
| X3.9 | low | rtl-i18n | `src/components/store/CartView.tsx:276` | Hand-built signs beside Latin digits reorder in RTL: discount shows «50.00−», attention count shows «+200» | fixed | STORE |
| X6.9 | low | dead-code | `src/components/store/CheckoutForm.tsx:135` | CheckoutForm hand-rolls a copy of the shared `useTurnstile` hook | fixed | STORE |
| S14.8 | low | correctness | `src/components/store/CheckoutForm.tsx:198` | Submit is not blocked while the quote is stale or refused, so avoidable refusals use up the buyer's five hourly create attempts | fixed | STORE |
| S06.7 | low | correctness | `src/components/store/CheckoutForm.tsx:259` | A duplicate `create` reply for an expired or cancelled order is shown as a live 20-minute hold | fixed | STORE |
| S14.9 | low | correctness | `src/components/store/CheckoutForm.tsx:284` | The idempotency key lives only in memory, so after a lost response and a reload the buyer is blocked by their own hold and told to do something the page cannot do | fixed | STORE |
| S06.6 | low | correctness | `src/components/store/CheckoutForm.tsx:292` | Server field errors (422 INVALID) are dropped, so a rejected email shows only «بيانات غير صالحة.» | fixed | STORE |
| S06.5 | low | correctness | `src/components/store/CheckoutForm.tsx:565` | Address field allows 2000 characters but the database accepts 500, and the refusal says «أدخل عنوان التوصيل» | fixed | STORE |
| S06.9 | low | correctness | `src/components/store/quote.ts:261` | quoteErrorMessage has no case for the dedication codes, so a dedication refusal reads «تحقق من محتويات السلة.» | fixed | STORE |
| S13.5 | low | a11y | `src/components/weave/VideoTile.tsx:103` | The play-failure message is inserted together with its role=status region, so screen readers may not announce it | fixed | PUBLIC |
| S15.5 | low | correctness | `src/lib/book-preview.ts:82` | One page at a time, the canvas window ignores skipped blank/endpaper leaves, so a turn between parts reveals an empty page | fixed | BOOK |
| S14.12 | low | data-loss | `src/lib/cart.ts:232` | A failed cart write is kept in memory but never read back while localStorage is readable, so AddToCart reports an item added that the cart never shows | fixed | STORE |
| G1.3 | low | privacy | `src/lib/cart.ts:260` | The dedication text is saved to localStorage on every keystroke and never cleared, against DATA step 1 and P07's 'persist cart IDs/qty only' | fixed | STORE |
| X6.5 | low | dead-code | `src/lib/content.ts:51` | Nine exported content types that nothing imports | fixed | PUBLIC |
| S20.1 | low | security | `src/lib/env.ts:26` | The local-database guard checks the URL's hostname, but `pg` connects to the `?host=` query parameter | fixed | SCRIPTS |
| X6.3 | low | dead-code | `src/lib/format.ts:20` | `formatDate` and `formatYear` are used only by their unit test | fixed | PUBLIC |
| S12.5 | low | performance | `src/lib/journal.ts:45` | Media-id lookups put every id in one GET URL; at about 420 post covers the build fails with 414 | fixed | PUBLIC |
| S02.5 | low | docs | `supabase/functions/_shared/admin.ts:29` | admin.ts header says the role check 'only shapes the reply', but for stats, status and the TOTP step-up it is the only enforcement | fixed | FN |
| S02.3 | low | docs | `supabase/functions/_shared/admin.ts:331` | media-delete comment says leftover objects are covered by the I29 sweep, but the sweep only handles quarantine/ and remove() never reports a failure | fixed | FN |
| S07.1 | low | correctness | `supabase/functions/_shared/analytics.ts:79` | The 'most requested pages' list counts 404s, redirects and bot scans because the query has no status filter | fixed | FN |
| S03.4 | low | docs | `supabase/functions/_shared/contact.ts:177` | Contact form never records or links the privacy policy, yet the privacy runbook says it does | owner | - |
| S04.5 | low | security | `supabase/functions/_shared/contact.ts:85` | The contact name accepts newlines, so a visitor can forge the notice's own الاسم / البريد / الوقت lines | fixed | FN |
| X6.11 | low | dead-code | `supabase/functions/_shared/email.ts:262` | email.ts has a second constant-time comparator beside env.ts `secretsMatch` | fixed | FN |
| S07.2 | low | security | `supabase/functions/_shared/http.ts:40` | Public functions read the whole body into memory before checking its size; boundedText() exists for this but nothing calls it | fixed | FN |
| S02.2 | low | correctness | `supabase/functions/_shared/media-rules.ts:28` | folderIsInvalid misses C1 control characters that the SQL [[:cntrl:]] check refuses, so an upload fails only after every part is sent | fixed | FN |
| X6.2 | low | dead-code | `supabase/functions/_shared/media.ts:116` | Unused function `declaredParts` in the media rules module | fixed | FN |
| S07.6 | low | correctness | `supabase/functions/_shared/staff.ts:37` | A failed staff-row lookup is reported as unauthenticated, so the owner is told the page is for owners only | fixed | FN |
| X1.5 | low | config | `supabase/functions/staff-admin/index.ts:10` | The staff-admin function, the most privileged one, imports an unpinned supabase-js major version | fixed | FN |
| S07.7 | low | correctness | `supabase/functions/staff-admin/index.ts:123` | When a restore's ban lift fails, the message says sign-in could not be stopped, and the member is left shown as active while still banned | fixed | FN |
| X6.16 | low | dead-code | `supabase/functions/staff-admin/index.ts:19` | staff-admin re-implements staff.ts identity, db.ts client and http.ts reply helpers | fixed | FN |
| S07.5 | low | correctness | `supabase/functions/staff-admin/index.ts:89` | The invite answers 'email already registered' for every createUser failure | fixed | FN |
| S07.4 | low | correctness | `supabase/functions/staff-admin/index.ts:97` | staff-admin ignores failed audit writes, so an invite, role change or revoke can succeed with no audit record | fixed | FN |
| S01.5 | low | security | `supabase/migrations/20260924130000_staff_and_app_server.sql:11` | The default-privilege revoke of EXECUTE from PUBLIC does nothing, so functions are not deny-by-default | fixed | DB |
| S02.4 | low | performance | `supabase/migrations/20260926090000_media_library.sql:94` | Anonymous media reads run media_is_published once per row, a full JSON-path scan of every published document each time (unthrottled amplification) | fixed | DB |
| S03.5 | low | privacy | `supabase/migrations/20260926120000_contacts_and_email.sql:283` | Contact notices queued for a revoked staff member are still sent, and can be replayed, after revocation | fixed | DB |
| S04.4 | low | correctness | `supabase/migrations/20260926120000_contacts_and_email.sql:332` | A delivery or bounce webhook that arrives before the row's provider_id is stored is never applied to that row | fixed | DB |
| X2.3 | low | concurrency | `supabase/migrations/20260927090000_static_site_and_functions.sql:61` | publish_version/schedule_version accept a stale seq, so an out-of-date admin tab silently reverts newer live content | fixed | DB |
| G1.2 | low | privacy | `supabase/migrations/20260927160000_catalog_and_checkout.sql:1082` | Expired and cancelled holds, and the customer row each hold creates, keep buyer name, email, phone, address and dedication forever | owner | - |
| S05.3 | low | correctness | `supabase/migrations/20260927160000_catalog_and_checkout.sql:1087` | Hold expiry releases stock and coupon uses without recording which orders in the audit trail | fixed | DB |
| X5.6 | low | correctness | `supabase/migrations/20260927160000_catalog_and_checkout.sql:139` | Preorder is in P07 scope and the data contract but has no field or logic, and is not recorded as open | owner | - |
| S05.4 | low | correctness | `supabase/migrations/20260927160000_catalog_and_checkout.sql:73` | A coupon's product scope change is audited only as 'changed', not with its old and new values | fixed | DB |
| S06.4 | low | security | `supabase/migrations/20260927160000_catalog_and_checkout.sql:881` | Store-wide 500/day checkout throttle is spent by refused requests, so it can be exhausted without creating any order | recorded | - |
| X2.4 | low | concurrency | `supabase/migrations/20260927170000_policy_approval.sql:42` | Policy approval approves whatever is published at click time, not what the owner reviewed | recorded | - |
| X2.6 | low | concurrency | `supabase/migrations/20260927180000_store_media.sql:66` | A product can be saved with a library cover that was deleted while its form was open | fixed | DB |
| S21.7 | low | tests | `tests/e2e/cart-checkout.spec.ts:166` | checkoutOn() publishes test policies into the local DB and never removes them | fixed | TESTS |
| S21.1 | low | tests | `tests/e2e/cart-checkout.spec.ts:22` | Routine e2e runs overwrite committed acceptance screenshots, which breaks the documented H2 guarantee | fixed | TESTS |
| S21.4 | low | tests | `tests/e2e/checkout-api.spec.ts:158` | checkout-api afterAll can throw before it restores commerce_settings, which leaves checkout enabled with test seller data | fixed | TESTS |
| S21.2 | low | tests | `tests/e2e/cms.spec.ts:335` | A failed CMS test leaves test content published and breaks every later run: the restore is not in finally | fixed | TESTS |
| S21.5 | low | tests | `tests/e2e/media.spec.ts:462` | Media step 7 clicks «نشر» before the restore has reloaded the form, so it can republish the test version | fixed | TESTS |
| S21.3 | low | tests | `tests/e2e/media.spec.ts:559` | The P05 overflow check is recorded but never asserted, so overflow cannot fail the test | fixed | TESTS |
| S21.6 | low | tests | `tests/e2e/owner-operations.spec.ts:686` | The stats screenshot waits on the nav link «المتجر», not on the data, so it can capture the loading state | fixed | TESTS |
| S19.3 | low | tests | `tests/integration/privacy-requests.test.ts:269` | The privacy_erase_contacts audit assertions count every erase_contacts row in the database | fixed | TESTS |
| S19.2 | low | tests | `tests/integration/staff-admin.test.ts:115` | The last-owner test deactivates every other active owner for good, including the bootstrapped local owner | fixed | TESTS |
| X5.15 | low | tests | `tests/integration/staff.test.ts:21` | P03 proof names the operations role and a revoked member, but the staff and audit Data API tests cover only anon, editor and owner | fixed | TESTS |
| S19.1 | low | tests | `tests/integration/static-site.test.ts:231` | The scheduled-publish test only checks the case where nothing is due; publish_due never has a due version to publish | fixed | TESTS |
| S20.4 | low | tests | `tests/unit/backup-format.test.ts:168` | The 'writer deletes the partial file' test fails before any partial file is created | fixed | TESTS |
| S20.7 | low | tests | `tests/unit/cart.test.ts:221` | The fingerprint 'never includes the Turnstile token' test passes no token, so it cannot fail | fixed | TESTS |
| S20.6 | low | tests | `tests/unit/checkout.test.ts:26` | No test checks the Turnstile action and hostname the checkout and contact handlers pass to siteverify | fixed | TESTS |
| X6.20 | low | tests | `tests/unit/email.test.ts:41` | Tests stub NODE_ENV, which no code reads since D32 | fixed | TESTS |
| S20.2 | low | tests | `tests/unit/media.test.ts:73` | Four media ticket rejection tests fail for another reason, so they pass even if the guard they name is removed | fixed | TESTS |
| S20.5 | low | tests | `tests/unit/reader-mapping.test.ts:171` | The real-PDF ligature check never looks for the reversed «الإ», and its length assertion is always true | fixed | TESTS |
| S20.3 | low | tests | `tests/unit/richtext.test.ts:40` | The 'non-https link' test puts the link where no link is allowed, so it never exercises the URL check | fixed | TESTS |
| G2.1 | low | config | `tsconfig.json:52` | tsconfig excludes .next, so Next's route validator (.next/types/validator.ts) is never type-checked by pnpm typecheck, CI or next build | fixed | SCRIPTS |
| S18.6 | info | config | `.claude/settings.json:3` | Sub-agent model force did not apply to this workflow-spawned auditor, which runs as Opus 5.5 (D41 says every sub-agent runs Sonnet 5.5) | recorded | - |
| G2.7 | info | config | `next-env.d.ts:3` | next-env.d.ts is dirty: next dev rewrote it to the .next/dev types, and the D41 working tree would commit that | fixed | ORCH |
| S15.8 | info | docs | `PLANS/WORK-PACKAGES.md:35` | PLANS still require `isEvalSupported:false` / a 'patched PDF.js', which the pinned pdf.js 6 no longer has | fixed | DOCS |
| G2.6 | info | docs | `scripts/backup.mjs:55` | backup and restore-check comments point to the deleted scripts/glm-worker.mjs | fixed | SCRIPTS |
| X6.22 | info | dead-code | `scripts/check-copy.mjs:25` | check-copy keeps an always-empty `GENERATED` skip list | fixed | SCRIPTS |
| G3.8 | info | docs | `src/admin/collections/site-settings.ts:11` | site-settings.ts header says the public pages read contact only from P10, but /contact already reads it | fixed | ADMIN_EDIT |
| X6.15 | info | dead-code | `src/admin/tables/variants.ts:37` | Table list `nullText` repeats the field's `nullHint` string | fixed | ORCH |
| X6.17 | info | dead-code | `src/components/admin/TeamView.tsx:24` | Staff role type and Arabic role labels declared in five places | fixed | ADMIN_OPS |
| X6.7 | info | dead-code | `src/components/store/quote.ts:203` | `quoteSchema` shim unused; the `{ parse }` wrappers only delegate | fixed | STORE |
| X6.23 | info | dead-code | `src/components/store/store.module.css:27` | Two unused CSS module classes ship in the public CSS | fixed | STORE |
| S16.10 | info | docs | `src/content/site.ts:7` | The ROOM_ORDER comment says it feeds the room doors, but it only feeds the 404 page | fixed | PUBLIC |
| X6.24 | info | dead-code | `src/lib/env.ts:10` | src/lib/env.ts duplicates the shared LOCAL_HOSTS set it could import | fixed | SCRIPTS |
| X6.13 | info | dead-code | `src/lib/journal.ts:43` | The build-time media lookup is written three times (content, journal, store) | fixed | PUBLIC |
| X6.10 | info | dead-code | `supabase/functions/_shared/checkout.ts:32` | contact.ts and checkout.ts redefine http.ts helpers (NO_STORE, fail) and duplicate siteOrigin | fixed | FN |
| X6.1 | info | dead-code | `supabase/functions/_shared/http.ts:37` | Dead export `boundedText` in http.ts while three handlers inline the same body-limit logic | fixed | FN |
| X6.19 | info | config | `supabase/functions/contact/deno.json:4` | Import maps list `image-size` for functions that never load media.ts | fixed | FN |
| S21.8 | info | tests | `tests/e2e/motion.spec.ts:108` | motion.spec skips a story page that returns 404 instead of failing | fixed | TESTS |
