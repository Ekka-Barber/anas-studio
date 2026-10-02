# Round 5: order mail

## Worker report 1

Round 5 is built. Every kind the outbox can hold is now rendered and sent, or closed with a stated code.

Migration 20261002120000_order_emails.sql: order_email_data (from the order's own snapshots, hasFile from the entitlement, refunds from the ledger, refund and shipment only when asked), notify_email_data, alert_email_data (all 8 alert names in the migrations plus refund_mismatch and refund_unverified; unknown or gone returns `{alert}` alone). outbox_claim has the sixth parameter p_low_reserve (default 30), three tiers (100, 100-20, 100-20-30), per-kind daily caps (contact_notice 40, order_link 20, notify_confirm 30) and the inactive-recipient rule for owner_alert; the old 5-argument claim is dropped and grants are restated (service_role only). outbox_replay has the same owner rule. outbox_attention hides rows closed because the state moved on.

email.ts: one pure plain-text renderer per kind (receipt, order_link, order_ready, order_shipped, order_refunded, notify_confirm, availability, owner_alert). Values are flattened to one line, stripped of bidi controls and isolated; money goes through one halalas formatter; links are built from the site origin. The receipt is never called a tax invoice and says nothing about tax; a not-plainly-paid order says only that the payment arrived and is under review; test orders are labelled.

outbox.ts: processRow calls the kind's data function, derives the token itself (orderAccessToken and notificationToken, pepper read as checkout.ts does), renders and sends. Closing codes: GONE, NOT_PENDING, NOT_CONFIRMED, NO_FILE, NO_SHIPMENT, NO_REFUND; an unknown kind stays RENDER_FAILED; missing config is a retry. LOW_RESERVE is exported and passed to the claim. The contact notice path is unchanged.

Proof: unit tests for every renderer (including a hostile-value fixture, which caught an unencoded order number in the link, now fixed) and for the dispatcher (data functions, closing codes, token never in an rpc argument or a log). The integration file runs real SQL: snapshots unchanged after price, title and seller edits, refund and shipment selection, receipts for paid and needs-resolution orders, every alert from its real producer, the tier boundaries (49/50, 79/80, 99/100), the per-kind caps, two owners each claimable, revoked or demoted owners closed and refused by replay, grants, the dispatcher over all eight kinds against the real data functions, and one receipt through the real outbox function into Mailpit.

Existing tests: no assertion changed. The outbox test's claim call now has 6 arguments and the static-site grants list has the new signature.

Result: every check passes except pnpm test:db, where one staff-admin test hits its 5 s timeout because the shared DB holds 135 active owners (environmental; it passes with a longer timeout, and my file leaves the count unchanged).

Files: supabase/migrations/20261002120000_order_emails.sql (new), supabase/functions/_shared/email.ts, supabase/functions/_shared/outbox.ts, tests/unit/email.test.ts, tests/unit/outbox.test.ts (new), tests/integration/order-emails.test.ts (new), tests/integration/outbox.test.ts (CLAIM_SQL arity only), tests/integration/static-site.test.ts (one signature string), tests/integration/support.ts (MAILPIT_URL in the Status type)

Checks:
- `pnpm exec supabase migration up --local` → 0 (First run applied 20261002120000_order_emails.sql (SQL first validated in a rolled-back transaction); the final re-run: 'Local database is up to date'. The migration was never edited after it was applied, so no rebuild was done.)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (After the last edit to supabase/functions/_shared.)
- `pnpm exec vitest run tests/unit/email.test.ts tests/unit/outbox.test.ts tests/unit/admin-function.test.ts` → 0 (3 files, 135 tests.)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/order-emails.test.ts tests/integration/outbox.test.ts tests/integration/email-delivery.test.ts tests/integration/forms.test.ts tests/integration/static-site.test.ts` → 0 (5 files, 123 tests (order-emails: 38, including the real outbox function into Mailpit).)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` → 1 (20 of 21 files, 434 of 435 tests. The one failure is tests/integration/staff-admin.test.ts 'refuses to remove the last active owner': 'Test timed out in 5000ms'. That test pauses every active owner one by one over HTTP, and the shared local DB holds 135 active owners (test pollution). It is not caused by this round: my order-emails file leaves the active-owner count unchanged (135 before and after, measured), and the same file passes 6/6 with --testTimeout=90000 (exit 0). An earlier full run of this round, before the last dispatcher test was added, passed 21/21 files and 434/434 tests. Not fixed: the only remedy is the orchestrator's reset + db:import + demo-catalog, which this round may not use to hide a failing test.)
- `pnpm exec vitest run --mode db tests/integration/staff-admin.test.ts --testTimeout=90000 (diagnostic, with the same TEST_ENV and DATABASE_URL)` → 0 (6/6 pass: the failure above is the 5 s timeout only.)
- `pnpm test` → 0 (55 files, 1489 tests.)
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0 (204 source files.)

Contract gaps:
- Per-kind caps: the brief says `contact_notice` 40 'as today' and lists 'the per-kind daily cap for contact notices' among the current claim's rules. The current claim (20260930120000_audit_fixes.sql) has no per-kind cap at all; the 40 lives in `contact_submit` (a cap on form messages a day, 20260930140000). I built the contract's section 8 caps in the claim as sends per UTC day: contact_notice 40, order_link 20, notify_confirm 30. Consequence: with two active recipients, 40 form messages a day are 80 notices, and the claim now sends 40 of them and holds the rest to the next UTC day (D31: the notice is the owner's inbox). If the contract meant messages, not mails, change the constant in the claim.
- The brief says the inactive-recipient rule closes an owner_alert row 'suppressed, like a contact notice today'. Today a contact notice to a removed member is closed `exhausted` with last_error `RECIPIENT_INACTIVE` (plus an `email.exhausted` audit row), not `suppressed`, and the contract only says the rule 'covers owner_alert'. I kept the existing behaviour for both kinds (an owner alert needs an active owner; a contact notice an active owner or operations member; a demoted-to-operations owner's alert is closed).
- The contract pins no payload for several kinds; the dispatcher assumes: order_ready `{orderId, itemIds:[order item ids]}` (round 7 must write it so), notify_confirm and availability `{notificationId}` (round 8), order_link `{orderId}` (extra keys ignored), refund_mismatch and refund_unverified alerts carry `refundId` (round 6). A payload missing its id closes the row `GONE`.
- Round 6 gives an owner alert to `PROVIDER_TOTAL_DECREASED` but no alert name; any name not in alert_email_data answers `{alert}` and sends the generic line with its code, so it works, but the contract should name it.
- The lock's allowedPaths do not list tests/integration/static-site.test.ts or tests/integration/forms.test.ts, which the task lists. I edited static-site.test.ts (one signature string, required by the new 6-argument claim) and left forms.test.ts untouched (its named-argument claim call still works through the defaults). Add both to the lock.
- Priorities written by earlier rounds all agree with section 8 (receipt 0, owner_alert 0, contact_notice 1): nothing to report there.
- Beyond the brief, deliberately: (1) `outbox_attention` is restated to leave out rows closed because the state moved on (NOT_PENDING, NOT_CONFIRMED, NO_FILE, like RECIPIENT_INACTIVE), otherwise every unsubscribe-at-send would sit in the owner's attention list; GONE, NO_SHIPMENT, NO_REFUND stay listed because they point at a producer bug. (2) Every buyer mail about a test order carries the test label, not only the receipt. (3) alert_email_data also returns a payment id, event type and provider status string where an owner needs them to find the payment (the renderer isolates and flattens them).

Open risks:
- `pnpm test:db` exits 1 on the shared DB's 135 active owners (see checks); every full run adds more, so it will keep failing until the orchestrator resets the local DB (reset + db:import + demo-catalog).
- The claim-level contact_notice cap (40 sends a day) is shared by the local e2e specs that send contact notices through the real function: the fifth full e2e run in one UTC day may find notices waiting.
- Rows closed for a stated reason count as `permanent` in the run summary, so a run that only closed rows is recorded as failed or partial in job_runs; the owner home keys on 'waiting', not on status, so it does not warn.
- A missing TOKEN_HASH_PEPPER or SITE_URL makes order, notify and alert rows `retry` with NOT_CONFIGURED (nothing wrong with the row): they burn attempts, back off, and show in the attention list once exhausted.
- The end-to-end Mailpit case calls the real outbox function and parks every other due outbox row 1 day ahead (committed), as owner-operations.spec.ts does; the message stays in Mailpit. It needs the edge runtime restarted after any `_shared` edit.
- `pgRpc` (support.ts) sends a JS array of strings as JSON, which fails for a uuid[] parameter; a future integration test that runs `order_shipped` through runOutbox(pgRpc(...)) needs the array-literal workaround used in order-emails.test.ts. PostgREST itself accepts a JSON array for p_item_ids (checked with the service key).
- docs/operations.md still describes the two-tier budget (outside the allowlist; round 12).
- Two untracked files appeared in artifacts/acceptance/P08 during the round and are not mine: moyasar-sandbox-2026-10-02.md and moyasar-sandbox-probe.mjs. The dirty .claude/* files predate the round.
- The tool layer rewrote the /uXXXX escapes I typed into raw characters; I replaced those spots with /p{Bidi_Control} and String.fromCharCode and scanned the files: the only raw bidi characters left are the pre-existing FSI/PDI constants, and email.ts holds the raw Arabic «ر.س» in money().
- No Moyasar call was made; no screenshot was written or rewritten (vitest only).

## Audit 1: audit_failed

### R5-01 [medium] supabase/migrations/20261002120000_order_emails.sql:321
- Problem: The claim's contact_notice cap counts mails sent, where the contract caps messages. Contract section 8 says `contact_notice` "at most 40 messages a day"; that cap already exists in `contact_submit` (`contact:all`, 40 a day). The new claim adds `v_contact_today < 40` on sent notice rows. One message queues one notice per active owner or operations member, so with two recipients the claim stops at 20 messages a day and holds the rest to the next UTC day, where they eat that day's 40. This changes the existing contact-notice behaviour the round was told to keep, and brings back the backlog that 20260930140000_audit2_fixes.sql removed.
- Evidence: Line 321: `and (o.kind <> 'contact_notice' or v_contact_today < 40)`, counted at line 303 from sent rows of the kind. PLANS/P08-CONTRACT.md line 434: "`contact_notice` (at most 40 messages a day)". 20260930140000_audit2_fixes.sql lines 414-422: "40 a day is at most 80 notices with two recipients", sized to the 80-send band. Probe in a rolled-back transaction on the local database (the day's sends moved out, other rows parked): 21 messages to two active recipients = 42 queued notices; a claim-one-and-mark-sent loop with (1, 120, 100, 20, 3000, 30) sent 40 and left 2 pending with only 40 of the 80-send band used. The previous claim would have sent all 42. The worker's own cap test (tests/integration/order-emails.test.ts:781-800) uses one recipient, so it does not show this. The worker reported the ambiguity under contractGaps. Side effect on the local stack: committed contact notices from test runs now count against the 40 (6 sent today), so specs that send a notice through the real function fail once a UTC day reaches 40.
- Correction: Orchestrator ruling, then a one-line change in the migration. Either drop the contact_notice term from the claim (the 40 messages a day are already enforced in `contact_submit`), or count messages rather than mails (`count(distinct o.payload ->> 'contactId')` over the day's sent contact notices). The order_link 20 and notify_confirm 30 caps are one mail per request and can stay. Add a two-recipient boundary case to tests/integration/order-emails.test.ts.

### R5-02 [low] supabase/functions/_shared/outbox.ts:184
- Problem: An `order_ready` row with no `itemIds` in its payload, or with ids that are not lines of the order, is closed `NO_FILE`, and the restated `outbox_attention` hides `NO_FILE`. That is a producer bug filed under "the state moved on": if round 7 writes another payload shape, every file-ready mail of a digital preorder is closed and no one sees it. The worker's own rule (GONE, NO_SHIPMENT and NO_REFUND stay listed because they point at a producer bug) is not applied here. The `outbox_attention` change itself is not in the contract's round 5 list.
- Evidence: outbox.ts:184-185: `data.lines.filter((line) => line.hasFile && payload.itemIds?.includes(line.itemId))`, empty result -> `closed('NO_FILE')`. Migration line 421: `coalesce(o.last_error, '') not in ('RECIPIENT_INACTIVE', 'NOT_PENDING', 'NOT_CONFIRMED', 'NO_FILE')`. tests/unit/outbox.test.ts:252-254 pins "No list at all" as NO_FILE. The contract (line 333) pins only the dedupe key `order_ready:<entitlementId>`, not the payload.
- Correction: In outbox.ts close an `order_ready` row whose payload has no `itemIds`, or whose ids match no line of the order, as `GONE` (listed in the attention view); keep `NO_FILE` for listed lines that exist and have no file. Change the unit case at tests/unit/outbox.test.ts:252-254 to match. The orchestrator records the `outbox_attention` change in the contract.

### R5-03 [low] PLANS/P08-CONTRACT.md:333
- Problem: The dispatcher now depends on payload shapes the contract does not pin, and later rounds write those rows. Unpinned: `order_ready` (the dispatcher needs `{orderId, itemIds:[order item ids]}`), `notify_confirm` and `availability` (`{notificationId}`), `order_link` (`{orderId}`), the `refund_mismatch` and `refund_unverified` alerts (`refundId`), and the alert name for `PROVIDER_TOTAL_DECREASED`. A round 6, 7 or 8 worker reading only the contract can write another shape; the row then closes `GONE` or `NO_FILE` and nothing is sent.
- Evidence: outbox.ts:157 reads `payload.notificationId`, :168 `payload.orderId`, :172 `payload.refundId`, :173 and :184 `payload.itemIds`. Migration lines 180 and 209-210 read `refundId` for the two refund alerts. Contract lines 324, 333, 355, 357 give only dedupe keys for order_link, order_ready, notify_confirm and availability; line 310 gives an owner alert for PROVIDER_TOTAL_DECREASED without a name. Only order_refunded (line 307) and order_shipped (line 344) have a pinned payload. The worker listed these assumptions under contractGaps.
- Correction: Before dispatching rounds 6 to 8, add the payloads to contract section 6: order_ready `{orderId, itemIds}`, notify_confirm and availability `{notificationId}`, order_link `{orderId}`, refund_mismatch and refund_unverified `{refundId, orderId}`, and name the PROVIDER_TOTAL_DECREASED alert (then add it to `alert_email_data` and `alertText` in that round).

### R5-04 [low] supabase/functions/_shared/email.ts:389
- Problem: A paid receipt can promise a file that will never come. `hasFile` is false in three cases: the entitlement has no file yet (a preorder), the entitlement was revoked (a refund), or the line has no entitlement at all (a refunded line that `order_resolve` skips). The renderer prints «سنضيفه إلى صفحة طلبك عند توفره» for all three.
- Evidence: Migration line 81: `'hasFile', e.asset_id is not null and e.revoked_at is null` over a left join. email.ts:388-390 prints the "will be added" note for every digital line with `hasFile` false. tests/integration/order-emails.test.ts:461-462 shows a revoked entitlement answers false. 20261002100000_payment_core.sql inserts entitlements only for lines `not coalesce(finance.item_fully_refunded(i.id), false)`, so the `receipt:<orderId>:resolved` mail of contract line 347 lists the refunded digital line with that note. A receipt held by the quota until after a refund does the same.
- Correction: Contract ruling on the line shape, then a small change in the migration and renderer: tell the three states apart (for instance `hasFile` null when there is no granted entitlement) and print the "will be added" note only for a granted entitlement without a file; print no file note for a revoked or missing one. Add the case to tests/unit/email.test.ts.

### R5-05 [low] supabase/functions/_shared/outbox.ts:210
- Problem: A retried send can be refused as an idempotency conflict. The new kinds are rendered from live state at each attempt, but the row keeps one Idempotency-Key. If the first attempt ended `uncertain` (the request may have left) and the text differs on the next attempt, Resend answers 409 `invalid_idempotent_request`, which is classified permanent, and the row ends exhausted `IDEMPOTENCY_CONFLICT` in the attention list. The contact notice never had this: its text comes from an immutable row.
- Evidence: outbox.ts:210-215 sends `idempotencyKey: row.idempotency_key` with text rendered in the same call. email.ts:69-73 maps a 409 that is not concurrent or locked to `{ outcome: 'permanent', error: 'IDEMPOTENCY_CONFLICT' }`. Text that changes between attempts: the live `stock` in a low_stock alert (migration line 190), `hasFile` notes and the order status in a receipt, `refundedHalalas` in order_refunded, `tokenVersion` in every order link. No test covers a re-claimed uncertain row of a new kind.
- Correction: Orchestrator ruling: accept it and record it in the runbook (the first attempt was most likely delivered; the row shows in the attention list), or make the text stable across attempts. The stable option belongs to the producers in other rounds' files (for instance the stock at alert time in the alert payload).

### R5-06 [low] supabase/functions/_shared/outbox.ts:149
- Problem: A missing `SITE_URL` or `TOKEN_HASH_PEPPER` burns the attempts of every order, notify and alert row. Each claimed row is given back as `retry` `NOT_CONFIGURED`, backs off and is exhausted after 8 attempts, although nothing is wrong with the row. Owner alerts wait on the pepper too, though they need no token. An unconfigured email provider, by contrast, skips the run and leaves the rows untouched.
- Evidence: outbox.ts:147-149: `if (!siteUrl || !pepper) return { outcome: 'retry', error: 'NOT_CONFIGURED' }`, placed before the `owner_alert` branch. `outbox_result` (20260930140000_audit2_fixes.sql:591-604) counts a plain retry as an attempt and exhausts at `max_attempts` (default 8). outbox.ts:221-234 shows the skip path for missing email configuration. Only the missing pepper is unit-tested (tests/unit/outbox.test.ts:273-279). The worker listed this under openRisks.
- Correction: Orchestrator ruling: accept and document, or check the two values once in `runOutbox` before the claim and record the run as skipped with a reason. The second choice also holds contact notices during the misconfiguration, which changes the contact path, so it needs the ruling.

### R5-07 [low] tests/integration/staff-admin.test.ts:104
- Problem: `pnpm test:db` exits 1, as the worker recorded: one test, "refuses to remove the last active owner", times out at 5000 ms. The cause is the shared local database, not this round: the test pauses every active owner one by one over HTTP.
- Evidence: My run: 20 of 21 files, 434 of 435 tests, exit 1, the same single failure at staff-admin.test.ts:104. The same file with `--testTimeout=90000`: 6 of 6, exit 0. The local database held 139 active owners and 759 staff rows before my runs and 131 and 960 after. This round's file creates 10 staff per run and deactivates them in afterAll. The round's diff does not touch the staff functions.
- Correction: Before acceptance the orchestrator resets the local database (reset, db:import, demo-catalog) and re-runs `pnpm test:db`. The staff count is 960, close to the 1000 that breaks auth.spec.

### R5-08 [low] .anasaq-execution.lock:79
- Problem: The lock's allowedPaths for this round do not list two files the round's brief allows: tests/integration/static-site.test.ts, which the worker edited, and tests/integration/forms.test.ts, which it left untouched.
- Evidence: Lock lines 79-86 list the migration, outbox.ts, email.ts, order-emails.test.ts, outbox.test.ts, email-delivery.test.ts, unit/email.test.ts and unit/outbox.test.ts only. `git diff` shows one changed line in tests/integration/static-site.test.ts: the claim's signature string in SERVER_ONLY, required by the six-argument claim.
- Correction: The orchestrator adds both paths to the lock before integrating the round.

Checks re-run:
- `pnpm exec supabase migration up --local` → 0
- `docker exec supabase_db_ANASAQ.ME psql (md5 of the seven installed function bodies against the bodies in 20261002120000_order_emails.sql, plus proacl, prosecdef, proconfig: all seven equal; claim and data functions service_role only; replay and attention authenticated only; uuid_or_null postgres only)` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/email.test.ts tests/unit/outbox.test.ts tests/unit/admin-function.test.ts (3 files, 135 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/order-emails.test.ts tests/integration/outbox.test.ts tests/integration/email-delivery.test.ts tests/integration/forms.test.ts tests/integration/static-site.test.ts (5 files, 123 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db (20 of 21 files, 434 of 435 tests; staff-admin 'refuses to remove the last active owner' timed out at 5000 ms)` → 1
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/staff-admin.test.ts --testTimeout=90000 (diagnostic: 6 of 6)` → 0
- `pnpm test (55 files, 1489 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy (204 source files)` → 0
- `POST /rest/v1/rpc/order_email_data with p_item_ids as a JSON array (service key: 200 null), alert_email_data (200), outbox_claim as anon with 4 and with 6 named arguments (401, 42501 both)` → 0
- `psql rolled-back probe: 42 contact notices for two active recipients, claim loop (1, 120, 100, 20, 3000, 30): 40 sent, 2 left pending` → 0

Uncovered:
- Two dispatcher runs at once at a tier or cap boundary (49, 79, 99 sends; 39, 19, 29 of a kind): each claim counts only rows already sent, so both can claim and the tier is passed by one per concurrent run. Every tier and cap test uses one connection.
- The contact_notice cap with two recipients (finding R5-01): the cap test queues notices for one recipient only.
- A re-claimed `uncertain` row of a new kind whose text changed between attempts (finding R5-05): same Idempotency-Key, different body, Resend 409, row exhausted.
- A revoke, a demotion or an unsubscribe that lands between the claim's sweep or the data read and the provider call: one mail still goes. Only the state before the claim is tested.
- `order_shipped`, `order_ready`, `order_refunded`, the notify kinds and `owner_alert` through the real outbox function over HTTP: only the receipt goes that way; the other kinds run through `runOutbox` with a direct pg session and an array-literal workaround for `p_item_ids`. My own PostgREST probe with a JSON array answered 200.
- A shipment whose asked items carry different carriers or tracking values: `order_email_data` shows the first line's values for all of them (migration lines 112-113).
- A receipt rendered after its entitlement was revoked, or the `receipt:<orderId>:resolved` receipt with a refunded digital line (finding R5-04).
- A missing `SITE_URL` (only a missing pepper is tested), and the attempts the `NOT_CONFIGURED` retry spends up to exhaustion (finding R5-06).
- A receipt or recovery link sent after `access_token_expires_at` has passed (mail held more than 7 days by the quota): the link is dead and nothing detects it.
- A claim with `p_limit` above 1 passing a per-kind cap or a tier in one batch: the migration comment admits it and the dispatcher claims one row at a time, but the tier tests themselves claim 10 at once and no test pins the overshoot.
- `outbox_replay` of a row the dispatcher closed with a state code (NOT_PENDING, NOT_CONFIRMED, NO_FILE, GONE): whether it is re-evaluated and closed again or sent once the state allows it.
- An `order_ready` payload with no `itemIds` is pinned as NO_FILE by the unit test and is then hidden from the attention list (finding R5-02); no test shows a producer-shaped payload from `paid_asset_set`, which does not exist yet.


## The orchestrator's rulings and own audit (2026-10-02)

The workflow ended `needs_orchestrator` after one build and one audit: one medium and seven low findings, each a ruling or a contract edit, so no fix pass ran. I read `20261002120000_order_emails.sql` whole, the new render functions in `email.ts` and the dispatcher's `renderMail` and `runOutbox` line by line (the token is derived at send and appears in the mail's text only; payloads hold ids only).

| Finding | Ruling |
|---|---|
| R5-01 (medium: the claim capped contact notices at 40 mails a day, where the contract caps 40 messages, already taken by `contact_submit`; with two recipients half the day's messages waited) | Fixed: the claim has no cap for contact notices. The `order_link` 20 and `notify_confirm` 30 caps stay (one mail per request). Test added: 45 notices sent today, the next one is still claimed. |
| R5-02 (an `order_ready` payload that names no line of the order was closed `NO_FILE` and hidden) | Fixed: it is `GONE`, which stays in the attention list; `NO_FILE` only for listed lines that exist and have no file. Test changed. |
| R5-03 (the dispatcher read payload shapes the contract did not pin) | The contract's section 6 now pins every outbox payload, and names the alert `refund_total_decreased`, which `alert_email_data` and the renderer now know. |
| R5-04 (a paid receipt promised a file for a revoked or never-granted line) | Fixed: `hasFile` has three values (true, false for an entitlement that waits, null when nothing will hand a file out) and the note is printed only for the first two. Tests added in SQL and in the renderer. |
| R5-05 (a retried row whose facts changed can be refused by the provider as an idempotency conflict) | Accepted and written into the contract: the first attempt was most likely delivered, and the row shows in the attention list. Round 7b puts the stock at alert time into the `low_stock` payload if that proves noisy. |
| R5-06 (a missing `SITE_URL` or pepper burned the attempts of every row) | Fixed: the run is skipped before any claim (`SITE_NOT_CONFIGURED`), like a missing email configuration; the rows wait and no attempt is spent. Two older test fixtures that model a configured deployment now set the pepper. |
| R5-07 (the last-owner test timed out on the polluted local database) | Not a code defect. The database was reset with the imports before my runs. |
| R5-08 (two test files of the brief were missing from the lock) | Added. |

The worker's stated choices are accepted and written into the contract: an owner alert to someone who is no longer an active owner is closed `exhausted` with `RECIPIENT_INACTIVE`, exactly like a contact notice; `outbox_attention` leaves out the rows closed because the state moved on; every buyer mail about a test order carries the test label.

Checks on the final tree, from a fresh `supabase db reset` with `db:import` and `db:demo-catalog`, the edge runtime restarted: `pnpm test:db` 0 (21 files, 435 tests, one of them a paid order's receipt through the real `outbox` function into Mailpit); `pnpm test` 0 (55 files, 1491 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; `playwright test cart-checkout checkout-api` 38 passed.

Left open, recorded for checkpoint (c) and round 12: two dispatcher runs at once can pass a tier or a cap by one; a revoke or an unsubscribe that lands between the claim and the provider call still sends one mail; only the receipt goes through the real function over HTTP, the other kinds through `runOutbox` with a direct session; a link mailed more than 7 days late is dead; `docs/operations.md` still describes two tiers (round 12).
