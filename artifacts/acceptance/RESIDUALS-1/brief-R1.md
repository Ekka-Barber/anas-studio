# RESIDUALS-1, round R1: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R1, base `2937c75`, branch
`agent/residuals-1`). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI
2.106.0, Docker Desktop with the development stack ANASAQ.ME running (9 containers). Git Bash and PowerShell exist; no
Deno on this machine (CI runs `deno check`). The round's scope and why it is a round: `SCOPE.md` beside this file.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"); `PLANS/ISSUES.md` I44, I45, I50, I51
and I55; `PLANS/DESIGN-AUDIT.md` (the items that apply to the admin, store and contact controls you change) and
`DESIGN.md`; each item's evidence named below. The digests are `artifacts/acceptance/FABLE-AUDIT/work/wave{A,B,C}/digest.md`
(search the id).

## Write only these paths

- `supabase/migrations/20261015120000_residuals_r1.sql` (new: every SQL change of this round, one file)
- `supabase/functions/_shared/admin.ts`, `_shared/checkout.ts`, `_shared/email.ts`, `_shared/refunds.ts`,
  `supabase/functions/staff-admin/index.ts`
- `supabase/config.toml` (comments only, item 7)
- `src/components/admin/CommerceSettingsForm.tsx`, `ReconciliationView.tsx`, `RefundView.tsx`, `MfaEnroll.tsx`,
  `StepUp.tsx`, `TeamView.tsx`, `CollectionForm.tsx`, `CollectionList.tsx`, `AdminShell.tsx`
- `src/lib/admin-commerce.ts`, `src/lib/admin-orders.ts`, `src/lib/admin-money.ts`, `src/lib/cart.ts`
- `src/app/(public)/contact/page.tsx`, `src/components/public/contact/contact.module.css`
- `src/components/store/CartView.tsx`, `src/components/store/quote.ts`, `src/components/store/CheckoutForm.tsx`
- `artifacts/soon/deploy.cjs`, `artifacts/soon/README.md` (item 8 only)
- tests: `tests/integration/support.ts`, `policy-approval.test.ts`, `commerce-settings.test.ts`, `checkout.test.ts`,
  `checkout-http.test.ts`, `order-operations.test.ts`, `staff-admin.test.ts`, `refunds-http.test.ts`;
  `tests/unit/admin-function.test.ts`, `admin-commerce.test.ts`, `admin-orders.test.ts`, `admin-money.test.ts`,
  `admin-refunds.test.ts`, `admin-ops.test.ts`, `admin-editor.test.ts`, `staff-admin-function.test.ts`,
  `email.test.ts`, `quote.test.ts`, `cart.test.ts`, `store-checkout.test.ts`, `checkout.test.ts`, `site-pages.test.ts`;
  `tests/e2e/cms.spec.ts`, `public.spec.ts`, `no-js.spec.ts`, `orders-admin.spec.ts`, `orders-money.spec.ts`,
  `cart-checkout.spec.ts`, `store-admin.spec.ts`, `owner-operations.spec.ts`
- `docs/operations.md`, `docs/development.md` (the paragraphs your items change)

Any other path: stop and report. Never stage, commit or format files outside this list.

## Never

Read or print `.env`, `supabase/functions/.env`, `.env.local`, `.claude/settings*.json` or `.mcp.json` (the tests and
scripts read what they need themselves). Touch `PLANS/`, `_archive/`, `deploy/design/`, or `artifacts/` beyond item 8.
Run `supabase db reset`, `supabase start/stop`, `pnpm db:*`, `pnpm backup`, `pnpm restore-check`, or any `docker`
command except `docker restart supabase_edge_runtime_ANASAQ.ME` and read-only `docker ps`/`docker inspect`. Run
`artifacts/soon/deploy.cjs` or anything that reaches Cloudflare or Moyasar. Install or upgrade a package. Commit, push,
stash, reset or switch branches. Spawn sub-agents. Poll (no sleep, until or tail loops): run each long command once,
with a timeout, or in the background with one completion notification.

## Rules that bind every item

- Arabic product copy exactly as given here (where the brief gives it); Latin digits; no em dash in product copy;
  `pnpm check:copy` must pass. Money pages (cart, checkout, return, orders, refunds, disputes) stay calm: no new
  motion or reveal.
- Smallest change that does the item; reuse the helpers named; no new dependency, no new abstraction for one use.
- SQL: one new migration, idempotent (`create or replace`; `drop function if exists` for a changed signature),
  grants restated for every function it creates or replaces, `set search_path = ''`, the existing lock order kept.
  Copy a function's latest definition (search every migration for it; the newest file wins) and change only what the
  item needs; say in a comment above it which item changed what. Apply it with `supabase migration up` (local); while
  iterating, keep the file idempotent so a second `migration up` after a repair is harmless.
- After any edit under `supabase/functions`, `docker restart supabase_edge_runtime_ANASAQ.ME` before a test that calls
  a function over HTTP (item 13 makes the tests refuse a stale runtime).
- The public JavaScript budget: `checkout.html` is at 149.7 of 150 KiB, `orders.html` 148.4, `cart.html` 147.0. If
  `pnpm check:budgets` fails, stop and report the numbers; do not move code to lazy loading (I50 (2) is the
  orchestrator's call).

## The items

### 1. I44 (1): «اعتماد السياسات» approves the revisions the owner reviewed

Evidence: ISSUES I44 (1); `commerce_policies_approve(uuid, integer)` (latest definition in
`supabase/migrations/20260930140000_audit2_fixes.sql:83`, its lock order from FABLE-AUDIT round M2 item 8, see the
comment at `20261007120000_fable_audit_second_pass.sql:1087`); `_shared/admin.ts:489`; `CommerceSettingsForm.tsx:251`.

Fix (decided):
- The function takes the revisions the screen showed: `commerce_policies_approve(p_actor uuid, p_expected_version
  integer, p_revisions jsonb)`, where `p_revisions` maps each policy the approval covers to the published revision the
  screen showed (use the identifier the database already has for a published revision; if `commerce_settings_get`
  does not return it, extend it to return, per policy the approval covers, its document id, title, published
  revision and publish time). After the existing locks, any policy missing from the map, any extra key, or any
  revision that is no longer the published one refuses the approval with a distinct error and changes nothing. The
  two-argument signature is dropped in the same migration.
- `_shared/admin.ts`: the `commerce-policies-approve` body requires `revisions` (a strict object, bounded size), passes
  it, and maps the new refusal to 409 `POLICIES_CHANGED`, «تغيّرت السياسات منذ فتحت الصفحة. راجعها ثم اعتمدها من
  جديد.»
- The screen lists, above «اعتماد السياسات», each policy the approval covers as «<title>: نُشرت <Riyadh date and time>»
  (the existing Riyadh formatter), sends exactly those revisions, and on `POLICIES_CHANGED` reloads the settings and
  shows the message.

Proof: `policy-approval.test.ts`: the current map approves; a revision published between the read and the approval
refuses and leaves the approval as it was; a missing or an extra key refuses; the M2 concurrency case still holds.
`admin-function.test.ts`: the body without `revisions` is 400, the refusal is 409. The e2e that approves
(`store-admin.spec.ts` or `owner-operations.spec.ts`, whichever has it) passes on the new flow.

### 2. I45 (3): /contact shows «بريد التواصل»

Evidence: ISSUES I45 (3); `site_settings.contact.email` (`src/admin/collections/site-settings.ts:74`, validated with
`CONTACT_EMAIL_ERROR`); `src/app/(public)/contact/page.tsx:27-60` shows WhatsApp and the social links only.

Fix (decided): when `contact.email` is set, the channels block shows a `mailto:` channel beside WhatsApp, in the
secondary channel style (WhatsApp keeps the main one), its visible text the address itself inside an LTR isolate,
and an accessible name «البريد: <address>». The block shows when any of WhatsApp, the email or a social link exists.
No new CSS unless the existing channel classes cannot hold it.

Proof: an e2e (`public.spec.ts` or `no-js.spec.ts`) with a published address asserts the link and its `href`; with
none, no mail channel. Set the address through the path the existing tests use to publish site settings; no
conditional assertion that the seeded data decides.

### 3. I50 (3): `create`'s own OUT_OF_STOCK says when other orders' holds are in the way

Evidence: ISSUES I50 (3); `checkout_price` adds `held: true` (`20261002110000_checkout_payment.sql:128-132`); find
the OUT_OF_STOCK refusal `checkout_create` makes after its own locks (latest definition in the same file; no later
migration replaces it) and how `_shared/checkout.ts` and the checkout page carry a create refusal.

Fix (decided): that refusal carries `held: true` under the same rule as `checkout_price`; the function passes it
through; the checkout page shows «الكمية محجوزة مؤقتًا لطلب آخر؛ حاول بعد قليل.» for it, through the existing
`quoteErrorMessage` (`src/components/store/quote.ts:364`).

Proof: `checkout.test.ts`: a create that loses the last unit to another order's unpaid hold answers OUT_OF_STOCK with
`held: true`; a create short of stock with no hold in the way answers without it. A unit test for the message on a
create refusal.

### 4. I50 (4): a no-order review payment closed by hand stays reachable

Evidence: ISSUES I50 (4); `artifacts/acceptance/P08/rounds/round-11b.md`, R11B-7 (option 1 is now decided);
`reconciliation_list` (latest definition `20261007100000_fable_audit_payments.sql:758`, open reviews at :804);
`ReconciliationView.tsx` (the review cards, «إغلاق المراجعة» and its no-order warning); `refund_request` refuses only
`closed_reason = 'refunded'`.

Fix (decided):
- `reconciliation_list` adds `closedReviews`: review payments with no order, closed by hand (`closed_at` set,
  `closed_reason` not `refunded`), not fully refunded, newest closed first, at most 50, in the same row shape as
  `reviews` (one parser, `reviewOf` in `src/lib/admin-orders.ts`). «تحتاج مطابقة» keeps counting open ones only.
- The screen shows them under the open reviews in a section «دفعات بلا طلب أُغلقت مراجعتها», each card with its
  `TestBadge`, «استرداد هذه الدفعة» and «تسجيل استرداد خارجي» as on an open review (both must work on a closed one:
  check `refund_request` and the external refund path, and say what you found).
- The warning beside «إغلاق المراجعة» on a no-order payment becomes «بعد الإغلاق تبقى هذه الدفعة في «دفعات بلا طلب
  أُغلقت مراجعتها» أدناه، ويمكن إعادتها من هناك.»
- `docs/operations.md`: the paragraph that says such a payment leaves the admin.

Proof: `order-operations.test.ts`: a no-order payment closed by hand is listed; one closed as refunded, one with an
order and an open one are not in `closedReviews`; a partly refunded one is listed, a fully refunded one is not.
`admin-orders.test.ts` for the parser. An e2e (`orders-money.spec.ts` or `orders-admin.spec.ts`) shows the section
and its refund control on such a payment.

### 5. I51 (2): the cart names a refused line

Evidence: ISSUES I51 (2); `artifacts/acceptance/P08/rounds/round-12a.md`, R12A-4; `CartView.tsx:232`; `checkout_price`
(latest definition `20261007120000_fable_audit_second_pass.sql`); `src/components/store/quote.ts` (the error type at
:94, its parser at :187).

Fix (decided): a line's refusal (OUT_OF_STOCK with or without `held`, short, UNAVAILABLE for a product that exists)
carries `productTitle` and `variantTitle` when the variant exists; a variant that no longer exists keeps the generic
name. Check how the quote hash is built and keep an unrefused cart's hash unchanged; say what you found. The function
and `quote.ts` carry the two optional strings (bounded); `CartView.tsx` names the line from them when there is no
quote line.

Proof: `checkout.test.ts` (titles on a refused line, none for a deleted variant, the hash of an unrefused cart
unchanged); `quote.test.ts`; `cart-checkout.spec.ts` asserts the product's name on a refused line.

### 6. I55 (3): the owner alert mail words `policies_reset` and `confirm_mail_braked`

Evidence: ISSUES I55 (3); `_shared/email.ts:558-640` (`alertText`, `renderOwnerAlert`, whose footer always links
`/admin/orders`); the payloads at `20261007120000_fable_audit_second_pass.sql:1536-1537` (`policy`, `seq`;
`bounced`); the brake at :940-972 (more than 3 bounced or complained confirmation mails in 7 days; the row stays and
the hourly backlog sends it later).

Fix (decided): `AlertEmailData` gains `bounced?: number | null` (and nothing for the policy, which the text does not
name). Each kind may name its own admin page in the footer; the other kinds keep «لوحة الطلبات».
- `policies_reset`: subject «تنبيه: أُلغي اعتماد السياسات»; text «تغيّرت سياسة كانت معتمدة، فأُلغي اعتماد السياسات.
  لن يُفتح الشراء حتى تراجعها وتعتمدها من جديد من صفحة «المتجر».»; footer «صفحة المتجر:» and the page where
  «اعتماد السياسات» lives (check it is `/admin/store`; if not, name that page instead in both places).
- `confirm_mail_braked`: subject «تنبيه: أوقفنا رسائل التأكيد مؤقتًا»; text «ارتدّت N من رسائل تأكيد «أخبرني عند
  توفره» أو عُلّمت كرسائل مزعجة خلال آخر 7 أيام، فأوقفنا إرسال رسائل التأكيد حمايةً لسمعة البريد. الطلبات محفوظة،
  ويعود الإرسال تلقائيًا حين يقل عددها عن 4 خلال 7 أيام.» (N is `bounced`); footer «صفحة البريد:» and
  `/admin/email`.

Check that the payload's `bounced` reaches `AlertEmailData` on the real path (the outbox job), and say how.

Proof: `email.test.ts` for both kinds and their footers; the generic text still for an unknown kind.

### 7. I55 (4): `supabase/config.toml`'s comments

Evidence: ISSUES I55 (4); VENDOR-PLAT-02 and VENDOR-PLAT-03 in the wave B digest. Fix: comments only. The comment
above `[functions.contact]` names every function with `verify_jwt = false` (read them all from the file); the
comments on `verify_jwt` and `secure_password_change` say what the settings do, per the digest's reading
(`secure_password_change` only asks a session older than 24 hours to reauthenticate; the access-token hook is the
control). No setting changes. (The two PLANS documents are the orchestrator's.)

### 8. I55 (5): `artifacts/soon/deploy.cjs` takes the Cloudflare variables from `.env` only

Evidence: ISSUES I55 (5), SOON-09. The script runs as `node --env-file=.env ...`, and Node's `--env-file` does not
override a variable the shell already has, so a shell set up for another account deploys there.

Fix (decided): the script takes `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the `.env` it already parses,
refuses when `.env` lacks either, and when the shell holds a different value for either prints one line naming the
variable (never a value) and uses `.env`'s. Wrangler still gets those two and nothing else from `.env`. Update the
header comment and the README's usage lines. Never run the script; never open `.env` yourself.

### 9. I55 (8): FD-A-01 and FD-A-02

Evidence: ISSUES I55 (8); `artifacts/acceptance/FABLE-AUDIT/cloud/DEEP-AUDIT.md`.
- **FD-A-01** (`supabase/functions/staff-admin/index.ts:140-185`): two owners revoking one member at once can leave
  the member banned in Auth but active for RLS. Fix (decided): when the ban call fails and this call flipped the
  row, read the account (`auth.admin.getUserById`) before rolling back; if it is banned (a `banned_until` in the
  future), keep the revoke: skip the rollback and go on as a ban that held (end the sessions, audit it, answer ok;
  the audit details say the ban was found applied). If the read fails or the account is not banned, roll back as
  today. Proof: `staff-admin-function.test.ts`, the three cases.
- **FD-A-02** (`_shared/refunds.ts:80`, `src/lib/admin-money.ts:218-299`, `RefundView.tsx:238-320`):
  `expectedRefunded` is optional, so a refund without it has no STALE check. Fix (decided): list every caller of
  `refund-create`; make each send the confirmed refunded total its form was built from in every path (the comment
  at `RefundView.tsx:238` names a path that sends none: close it); then make `expectedRefunded` required in the
  function's schema and in the client's type. If a screen cannot know the total, stop this item and report why.
  Proof: `admin-refunds.test.ts` (a body without it is 400), `admin-money.test.ts` updated.

### 10. I55 (9) and QUALITY-09: what the authenticator guards, and the team's factor lookup

Evidence: ISSUES I55 (9); `MfaEnroll.tsx:20` (comment) and `:107`; `StepUp.tsx:24` (the comment says the caller
retries a `staff-admin` call); the `STEP_UP_REQUIRED` cases in `_shared/admin.ts:236-272` and in
`staff-admin/index.ts`; QUALITY-09 in the wave C digest (`TeamView.tsx:137-143` reads a failed `listFactors` as no
authenticator and sends an enrolled owner to enrol).

Fix (decided):
- `MfaEnroll.tsx:107` becomes «مطلوب لكل إجراء يطلب رمزًا جديدًا: دعوة عضو وتغيير دوره وإيقافه، وإعادة مبلغ وتسجيل
  استرداد خارجي وتسجيل اعتراض، وحفظ إعدادات المتجر واعتماد السياسات وفتح الشراء وإغلاقه، وإرسال رابط طلب إلى بريد
  آخر.» Check the list against both functions' `STEP_UP_REQUIRED` cases and correct the sentence to the real list
  in the same style if it differs; say what you changed. The comments in `MfaEnroll.tsx` and `StepUp.tsx` say the same
  (the caller retries the original call of either function).
- `TeamView.tsx`: read the factors through `factorReading` (`src/lib/admin-commerce.ts:333`, as
  `CommerceSettingsForm.tsx:116` does); an unreadable list shows the same unreadable message the store settings show
  (`FACTORS_UNREADABLE`) and does not send the owner to enrol.

Proof: a unit test of the team's step-up decision if the logic can be reached without rendering; otherwise say so.

### 11. ADMIN-CMS-01: two tabs of one document no longer share one local copy

Evidence and fix: the wave C digest, ADMIN-CMS-01 (`CollectionForm.tsx:53-59, 205-221`; `AdminShell.tsx:89-104`).
Fix (decided, the digest's): key the copy per tab as well, `anasaq:draft:<collection>:<docId>:<tabId>`, with a random
tab id kept in `sessionStorage` (it survives that tab's reloads); the autosave writes and removes only its own tab's
key; `load()` offers this tab's copy, else the newest copy of another tab for the same document and the same user;
«تجاهل» removes the copy it was offered (whichever tab wrote it); an old key without a tab id is read as another
tab's copy. `hasDrafts()` and `clearDrafts()` keep working by prefix.

Proof: `cms.spec.ts`, the digest's recipe in one browser context with two pages: B's typed text survives A's save and
is offered after B's reload. A unit test for the key and the choice of copy if you extract a pure helper.

### 12. ADMIN-CMS-02: a never-saved document's local copy is listed

Evidence and fix: the wave C digest, ADMIN-CMS-02 (`CollectionList.tsx:64-95`). Fix (decided): in the collections
that offer «جديد», list this user's local copies of documents that have no database row at the top of the list, one
row per document (its newest copy), titled from the copy (or «بلا عنوان»), marked «مسودة غير محفوظة على هذا الجهاز»,
linking to its edit page, which then offers the copy as today. Works with item 11's keys.

Proof: `cms.spec.ts`: a «جديد» post typed and left without saving is listed so, and its link opens it with the text
offered.

### 13. TEST-DB-02: the HTTP tests refuse a stale edge runtime

Evidence and fix: the wave B digest, TEST-DB-02 (`tests/integration/support.ts:20-36`). Fix (decided): the first time
a test reads `status.FUNCTIONS_URL` (a getter, so the call sites do not change), compare the start time of the
container `supabase_edge_runtime_<project_id>` (`docker inspect -f '{{.State.StartedAt}}'`; `project_id` from
`supabase/config.toml`) with the newest modification time of any file under `supabase/functions` (times only; never
read a file's contents), with a few seconds' tolerance for the Docker VM's clock (a named constant, with its reason);
a newer file throws «the edge runtime is older than supabase/functions: run `docker restart
supabase_edge_runtime_<id>`», and an unreadable start time throws a clear error. `docs/development.md`: one line where
it tells the restart rule.

Proof: say how you showed it refuses (touch a file under `supabase/functions` after a restart, run one HTTP test file,
see the refusal; restart; it passes) and that the SQL-only files are unaffected.

### 14. STORE-UI-12 (= QUALITY-08): the cart no longer swallows a failed city list

Evidence: `CartView.tsx:116` (`.catch(() => setCities([]))`); the checkout's fix of the same line,
`CheckoutForm.tsx:199-208` (a `failed` state and «أعد المحاولة»). Fix (decided): the cart does what the checkout does,
with the checkout's own words.

Proof: an e2e in `cart-checkout.spec.ts` that fails the city request once (route interception), sees the note,
retries and gets the list; or a unit test if the state can be reached without rendering.

## Checks, then the report

Before any e2e run: free memory at least 10 GB, and fewer than 950 staff rows in the local database (count them
through the service client the tests use; if more, stop and report, do not reset). Run, and report each command, its
exit code and its counts:

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. `supabase migration up` (local), `docker restart supabase_edge_runtime_ANASAQ.ME`, then `pnpm test:db` (all files);
3. the e2e files you changed or whose screens you changed: `cms.spec.ts`, `store-admin.spec.ts`,
   `owner-operations.spec.ts`, `orders-admin.spec.ts`, `orders-money.spec.ts`, `cart-checkout.spec.ts`,
   `public.spec.ts`, `no-js.spec.ts` (Playwright on `http://localhost:3000`, never `127.0.0.1`; restore
   `next-env.d.ts` afterwards and remove `.next/e2e` if `pnpm typecheck` then fails with TS1128);
4. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the three largest pages and their sizes).

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof
that ran (a test that fails without the change: say which mutation you tried), anything not done and why, and the
risks left. Do not accept your own work; the orchestrator and an Opus auditor read the diff.
