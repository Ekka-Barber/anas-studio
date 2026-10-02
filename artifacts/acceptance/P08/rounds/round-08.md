# Round 8: notifications (the availability sign-up, its links, the sweep, the purges)

## Worker report 1

Round 8 built: migration 20261002150000_notifications.sql, the notify Edge Function (_shared/notify.ts, notify/index.ts) and three test files, plus a cleanup in tests/integration/support.ts.

SQL: finance.variant_public_state is the one public-state rule (null when off the shelf; ignores unpaid holds; uses finance.preorder_committed). catalog_availability, notify_subscribe and the sweep all read it. notify_subscribe, notify_token_info, notify_confirm, notify_unsubscribe and the extra notify_link_throttle are service_role only; the two finance jobs have no API grant. All are security definer with an empty search_path.

Sign-up: 54000 over 5 an hour per caller; otherwise always {ok: true}. Caps (one mail per address a day, 30 a day) are taken only when a mail is about to be queued. Two sign-ups at once give one row and one mail.

Sweep: runs every minute, locks the availability row before the notifications, touches only variants with a confirmed subscriber, and two runs at once queue each mail once. Purge: daily at 03:37, count-only audit row, orphan availability rows removed.

Function: Turnstile action notify, 200 {sent: true} for every sign-up outcome. confirm and unsubscribe recompute the mac, compare with secretsMatch, and give one 404 to every bad token (a mac is computed even for an unknown id). Confirm links last 7 days; unsubscribe links never expire. Needs no payment settings.

Tests: 105 unit, 53 SQL integration, 8 over HTTP. Mutations of both the handler and the SQL were caught by the tests.

Two existing tests outside my allowlist now fail by design and need a one-line change each: audit-fixes S01.5 (anon list) and unit cron-jobs (11 to 13 schedules). A third failure in the full db run, payment-http 'five different events', looks like a worker-retirement flake in the edge runtime; it passes alone. Details in checks and contractGaps.

Files: supabase/migrations/20261002150000_notifications.sql, supabase/functions/_shared/notify.ts, supabase/functions/notify/index.ts, tests/integration/notify.test.ts, tests/integration/notify-http.test.ts, tests/integration/support.ts, tests/unit/notify.test.ts

Checks:
- `pnpm exec supabase migration up --local` → 0 (20261002150000_notifications.sql applied on the first try; no db reset was needed)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (after the last edit under supabase/functions)
- `pnpm exec vitest run tests/unit/notify.test.ts tests/unit/tokens.test.ts tests/unit/outbox.test.ts tests/unit/email.test.ts` → 0 (227 passed; notify.test.ts has 105 and fails under four mutations of the handler (=== for secretsMatch, no mac on a miss, no 7-day limit, reply taken from the SQL))
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/notify.test.ts tests/integration/notify-http.test.ts tests/integration/order-emails.test.ts tests/integration/checkout.test.ts` → 0 (154 passed on the final files (notify 53, notify-http 8). Six SQL mutations each made notify.test.ts fail: no row lock in the sweep, no stale-true repair, no per-address cap, unsubscribe keeping its mail, pending subscribers swept, 7 days becoming 70)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` → 1 (731 passed, 2 failed. (1) audit-fixes.test.ts S01.5 'anon runs only the two public media reads': catalog_availability is granted to anon as the contract orders (contract gap 1). (2) payment-http.test.ts 'five different events for one payment at once': the callback answered 500 once in a burst of six; edge runtime log shows 'user worker failed to respond: request cannot be handled because the worker has already retired' twice; the file passes alone (41/41) and that test passed 3/3 again in isolation. I had restarted the edge runtime before the run, so cold workers are the likely cause. Full log: scratchpad test-db.log)
- `pnpm test` → 1 (1880 passed, 1 failed: tests/unit/cron-jobs.test.ts expects 11 real schedules and now finds 13 (contract gap 2))
- `pnpm lint` → 0 (re-run after the last test edit)
- `pnpm typecheck` → 0 (re-run after the last test edit)
- `pnpm check:copy` → 0 (209 source files)

Contract gaps:
- tests/integration/audit-fixes.test.ts S01.5 hard-codes anon's executable functions as public.media_is_published and public.media_published_ids. Section 6 grants public.catalog_availability() to anon, so the test now fails. One-line fix: add 'public.catalog_availability' first in the sorted expected list. The file is not on my allowlist, so I did not edit it.
- tests/unit/cron-jobs.test.ts hard-codes 11 real schedules. The two schedules this round adds (availability-sweep every minute, notifications-purge daily at 03:37) make 13, so that one assertion fails under pnpm test. Change 11 to 13. The file is not on my allowlist.
- The contract's three token functions carry no caller hash, so the per-IP throttle of confirm and unsubscribe (60 an hour) had no place to live. I added public.notify_link_throttle(p_ip_hash text) returns void, service_role only, raising 54000 when over; the function calls it first for both actions. The contract's function list should name it.
- 'The row starts false at the first subscription' does not hold when a stale sellable = true is left from an earlier cycle (the variant sold out again while no confirmed subscriber was there for the sweep to see). A subscriber who signs up and confirms after the next restock would then never be mailed. notify_subscribe therefore also sets an existing sellable = true row to false (the variant is out of stock at that moment, so false is true). This is an addition to the contract's wording.
- The contract does not say which timestamps the purge ages use. Chosen: unsubscribed rows by unsubscribed_at (30 days); pending rows by updated_at, the last sign-up request (7 days), so a row asked for again keeps its live link; confirmed rows are never purged. Unsent outbox rows (not sent, not sending) of a purged or unsubscribed row are deleted, not closed.
- Section 12 still lists src/admin/tables/notifications.ts under round 8; as the task says, it is not built here and moves to round 11.

Open risks:
- The confirm link's 7 days run from the moment the mail is queued (confirm_sent_at), not from when it is sent. Priority-2 mail stops at 50 sends a day and waits behind everything else, so a mail held back for days arrives with a short or dead link.
- Silent caps by contract: past the day's 30 mails, or for a second variant of an address the same day, the row is stored with no mail and confirm_sent_at null, and the visitor is still told sent: true. A spent address also spends nothing of the day total, but an address spent before a spent day stays spent until tomorrow.
- The minute sweep and the minute mail dispatcher also run on the local database during tests. Sweep tests assert effects, not which run queued them; fixture mail is parked a day ahead so the dispatcher cannot send it. The tests clear the global notify-confirm:all bucket before running.
- catalog_availability is callable by anon with no throttle and does one lookup per variant (the catalog is tens of variants). notify:ip counts per hour per caller hash, not per address.
- The sweep has no index on notifications.variant_id (the migration is functions and schedules only); fine at this size, an index is the upgrade if confirmed subscribers reach the tens of thousands.
- Two pending public.notifications rows left by tests/integration/payment.test.ts (not mine) remain in the local database; my tests remove their own rows, mail and availability rows on exit.
- No UI or page was built, so no screenshots were taken or rewritten.

## Audit 1: audit_failed

### R8-01 [medium] supabase/migrations/20261002150000_notifications.sql:285
- Problem: finance.availability_sweep mails only on a false -> true transition (lines 285-305). A subscriber who confirms while the variant's availability row is already sellable = true is never told about the current availability. That happens whenever another confirmed subscriber already made the sweep flip the row (the normal case for an item with two or more subscribers), or when a stale true is left from an earlier cycle and a pending subscriber confirms later. The contract and the brief promise without condition that a subscriber who confirms after the restock is notified by the next sweep; invariant 8 is not held for that subscriber. The only test for it (tests/integration/notify.test.ts:688) uses a lone subscriber, so it passes.
- Evidence: Rolled-back transaction on the local database (demo variant 6d5c70a7..., stock set to 0): A confirmed, B pending; restock; sweep 1 queued 1 and the row became sellable=true, revision=1; notify_confirm(B, 1) -> {ok:true,status:confirmed}; sweep 2 queued 0; sweep 3 queued 0; final rows: A notified_revision=1, B confirmed with notified_revision=0; the only availability mail is A's; row still true at revision 1. The code has no branch for v_sellable and r.sellable (if ... elsif at lines 285 and 303).
- Correction: In the sweep, whenever the variant is sellable now, queue for every confirmed subscriber whose notified_revision is below the row's revision: bump the revision only on false -> true, then run the same notify CTE in both the false -> true and the true -> true case with the row's current revision (dedupe key unchanged, so a second run still queues nothing). Add a test in tests/integration/notify.test.ts: two subscribers, one confirms before the restock and one after it, each ends with exactly one availability:<variant>:1:<id> mail; and one for a stale true with a pending subscriber who confirms while the variant is in stock. The orchestrator amends the sentence in PLANS/P08-CONTRACT.md section 6 (line 371) to match.

### R8-02 [medium] tests/unit/cron-jobs.test.ts:79
- Problem: pnpm test exits 1. The test hard-codes 11 cron schedules; this round's migration adds availability-sweep and notifications-purge, as the contract orders, so there are 13. A required check of the package is red until the file, which is outside the round's allowlist, is updated.
- Evidence: Re-run: pnpm test -> exit 1, 1880 passed, 1 failed: tests/unit/cron-jobs.test.ts > cronScheduleStatements: 'expected [ content-publish-due, ...(12) ] to have a length of 11 but got 13'. cron.job on the local database lists 13 jobs with unique names.
- Correction: Orchestrator: change toHaveLength(11) to 13 at tests/unit/cron-jobs.test.ts:79 and add 'availability-sweep' and 'notifications-purge' to the arrayContaining list at lines 29-40 (and the 'ten schedules' title), then re-run pnpm test.

### R8-03 [medium] tests/integration/audit-fixes.test.ts:123
- Problem: pnpm test:db exits 1. S01.5 hard-codes anon's executable functions as the two media reads; contract section 6 grants public.catalog_availability() to anon, so the guard test fails. The file is outside the round's allowlist.
- Evidence: Re-run alone against the stack: TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db -> exit 1, 29 files, 732 passed, 1 failed: tests/integration/audit-fixes.test.ts > S01.5 > 'no public or finance function is executable by PUBLIC, and anon runs only the two public media reads'. The payment-http 'five different events' failure the worker reported did not recur (it passed in this run).
- Correction: Orchestrator: add 'public.catalog_availability' as the first entry of the expected list at tests/integration/audit-fixes.test.ts:123-126 (and adjust the test title), then re-run pnpm test:db.

### R8-04 [low] supabase/migrations/20261002150000_notifications.sql:345
- Problem: finance.notifications_purge takes its locks in the opposite order to the one the file declares (lines 30-32: the availability row, then the notifications). It deletes notification rows first (lines 331-335) and only then locks the orphan availability rows (lines 345-347). notify_subscribe holds the availability row and then upserts the notification. A sign-up for the same address and variant as a row being purged, on a variant left with no other subscription, deadlocks with the purge: the visitor's request gets 40P01, which the handler answers as 500. The window is the instant of the daily purge, so it is rare, but it is a real lock-order inversion and no test runs the purge against a concurrent sign-up.
- Evidence: Reproduced on the local database with three sessions (fixtures removed afterwards, verified): a helper held another orphan availability row so the purge paused after its delete; notify_subscribe for the purged row's address and variant took the availability row and waited on the purge; on release the purge returned 1 and the sign-up failed with code 40P01 'deadlock detected'.
- Correction: Make the purge unable to wait behind a sign-up: lock the orphan availability rows with 'for update skip locked' and delete only the rows it locked (a row a sign-up holds is no longer an orphan), or lock the availability rows of the variants to be purged in ascending id before deleting their notifications. Add a concurrency test: a held sign-up and the purge at once, neither raises.

### R8-05 [low] PLANS/P08-CONTRACT.md:366
- Problem: The built SQL differs from the contract's text in four places that need a ruling and a contract edit: (1) public.notify_link_throttle(p_ip_hash text) returns void, service_role only, is not in section 6 (migration lines 178-192); the brief allowed a SQL throttle but the function list does not name it. (2) notify_subscribe also resets an existing sellable = true row to false (lines 123-124), an addition to 'creates the row when it has none'. (3) The purge's clocks are chosen by the worker: unsubscribed_at for 30 days, updated_at (the last request) for 7 days (lines 333-334), so a re-requested pending row is never purged. (4) Section 12 row 8 (contract line 531) still lists src/admin/tables/notifications.ts, which the brief moved to round 11. Also unresolved by a functions-only migration: there is no index on notifications(variant_id), so the every-minute sweep and each unsubscribe or purge scan the tables.
- Evidence: Migration lines 123-124, 178-192, 333-334; contract lines 366-372 and 531; pg_indexes on the local database shows only notifications_pkey and notifications_email_variant_id_key (email first).
- Correction: Orchestrator: name notify_link_throttle in section 6, record the stale-true reset and the purge clocks there, move the admin list to round 11 in section 12, and rule on whether a later migration adds an index on public.notifications (variant_id) where status = 'confirmed'.

### R8-06 [low] supabase/migrations/20261002150000_notifications.sql:143
- Problem: Flooding, as the contract's silent caps were built. A stranger cannot make the site mail one address more than once per UTC day (two mails minutes apart across UTC midnight are possible). What remains unbounded or open: (a) the day's 30 confirmations can be spent by anyone with 30 addresses, 30 Turnstile passes and six caller hashes (5 an hour each); every later sign-up that day is stored with confirm_sent_at null, told sent: true, and nothing ever queues its confirmation, so the row can never be confirmed and is purged after 7 days; (b) the same silent dead row for a real visitor's second variant on the same day; (c) a stranger can re-subscribe a victim every day for ever, also after the victim unsubscribed (the row is re-opened as pending and mailed again), and each request sets updated_at so the row is never purged; (d) the number of pending rows stored is bounded only by the per-caller throttle.
- Evidence: Lines 127-137 (re-open, updated_at = now()), 143-155 (address bucket, then the day bucket; no mail and no retry when either refuses), 334 (purge by updated_at). Tests assert the silence (notify.test.ts:295-311, 339-355) and no test covers a later re-queue because none exists.
- Correction: Orchestrator ruling on the contract: either accept and record the residual in docs/operations.md, or have a job queue the confirmation for pending rows whose confirm_sent_at is null once the day's budget allows, and alert the owner when the day's 30 are spent.

### R8-07 [low] supabase/migrations/20261002150000_notifications.sql:138
- Problem: Enumeration. The reply, the status and the stored rows of subscribe tell nothing. Two residual channels remain: (1) a sign-up for an address already confirmed for that variant returns at line 138-140, before the two rate-limit takes and the outbox insert, so it does less work than any other outcome (a timing difference of a few statements behind a Turnstile call and a 5-an-hour throttle: impractical, untested); (2) the shared 30-a-day counter is observable: an attacker who signs the victim up and then signs up 30 addresses of his own learns from whether his 30th confirmation arrives if the victim's sign-up consumed a slot, that is whether the victim was already confirmed for that variant. It needs a quiet day, 30 Turnstile passes and six caller hashes.
- Evidence: Lines 138-140 (early return for a confirmed row, no bucket taken; notify.test.ts:382 asserts the address bucket is not taken) against lines 143-155 (every other outcome takes the address bucket and, when it passes, the day bucket).
- Correction: Orchestrator ruling: accept and record as a residual, or take the address bucket for a confirmed row as well so that every well-formed sign-up to an out-of-stock variant spends the same buckets.

### R8-08 [low] PLANS/EXECUTION-STATUS.md:362
- Problem: Plan files and artifacts/soon/ changed in the working tree while round 8 was being written, outside the round's allowlist: PLANS/DECISIONS.md (D46, D47), PLANS/EXECUTION-STATUS.md (SOON-1), PLANS/WORK-PACKAGES.md, the new PLANS/SITE-STATE-CONTRACT.md and artifacts/soon/. Their content is the soon and maintenance pages, not round 8, so they are not the worker's; but their write times (22:17 to 22:54) overlap the worker's (22:33 to 22:55), against the single-writer rule.
- Evidence: git status --short; git diff of the three PLANS files; file modification times.
- Correction: Orchestrator: keep these paths out of the round 8 commit and record in the lock or the round note who wrote them.

Checks re-run:
- `pnpm exec supabase migration up --local` → 0
- `compare supabase_migrations.schema_migrations statements of 20261002150000 with the file on disk (identical after stripping comments and whitespace)` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/notify.test.ts tests/unit/tokens.test.ts tests/unit/outbox.test.ts tests/unit/email.test.ts (227 passed)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/notify.test.ts tests/integration/notify-http.test.ts tests/integration/order-emails.test.ts tests/integration/checkout.test.ts (154 passed)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db (run alone: 732 passed, 1 failed: audit-fixes S01.5; the payment-http flake did not recur)` → 1
- `pnpm test (1880 passed, 1 failed: tests/unit/cron-jobs.test.ts expects 11 schedules, finds 13)` → 1
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy (209 source files)` → 0
- `psql, one rolled-back transaction: second subscriber confirms after the restock, three sweeps (shows R8-01: notified_revision stays 0, no mail)` → 0
- `node -e with pg, three sessions: notifications_purge against notify_subscribe for the same address and variant (shows R8-04: 40P01 for the sign-up; fixtures removed and verified)` → 0

Paths outside the allowlist: PLANS/DECISIONS.md, PLANS/EXECUTION-STATUS.md, PLANS/WORK-PACKAGES.md, PLANS/SITE-STATE-CONTRACT.md, artifacts/soon/

Uncovered:
- Confirm after the restock when the availability row is already true (another confirmed subscriber, or a stale true): no test; the behaviour is broken (R8-01).
- The purge against a concurrent sign-up, confirm or unsubscribe: no concurrency test for finance.notifications_purge at all (R8-04 deadlock).
- The sweep racing notify_confirm, notify_unsubscribe or notify_subscribe on the same variant: only sweep against sweep and sign-up against sign-up are raced.
- The UTC-midnight boundary of the per-address and per-day buckets (two confirmations minutes apart for one address): no test.
- A sign-up left without mail by a cap: no test that it can ever be confirmed, because nothing re-queues it (R8-06).
- Timing and the shared day counter as side channels of subscribe (R8-07): no test.
- A sweep-queued availability row is never sent end to end: notify-http derives the link with the dispatcher's renderer but does not run the dispatcher; 'unsubscribe at send' is proven only in round 5's order-emails.test.ts with hand-inserted rows.
- The sweep while the checkout switch is off: it still mails 'available' although nothing can be bought; the contract has no rule and there is no test.
- A variant that is out of stock for under a minute between two sweeps plus a sign-up in that window gives confirmed subscribers a second notice at a new revision (by contract a new revision); no test names it.
- Worker mutation claims (four handler mutations, six SQL mutations) were not re-run: an auditor writes no product file.

## Worker report 2

Fixed R8-01 and R8-04 in the round-8 migration and added the four tests that would have caught them (the tests failed before the fix and pass after). The sweep now tells every confirmed subscriber who has not been told the row's current revision while the variant is sellable, bumping the revision only on false to true. The purge skips availability rows another writer holds instead of waiting for them, so it can no longer deadlock with a sign-up. The edited migration applies from scratch (one local rebuild with re-import). The focused unit and database runs, lint, typecheck and check:copy are green. `pnpm test` and `pnpm test:db` each have one red test in a file outside my allowlist, caused by round 8's own anon grant and two new schedules; each needs a one-line update by the orchestrator. I did not revert the PLANS/ and artifacts/soon/ paths named for restoration: they hold the orchestrator's own D46/D47 work and PLANS/ is forbidden to me.

Files: supabase/migrations/20261002150000_notifications.sql, tests/integration/notify.test.ts

Checks:
- `vitest run --mode db tests/integration/notify.test.ts -t <the 4 new tests>, BEFORE the migration edit` → 1 (4 failed as intended: R8-01 late subscriber got no mail (x2); old purge 'blocked' behind a held sign-up; old purge rejected (deadlock victim) in the three-session case)
- `hot patch of the two edited functions (create or replace, same text as the file), then the same 4 tests` → 0 (4 passed)
- `pnpm exec supabase db reset && pnpm db:import && pnpm db:demo-catalog (DATABASE_URL set)` → 0 (rebuild 1 of at most 2; the edited migration applied from scratch)
- `pnpm exec supabase migration up --local` → 0 (Local database is up to date)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/notify.test.ts tests/unit/tokens.test.ts tests/unit/outbox.test.ts tests/unit/email.test.ts` → 0 (4 files, 227 tests)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/notify.test.ts tests/integration/notify-http.test.ts tests/integration/order-emails.test.ts tests/integration/checkout.test.ts` → 0 (4 files, 158 tests)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db (alone)` → 1 (736 passed, 1 failed: tests/integration/audit-fixes.test.ts S01.5 (anon-executable list now holds public.catalog_availability). Not this fix; file outside my allowlist.)
- `pnpm test` → 1 (1880 passed, 1 failed: tests/unit/cron-jobs.test.ts:79 expects 11 cron.schedule statements, the round-8 migration makes 13. Not this fix; file outside my allowlist.)
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0 (209 source files)

Contract gaps:
- NOT DONE, on purpose: the order to put PLANS/DECISIONS.md, PLANS/EXECUTION-STATUS.md, PLANS/WORK-PACKAGES.md, PLANS/SITE-STATE-CONTRACT.md and artifacts/soon/ back 'exactly as they were'. PLANS/ is forbidden to me and none of them is on my allowlist. Their diffs are not round-8 work: they are the orchestrator's D46/D47 soon-page and maintenance-page side package (decisions D46 and D47, the SOON-1 row, the SITE-STATE-1 items in 'Next work', SITE-STATE-CONTRACT.md, artifacts/soon/), edited 22:12 to 22:54 local, and the lock's dirtyAtStart lists only the .claude files. git status is identical to the session-start snapshot. Reverting by hand would delete that work. If they must go, the orchestrator does it.
- PLANS/P08-CONTRACT.md section 6 line 371 (sweep) needs the orchestrator's amendment, as the finding says: the revision is bumped only on false to true, but while the variant is sellable every run queues one availability mail per confirmed subscriber whose notified_revision is below the row's revision (dedupe key unchanged), so a subscriber who confirms after a restock is told whether or not another subscriber's notice already turned the row true.
- Two earlier tests outside my allowlist go red because of round 8's own contract (a grant and two schedules), each a one-line change for the orchestrator: tests/integration/audit-fixes.test.ts:123-126 must also expect 'public.catalog_availability' (sorted first) for anon, and its title says 'the two public media reads'; tests/unit/cron-jobs.test.ts:79 toHaveLength(11) becomes 13 (availability-sweep, notifications-purge).

Open risks:
- pnpm test and pnpm test:db stay red (one failure each, listed above) until those two test lines are updated; everything else is green.
- I rebuilt the local database once (db reset + import + demo catalog), as the brief allows for an edited applied migration; the stack was not stopped. Staff users and fixtures made by earlier test runs are gone, the content and demo catalog are back. Before the reset I hot-patched the two functions with create or replace, to iterate; the reset then proved the edited file applies from scratch.
- The deadlock test pins the planner (set enable_seqscan = off on its own session) so the OLD purge reads its rows by id and the reproduction is deterministic; the new purge does not depend on scan order. In the old-code run the failing assertion printed only status 'rejected' for the purge, not its SQLSTATE; the assertion now prints the code (40P01 expected). I did not re-run it against the old bodies.
- The purge tests use the file's usual 1500 ms settledWithin window to tell 'blocked' from 'answered'; a very slow machine could false-fail them.
- A true to true sweep run now executes one update that matches nothing for each variant that has a confirmed subscriber, every minute: fine for a catalog of tens of variants.
- A held orphan availability row is passed by and removed by the next daily purge (by design); the first run leaves it for a day.

## Audit 2: audit_failed

### R8-02 [medium] tests/unit/cron-jobs.test.ts:79
- Problem: Not fixed: pnpm test still exits 1. The file is unchanged (last written 2026-10-02 10:44, not in git status). It hard-codes 11 cron schedules; the round's migration adds availability-sweep and notifications-purge as the contract orders, so there are 13. A required check of the package is red.
- Evidence: Re-run now: pnpm test -> exit 1, 60 files, 1880 passed, 1 failed: tests/unit/cron-jobs.test.ts > cronScheduleStatements > 'keeps a real migration statement whole': 'expected [ content-publish-due, ...(12) ] to have a length of 11 but got 13'. cron.job on the local database lists 13 jobs, no duplicate name.
- Correction: Orchestrator: change toHaveLength(11) to 13 at tests/unit/cron-jobs.test.ts:79, add 'availability-sweep' and 'notifications-purge' to the arrayContaining list at lines 29-40 and fix the 'ten schedules' title at line 27, then re-run pnpm test.

### R8-03 [medium] tests/integration/audit-fixes.test.ts:123
- Problem: Not fixed: pnpm test:db still exits 1. The file is unchanged (last written 2026-10-01, not in git status). S01.5 expects anon to run only the two media reads; contract section 6 grants public.catalog_availability() to anon, so the guard fails. A required check of the package is red.
- Evidence: Re-run now, alone against the stack: TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db -> exit 1, 29 files, 736 passed, 1 failed: tests/integration/audit-fixes.test.ts > S01.5 > 'no public or finance function is executable by PUBLIC, and anon runs only the two public media reads'. Nothing else failed (the payment-http flake of the first worker report did not appear).
- Correction: Orchestrator: add 'public.catalog_availability' as the first entry of the expected list at tests/integration/audit-fixes.test.ts:123-126 and adjust the title at line 108, then re-run pnpm test:db.

### R8-09 [low] supabase/migrations/20261002150000_notifications.sql:121
- Problem: New finding (the code is the first pass's, not the fix's): a check outside the lock. notify_subscribe reads the variant's public state at line 121, before it takes the availability row at lines 125-126, and then resets sellable to false on what it read. When a sweep holds the row, the sign-up waits; if the owner's restock commits and that sweep flips the row to true meanwhile, the sign-up then sets it back to false although the variant is in stock. The next sweep sees false -> true again, adds a revision, and mails every confirmed subscriber a second notice for one restock. The sign-up also stores a pending row and queues a confirmation for a variant that is on sale. The window is one sweep run (milliseconds, once a minute) that must contain both the sign-up and the restock, so it is rare; the cost is one extra priority-2 mail per confirmed subscriber.
- Evidence: Reproduced on the local database with three sessions (scratchpad audit2-race.cjs, own product and variant, every fixture removed and verified: products 0, notifications 0, outbox 0). Subscriber A confirmed, variant at stock 0. Holder: begin, select the availability row for update. Sign-up for address B: blocked. Holder: stock = 5, finance.availability_sweep(), commit (row true, revision 1, A mailed). Sign-up returns {ok:true}; row is now {sellable:false, revision:1} while the variant reads stock 5, state 'available'. Next sweep: {sellable:true, revision:2}; A's availability mails: availability:V:1:A and availability:V:2:A. No test races a sign-up against the sweep.
- Correction: Decide under the lock: keep the first read (an unknown or sellable variant returns before anything is written), take the availability row (insert ... on conflict do nothing, then select ... for update), and in a new statement read finance.variant_public_state again; return {ok:true} when it is no longer 'out_of_stock', and only then set a stale sellable = true to false. Add the three-session test to tests/integration/notify.test.ts: a held availability row, a sign-up waiting, a restock and a sweep in the holder, commit; the row stays true at its revision and a second sweep queues no second notice for the confirmed subscriber.

### R8-05 [low] PLANS/P08-CONTRACT.md:371
- Problem: Not done: the contract still differs from the built SQL, and the R8-01 fix adds one more difference. (1) Line 371 says the sweep queues only on false -> true; the code now also queues, while the variant is sellable, for every confirmed subscriber whose notified_revision is below the row's revision (migration lines 289-309), which is the correction asked for. (2) public.notify_link_throttle(p_ip_hash text) returns void, service_role only (migration lines 180-194), is not named in section 6. (3) notify_subscribe resets a stale sellable = true to false (lines 125-126). (4) The purge's clocks (unsubscribed_at for 30 days, updated_at for 7 days, lines 345-346), the deletion (not closing) of unsent mail, and the skip-locked removal of orphan availability rows (lines 357-364) are the worker's choices. (5) Section 12 row 8 (line 531) still lists src/admin/tables/notifications.ts. Still no index on notifications(variant_id): the sweep now runs one more scan of public.notifications per sellable variant with a confirmed subscriber every minute.
- Evidence: PLANS/P08-CONTRACT.md was last written at 22:14, before the round; lines 366-372 and 531 read as before. pg_indexes on the local database: only notifications_pkey and notifications_email_variant_id_key (email first).
- Correction: Orchestrator: amend line 371 to the built rule (revision bumped only on false -> true; while sellable, one notice per confirmed subscriber below the row's revision, same dedupe key), name notify_link_throttle, record the stale-true reset, the purge clocks and the orphan rule in section 6, move the admin list to round 11 in section 12, and rule on an index on public.notifications (variant_id) where status = 'confirmed' in a later migration.

### R8-06 [low] supabase/migrations/20261002150000_notifications.sql:145
- Problem: No ruling recorded yet; the code is unchanged. Flooding as the contract's silent caps were built: a stranger cannot make the site mail one address more than once per UTC day (two mails minutes apart across UTC midnight are possible). What remains open: (a) the day's 30 confirmations can be spent by anyone with 30 addresses, 30 Turnstile passes and six caller hashes; every later sign-up that day is stored with confirm_sent_at null, told sent: true, and nothing ever queues its confirmation; (b) the same dead row for a real visitor's second variant on the same day; (c) a stranger can re-subscribe a victim every day for ever, also after the victim unsubscribed, and each request sets updated_at so the row is never purged; (d) the number of pending rows stored is bounded only by the per-caller throttle.
- Evidence: Lines 129-139 (re-open, updated_at = now()), 144-157 (address bucket, then the day bucket; no mail and no retry when either refuses), 346 (purge by updated_at). Tests assert the silence (tests/integration/notify.test.ts:295-311, 339-355); none covers a later re-queue because none exists.
- Correction: Orchestrator ruling on the contract: accept and record the residual in docs/operations.md, or have a job queue the confirmation for pending rows whose confirm_sent_at is null once the day's budget allows, and alert the owner when the day's 30 are spent.

### R8-07 [low] supabase/migrations/20261002150000_notifications.sql:140
- Problem: No ruling recorded yet; the code is unchanged. Enumeration: the reply, the status and the stored rows of subscribe tell nothing, but two residual channels remain. (1) A sign-up for an address already confirmed for that variant returns at lines 140-142, before the two rate-limit takes and the outbox insert, so it does less work than any other outcome (a few statements behind a Turnstile call and a 5-an-hour throttle: impractical). (2) The shared 30-a-day counter is observable: whether the victim's sign-up consumed a slot shows in whether the attacker's own 30th confirmation arrives.
- Evidence: Lines 138-142 (a confirmed row fails the update's condition, nothing is taken; tests/integration/notify.test.ts:382 asserts the address bucket is not taken) against lines 145-148 (every other outcome takes the address bucket and, when it passes, the day bucket).
- Correction: Orchestrator ruling: accept and record as a residual, or take the address bucket for a confirmed row as well so that every well-formed sign-up to an out-of-stock variant spends the same buckets.

### R8-08 [low] PLANS/EXECUTION-STATUS.md
- Problem: Still in the working tree, outside the round's allowlist: PLANS/DECISIONS.md, PLANS/EXECUTION-STATUS.md, PLANS/WORK-PACKAGES.md, the new PLANS/SITE-STATE-CONTRACT.md and artifacts/soon/. Their content is the soon and maintenance pages (D46, D47), not round 8, and the fix worker rightly left them alone; they were written while the lock was held for round 8.
- Evidence: git status --short now: the same five paths as at the first audit; file times 22:17 to 22:54 against the lock's 22:19 and the worker's 22:33 to 23:40.
- Correction: Orchestrator: keep these paths out of the round 8 commit and record in the lock or the round note who wrote them.

Checks re-run:
- `pnpm exec supabase migration up --local (Local database is up to date)` → 0
- `node scratchpad/audit2-compare.cjs: pg_proc.prosrc of the 9 functions of 20261002150000 against the file on disk (9 SAME, 0 different; security definer, search_path "", owner postgres, ACLs as the contract: catalog_availability anon+authenticated, five notify_* service_role only, three finance functions postgres only); cron.job 13 names, no duplicate; RLS on public.notifications with one staff select policy` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/notify.test.ts tests/unit/tokens.test.ts tests/unit/outbox.test.ts tests/unit/email.test.ts (4 files, 227 passed)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/notify.test.ts tests/integration/notify-http.test.ts tests/integration/order-emails.test.ts tests/integration/checkout.test.ts (4 files, 158 passed; notify.test.ts holds 57 tests, not the 61 the worker wrote)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db (run alone: 29 files, 736 passed, 1 failed: audit-fixes S01.5)` → 1
- `pnpm test (60 files, 1880 passed, 1 failed: tests/unit/cron-jobs.test.ts expects 11 schedules, finds 13)` → 1
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy (209 source files)` → 0
- `R8-01 recheck by reading and by the two new tests (notify.test.ts:709 and :732, both in the passing run): migration lines 289-309 queue for every confirmed subscriber below the row's revision whenever the variant is sellable, revision bumped only on false -> true; fixed at the cause, no assertion loosened` → 0
- `R8-04 recheck: node scratchpad/audit2-race.cjs part (a), three sessions: the purge holds and deletes an orphan availability row, a sign-up for that variant waits ('blocked'), the purge commits, the sign-up answers {ok:true} with a new availability row (false, 0), one pending row and one mail; no 40P01. Purge lines 357-364 lock orphans with skip locked and re-check in a new statement; fixed at the cause. Side effect on the local database: one run of finance.notifications_purge with its count-only audit row` → 0
- `node scratchpad/audit2-race.cjs part (b), three sessions: notify_subscribe against a sweep holding the availability row during a restock (shows R8-09: row set false with stock 5, then revision 2 and a second notice to the confirmed subscriber); fixtures removed and verified` → 0

Paths outside the allowlist: PLANS/DECISIONS.md, PLANS/EXECUTION-STATUS.md, PLANS/WORK-PACKAGES.md, PLANS/SITE-STATE-CONTRACT.md, artifacts/soon/

Uncovered:
- A sign-up racing the sweep on one variant during a restock: no test; the behaviour is broken in a narrow window (R8-09).
- The sweep racing notify_confirm or notify_unsubscribe on the same row: no test. By reading, the lock order (availability row, notification, then outbox) is the same in all three and the guarded updates re-check after the wait.
- The purge racing notify_confirm or notify_unsubscribe on a pending row it is about to delete: no test.
- A sign-up that waits for an orphan availability row the purge is deleting: not in the suite (the new deadlock test's sign-up starts after the purge has already answered); run by hand in this audit and correct.
- The UTC-midnight boundary of the per-address and per-day buckets (two confirmations minutes apart for one address): no test.
- A sign-up left without mail by a cap: no test that it can ever be confirmed, because nothing re-queues it (R8-06).
- Timing and the shared day counter as side channels of subscribe (R8-07): no test.
- A sweep-queued availability row is never sent end to end: notify-http derives the link with the dispatcher's renderer but does not run the dispatcher; 'unsubscribe at send' is proven only in round 5's order-emails.test.ts with hand-inserted rows.
- An availability notice that waits in the outbox (priority 2 stops at 50 sends a day) while the variant sells out again is still sent: the dispatcher rechecks only that the row is confirmed. The contract has no rule and there is no test.
- The sweep while the checkout switch is off: it still mails 'available' although nothing can be bought; the contract has no rule and there is no test.
- A variant out of stock for under a minute between two sweeps, plus a sign-up in that window, gives confirmed subscribers a second notice at a new revision (by contract a new revision); no test names it.
- The worker's mutation claims (four handler mutations, six SQL mutations) and the old-code run of the deadlock test were not re-run: an auditor writes no product file.


## The orchestrator's rulings and own audit (2026-10-03)

The workflow ended `needs_orchestrator` after one build, one audit (three medium, five low), one fix pass and a second audit: what remained was mine to do (two guard tests outside the round's files, rulings on the contract) plus one new low finding. I read `20261002150000_notifications.sql` whole and `notify.ts` line by line: the token is never stored, the mac is recomputed for the row's current version and compared in constant time, a miss computes a mac like a hit, one 404 answers every bad link, and nothing is logged.

| Finding | Ruling |
|---|---|
| R8-01 (medium: a subscriber who confirmed while the variant's row was already true was never told) | Fixed by the second worker: while the variant is sellable, every run tells each confirmed subscriber who has not been told the row's revision; the revision moves only on false to true. Two tests added. |
| R8-02, R8-03 (medium: two guard tests of earlier packages went red, as the contract's own grant and schedules require) | Fixed by me: `cron-jobs.test.ts` expects the schedules that now exist (14) and names the P08 ones; `audit-fixes.test.ts` S01.5 names `catalog_availability` as the third function anon may run. |
| R8-04 (the purge took its locks in the opposite order to a sign-up: a deadlock) | Fixed by the worker: the purge passes by an availability row another writer holds. Two concurrency tests. |
| R8-09 (new: a sign-up decided on a state it read before it took the availability row, so one that waited behind a sweep which saw a restock set the row back to false: a second notice for one restock, and a subscription to a variant on sale) | Fixed by me: the state is read again under the row's lock. Three-session test added. |
| R8-06 (a visitor told «sent» whose mail a cap held back never got it: the second variant of one address on one day, or any sign-up after the day's 30) | Fixed by me: this was a promise to a visitor that nothing kept. `finance.notify_confirm_backlog()` (hourly) queues what a cap held back, the longest waiting first. And the one flooding path that had no bound is bounded: a stranger could re-subscribe a victim every day for ever, also after an unsubscribe; an address now gets at most five confirmation mails in 30 days (counted from the outbox). What remains, recorded for `docs/operations.md`: anyone with 30 addresses and 30 Turnstile passes spends the day's 30, and the sign-ups after that wait for the next day's backlog. |
| R8-07 (enumeration residue: a confirmed row does less work, and the shared day counter can be observed) | Accepted and recorded: the timing is a few statements behind a Turnstile call and a 5-an-hour throttle; the counter needs a quiet day, 30 Turnstile passes and six caller hashes to learn one bit (whether one address is confirmed for one variant). Taking a slot for a confirmed row would spend the budget on no mail. |
| R8-05 (the contract was behind the code) | Written into the contract: the sweep's rule, `notify_link_throttle`, the stale-true reset, the caps and the backlog, the purge's clocks, the admin list moved to round 11. No index on `notifications (variant_id)`: at this size a scan of tens of rows a minute; recorded as a ceiling. |
| R8-08 (plan files and `artifacts/soon/` changed in the tree during the round) | The owner's own side packages (SOON-1, SITE-STATE, D46 and D47), written in another session. Left alone, not staged here. |

My own finding, fixed: the sweep told subscribers an item was back while checkout was switched off and nothing could be bought (the state of the site today). It now does nothing at all while the switch is off, and moves no row, so opening the shop is what tells the subscribers, and closing and opening it again tells nobody twice. Test added. Not covered by SQL, for the runbook's go-live steps (round 12): during sandbox runs on the hosted site the switch is on while only holders of the access code can buy, so a restock then would tell real subscribers; restock after the sandbox runs, or keep the sign-up form closed until then.

Accepted as built: the confirm link's seven days run from the moment the mail is queued (priority 2 can wait behind the day's first 50); a notice already queued is still sent if the variant sells out again before it leaves.

Recorded for checkpoint (c): the sweep against `notify_confirm` and `notify_unsubscribe` on one row (by reading: one lock order); the purge against a confirm or an unsubscribe of a row it deletes; the UTC-midnight edge of the daily buckets; a sweep-queued notice sent end to end through the dispatcher (round 12's e2e); the backlog against a sign-up for the same row at once.

Checks on the final tree, from a fresh `supabase db reset` with `db:import` and `db:demo-catalog`, the edge runtime restarted: `pnpm test:db` 0 (29 files, 745 tests, run alone; `notify.test.ts` 65); `pnpm test` 0 (60 files, 1881 tests); `pnpm typecheck` 0; `pnpm lint` 0; `pnpm check:copy` 0. No call to Moyasar.
