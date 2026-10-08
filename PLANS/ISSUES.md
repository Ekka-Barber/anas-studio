# Issues

Open items only. Closed items are listed at the end in one line each; their full records are in Git history. Revised 2026-10-01 after FOUNDATION-1 (`artifacts/acceptance/FOUNDATION-1/REPORT.md`).

## I24 — token discipline

The P01 worker spent about 218M cached input tokens in 10.7 hours: one worker resumed across three audit rounds, 65 polling calls, visual runs hung by I23, 31 full container rebuilds for CSS fixes, and two usage-limit resumes. **Rules (CLAUDE.md, worker briefs):** a fresh bounded worker per round, never resumed; no polling; one screenshot pass at 360 and 1440 per round, the full suite only at acceptance; iterate CSS with `next dev`; end long sessions with a written state.

## I28 — hosted Supabase Auth settings must match the local ones

**Package:** P11 (hosted setup). In Supabase, the email section's "enable sign-up" switch (`[auth.email] enable_signup` locally) turns the whole email provider on or off, codes included; new sign-ups are blocked by the global switch (`[auth] enable_signup = false`). P03 lost sign-in to this once locally. On the hosted project: email provider ON, "Allow new users to sign up" OFF, email OTP length 6 and expiry 600 s, TOTP enroll/verify ON, the Arabic magic-link template, Resend as custom SMTP (the built-in sender allows 2 emails per hour), and `service_role` grants applied by the migrations. **Added by AUDIT-1 (S01.4):** "Secure password change" ON, and the Custom Access Token hook (Authentication, Hooks) set to `public.deny_password_tokens`, which `20260930120000_audit_fixes.sql` creates: it refuses every password sign-in (D08). Verify with the same three refusal checks recorded in `artifacts/acceptance/P03/commands.txt`, plus a password grant that must answer 403.

## I32 — hosted checks the local stack cannot make

**Package:** P11 (hosted setup), from D32. Three facts are only true or false on the hosted project: (1) which header carries the visitor's IP to the `contact` function. The rate-limit key takes `cf-connecting-ip` first (Cloudflare fronts hosted Supabase and replaces any client value), else the LAST `x-forwarded-for` hop, else `local` (`supabase/functions/_shared/rate-limit.ts`). Community reports on hosted Supabase ([supabase#34647](https://github.com/orgs/supabase/discussions/34647)) say `cf-connecting-ip` holds the real address and that a spoofed `x-forwarded-for` gets the real address appended after it; no official statement exists. Probe it at P11 with a throwaway function that echoes the three headers, called with forged `cf-connecting-ip` and `x-forwarded-for` values, then delete it; if Cloudflare's value does not arrive, the last hop must be confirmed as the visitor, not a proxy; (2) whether Storage's public responses carry `X-Content-Type-Options: nosniff` (only checked WebP ever reaches `media-public`, and the bucket accepts `image/webp` only, so a missing header is recorded, not a blocker); (3) the Pages build count per month against the plan's quota, with rebuilds coalesced to at most one per two minutes. AUDIT-1 adds: (4) the `public/_headers` rules (S12.2) are served by Pages.

## I33 — the room videos are not in the repository

**Package:** P11 (hosted setup), from D32. The transcoded room films (`public/media/*.mp4`, made by `scripts/prepare-media.mjs` from local sources) are git-ignored, so a Cloudflare Pages build from the repository has none and the reels would 404. Before launch, either commit the transcoded files (each is under Pages' 25 MiB file limit) or upload them to a public Storage bucket and point the manifest at it. Owner's choice; the photos and content are on his machine too (E05). **FOUNDATION-1 (D44):** all 18 films are in the manifest and the content again, the five that show children included (Anas's consent); their posters are committed with the other images.

## I34 — site rebuild delivery: the failed-build half

**Status (2026-09-27, P06 round 3):** the delivery half is done: `site_build_trigger` keeps the pg_net request id, reads `net._http_response` on the next run, records each answered call as a `site_build` job run, and re-arms a failed call up to five times in a row (then the owner home shows «فاشل» until the next publish). The media sweep (I29) exists, and the no-upsert refusals are proven in the media e2e.

**Still open for P11:** a Pages build that breaks after the hook answered is visible only in the Pages dashboard; the owner checks it after the first publishes. LOW residuals: the `contact:email` throttle key is an unsalted sha256 (a DB-read-only concern), and orphaned public derivatives from a failed Storage removal outlive their row (the sweep handles `quarantine/` only).

## I40: launch check, no demo rows and Anas's own policy text

**Status (2026-09-29, CLEANUP-1):** the build check exists. `pnpm check:export` (`scripts/lib/demo-guard.mjs`) finds the Supabase origin baked into the export and fails when any page's visible text shows «تجريبي» in a build against a non-loopback Supabase, naming the pages and never a key; a loopback build passes with a one-line note. Still open for P11: the Pages build command must be `pnpm build && pnpm check:export` (or the deploy must gate on it) for the check to block a real deploy; confirm the production database has no `demo` rows (a demo row edited until its text no longer says «تجريبي» is invisible to the check); every published policy is Anas's approved text. Known false positive: the check matches the plain word «تجريبي», so real content that shows it on a page (for example «مشروع تجريبي») fails a hosted build; narrowing it to the seed's exact markers is the owner's choice. Evidence: `artifacts/acceptance/CLEANUP-1/w1.md`, `audit-w1.json`.

## I41: the hosted content bootstrap must carry the social links, the scenes, the book page, the home doors and the contact page

**Package:** P11 (hosted setup), from CLEANUP-1 (2026-09-29). `pnpm db:import` runs only against a loopback database, and the hosted project has neither `site_settings.social` (C09) nor a published `scenes/gallery` (C05). The pages stay truthful without them: the footer shows no handle, /contact no social tiles, and /scenes says «لا توجد مَشاهد بعد.». Before the first hosted build, the hosted `site_settings/site` needs the four `social` entries and the hosted `scenes/gallery` the 19 photos from `content/initial-content.json`, through the P11 content bootstrap or the owner in the admin; the migrations through `20260930140000_audit2_fixes.sql` must be applied first. Check after the first hosted build that `/contact` shows the four tiles and `/scenes` its photos. **FOUNDATION-1 (D44)** adds three documents the build cannot do without: a published `rooms/book`, and `home.doors` and `contactPage` in `site_settings/site`. Without them the build stops on purpose (`getBookRoom`, `getHomeDoors` and `getContactPage` throw), so the bootstrap writes all three from `content/initial-content.json` before the first hosted build.

## I43: the contact form and the privacy policy (owner, E08)

**From AUDIT-1 (S03.4).** The contact form neither links nor records the privacy policy (`contacts.policy_revision` stays null). Decide with E08 whether the form links the policy and records its revision. (The buyer-retention half of this item is done: D42, 90 days, `20260930130000_buyer_retention.sql`.)

## I44: P07 residuals

**From AUDIT-1.** (1) Policy approval (X2.4): «اعتماد السياسات» approves whatever revision is published at the moment of the click, not the one the owner read; the fix passes the reviewed revisions and refuses a mismatch (`commerce_policies_approve` plus the `admin` function's schema). Since AUDIT-1 (X1.1), any change to an approved policy clears the approval, so the window is the minutes between reading and clicking. (2) The store-wide 500-per-day checkout throttle is spent by refused requests too (S06.4, a recorded residual in `docs/operations.md`), a P08 decision. Preorder moved to P08 (D42).

## I45: owner and Anas inputs the code waits for

**From AUDIT-1.** (1) X5.7, the home doors, the book page and the services as CMS fields: done in FOUNDATION-1 (D44). (2) The earlier open question from I25: Tabuk imagery (real reference photos and film frames are preferred to generated ones). The seeded social links stay as they are (D42); the owner edits them in «الإعدادات» → «روابط التواصل». (3) From AUDIT-2 (ADMIN-editor-8, PUBLIC-data-6): «بريد التواصل» in the site settings is validated and published, but no page shows it; whether the site shows a contact e-mail beside the form is Anas's choice.

## I46: security headers beyond the safe baseline (P10)

**From AUDIT-1 (S12.2).** `public/_headers` now sends the directives that cannot break a page (`frame-ancestors`, `object-src`, `base-uri`, `form-action`). A full Content-Security-Policy (script, style, connect and frame sources for Next's inline scripts, Turnstile, the pdf.js worker, the Supabase origin and the functions) belongs to P10, where it is tested on a Pages preview.

## I47: the /book visual baseline outside the reader (P10)

**From AUDIT-1 (X5.5).** P02's proof "outside the reader the book visual baseline remains unchanged" has no evidence: the visual suite captures and checks overflow but never compares, and the committed /book baselines predate the reader, which moves everything below it by 1,100 to 1,500 px. P10's visual regression makes a masked comparison of the regions above and below the reader stage at 360 and 1440.

## I48: checkout work P08 must finish before the switch opens

**From AUDIT-2** (section 5 of its report; checkout is off, so each is latent). (1) Policy consent (DB-commerce-set-1, X-CONTRACT-2, DB-auditfix-1, GAP-G5-3): approval records the database's published revisions, while the buyer reads the policy page of the last static build, so an approval made before the rebuild lands binds the order to a revision the buyer was not shown; the build should embed the revision it rendered and the checkout send that one. (2) The quote reports checkout open while `checkout_create` would refuse an unconfigured seller or unapproved policies (STORE-checkout-1, X-MONEY-1): fold that readiness into `checkoutEnabled`. (3) Holds: ACTIVE_HOLD asks the buyer to complete or cancel an order the page cannot reach (EF-money-2, FIX-public-4, STORE-checkout-10); anyone can hold a known address and the reply confirms a live order exists (X-SEC-4); the hold view still claims a live hold after it expired (X-MONEY-3); a stored pending order clears only on a successful cancel (STORE-checkout-9). (4) A coupon can bring the total to 0, creating an order nothing can pay (DB-catalog-2, split verdict). (5) The function does not refuse control characters in the buyer's name that `checkout_create` refuses, so the error names no field (GAP-G4-4).

## I50: P08 residuals for later packages

From the P08 round rulings (2026-10-03; the round files in `artifacts/acceptance/P08/rounds/`). (1) R11C-5, P10 security pass: the variant form reads `product_variants` with `select('*')`, so `digital_asset` (the paid file's storage key) reaches an admin browser, and any active staff member may select the column; the bucket is private with no policies, so the key alone grants nothing. The fix is explicit columns in the variant form and column grants that leave the key out, after checking every reader. (2) R10B-1: `checkout.html` is at 148.9 of the 150 KiB public budget; the next change to the checkout page, `quote.ts` or `cart.ts` that needs room loads the checkout form body on demand (about 5 KiB). (3) `create`'s own `OUT_OF_STOCK` refusal carries no `held` (only the quote does), so a buyer who loses a race at `create` reads «الكمية المطلوبة غير متوفرة الآن.» rather than the held sentence. (4) R11B-7: a review payment with no order leaves every admin screen once the owner closes it by hand (`reconciliation_list` lists open ones only); the screen warns before closing, and a later refund is made in Moyasar's dashboard.

## I51: P08 round 12 residuals

From the round 12a and 12b rulings (2026-10-03; `artifacts/acceptance/P08/rounds/round-12a.md` and `round-12b.md`). (1) R12B-12, the privacy pass with E08: `privacy_buyer_export` carries the buyer's customer row, orders, items, fulfilments, entitlements, refunds, returns, notifications and mail, but no payment attempts (amount, status, the card source's type and company, times), review payments or disputes for the person's orders. `docs/privacy-data-map.md` says so and gives three read-only queries for an access request; extending the export (contract section 6) is code. (2) R12A-4: a cart line the quote refused shows the generic «منتج في السلة», because the stored cart holds only ids and quantities (P07) and the quote does not name a refused line. The checkout link is now hidden while a line is refused; naming the line needs the quote to carry the titles of refused lines. (3) R12A-7: the journeys spec `tests/e2e/orders.spec.ts` takes 7 to 11 minutes for both widths; it runs in the background with `--global-timeout`, since a killed run skips its cleanup.

## I49: AUDIT-2 residuals

(1) X-SEC-6: `media-ticket` has no rate or byte cap, so a signed-in editor's token can fill Storage faster than the daily sweep (1,000 objects) empties it; a ticket-count cap would also block the owner's bulk uploads, so it needs a bytes-per-actor cap and a sweep that loops. (2) ADMIN-media-7: an AVIF, WebP or PNG whose rotation is stored in the file fails `DIMENSION_MISMATCH` (the server only reads JPEG orientation); the admin now explains it and asks for a re-export, and the server-side read is not built. (3) TOOLING-9: done in FOUNDATION-1; CI installs Deno 2.9.6 and runs `deno check` on every function. (4) Optional hardening: `check:export` could also look for a Postgres connection string, a Supabase access token and the Turnstile secret shape. (5) The largest page's initial JavaScript is 147.4 of its 150 KiB budget (P10). (6) From FOUNDATION-1: a full `scripts/prepare-media.mjs` run takes more than ten minutes, and because some local sources are now wider than when the committed derivatives were made, it would add about 40 new image sizes; FOUNDATION-1 made only the five restored films' posters. A full run, with the budgets re-checked, belongs to the P10 media pass.

## I52: «لوحة المشاريع» (P12): the owner's open questions

**Package:** P12, asked at its start. D22 keeps the board owner-only, and D50 keeps teams, assignees, notifications and automations out. The owner's "everything can make ANAS ultimate" (2026-10-08) leaves two questions open: (1) may staff (editors, operations) see a project, or be given a card, and if so with what rights; (2) does Anas want a reminder of due cards beyond the admin home's list (a daily mail would be an automation, which D22 excludes). Until the owner answers, P12 is built as D50 states it.

## Closed

- I42 — the WhatsApp export in Git history: removed from the repository and from all 116 commits of every branch, then force-pushed (D42, 2026-09-30); the files stay on the owner's machine, git-ignored, and a pre-rewrite bundle sits outside the repository until the owner deletes it. The Codex app's local `refs/codex/*` checkpoints still hold the old trees on this machine only (never pushed).
- I25 — public design direction: closed by D39 (2026-09-28); the port is DESIGN-B.
- I29 — media housekeeping in Storage: `20260927120000_rebuild_delivery_and_media_sweep.sql` and the daily `media_sweep` job (P06 round 3); the orphaned-derivative residual is under I34.
- I31 — append-only `audit_events` and deleting auth users: `privacy_erase_staff` erases instead of deleting (P06 round 3); runbook `docs/privacy-data-map.md`.
- I35 — the email job read as stale on an idle site: `finance.outbox_due_since()` (P06). Its P08 residual (quota-delayed mail had no signal) is handled by AUDIT-1's S04.2: a Resend daily or monthly quota answer no longer spends retries and waits for the next UTC day.
- I37 — a cold `next dev` after `pnpm build` 404ed an admin route: the e2e dev server builds into `.next/e2e` (P06).
- I38 — `next dev` 404s a `generateStaticParams` page created mid-run: cause found in Next's dev static-paths cache; `cart-checkout.spec.ts` waits for its fixture page; production (the export) is unaffected (P07).
- I39 — a build could reuse an earlier build's data: `pnpm build` removes `.next/cache/fetch-cache` first (P07, owner-approved).
- Small UI item: the inline-styled button in `src/app/(public)/error.tsx` no longer exists (checked in AUDIT-1).
- I04, I05, I08, I09, I21, I23, I30 — the Worker preview in CI, the Windows OpenNext symlink error, `wrangler secret put` creating a stub Worker, `.env` mirrored into `.open-next/`, Worker CPU on fresh isolates, OpenNext's segment-prefetch loop and the Worker cron's CPU: moot with D32 (no Worker; static files on Pages, server work in Supabase). The old Worker, Hyperdrive and R2/D1 resources are the owner's to delete once the Pages site works. `prefetch={false}` stays until a hosted check turns it back on.
- I01 — withdrawn: the Worker never exceeded the enforced size limit.
- I02 — P00 hosted half: the public route was proven; the admin half was withdrawn by D29.
- I06, I10, I16, I17, I18 — Payload job rows, `payload run`, PBKDF2 login CPU, seeded-owner login and cron bundling: gone with Payload (D29).
- I07 — the superseded 3 MiB limit was removed from code and docs (`2cfed29`, `9aa8b74`).
- I11, I12, I14, I15 — P00 pooler connection, CPU and budget findings: resolved or measured in P00 and committed.
- I13 — external audit of P00: fixes accepted; its two open items (Payload job-sweep role check, unenforced migration-connection helper) are superseded by D29's roles and `supabase/migrations/`.
- I19, I22 — the Oracle VM admin (proposed D27) and its impact analysis: withdrawn by D29; the VM files are removed in the P00 D29 swap.
- I20 — public route measured with real data and on-demand ISR; accepted and committed.
- I26 — owner questioned Payload: resolved by D29.
- I03 — unit tests for the environment and secret guards: `tests/unit/env.test.ts` (P00 D29 swap).
- I27 — unmatched URLs showed Next's English 404: `src/app/global-not-found.tsx` renders the Arabic page with status 404 (P00 D29 swap).
- R01 — the migration connection now uses the session endpoint on 5432.
- Favicon (small UI item from I27) — `src/app/icon.svg`, `src/app/apple-icon.png` and `public/favicon.ico` (CLEANUP-1, 2026-09-29); the pages no longer log a 404 for `/favicon.ico` (`artifacts/acceptance/CLEANUP-1/commands.txt`).
