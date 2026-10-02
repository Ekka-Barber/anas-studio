# Round 7: delivery (order access, recovery, downloads, paid files, the return request)

## Worker report 1

Round 7 delivery: the cut-off worker's tree was complete. I read the migration, the three shared modules, both index.ts, the admin/sweep/backup diffs and all test files against sections 1, 4-8, 11 and 13; no migration or function defect found, so the migration is unchanged and no reset was run.
What exists: 7 contract SQL functions plus `finance.item_returnable` and `public.paid_files_sweep_candidates`; `orders` (get, recover, return-request) and `download` (issue, redeem) with checkout's discipline; admin `paid-file-ticket`/`paid-file-complete` with ranged head checks (PDF magic; EPUB first ZIP entry = stored `mimetype`); `media_sweep` removing `incoming/` parts older than 24 h (never `assets/`); `paid-files` in backup and restore-check; 6 new test files.
The 3 failing HTTP tests were the tests, not the function: Kong rewrites ACAO to `*` and answers preflights itself for every function (probed on checkout, payments, orders, download). I removed those assertions and assert the site-origin answer, refusals included, in the unit tests.
Fixed or added: restore rehearsal storage limit (50 to 100 MiB, a paid file over 50 MiB could not be restored); the real `outbox` media_sweep job removing a stale `incoming/` part from real Storage while keeping a fresh part and an old asset; token-before-lock proofs (wrong guess answers at once while the order or entitlement is held, the right token waits; order_access reads under no lock); a refund racing the file attach (no deadlock, mail only if filled); the mailed link equals the stored link (order_email_data through tokens.ts) and `hasFile` true/false/null as the dispatcher reads it.
Contract deviation, proven: `createSignedUrl(.., {download})` double-encodes an Arabic name in storage-js 2.117.1, so the name is added on the rebuilt URL instead (real file reply asserted).
Choices the contract did not settle: asset id taken from the key; sweep function and `paidFiles` count; IP throttles 120/120/20 an hour; recovery's no-hash renewal needs an unexpired token; reply shapes `{ticket,bucket,path,token}`, `{assetId,filled}`, 201 `{returnId}`.
Checks all exit 0: 8 unit files 254 tests; orders-http 17; orders-access+download+order-emails+refunds 162 (then 56 after my additions); full test:db 26 files 594; pnpm test 59 files 1762; lint; typecheck; check:copy 208 files. Not run: backup, restore-check, e2e, any hosted check.

Files: supabase/migrations/20261002140000_delivery.sql — new (cut-off worker); read in full against section 6, unchanged, applied cleanly (no reset), supabase/functions/_shared/orders.ts — new (cut-off worker), reviewed, unchanged, supabase/functions/_shared/download.ts — new (cut-off worker), reviewed, unchanged, supabase/functions/_shared/paid-files.ts — new (cut-off worker), reviewed, unchanged, supabase/functions/orders/index.ts — placeholder replaced (cut-off worker), unchanged, supabase/functions/download/index.ts — placeholder replaced (cut-off worker), unchanged, supabase/functions/_shared/admin.ts — paid-file-ticket/complete wired (cut-off worker), unchanged, supabase/functions/_shared/media-sweep.ts — incoming/ sweep (cut-off worker), unchanged, scripts/backup.mjs — paid-files bucket (cut-off worker), unchanged, scripts/restore-check.mjs — per-bucket check (cut-off worker) + MY change: scratch stack storage limit patched to 100MiB, tests/unit/restore-check.test.ts — cut-off worker + MY new test for the storage-limit patch, tests/unit/orders.test.ts — new (cut-off worker) + MY foreign-origin ACAO assertion, tests/unit/download.test.ts — new (cut-off worker) + MY foreign-origin ACAO assertion, tests/unit/admin-paid-files.test.ts — new (cut-off worker), reviewed, unchanged, tests/unit/admin-function.test.ts — sweep tests extended (cut-off worker), unchanged, tests/unit/backup-cli.test.ts — cut-off worker, unchanged, tests/unit/backup-format.test.ts — cut-off worker, unchanged, tests/integration/orders-http.test.ts — new (cut-off worker) + MY fix of the 3 failing CORS assertions and MY new real-jobs-endpoint sweep test, tests/integration/orders-access.test.ts — new (cut-off worker) + MY mail-link cross-check and token-before-lock test, tests/integration/download.test.ts — new (cut-off worker) + MY hasFile cross-check, token-before-lock test, refund-vs-upload test, tests/integration/support.ts — commerceHarness (cut-off worker) + MY settledWithin helper

Checks:
- `pnpm exec supabase migration up --local` → 0 (Local database is up to date. The migration was not edited, so no pnpm db:reset was run.)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (No file under supabase/functions was edited in this pass; restarted anyway for a clean runtime. orders, download and payments answered 422 to {} afterwards.)
- `pnpm exec vitest run tests/unit/orders.test.ts tests/unit/download.test.ts tests/unit/admin-paid-files.test.ts tests/unit/admin-function.test.ts tests/unit/media.test.ts tests/unit/backup-cli.test.ts tests/unit/backup-format.test.ts tests/unit/restore-check.test.ts` → 0 (8 files, 254 tests (253 found, plus my restore-check test).)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/orders-http.test.ts` → 0 (17 tests, final run after my sweep test. Before my fix 3 of 69 across the three round-7 files failed (the CORS assertions). Run as its own command, split from the four files below only to keep each run short.)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/orders-access.test.ts tests/integration/download.test.ts tests/integration/order-emails.test.ts tests/integration/refunds.test.ts` → 0 (162 tests before my additions. orders-access + download were run again after them: 56 tests, exit 0.)
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db` → 0 (26 files, 594 tests on the final tree (an earlier full run before my test additions: 590). The staff-admin last-owner test did not time out.)
- `pnpm test` → 0 (59 files, 1762 tests, run again after my last integration-test edits.)
- `pnpm lint` → 0 (Run again after my last edits.)
- `pnpm typecheck` → 0 (Run again after my last edits.)
- `pnpm check:copy` → 0 (208 source files.)

Contract gaps:
- Section 7 `download` says `createSignedUrl(key, 60, {download: filename})`. Built differently, same result for the buyer: the signer is called as `createSignedUrl(key, 60)` and `download=<name>` is added to the URL rebuilt on the public Storage base (`publicFileUrl`). Reason, read in the installed @supabase/storage-js 2.117.1 (dist/index.mjs lines 1063-1067) and reproduced in node: the library URLSearchParams-encodes the name and then encodeURI()s the whole URL, so an Arabic name arrives as `%25D9%2583...` and the browser would save it as the literal text `%D9%83...`. orders-http asserts the real file reply's `content-disposition filename*=UTF-8''<name>`.
- The brief says checkout-http.test.ts asserts Access-Control-Allow-Origin over HTTP against `checkout`. No integration test does (grep: the only ACAO assertions on the real functions were this round's). Probed live: the local Kong 2.8.1 answers every OPTIONS itself (200, `*`) and rewrites ACAO to `*` on every function reply, for checkout and payments exactly as for orders and download. The functions were right; the 3 HTTP assertions were wrong and are removed. The site-origin answer, a foreign-origin refusal included, is now asserted in the unit tests of both handlers.
- Section 6 gives `paid_asset_set` no asset-id parameter. The asset id is the last part of the key `assets/<variantId>/<assetId>` that `paid-file-complete` mints; the SQL checks the key's exact shape and takes the id from it.
- The contract names no way to list abandoned uploads. Added `public.paid_files_sweep_candidates(p_limit)` (service_role only, same shape as `media_sweep_candidates`: `paid-files`, `incoming/%`, older than 24 hours). `media_sweep` now also fails the run, removing nothing, if a listed key is outside the swept prefix (both buckets), and the summary and the job record gain `paidFiles`.
- The contract gives no limits for the IP throttles of `download_issue` (120 an hour), `download_redeem` (120 an hour) and `return_request_create` (20 an hour), though the signatures take `p_ip_hash`; chosen like `order_access`/`payment_check_begin`, each answering 54000 which the functions map to 429. Beyond the contract's replies, `recover` answers 503 while payments are not configured and 400/503 for Turnstile and 422 for a malformed address, like checkout; nothing of those depends on whether the address has orders.
- `order_recover_apply` with no hash renews the expiry only while the stored token is still unexpired and at the version listed (stricter than 'guarded on the version'): an expired token is never revived under its old version, so the old link stays dead and only the next version works.
- The sandbox restore rehearsal (`scripts/restore-check.mjs`) builds its scratch stack with `supabase init`, whose storage limit is 50 MiB (checked live on the installed CLI), while the project's config and the `paid-files` bucket allow 100 MiB: a paid file over 50 MiB could not be restored there. Patched to the project's 100MiB; a unit test ties the patch to supabase/config.toml.

Open risks:
- `pnpm backup` and `pnpm restore-check` were NOT run end to end (they need the Supabase CLI against a linked or scratch stack, Docker, a passphrase). The bucket list, the per-bucket row comparison and the 100 MiB patch are covered by source-level unit tests only. Run one rehearsal with a real paid file over 50 MiB before the backup gate.
- Hosted-only facts are unverified: Storage with a 100 MiB upload, Range support and `nosniff` on the signed file reply (I32), and the function's own CORS answer behind the hosted gateway (locally Kong overrides it, so only the in-process unit tests see it).
- A failed removal right after a database error leaves an orphan object under `assets/` with no `paid_assets` row; the sweep never touches `assets/` by design. `incoming/` leftovers are swept after 24 hours.
- Recovery's global cap of 20 `order_link` mails a day (contract) can be used up by anyone who knows 20 customer addresses; the buyer then gets a renewed link but no mail until the next UTC day.
- `paid-file-ticket` does not check that the variant is digital (no SQL exists for it in the contract): the owner learns it at completion (NOT_DIGITAL, the upload is removed). `download_*`, `return_request_create` and recovery take no mode (as their contract signatures); only `order_access` is bound to it.
- Local database after these runs: 364 staff rows (229 active), 1351 orders, 1390 pending outbox rows (test leftovers, most not from this round), checkout_enabled is true (the demo seed's value, restored by the harness). Reset + db:import + db:demo-catalog before any acceptance e2e, as the auth.spec note says.
- Unrelated working-tree changes were left alone: modified .claude/launch.json and .claude/settings.json, untracked .claude/settings.json.tmp, and an untracked BOOK_ASSETS WhatsApp zip. No Playwright run, so no screenshot was rewritten.

## Audit 1: audit_failed

### R7-01 [medium] supabase/functions/_shared/paid-files.ts:264
- Problem: paid-file-complete removes the moved object when the paid_asset_set call ends in a fetch failure, i.e. when the outcome is unknown and the SQL may have committed. That is the exact case the comment two lines above says must never happen. If it commits, the asset is recorded, the variant points at it, waiting entitlements are filled and buyers are mailed order_ready, but the object is gone. Nothing repairs it: a later upload leaves entitlements that already have a file untouched, so those buyers get a 500 on every redeem.
- Evidence: Line 264 discards when `typeof code === 'string'`. The real rpc never throws a code-less error: postgrest-js 2.117.1 (node_modules/.pnpm/@supabase+postgrest-js@2.117.1/.../dist/index.mjs:416-455) turns a fetch failure or abort into `error.code = ""`, and db.ts:40 rethrows it as `new DbError(error.message, error.code)`. An empty string is a string. Reproduced with `node --experimental-transform-types`: paidFileComplete with an rpc throwing `new DbError('TypeError: fetch failed', '')` printed `status 500 | moved to assets: true | object removed after unknown outcome: true`. The unit test that claims to cover this (tests/unit/admin-paid-files.test.ts:401-407) throws a bare `TypeError('fetch failed')`, a shape serviceRpc() never produces, so it passes while the real wiring deletes the file.
- Correction: Discard only when the database answered with a SQLSTATE: replace the condition with a five-character check (`/^[0-9A-Z]{5}$/.test(code)`), so an empty code keeps the object. Change the unit test at admin-paid-files.test.ts:401 to throw the real shape (`new DbError('TypeError: fetch failed', '')`) and assert `files.remove` was not called; keep the existing SQLSTATE cases asserting removal.

### R7-02 [low] supabase/functions/_shared/paid-files.ts:189
- Problem: On 55P03 (a late order held by another writer) the owner is told to retry in a moment, but the uploaded object has already been removed. A retry of paid-file-complete with the same ticket answers MISSING_FILE, so the owner must upload the whole file again (up to 100 MiB) for a lock that clears in milliseconds.
- Evidence: Line 190 answers 409 BUSY with «أعد المحاولة بعد لحظات»; line 264 discards the moved object for every coded error, 55P03 included. tests/unit/admin-paid-files.test.ts:384 asserts both the BUSY reply and the removal. The object is no longer under incoming/<ticket> after the move, so the second complete hits the `missing()` branch.
- Correction: Either retry the rpc a few times on 55P03 before giving up, or move the object back to incoming/<ticket> on 55P03 so the same ticket can be completed again. Failing that, change the message to say the file must be uploaded again, as the 23505 message already does.

### R7-03 [low] supabase/functions/_shared/paid-files.ts:107
- Problem: The store's remove() ignores what Storage answers, so a refused removal is silent. Under incoming/ the daily sweep takes the part later. Under assets/ (after a SQL refusal such as NOT_DIGITAL, or any coded error) the object stays for ever: the sweep never lists assets/, no row refers to it, and nothing reports it. It is then carried in every backup.
- Evidence: Lines 107-110: `await bucket().remove(keys)` with the `{ error }` result unread; supabase-js returns errors, it does not throw. `discard` (lines 213-219) only catches throws. `paid_files_sweep_candidates` lists `incoming/%` only (migration lines 470-479). The worker's own openRisks names the orphan.
- Correction: Read the error in remove() and throw. In paidFileComplete, when the removal of an assets/ key fails, move the object back under incoming/ (so the sweep owns it) or say so in the reply so the owner knows a stray object exists.

### R7-04 [low] supabase/migrations/20261002140000_delivery.sql:285
- Problem: Only order_access is bound to the configured mode. download_issue, download_redeem, return_request_create, order_recover_list and paid_asset_set act on orders of either mode. On a database that holds test orders after going live, a test order's token still issues downloads of the real file and files return requests, recovery mails a link to a test order that the order page then answers NOT_FOUND, and a file upload fills and mails test orders. The worker followed the contract's signatures, which carry no p_mode for these.
- Evidence: Line 85 filters `o.environment = p_mode`; lines 285 (download_issue), 340-352 (download_redeem), 520 (return_request_create), 184-185 (order_recover_list) and 413-415 (paid_asset_set) have no environment condition. Contract section 6 gives these five no mode parameter, while its preamble says a function that takes the mode refuses the other one. No test covers an other-mode order on these paths. Exposure is limited by the sandbox fence: only holders of the test access code can create test orders on a hosted site.
- Correction: Contract ruling: either add p_mode to download_issue, return_request_create and order_recover_list (and derive it for redeem and paid_asset_set from the order's environment), or record in section 13 that delivery is mode-agnostic by design and that test orders must be purged before going live.

### R7-05 [low] tests/unit/restore-check.test.ts:43
- Problem: The new restore-check tests assert on the script's source text, not its behaviour, so they do not fail if the behaviour they name breaks. The per-bucket comparison and the 100 MiB patch could both be wrong and still pass. No backup or restore rehearsal with a paid file was run, so 'paid-files is in the backup and the restore check' rests on a constant and three regexes.
- Evidence: Lines 43-47 only match `/group by bucket_id/` and a message string in the source. Lines 37-41 only check that the string `file_size_limit = "100MiB"` appears. Changing `total === rowCount` (restore-check.mjs:461) or the section test in patchConfig (restore-check.mjs:135) would leave all three green. The worker's report states `pnpm backup` and `pnpm restore-check` were not run.
- Correction: Before the backup gate, run one real rehearsal: upload a paid file (one over 50 MiB), `pnpm backup --local`, `pnpm restore-check`, and record the per-bucket lines. If a behavioural unit test is wanted, patchConfig and the per-bucket verdict need to be importable, which means a path outside this round's allowlist.

### R7-06 [low] tests/integration/refunds-http.test.ts:521
- Problem: One full `pnpm test:db` run failed in round 6's refunds-http.test.ts ('a refund that times out and lands late'): the refund was still `uncertain` after the second job run. The same command run alone passed 594 of 594. The file has no diff in this round and I found no link to round 7's code; the cause is not established. The failing run overlapped my own typecheck, lint and check:copy.
- Evidence: Run 1: `Test Files 1 failed | 25 passed (26), Tests 1 failed | 593 passed (594)`, AssertionError at refunds-http.test.ts:522 (`status: 'uncertain'`, expected `succeeded`). Run 2, nothing else running: `26 passed, 594 passed`, exit 0. Line 521 is `await runJob()` with no assertion on its status, so a job run that failed or was cut short shows up only as a wrong refund state. Edge runtime logs for the window show one `CPU time soft limit reached` and 30 `early termination` lines, which fits a load-induced failure but does not prove it. Cron cannot be the cause locally: Vault holds no secrets, so payments_kick posts nothing.
- Correction: Assert the status and the refunds count of the second runJob() at line 521, as line 512 does for the first, so a failed job run is named as such. Re-run test:db alone at acceptance.

### R7-07 [low] tests/integration/orders-http.test.ts:18
- Problem: The worker's diagnosis of the three failing CORS assertions is right: the functions were correct and the assertions could not hold locally. The consequence is that the site-origin answer of orders and download is proven only in-process; behind a real gateway it is unverified.
- Evidence: Live probe through 127.0.0.1:54321: OPTIONS on checkout, orders, download and payments is answered by Kong 2.8.1 itself (200, `Access-Control-Allow-Origin: *`), and a POST with a foreign Origin to each returns the function's 403 with ACAO rewritten to `*`. checkout behaves identically. No integration test asserts ACAO on any real function (grep: only unit tests and e2e route mocks). tests/unit/orders.test.ts:106,131 and tests/unit/download.test.ts:95,119 assert the site origin on the preflight and on a foreign-origin refusal.
- Correction: Add to the hosted checks (I32): a preflight and a foreign-origin POST to orders and download on the hosted project answer the site's origin, never `*`.

### R7-08 [low] supabase/migrations/20261002140000_delivery.sql:26
- Problem: The migration creates an index, though its own header and contract section 4 say rounds after round 2 add functions only. The worker's report does not list it among the contract gaps. The index itself is sound: recovery looks orders up by email_hash and no index covered the paid states.
- Evidence: Lines 26-27: `create index orders_email_recent on finance.orders (email_hash, created_at desc) where status in ('paid','paid_needs_resolution','refunded')`. Line 2 of the same file says 'Functions only'. pg_indexes shows the only other email_hash index is `orders_pending_email` (pending_payment only).
- Correction: Accept the index and note it in the contract (section 4 or 13), or move it to wherever the orchestrator wants schema changes recorded.

### R7-09 [low] tests/integration/support.ts:411
- Problem: The shared harness's stop() cleans up by time window, not by its own rows. It deletes every refund created since the harness started, closes every review payment created since then, and deletes every owner_alert mail since then, whoever made them. Sequential test:db files are safe; anything else writing to the local database during a run (a dev session, an e2e run) loses rows.
- Evidence: Lines 411, 414 and 417: `delete from finance.refunds where created_at >= $2 or order_id = any($1)`, `update finance.payment_reviews ... where created_at >= $1`, `delete from finance.email_outbox where kind = 'owner_alert' and created_at >= $1`. vitest.config.ts sets `fileParallelism: mode !== 'db'`, which is what keeps this safe today.
- Correction: Scope the three statements to `created.orders` (refunds and reviews by order_id, owner alerts by the payload's orderId or the run's own staff recipients).

### R7-10 [low] (auditor's own run, no repository file)
- Problem: My own slip, not the worker's: while confirming the gateway's CORS behaviour I grepped Kong's config inside the container, and the matched lines included the local stack's API keys (the local sb_secret and sb_publishable values and the supabase-demo JWTs). They appeared in my tool output only; nothing was written to the repository, a log or an artifact. The brief said never to print a key.
- Evidence: Command: `docker exec supabase_kong_ANASAQ.ME sh -c 'grep -n -i -B3 -A12 "name: cors" /home/kong/kong.yml'`. The request-transformer lines after each cors plugin carry the keys. These are the local development stack's keys, not hosted secrets.
- Correction: No action needed for the hosted project. If the local keys matter to you, `supabase stop` and `supabase start` regenerate nothing by themselves; treat this session's transcript as holding local-only keys.

Checks re-run:
- `pnpm exec supabase migration up --local  (Local database is up to date)` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/orders.test.ts tests/unit/download.test.ts tests/unit/admin-paid-files.test.ts tests/unit/admin-function.test.ts tests/unit/media.test.ts tests/unit/backup-cli.test.ts tests/unit/backup-format.test.ts tests/unit/restore-check.test.ts  (8 files, 254 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/orders-access.test.ts tests/integration/download.test.ts tests/integration/orders-http.test.ts tests/integration/order-emails.test.ts tests/integration/refunds.test.ts  (5 files, 182 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db  (run 1, overlapping my typecheck/lint/check:copy: 593 of 594, one failure at tests/integration/refunds-http.test.ts:522)` → 1
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db  (run 2, alone: 26 files, 594 tests)` → 0
- `pnpm test  (59 files, 1762 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy  (208 source files)` → 0
- `curl OPTIONS and foreign-origin POST to checkout, orders, download, payments via 127.0.0.1:54321  (Kong answers preflights itself and rewrites ACAO to * on all four)` → 0
- `node --experimental-transform-types -e <paidFileComplete with rpc throwing new DbError('TypeError: fetch failed', '')>  (printed: object removed after unknown outcome: true)` → 0
- `docker logs --since 30m supabase_edge_runtime_ANASAQ.ME | pattern counts  (0 lines with a storage key, incoming key, signed URL, email, token or order link in 1149 lines)` → 0

Uncovered:
- paid-file-complete when the database call fails the way the real rpc reports a fetch failure (DbError with code ''): the existing test uses a shape production never throws (finding R7-01).
- paid_asset_set racing a real apply_verified_payment of a new order of the same variant: only simulated by repointing an entitlement by hand (download.test.ts:486-521).
- download_redeem racing a refund on separate connections (redeem holding the token row while the refund commits): refund-then-redeem is tested only in sequence.
- An order of the other mode through download_issue, download_redeem, return_request_create, recovery and paid_asset_set: no test, and the contract gives these no mode (finding R7-04).
- The throttles as 429 through the real functions over HTTP (order_access, download issue and redeem, return-request): unit tests and SQL tests only.
- Replay of a signed upload token after completion (a second upload to the same incoming/<ticket>, then a second complete): untested.
- A real object over the bucket's 100 MiB limit, and the bucket's own refusal of a wrong content type at upload: the size branch is tested with a faked info() only.
- pnpm backup followed by pnpm restore-check with a paid file, and one over 50 MiB: never run; the tests are source-text assertions (finding R7-05).
- A Storage failure after download_redeem has counted a use: the use is spent with no link handed out; the behaviour is neither specified nor asserted at the SQL level.
- The sweep removing an old incoming/ part while paid-file-complete is checking it.
- Recovery's reply time for an address with orders against one without: the call sequence is asserted equal, the timing is not measured.
- Denial of recovery mail by spending the day's 20 order_link slots with 20 known customer addresses: the cap is tested, the abuse is not bounded (contract section 6 sets the cap).
- Hosted-only: the functions' own CORS answer behind the hosted gateway, Range support on signed URLs, nosniff on the signed file reply, a 100 MiB upload.

## Worker report 2

Fixed all four findings at their cause; the checks are green except the known staff-admin timeout.

R7-01 (medium): paid-files.ts no longer removes the moved object on a code-less failure. It discards only when the error carries a SQLSTATE (/^[0-9A-Z]{5}$/). The old test threw a bare TypeError, so it passed against the real wiring. The new unit test throws the real shape: DbError('TypeError: fetch failed', ''), an abort with an empty code, a code of undefined, a bare TypeError and a PGRST code. Each must keep the object, with move called once and remove never. The SQLSTATE rows still assert removal, and dbError now builds a real DbError.

R7-02: on 55P03 nothing was recorded, so the object now goes back to incoming/<ticket> and the same ticket completes again. 'Retry in a moment' is now true. Proven by a unit test over an in-memory store (409, then 201 with the same ticket) and by a real-Storage test in orders-http.test.ts.

R7-03: paidFileStore().remove() now throws when Storage answers an error. After a SQL refusal, a failed removal of the assets/ key moves the object back under incoming/, where the daily sweep owns it. If that move fails too, the refusal is still answered and nothing leaks. The adapter is unit-tested through a faked service client.

R7-09: support.ts stop() now cleans by this run's orders: refunds and review payments by order_id. I dropped the owner_alert time-window delete; the existing orderId-payload delete covers the run's alerts. I also removed the now-unused startedAt from the harness. orders-http afterAll deleted payment_events by time window, the same cause, so it now deletes by the run's own emulator payment ids.

Mutation checks, each restored afterwards: the old condition fails 3 unit tests, dropping the 55P03 branch fails 1 unit and 1 integration test, removing the removal fallback fails 2, and remove() ignoring errors fails 1.

Rest of the round read against the contract section 6, the functions and the test list: nothing else needed changing. The CORS question is answered in contractGaps: the gateway, not the functions.

Files: C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/supabase/functions/_shared/paid-files.ts, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/unit/admin-paid-files.test.ts, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/support.ts, C:/Users/alazi/Downloads/Tech/Code/My_projects/not shipped yet/ANASAQ.ME/tests/integration/orders-http.test.ts

Checks:
- `pnpm exec supabase migration up --local` → 0 (Local database is up to date. The migration was not edited, so no db reset was run.)
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0 (Run twice; the last restart came after the final edit to supabase/functions.)
- `pnpm exec vitest run tests/unit/orders.test.ts tests/unit/download.test.ts tests/unit/admin-paid-files.test.ts tests/unit/admin-function.test.ts tests/unit/media.test.ts tests/unit/backup-cli.test.ts tests/unit/backup-format.test.ts tests/unit/restore-check.test.ts` → 0 (8 files, 264 tests (253 before this pass; the new ones are in admin-paid-files.test.ts).)
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec vitest run --mode db tests/integration/orders-access.test.ts tests/integration/download.test.ts tests/integration/orders-http.test.ts tests/integration/order-emails.test.ts tests/integration/refunds.test.ts` → 0 (5 files, 182 tests. orders-http then got one more test (real Storage, 55P03) and re-ran alone: exit 0, 18 tests.)
- `TEST_ENV=local DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:db` → 1 (25 of 26 files pass, 594 of 595 tests. The only failure is tests/integration/staff-admin.test.ts 'refuses to remove the last active owner', timed out at 5000 ms. The shared database holds 150 active and 337 total test owners. Not caused by this round.)
- `pnpm test` → 0 (59 files, 1772 tests.)
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0 (OK, 208 source files.)

Contract gaps:
- No finding was wrong; all four are fixed. R7-02: I chose the 'put the object back under its ticket' option (the finding offered a retry, a move back, or a message change). R7-03: I chose 'move back under incoming/' over 'say so in the reply'.
- Contract section 7 says createSignedUrl(key, 60, {download: filename}). download.ts adds the `download` query parameter itself, because supabase-js percent-encodes the name twice (an Arabic name would reach the browser as %D9... text). The real-Storage test in orders-http.test.ts proves content-disposition filename*=UTF-8''<name> and the exact bytes. Same behaviour, different mechanism.
- The contract names no SQL for the sweep. The migration adds public.paid_files_sweep_candidates(integer), service_role only, listing incoming/% objects older than 24 h (the job removes them through the Storage API, like media_sweep_candidates).
- The contract sets no IP throttle on download_issue, download_redeem or return_request_create. The SQL takes 120/h, 120/h and 20/h per IP hash and raises 54000, which the functions map to 429.
- The 3 CORS failures in orders-http were the test's, not the functions'. Local Kong 2.8.1 answers Access-Control-Allow-Origin: * on every preflight and every POST reply, orders, payments, checkout and contact alike (curl checked in this pass). checkout-http.test.ts never asserted CORS. The functions' own headers (the site origin, also on a refusal) are proven in tests/unit/orders.test.ts and download.test.ts.

Open risks:
- Two Storage failures in a row (the removal, then the move back) leave the moved object under assets/ with no row. Nothing sweeps assets/, and every backup carries it. The owner just gets the normal refusal reply.
- A code-less database failure keeps the moved object under assets/ by design (the file may have been recorded). If the SQL had not committed, that object is an orphan, and the owner uploads again after the 500.
- A SQLSTATE of class 08 (connection exception) counts as 'the database answered', so the object is removed, exactly as the finding prescribed (/^[0-9A-Z]{5}$/). I did not verify whether PostgREST reports a lost commit that way.
- commerceHarness still deletes two global rate-limit buckets (checkout:all, order-link:day) at start. Counters only, and not in the finding.
- Whether Storage's own file response carries nosniff is still the hosted check I32.
- No Playwright or screenshot run in this pass, so no artifacts/acceptance file was rewritten.

## Audit 2: pass

### R7-04 [low] supabase/migrations/20261002140000_delivery.sql:285
- Problem: Still open, no ruling recorded. Only order_access is bound to the configured mode. download_issue, download_redeem, return_request_create, order_recover_list and paid_asset_set act on orders of either mode. On a database that keeps sandbox orders after going live, a test order's link still issues downloads of the real file, recovery mails a link the order page then answers NOT_FOUND, and an upload fills and mails test orders.
- Evidence: Line 85 filters `o.environment = p_mode`; lines 285 (download_issue), 340-352 (download_redeem), 520 (return_request_create), 184-185 (order_recover_list) and 413-415 (paid_asset_set) carry no environment condition. Contract section 6 gives these five no p_mode. Section 13 (read in full, 12 items) says nothing about delivery being mode-agnostic. grep of PLANS/ and artifacts/acceptance/P08 for a ruling: none. No test puts an other-mode order through these paths. Exposure is limited to holders of the sandbox access code.
- Correction: Contract ruling: add p_mode to download_issue, return_request_create and order_recover_list (derive it from the order for redeem and paid_asset_set), or record in section 13 that delivery is mode-agnostic and that sandbox orders are purged before going live.

### R7-05 [low] tests/unit/restore-check.test.ts:43
- Problem: Still open. The restore-check tests assert on the script's source text, not on what it does, and no backup or restore rehearsal with a paid file has been run. 'paid-files is in the backup and the restore check' rests on a constant and three regexes.
- Evidence: Lines 25-47: the bucket list is read with a regex, the 100 MiB patch is a `toContain` on the source, the per-bucket comparison is `/group by bucket_id/` plus a message string. Changing `total === rowCount` (restore-check.mjs:461) or the section test in patchConfig (restore-check.mjs:135) leaves all three green. Both worker reports state `pnpm backup` and `pnpm restore-check` were not run. I did not run them either (they need a scratch stack and a passphrase).
- Correction: Before the backup gate, one real rehearsal: upload a paid file over 50 MiB, `pnpm backup --local`, `pnpm restore-check`, and keep the per-bucket lines as evidence.

### R7-06 [low] tests/integration/refunds-http.test.ts:521
- Problem: Still open (round 6's file, unchanged). The second `runJob()` of 'a refund that times out and lands late' is not asserted, so a job run that failed or was cut short shows only as a wrong refund state. It failed once under load in the previous audit; it passed in this audit's full run.
- Evidence: Line 521 is `await runJob()` with no check, while line 512 asserts `(await runJob()).status` is 200. This audit's `pnpm test:db`, run alone: 594 of 595, the only failure being the staff-admin timeout. git status shows no diff on the file.
- Correction: Assert the status of the second runJob() as line 512 does.

### R7-07 [low] tests/integration/orders-http.test.ts:18
- Problem: Still open. The site-origin answer of `orders` and `download` is proven only in-process. Locally the gateway answers preflights itself and rewrites the allowed origin to `*`, so no HTTP test can see what the functions send. Behind the hosted gateway it is unverified.
- Evidence: tests/unit/orders.test.ts:103-108 and 127-131 and tests/unit/download.test.ts:92-97 and 115-119 assert `access-control-allow-origin` equals the site on the preflight and on a foreign-origin 403. orders.ts:139 and download.ts:106 build the header from `siteOrigin()` only, never `*`. orders-http.test.ts:634-647 asserts the 403 status alone, and lines 18-21 say why.
- Correction: Add to the hosted checks (I32): a preflight and a foreign-origin POST to `orders` and `download` on the hosted project answer the site's origin, never `*`.

### R7-08 [low] supabase/migrations/20261002140000_delivery.sql:26
- Problem: Still open. The migration creates an index although its own header (line 2) and contract section 4 say rounds after round 2 add functions only. The index is sound; the contract does not record it.
- Evidence: Lines 26-27 create `orders_email_recent`; pg_indexes on the local database shows it applied as written. Contract section 4, line 166: 'later migrations add functions only'.
- Correction: Accept the index and note it in contract section 4 or 13.

### R7-11 [low] supabase/functions/_shared/paid-files.ts:291
- Problem: R7-01, R7-02 and R7-03 are fixed at their cause, and the fixes are right. What remains is the other side of that choice: an object can be left under `assets/` with no `paid_assets` row, and nothing ever lists, reports or removes it. Each one is up to 100 MiB, kept for ever and carried in every backup.
- Evidence: Three paths leave such an object. (1) Line 291 keeps the moved object whenever the error has no SQLSTATE; that includes PostgREST's own codes, where nothing ran (tests/unit/admin-paid-files.test.ts:416 asserts the keep for `PGRST202`). (2) Lines 242-248: a removal that fails falls back to `putBack`, which swallows a failed move (235-241). (3) Line 291 on 55P03: if the move back fails, the reply still says to retry and the retry answers MISSING_FILE. `paid_files_sweep_candidates` lists `incoming/%` only (migration lines 470-479) and media-sweep.ts:37 fails the run on any other prefix. The brief forbids sweeping `assets/`, so a worker cannot close this. On the local database now: 0 such objects. Fix checks: the R7-01 cases at admin-paid-files.test.ts:410-425 throw `new DbError(..., '')` and assert `remove` is never called; R7-02 at 455-475 and orders-http.test.ts:540-582 (real Storage); R7-03 at 484-509 and 512-544.
- Correction: Ruling for the orchestrator: either let the daily sweep also list `assets/%` objects older than 24 hours that no `finance.paid_assets.storage_key` names (an outcome is known long before that), or show their count in the owner's status so a person removes them. Record the choice in the contract.

### R7-12 [low] supabase/functions/_shared/paid-files.ts:294
- Problem: A database answer that is neither a success nor an explicit refusal (null, or a shape with no `ok`) is treated as 'nothing was recorded' and the moved object is removed. Only `{ok:false}` or a SQLSTATE proves that. This is the same rule R7-01 fixed for thrown errors, left open for returned values. Not reachable with today's SQL.
- Evidence: Line 294: `if (result?.ok !== true) { await dropMoved(key) ... }`. `paid_asset_set` returns a jsonb object on every path or raises (migration lines 393-457), so a null answer cannot come from it today. tests/unit/admin-paid-files.test.ts:382 asserts the removal for a `null` reply.
- Correction: Remove the object only when `result?.ok === false`; for any other non-success answer keep it and answer the detail-free 500, and change the `null` row of the test at line 382 to assert `remove` was not called.

### R7-13 [low] PLANS/P08-CONTRACT.md:413
- Problem: The round settled several things the contract does not say, and one that it says differently. The code is sound on each; the contract text is now behind the code, which is a mismatch between two layers for rounds 10 and 11 that build on it.
- Evidence: (1) Section 7 line 413 says `createSignedUrl(key, 60, {download: filename})`; download.ts:78 signs without the name and download.ts:92 adds `download` on the rebuilt URL. Reason confirmed: storage-js 2.117.1 dist/index.mjs:1067 runs `encodeURI` over an already encoded query, and orders-http.test.ts:329 asserts the real file reply's `filename*=UTF-8''<name>`. (2) `public.paid_files_sweep_candidates(integer)` (migration 463-480) and `paidFiles` in the job record are not in section 6 or 7. (3) IP throttles the contract gives no number for: download_issue 120 an hour (line 281), download_redeem 120 (336), return_request_create 20 (514). (4) `order_recover_apply` with no hash renews only an unexpired token at the listed version (line 228), stricter than section 6. (5) Reply shapes: `paid-file-ticket` 201 `{ticket, bucket, path, token}`, `paid-file-complete` 201 `{assetId, filled}` with codes MISSING_FILE, TYPE_MISMATCH, TOO_LARGE, NOT_A_PDF, NOT_AN_EPUB, BUSY, CONFLICT; `return-request` 201 `{returnId}`; `recover` answers 503, 400 and 422 before the database, none depending on the address.
- Correction: Write these into contract sections 6 and 7 before rounds 10 and 11 are briefed.

Checks re-run:
- `pnpm exec supabase migration up --local  (Local database is up to date)` → 0
- `docker restart supabase_edge_runtime_ANASAQ.ME` → 0
- `pnpm exec vitest run tests/unit/orders.test.ts tests/unit/download.test.ts tests/unit/admin-paid-files.test.ts tests/unit/admin-function.test.ts tests/unit/media.test.ts tests/unit/backup-cli.test.ts tests/unit/backup-format.test.ts tests/unit/restore-check.test.ts  (8 files, 264 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm exec vitest run --mode db tests/integration/orders-access.test.ts tests/integration/download.test.ts tests/integration/orders-http.test.ts tests/integration/order-emails.test.ts tests/integration/refunds.test.ts  (5 files, 183 tests)` → 0
- `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db  (run alone: 25 of 26 files, 594 of 595 tests; the only failure is tests/integration/staff-admin.test.ts 'refuses to remove the last active owner', timed out at 5000 ms: the shared database's test owners, 146 active owners and 1079 staff rows; reset, db:import and db:demo-catalog are needed before any acceptance e2e)` → 1
- `pnpm test  (59 files, 1772 tests)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy  (208 source files)` → 0
- `node probe.mjs: pg_proc against supabase/migrations/20261002140000_delivery.sql  (all 9 functions: applied body equals the file, search_path empty, owner postgres, no execute for public, anon or authenticated; service_role on the 8 public ones, none on finance.item_returnable; anon cannot select product_variants.digital_asset; paid-files is private, 104857600 bytes, pdf and epub only; storage.objects has no policy)` → 0
- `docker logs --since 20m supabase_edge_runtime_ANASAQ.ME | pattern counts  (903 lines; 0 with a storage key, an incoming key, object/sign, token=, an email, an order link, downloadToken, accessToken, a key or a JWT)` → 0
- `node state.mjs: local database after the runs  (refunds 0, open review payments 0, attempts due 0, unprocessed events 0, paid-files objects 0, assets objects with no row 0, checkout_enabled true; leftovers: 9625 pending contact_notice rows, 493 paid_assets rows of test fixtures with no object)` → 0
- `grep of the round's files for key shapes, api.moyasar.com, skipped or retried tests  (only the documented local emulator key and a dummy token in unit tests; no skip, only, todo or retry)` → 0

Uncovered:
- download_redeem racing a refund on separate connections (the redeem queued on the token row while the refund commits): refund-then-redeem is tested in sequence only; issue-versus-refund is tested at once (download.test.ts:322).
- paid_asset_set racing a real apply_verified_payment of a new order of the same variant: only simulated by repointing an entitlement by hand (download.test.ts:486-521).
- An order of the other mode through download_issue, download_redeem, return_request_create, recovery and paid_asset_set: no test, and the contract gives these no mode (R7-04).
- The throttles as 429 through the real functions over HTTP (order_access, download issue and redeem, return-request): unit tests and SQL tests only.
- Replay of the signed upload token after the object has left incoming/<ticket>: a second upload to the same key after a completion, or during the window before a 55P03 put-back (the move back would then meet an existing object and leave the first one under assets/).
- paid-file-complete when Storage fails twice in a row (removal, then the move back) on real Storage: unit-tested with fakes only; the object stays under assets/ (R7-11).
- A real object over the bucket's 100 MiB limit, and the bucket's own refusal of a wrong content type at upload: the size branch is tested with a faked info() only.
- pnpm backup followed by pnpm restore-check with a paid file, and one over 50 MiB: never run (R7-05). Also pnpm backup against a database that has no paid-files bucket yet.
- A Storage signing failure after download_redeem has counted a use: the use is spent with no link handed out; neither specified nor asserted.
- The daily sweep removing an old incoming/ part while paid-file-complete is checking it.
- Recovery's reply time for an address with orders against one without: the reply and the call sequence are asserted equal, the timing is not measured (a hit runs an update and an insert that a miss does not).
- Denial of recovery mail: the day's 20 order_link slots spent with 20 known customer addresses, and one address's 3 requests an hour spent by someone else. The caps are tested; the abuse is not bounded (contract section 6 sets the caps).
- A database connection lost at commit reported with a class 08 SQLSTATE: paid-file-complete would remove the object as 'nothing recorded'. Whether PostgREST can report a lost commit that way was not verified.
- Hosted only: the functions' own CORS answer behind the hosted gateway (R7-07), Range support and nosniff on the signed file reply (I32), a 100 MiB upload.


## The orchestrator's rulings and own audit (2026-10-02)

The round was written by two workers: the first was cut off by a network failure after most of the build (no report, no audit); a fresh one read all of it against the contract, finished it and reported for the whole round. The workflow ended `audit_pass` after one build, one audit (one medium, nine low), one fix pass and a second audit. I read `20261002140000_delivery.sql` whole, and `orders.ts`, `download.ts` and `paid-files.ts` line by line, with the diffs of `admin.ts`, `media-sweep.ts`, `backup.mjs` and `restore-check.mjs`: where each token is minted and hashed (the order token is never stored or logged, the download token leaves once, in the reply that minted it), what each buyer function locks (the entitlement row alone, the token row alone, the order row after the token comparison), and the paid file's path (minted by the function, never built from caller input beyond the variant id, which the SQL checks against the key).

| Finding | Ruling |
|---|---|
| R7-01 (medium: the moved object was removed when the database call's outcome was unknown, because the real rpc reports a network failure with an empty code) | Fixed by the second worker: the object is removed only for a SQLSTATE. I narrowed it further: class 08 (a connection lost on the way) is not an answer either. |
| R7-02 (a 55P03 told the owner to retry, with the object already gone) | Fixed by the worker: the object goes back under its ticket and the same ticket completes again. Proven on real Storage. |
| R7-03 (a removal Storage refused was silent) | Fixed by the worker: `remove` throws, and a refused removal puts the object back under `incoming/`, where the sweep owns it. |
| R7-04 (only `order_access` was bound to the configured mode; my own read found the same) | Fixed by me, a gap of my contract: `download_issue`, `download_redeem`, `return_request_create` and `order_recover_list` take `p_mode` and treat an order of the other mode as not found, so a sandbox order's link issues no download of the real file, files no return and is mailed no link once the site is live. `paid_asset_set` stays without a mode: it is the owner's, and filling a waiting sandbox order harms nothing (its download is refused by the mode). Tests added for each function; the contract says so. |
| R7-05 (the restore-check tests assert on source text; no rehearsal with a paid file was run) | Accepted as a residual of this round, and put on the close's list: one real `pnpm backup --local` and `pnpm restore-check` with a paid file, recorded as evidence. |
| R7-06 (round 6's late-landing refund test did not assert its second job run) | Fixed by me: the status is asserted. |
| R7-07 (the functions' own CORS answer is proven only in-process: the local gateway answers preflights itself and rewrites the allowed origin) | Accepted. The worker's diagnosis is right; the hosted check (a preflight and a foreign-origin POST to `orders` and `download` answer the site's origin) goes into I32 at the close. |
| R7-08 (the migration adds an index, where the contract said functions only) | Accepted; the contract's section 4 names it. |
| R7-09 (the shared harness cleaned up by time window) | Fixed by the worker: by the run's own orders. |
| R7-10 (the auditor's own slip: local development keys of the local stack in its tool output) | No action: the local stack's keys are the Supabase CLI's local defaults, not hosted secrets; nothing was written to the repository or to evidence. |
| R7-11 (an object can stay under `assets/` with no row: an unknown outcome that did not commit, or two Storage failures in a row) | Ruled: no automatic removal. A sweep of `assets/` could race a completion (if a moved object keeps its upload time, a ticket completed after a day could lose a file that is about to be recorded), and a paid file must never be removed by a job. The orphan is private and rare; `docs/operations.md` gets the query that lists them (round 12). Written into the contract. |
| R7-12 (a database answer that is neither a success nor a refusal removed the object) | Fixed by me: only `{ok:false}` removes it. |
| R7-13 (the contract was behind the code: the download name on the rebuilt URL, the sweep function, the throttles, the stricter renewal, the reply shapes) | Written into the contract (sections 4, 6 and 7). |

The worker's stated choices are accepted: the download name added on the rebuilt URL (the library encodes it twice), the asset id taken from the key, the IP throttles (120, 120 and 20 an hour), the scratch stack's storage limit raised to the project's 100 MiB in `restore-check`, and the sweep failing its run on a key outside the swept prefix.

Recorded for checkpoint (c): `download_redeem` racing a refund on two connections; `paid_asset_set` racing a real `apply_verified_payment` of a new order of the same variant; the throttles as 429 through the real functions; a replay of the signed upload token after completion; a real object over 100 MiB; recovery's reply time for an address with and without orders (the call sequence is equal, the timing is not measured; ten requests an hour per IP and a Turnstile solve each bound the sampling); the day's 20 `order_link` mails spent by someone who knows 20 customer addresses, and one address's 3 an hour spent by someone else (the caps are the contract's; recorded as residuals for `docs/operations.md`). Hosted only: CORS behind the hosted gateway, Range and `nosniff` on the signed file reply (I32), a 100 MiB upload.

Checks on the final tree, from a fresh `supabase db reset` with `db:import` and `db:demo-catalog`, the edge runtime restarted: `pnpm test` 0 (59 files, 1776 tests); `pnpm typecheck` 0; `pnpm lint` 0; `pnpm check:copy` 0 (208 source files); `pnpm test:db` 597 of 598 (26 files). The one failure was `tests/integration/staff-admin.test.ts` "set_role writes an audit row", timed out at 5000 ms: a P03 file this round does not touch, whose cases sign real users in and enrol a TOTP and take about 3.5 seconds each when run alone, so the default 5 seconds fails whenever the stack is busy (the same file's "last active owner" case failed the same way in earlier rounds, where it was put down to leftover test owners; on a fresh reset that explanation does not hold). Fixed at its cause: the file's timeout is 20 seconds. Re-run after that, together with the round's own database files and `refunds-http.test.ts`: 5 files, 98 tests, 0. The full `test:db` was not run a second time after the timeout change; the acceptance battery runs it again.
