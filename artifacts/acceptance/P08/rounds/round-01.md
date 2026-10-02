# P08 round 1: the Moyasar emulator, the client and the runbook sources (workflow wf_93afe5c2-f9a)

## Worker report 1

Round 1 built and verified: the local Moyasar emulator, the only Moyasar client with paymentsConfig(), and the runbook's first part.

Emulator (tests/support/moyasar-emulator.ts): node:http only, erasable TS, runs under `node` directly (smoke: 200 with key, 401 without). startEmulator returns { url, port, server, close, state, reset, config }. All seven documented routes with every documented field, 40 per page with meta, Basic auth, expiry, cancel and refund rules, the eleven config switches, five fault modes (timeout, 500, 429, drop_after_commit, commit_after_delay), the Arabic RTL stand-in page (pay, fail, 3-D Secure, back), and the eight /__emulator/* routes. Guards: loopback and private peers only, local-host webhookUrl, callback_url, success_url and back_url, no Authorization header ever recorded, refuses a hosted SITE_URL.

Client (supabase/functions/_shared/payments/moyasar.ts): paymentsConfig() with the seven rules in order and nine reason codes, never throws or logs; moyasarClient classifies by HTTP status only (reads: unavailable, writes: uncertain), one 10 s timeout, non-UUID ids and non-positive-integer refund amounts refused with no call, zod parsing into the normalized types.

Tests: 363 new (emulator 199, client 164); the whole suite is 1011 passing. Lint, typecheck and check:copy are clean. Two audit-style hardenings were added now rather than later: an http(s)-only invoice url and a JSON-only control surface.

Contract points that need a ruling are under contractGaps, chiefly the stand-in page's failure flow and the listInvoices return shape. No Moyasar network call was made, no screenshots were produced, no file outside my five paths was touched, and nothing was committed.

Files: tests/support/moyasar-emulator.ts, tests/unit/moyasar-emulator.test.ts, supabase/functions/_shared/payments/moyasar.ts, tests/unit/moyasar-client.test.ts, docs/payments-runbook.md

Checks:
- `pnpm exec vitest run tests/unit/moyasar-emulator.test.ts tests/unit/moyasar-client.test.ts` → 0 (2 files, 363 tests passed (final state))
- `pnpm lint` → 0 (no errors, no warnings)
- `pnpm typecheck` → 0 (tsc --noEmit; also type-checks moyasar.ts through the tests' imports)
- `pnpm check:copy` → 0 (199 source files)
- `pnpm test` → 0 (50 files, 1011 tests passed)
- `node -e <spawn script>: spawn `node tests/support/moyasar-emulator.ts`, GET http://127.0.0.1:54390/v1/invoices with the local key, print status, kill` → 0 (200 with the key (empty list with meta), 401 without it; port 54390 free afterwards. An earlier attempt returned 127 only because my script called process.exit right after child.kill on Windows (libuv assertion); the emulator output was already correct, and the clean re-run is 0.)
- `SITE_URL=https://anas.studio node tests/support/moyasar-emulator.ts` → 1 (extra check: refuses with 'The Moyasar emulator refuses to run when SITE_URL names a hosted site.' (expected refusal). With SITE_URL=http://localhost:3000 it starts (killed by timeout 3, exit 124).)
- `deno check supabase/functions/_shared/payments/moyasar.ts` → -1 (SKIPPED: deno is not installed here, so the client is type-checked only by tsc via the test imports)

Contract gaps:
- Stand-in page flow (contract 9 says it redirects to success_url or back_url): built pay and 3-D approve to success_url, back to back_url; fail and 3-D reject keep the buyer on the page with an Arabic failure notice and the invoice stays payable (Moyasar's behaviour after a failed payment is open item 6). Orchestrator to rule if a failure should redirect to back_url.
- Contract 9 guards callback_url and success_url to local hosts; I also guard back_url, because the page redirects to it.
- Contract gives no return shape for listInvoices: built data = { invoices: MoyasarInvoice[]; nextPage: number | null }, so rounds 3/4 must read result.data.invoices.
- createInvoice(input) takes the snake_case literal of contract 7 (callback_url, success_url, back_url, expired_at as ISO string, metadata) and sends exactly those eight fields.
- Contract 1 rule 7: a PAYMENTS_TEST_ACCESS_CODE under 16 characters is TEST_CODE_REQUIRED (no separate code); testAccessCode is returned only for a hosted site in test mode.
- checkout.ts line 347 still reads PAYMENTS_MODE itself; contract 1 says it stops and uses paymentsConfig(). That is a later round and outside my paths.
- Additions beyond the contract, all safety or harness choices: refundPayment refuses a non-positive-integer amount locally (NaN or undefined would mean a full refund); redirect:'manual' so the key never follows a redirect; an invoice url must be http(s); a fractional fee is rounded, not refused; /__emulator/* POST bodies must be application/json (415 otherwise, blocks cross-origin simple requests from a browser tab).
- Harness choices where the docs are silent, listed in the runbook: invoice status follows only paid and refunded payments; a failed payment leaves it payable; payments copy the invoice's metadata; fee and captured are 0 (captured status captures in full); webhooks are sent only on payment creation and by /__emulator/webhook, never on refunds or dashboard edits; no webhook retries.

Open risks:
- Deno type-check not run (deno not installed). The client relies on AbortSignal.timeout, btoa, redirect:'manual' and Response.body.cancel(), all standard and partly already used by email.ts, but unproven under the Supabase runtime.
- Whether the Edge runtime container reaches the emulator at host.docker.internal:54390 when it listens only on 127.0.0.1 is not tested here (no Docker call). Standalone mode has no host option; round 3 may need one on some Docker setups.
- The emulator's undocumented-behaviour choices (listed in the runbook) are harness assumptions; only the real sandbox (E02) can confirm them.
- Timing-based tests (150 ms client timeouts, commit_after_delay 150 and 300 ms) passed twice, including a loaded full run, but could flake on a very slow machine.
- Webhook and callback deliveries are awaited (up to 8 s each) before the stand-in page redirects, so a slow local function delays the redirect in e2e.
- Real Moyasar may return a fractional fee or non-http payment urls: both are now handled, but an integer-only amount or refunded that Moyasar does not honour would make payments unreadable (unavailable) until the sandbox run shows it.

## Audit 1: audit_failed

### R1-F1 [medium] tests/support/moyasar-emulator.ts:908
- Problem: POST /__emulator/pay ignores the contract's `force` field. Contract section 9 defines the body as {invoiceId, status, amount?, currency?, force?}, where `force` is what lets a payment land on an expired, canceled or already paid invoice, and says an invoice past its expired_at 'refuses payment'. The emulator never reads `force`: every call pays, whatever the invoice state. The default is inverted, so later rounds' tests can create late or second payments by accident, and the refusal exists only on the stand-in page. The worker did not list this deviation in contractGaps; the test and the runbook pin the opposite of the contract.
- Evidence: harnessPay (lines 902-913) has no reference to body.force; line 908 comment: 'No expiry or cancel check: a payment that completes late is a case the tests need.' Grep for 'force' in the emulator returns nothing. Scratch probe against a started emulator: expired invoice, no force -> 200 payment paid; canceled -> 200 paid; already paid -> 200 paid; `force:false` -> 200 paid in all three; the paid invoice ended with 3 payments. tests/unit/moyasar-emulator.test.ts:630-639 asserts 'does not check the invoice state'. docs/payments-runbook.md:94 documents the route without `force` and says 'It does not check the invoice's state'.
- Correction: In harnessPay read `force` (400 when present and not a boolean). Without `force: true`, refuse (409 with {error}) when the invoice, after expireIfDue, is not `initiated`: no payment created, no delivery sent. Keep today's behaviour only under `force: true`. Replace the test at moyasar-emulator.test.ts:630 with: refused without force for expired, canceled and paid (payments unchanged, receiver empty), accepted with force for each; add `force: true` to the tests that pay a paid invoice on purpose (e.g. line 1061-1066). Update runbook line 94 to the contract's body and wording.

### R1-F2 [low] tests/support/moyasar-emulator.ts:563
- Problem: The emulator turns a paid invoice `refunded` whenever one of its payments becomes `refunded` (also after a partial refund), with no switch, and both the code comment and the runbook present this as a case 'where the documentation is clear'. It is not documented: contract section 2 open item 6 lists the invoice's status after a refund as unknown, and the evidence file lists invoice status transitions under 'Not documented (so not assumed)'.
- Evidence: emulator lines 549-553 ('The invoice follows its payments only where the documentation is clear: ... a refunded one marks a paid invoice refunded') and 563-566. docs/payments-runbook.md:135 repeats the sentence. Probe: partial refund of 1000 on a 6900 payment -> payment `refunded`, GET invoice -> `refunded`. artifacts/acceptance/P08/moyasar-docs-2026-10-02.md line 59: 'The meaning of each invoice status and their transitions (only expired is explained)'. Nothing in the contract's code path branches on an invoice status of `refunded`, hence low.
- Correction: Reword the comment and runbook line 135: only 'a paid payment pays a payable invoice' is documented (the callback page); the move to `refunded` is a harness choice awaiting E02 item 6. Either drop the transition (leave the invoice `paid`, set it with /__emulator/invoice when a test needs it) or keep it and say plainly it is undocumented.

### R1-F3 [low] tests/support/moyasar-emulator.ts:1018
- Problem: The 'no foreign web page can drive the harness' guard does not hold for bodiless control calls. The content-type rule is skipped when the body is empty, and POST /__emulator/reset takes no body, so a cross-origin 'simple' POST from any page open in the developer's browser wipes the emulator's state mid-run. Neither Origin nor Host is checked on the harness routes, so a DNS-rebinding page is same-origin and passes the JSON rule too.
- Evidence: Line 1018: `if (text.trim() !== '' && !/^application//json/b/i.test(...))`; lines 1036-1038 run reset() with no body. Probe on the standalone emulator: created an invoice (201), then `POST /__emulator/reset` with no body, no content type and `Origin: https://evil.example` -> 200, invoices left: 0. The claim is at lines 1016-1017 and docs/payments-runbook.md:90. Impact is a local test harness with no secret and no money, hence low.
- Correction: For every /__emulator/* request and the stand-in action POST: refuse (403) when the Host header's hostname is not in LOCAL_HOSTS, and refuse a request whose Origin header is present and not a local host; require application/json on every harness POST, empty body included. Add a test for a bodiless reset with a foreign Origin and for a foreign Host.

### R1-F4 [low] tests/support/moyasar-emulator.ts:880
- Problem: The stand-in page does not redirect after a failed payment or a rejected 3-D Secure step; it stays on the page. Contract section 9 says the page 'creates the payment, sends the webhook and the callback as configured, then redirects to success_url or back_url'. The worker reported this for a ruling; it is still a contract deviation until ruled.
- Evidence: Lines 869-874 (`finish` redirects only when payment.status === 'paid', otherwise renders a notice), 880 and 892. Test moyasar-emulator.test.ts:1289-1298 pins status 200 and the page text. Moyasar's own behaviour after a failed payment is open item 6, so neither reading is provable today.
- Correction: Orchestrator to rule. Either amend contract section 9 to say a failure stays on the page with the invoice still payable (what the e2e 'failed' journey then clicks through), or redirect a failure to back_url and adjust the test and runbook lines 82-83.

### R1-F5 [low] supabase/functions/_shared/payments/moyasar.ts:293
- Problem: A secret key holding a character outside Latin-1 passes paymentsConfig() (rule 3 checks only the prefix, line 86) and then makes moyasarClient() throw at construction, outside the client's try/catch. A misconfiguration becomes an unhandled exception in every handler that builds the client, instead of a reason code.
- Evidence: Line 293: `btoa(`${config.secretKey}:`)`. Probe: moyasarClient({ baseUrl, secretKey: 'sk_test_☃' }) -> throws InvalidCharacterError. No test covers it. Real keys are ASCII, hence low.
- Correction: In rule 3 require the whole key to be printable ASCII (for example /^sk_(test|live)_[/x21-/x7e]+$/ matched against the mode) and answer KEY_MODE_MISMATCH otherwise; add the case to the rule 3 test table.

### R1-F6 [low] tests/unit/moyasar-client.test.ts:673
- Problem: Two tests assert 'nothing has happened yet' inside a 150 to 300 ms window after a commit_after_delay fault. On a loaded machine the follow-up request can take longer than the delay and the test fails for no product reason (a false failure, never a false pass).
- Evidence: moyasar-client.test.ts:673-683: delayMs 300, then a fetchPayment that must return refunded 0 before the commit lands. moyasar-emulator.test.ts:932-938: delayMs 150, then state().invoices must be empty. Both passed in three runs here (twice alone, once in the full suite of 50 parallel files); the worker lists the same risk.
- Correction: Raise the delay to 1000 ms or more in both tests (the later waitFor already allows 3 s), or assert the order from the call log instead of from wall-clock timing.

### R1-F7 [low] .env.example:73
- Problem: Round-0 file (the orchestrator's, not the worker's): the comment tells the owner the sandbox visitor arrives with `?test=<this code>`. Contract section 1 fixes the code in the URL fragment (`#test=<code>`) precisely so that it never reaches a server log. A link built from this comment would put the access code in query strings and logs.
- Evidence: .env.example:73 '# with ?test=<this code>.' against PLANS/P08-CONTRACT.md:49 'the store pages read #test=<code> from the URL fragment once into sessionStorage ... (a fragment never reaches a server log)'.
- Correction: Change the comment to `#test=<this code>` (orchestrator fix, outside the worker's paths).

Checks re-run:
- `pnpm exec vitest run tests/unit/moyasar-emulator.test.ts tests/unit/moyasar-client.test.ts` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0
- `pnpm test` → 0
- `node <scratchpad>/smoke.mjs (spawns `node tests/support/moyasar-emulator.ts`, GET http://127.0.0.1:54390/v1/invoices with the local key -> 200 with empty list and meta, without the key -> 401, webhookUrl and webhook secret are the local values, child killed, port free)` → 0
- `SITE_URL=https://anas.studio node tests/support/moyasar-emulator.ts (expected refusal: 'The Moyasar emulator refuses to run when SITE_URL names a hosted site.')` → 1
- `pnpm check:frozen` → 0
- `node <scratchpad>/probe.mjs (force ignored on expired/canceled/paid; stalled 2xx body -> unavailable for a read, uncertain for a write, status 200; a real 307 is not followed, 0 hits on the target; non-Latin-1 key throws; paymentsConfig with SITE_URL unset or scheme-less; after close() no active resources and the process exits on its own)` → 0
- `node <scratchpad>/reach.mjs (bodiless POST /__emulator/reset with a foreign Origin -> 200 and state wiped; `docker exec supabase_edge_runtime_ANASAQ.ME` and `supabase_db_ANASAQ.ME` reach host.docker.internal:54390 -> HTTP/1.1 401 Unauthorized, i.e. the loopback-bound emulator is reachable from the stack's containers on this machine)` → 0
- `deno check supabase/functions/_shared/payments/moyasar.ts (not run: deno is not installed)` → -1

Uncovered:
- `deno check` of supabase/functions/_shared/payments/moyasar.ts was not run by anyone (deno is not installed); tsc covers the file only through the tests' imports, so AbortSignal.timeout, btoa, redirect:'manual' and Response.body.cancel() are unproven under the Supabase Edge runtime until round 3's HTTP tests call the real functions.
- paymentsConfig() when SITE_URL is unset or unparseable on a real deployment: isHostedSite() is false, so rule 6 applies. Probe: SITE_URL unset or 'anas.studio' (no scheme) with the real base, an sk_test_ key and a public https FUNCTIONS_PUBLIC_URL -> ok:true with no testAccessCode (the sandbox fence is off and EMULATOR_ON_HOSTED is never evaluated). The contract defines it this way and siteOrigin() is null in that state, so the Origin-checked functions fail closed; no test pins that pairing, and the 'garbage SITE_URL' test only asserts that nothing throws.
- The standalone branch (`import.meta.main`: port 54390, the default webhookUrl, exit code 1 on a hosted SITE_URL, SIGINT/SIGTERM shutdown) has no automated test; it was proven only by the manual smoke.
- No test fails if `redirect: 'manual'` is removed from the emulator's outbound deliveries (line 587): a local receiver answering a 3xx to a non-local host is not exercised, and neither is the 8 s delivery timeout ('timeout' error) or a delivery still in flight when close() or reset() is called.
- The client's real 10 s timeout is never exercised end to end: tests either replace the signal with a 150 ms one through the injected fetch or spy on AbortSignal.timeout. Nothing fails if the client later passed a different signal than the one it created for a body read (my probe with a real stalled body and a short injected signal did classify correctly).
- One unreadable nested payment makes the whole invoice unreadable (pinned by the test 'one nested payment that is unreadable'): if the real sandbox returns a non-charged sibling payment (initiated, failed) with a null fee or refunded, a paid invoice would read as `unavailable` and never settle until E02 shows the real shapes. Fail-safe, but untested against any real reply.
- The provider's ids inside a parsed reply (invoice.id, payment.id, invoice_id) are not checked for the UUID shape at parse time; a non-UUID id in payments[] is only caught when it is next put in a path, where it comes back as `refused` with no status and could be read by a caller as a provider 4xx. No test covers that hand-off.
- The emulator cannot produce a non-zero fee, a refund webhook on POST /v1/payments/:id/refund, or webhook retries; rounds 3 and 6 must drive `payment_refunded` and repeats by hand through /__emulator/webhook, and fee handling is proven only against stubs.
- Races inside the emulator (two simultaneous pay posts on one invoice, two simultaneous refunds over the remaining amount, a pay racing a cancel) hold by construction (no await between check and write) but have no test; a later refactor that adds an await there would not be caught.
- A refund with no amount after a partial refund answers 400 in the emulator ('full amount' is read as the payment amount, not the remainder); the documentation is ambiguous and there is no switch. The client always sends the amount, so nothing depends on it today.
- The three duplicated local strings (emulator key and webhook secret in moyasar.ts, the emulator, scripts/local-env.mjs and check-export.mjs) have no test tying them together; a change in one place would not fail a check.

## Worker report 2

Fixed R1-F1, F2, F3, F5 and F6. Left F4 (needs your ruling) and F7 (outside my paths) and listed them under contractGaps.

- **R1-F1 (medium).** `POST /__emulator/pay` now reads `force` (400 if present and not a boolean). Without `force: true` it answers 409 `{error}` for any invoice that is not `initiated` after `expireIfDue`: no payment is created and no webhook or callback is sent. `force: true` keeps the old behaviour. The old 'does not check the invoice state' test is replaced by refused-without-force and accepted-with-force tests for expired, canceled and paid. `force: true` was added to the second-payment test, plus a test that a refusal sends nothing to the receiver. Runbook updated to the contract's body and wording.
- **R1-F2.** The invoice no longer turns `refunded` after a refund. `mirrorInvoice` now only does the documented 'paid payment pays a payable invoice', and `refundPayment` no longer calls it. The tests and runbook are corrected, and E02 open item 6 is named as the reason.
- **R1-F3.** A new `isLocalRequest` runs on every non-`/v1` route: `Host` must be a local host, and `Origin`, when present, must be local too, otherwise 403. Every `/__emulator/*` POST now needs `application/json`, an empty body included (415 otherwise). New tests cover a bodiless reset with a foreign Origin, a foreign Host, and local Host and Origin values still passing. The runbook is updated.
- **R1-F5.** Rule 3 now requires `sk_<mode>_` followed only by printable ASCII, else `KEY_MODE_MISMATCH`. Added cases for a snowman, an accented `é` and a space, plus an ok case at the boundary characters that builds a client.
- **R1-F6.** `commit_after_delay` delay raised from 150 and 300 ms to 1000 ms in the emulator and client tests.
- **Checks.** All six checks above ended with exit 0 on the final tree. One typecheck failure along the way is described in its note.

Files: tests/support/moyasar-emulator.ts, tests/unit/moyasar-emulator.test.ts, tests/unit/moyasar-client.test.ts, supabase/functions/_shared/payments/moyasar.ts, docs/payments-runbook.md

Checks:
- `pnpm exec vitest run tests/unit/moyasar-emulator.test.ts tests/unit/moyasar-client.test.ts` → 0 (2 files, 378 tests passed (final tree))
- `pnpm lint` → 0 (final tree)
- `pnpm typecheck` → 0 (first run exited 2: TS2769 at tests/unit/moyasar-emulator.test.ts(1581,87), headers array inferred as a union with optional undefined, in my new test. Fixed with an Array<Record<string,string>> annotation; rerun exit 0.)
- `pnpm check:copy` → 0 (199 source files)
- `pnpm test` → 0 (50 files, 1026 tests passed)
- `node smoke-emulator.cjs (spawns `node tests/support/moyasar-emulator.ts`, GET http://127.0.0.1:54390/v1/invoices with the local key, then kills it)` → 0 (200 with {invoices:[],meta:{...total_count:0}}; the same call with no key gave 401; afterwards port 54390 refused connections (curl exit 7), so nothing is left running)

Contract gaps:
- R1-F4 NOT changed: it needs the orchestrator's ruling. Contract section 9 says the stand-in page redirects 'to success_url or back_url'. Today a failed payment or a rejected 3-D Secure step stays on the page (200) with the invoice still payable; only a paid one redirects. Option A: amend section 9 to say a failure stays on the page (no code change). Option B: redirect a failure to back_url: `finish` in standIn (tests/support/moyasar-emulator.ts:872-876), the tests 'fail: ...' (moyasar-emulator.test.ts:1354) and the reject step of the 3-D Secure test (:1391, expects 200), and runbook lines 82-83.
- R1-F7 NOT changed: .env.example is not in this round's write list. Orchestrator fix: .env.example:73 says `?test=<this code>`; contract section 1 fixes the code in the URL fragment, so it should read `#test=<this code>`.
- Contract section 9 does not yet say that every `/__emulator/*` POST must be sent as application/json even with an empty body (send `{}`), nor that Host and Origin must name a local host (R1-F3, as the finding ordered). Later rounds that call `POST /__emulator/reset` with no body (a Playwright `request.post(url)` with no `data`) now get 415. Worth one sentence in section 9.
- R1-F2: I took the 'drop the transition' option. A refund (or a dashboard refund) no longer turns the invoice `refunded`; it stays `paid`, and `/__emulator/invoice` sets `refunded` for a test that needs that reading. Contract section 9 names no such switch and I added none.

Open risks:
- Host check uses LOCAL_HOSTS only (localhost, 127.0.0.1, [::1], host.docker.internal), as the correction says. Opening the stand-in page from a phone on the LAN (Host = a LAN IP) now answers 403. The Moyasar `/v1` routes are not Host-checked: they sit behind the Basic key, and the Edge Functions reach them as host.docker.internal.
- Fix pass 1 touched only the five listed files. I did not run the new tests against the old code to watch them fail; I checked by reading that each would have failed on the defect.
- 'reset() cancels a commit that is still pending' (moyasar-emulator.test.ts) still uses a 150 ms delay. On a very loaded machine it could pass without exercising the cancel (a false pass, never a false failure). The finding did not name it; left alone.
- Screenshots: none were written or rewritten (unit tests and a smoke only).

## Audit 2: pass

### R1-F4 [low] tests/support/moyasar-emulator.ts:875
- Problem: Still open from the first audit, waiting for the orchestrator's ruling. The stand-in page does not redirect after a failed payment or a rejected 3-D Secure step: it stays on the page with the invoice still payable. Contract section 9 says the page 'creates the payment, sends the webhook and the callback as configured, then redirects to success_url or back_url'. The worker changed nothing here, as instructed.
- Evidence: `finish` (lines 872-877) redirects only when payment.status === 'paid' and otherwise renders a notice; the fail and reject paths are lines 883 and 895. tests/unit/moyasar-emulator.test.ts:1354-1363 and :1391-1394 pin status 200 and the invoice staying `initiated`. docs/payments-runbook.md:82-83 documents the same. Moyasar's behaviour after a failed payment is E02 open item 6, so neither reading can be proven today.
- Correction: Orchestrator to rule. Either amend contract section 9 to say a failure stays on the page with the invoice still payable (no code change), or redirect a failure to back_url in `finish` and adjust the two tests and runbook lines 82-83.

### R1-F7 [low] .env.example:73
- Problem: Still open from the first audit; a round-0 file outside the worker's paths. The comment tells the owner the sandbox visitor arrives with `?test=<this code>`. Contract section 1 fixes the code in the URL fragment (`#test=<code>`) so that it never reaches a server log. A link built from this comment would put the access code in query strings and logs, and the store pages would not read it.
- Evidence: .env.example:73 reads '# with ?test=<this code>. At least 16 characters. Unset it with the test keys.' against PLANS/P08-CONTRACT.md:49 'the store pages read #test=<code> from the URL fragment once into sessionStorage ... (a fragment never reaches a server log)'.
- Correction: Orchestrator fix: change the comment to `#test=<this code>`.

### R2-F1 [low] tests/support/moyasar-emulator.ts:587
- Problem: close() and reset() do not cancel a webhook or callback delivery that is still in flight. After close() the outbound socket and its 8-second abort timer stay open until the receiver answers or the timeout fires. After reset() the late delivery is written into the fresh delivery log, so the next test can see a delivery it never caused.
- Evidence: `post` (lines 576-602) passes only `AbortSignal.timeout(DELIVERY_TIMEOUT_MS)` to fetch and pushes its record after the await (line 600); close() (1097-1105) and reset() (1008-1017) clear only the `timers` set. Probe with a receiver that never answers: 300 ms after close() resolved, process.getActiveResourcesInfo() still held a TCPSocketWrap for the emulator's outbound call, and it emptied only when the receiver was closed. Second probe: /__emulator/pay in flight, reset(), deliveries 0, then once the stalled call ended state().deliveries held one `webhook payment_paid unreachable` record with payments 0. No test covers either case; the harness awaits deliveries before it answers, so only a stalled receiver triggers it, hence low.
- Correction: Keep one AbortController per emulator; send each delivery with `AbortSignal.any([controller.signal, AbortSignal.timeout(DELIVERY_TIMEOUT_MS)])`; abort it and replace it in reset() and abort it in close(); skip `deliveries.push` when the delivery was aborted. Add a test with a receiver that never answers for close() and for reset().

### R2-F2 [low] tests/support/moyasar-emulator.ts:1084
- Problem: Introduced by the R1-F3 fix. startEmulator accepts any `publicBase`, but the stand-in page now answers 403 unless the Host header names a local host. An emulator started with a non-local publicBase hands out invoice urls that can never be opened. The existing test starts one with such a base and only checks the string.
- Evidence: Line 1084 takes `wantedBase` unchecked; line 1062 refuses every non-/v1 request whose Host is not in LOCAL_HOSTS. Probe: publicBase 'http://192.168.1.50:54390' gave invoice url http://192.168.1.50:54390/invoices/<id>, and GET of that page with Host 192.168.1.50:54390 answered 403. tests/unit/moyasar-emulator.test.ts:326-334 starts with publicBase 'http://browser.example.test:8080/' and asserts only the url text. No planned round uses a non-local base, hence low.
- Correction: Refuse a publicBase that is not a local http(s) URL at start (`isLocalUrl`), the same rule as webhookUrl; change the test at :326 to a local host with another port (for example http://localhost:8080/) and add the refusal case. Say in the runbook that the page is reachable only under a local host name.

### R2-F3 [low] PLANS/P08-CONTRACT.md:448
- Problem: Contract section 9 does not state two rules the emulator now enforces after R1-F3: every `/__emulator/*` POST must carry `content-type: application/json` (an empty body included, 415 otherwise), and the control routes and the stand-in page refuse a Host or Origin that is not a local host (403). Later rounds' briefs are written from the contract, so a helper that calls `POST /__emulator/reset` with no body would fail without explanation.
- Evidence: tests/support/moyasar-emulator.ts:1023-1025 (415) and :1062 with isLocalRequest at :277-281 (403). Contract line 448 lists only the peer rule, the local targets and the Authorization rule. docs/payments-runbook.md:90 does document both rules. The worker reported the gap.
- Correction: Orchestrator: add one sentence to section 9 after the peer rule: control POSTs are JSON (`{}` when empty), and Host and Origin must name a local host.

Checks re-run:
- `pnpm exec vitest run tests/unit/moyasar-emulator.test.ts tests/unit/moyasar-client.test.ts (2 files, 378 tests passed)` → 0
- `pnpm lint` → 0
- `pnpm typecheck` → 0
- `pnpm check:copy` → 0
- `pnpm check:frozen` → 0
- `pnpm test (50 files, 1026 tests passed)` → 0
- `node <scratchpad>/a2-smoke.mjs (spawns `node tests/support/moyasar-emulator.ts`; GET http://127.0.0.1:54390/v1/invoices with the local key -> 200 with an empty list and meta; without the key -> 401; webhookUrl and webhook secret are the local values; child stopped; port free afterwards)` → 0
- `SITE_URL=https://anas.studio node tests/support/moyasar-emulator.ts (expected refusal: 'The Moyasar emulator refuses to run when SITE_URL names a hosted site.')` → 1
- `node <scratchpad>/a2-probe.mjs (a delivery answered 307 is recorded and not followed, 0 hits on the target; no Host header -> 403; 3-D Secure approve after expiry -> 409; close() cuts a held timeout call and a pending commit; paymentsConfig edges: live key on a local site -> LIVE_ON_LOCAL, live key in test mode -> KEY_MODE_MISMATCH, emulator values on a hosted site -> BAD_BASE_URL, key with a trailing newline -> KEY_MODE_MISMATCH, real base with a query or upper-case host -> BAD_BASE_URL)` → 0
- `node <scratchpad>/a2-probe2.mjs (non-local publicBase -> stand-in page 403; a stalled delivery lands in the delivery log after reset())` → 0
- `deno check supabase/functions/_shared/payments/moyasar.ts (not run: deno is not installed on this machine)` → -1

Uncovered:
- `deno check` of supabase/functions/_shared/payments/moyasar.ts has still been run by nobody (deno is not installed). tsc covers the file only through the tests' imports, so AbortSignal.timeout, btoa, redirect:'manual' and Response.body.cancel() stay unproven under the Supabase Edge runtime until round 3's HTTP tests call the real functions.
- The standalone branch (`import.meta.main`: port 54390, the default webhookUrl, exit code 1 on a hosted SITE_URL, SIGINT/SIGTERM shutdown) has no automated test; it is proven only by the manual smoke.
- No test fails if `redirect: 'manual'` is removed from the emulator's outbound deliveries (moyasar-emulator.ts:591); my probe confirmed a 307 is not followed, but nothing pins it. The 8-second delivery timeout ('timeout' error) is not exercised either.
- The client's real 10-second timeout is never exercised end to end: tests replace the signal with a 150 ms one through the injected fetch, or spy on AbortSignal.timeout. Nothing fails if the client passed a different signal to the body read than the one it created.
- The Moyasar `/v1` routes have no peer, Host or Origin guard (the contract guards only the harness). An unauthenticated call from any origin answers 401 but is still written to the call log with its body (probe: +1 call). A test that counts calls by route without filtering on status could be skewed; no test pins this.
- paymentsConfig() when SITE_URL is unset or unparseable on a real deployment: isHostedSite() is false, so rule 6 applies and the sandbox fence and EMULATOR_ON_HOSTED are never evaluated. The contract defines it this way; no test pins that pairing.
- On a hosted site `https://localhost./functions/v1` (trailing dot) and `https://127.0.0.2/functions/v1` pass as a public callback base, because 'non-local' is exactly LOCAL_HOSTS. A bare `sk_test_` key with nothing after the prefix also passes rule 3. Both harm only the misconfigured site; neither is tested.
- One unreadable nested payment makes the whole invoice unreadable (pinned by a test). If the real sandbox returns a sibling payment with a null `fee` or `refunded`, a paid invoice would read as `unavailable` and never settle until E02 shows the real shapes.
- Provider ids inside a parsed reply (invoice.id, payment.id, invoice_id) are not checked for the UUID shape at parse time. A non-UUID id in payments[] is caught only when it is next put in a path, where it comes back as `refused` with no status. No test covers that hand-off.
- The emulator cannot produce a non-zero fee, a refund webhook on POST /v1/payments/:id/refund, webhook retries, or a delayed-but-delivered reply (a late 201). Rounds 3 and 6 must drive `payment_refunded` and repeats through /__emulator/webhook and prove the late 201 with injected stubs.
- Races inside the emulator (two simultaneous pay posts on one invoice, two simultaneous refunds over the remaining amount, a pay racing a cancel, a reset during a stand-in action) hold by construction but have no test.
- A refund with no amount after a partial refund answers 400 in the emulator ('full amount' is read as the payment amount, not the remainder). The documentation is ambiguous and there is no switch; the client always sends the amount.
- 'reset() cancels a commit that is still pending' (moyasar-emulator.test.ts:994-1000) uses a 150 ms delay and a 400 ms wait. On a very loaded machine it can pass without exercising the cancel: a false pass, never a false failure.
- The three duplicated local strings (emulator key and webhook secret in moyasar.ts, the emulator, scripts/local-env.mjs and scripts/check-export.mjs) have no test tying them together.
- supabase/functions/_shared/checkout.ts:347 still reads PAYMENTS_MODE itself. Contract section 1 makes paymentsConfig() the only reader; that change belongs to a later round and nothing fails on it today.

## The orchestrator's rulings and own audit (2026-10-02)

The Opus auditor failed the first build on one medium finding (R1-F1: `/__emulator/pay` ignored `force`) and passed the fix pass. I read the client (`supabase/functions/_shared/payments/moyasar.ts`) line by line and the emulator's delivery, reset, start and guard code, and re-ran the checks.

| Finding | Ruling |
|---|---|
| R1-F1, F2, F3, F5, F6 | Fixed by the fix pass; confirmed by the second audit. |
| R1-F4 (a failed payment stays on the stand-in page) | Accepted as built. Contract section 9 now says so: a paid payment redirects to `success_url`, back to `back_url`, a failure stays on the page with the invoice payable (a harness choice; sandbox item 6). |
| R1-F7 (`.env.example` said `?test=`) | Fixed by the orchestrator: `#test=`. |
| R2-F1 (a delivery in flight survived `close()` and `reset()`) | Fixed by the orchestrator: one abort controller per emulator; a cut delivery is not logged. |
| R2-F2 (a non-local `publicBase` gave links nobody could open) | Fixed by the orchestrator: refused at start; the test uses a local host. |
| R2-F3 (the contract did not state the JSON and Host rules) | Fixed: section 9. |

Found by the orchestrator, from the auditor's "uncovered" list:

- An invoice whose list of payments held one payment with a field missing was unreadable as a whole, so a paid invoice next to a failed sibling could never settle if the real API omits a field on it. The client now reads only `id` and `status` of the payments an invoice lists (the money facts always come from `fetchPayment`), and a missing `fee` (an estimate) reads as 0. Tests changed and added.

Checks on the final tree: `pnpm exec vitest run tests/unit/moyasar-emulator.test.ts tests/unit/moyasar-client.test.ts` 0 (380 tests); `pnpm test` 0 (50 files, 1028 tests); `pnpm lint` 0; `pnpm typecheck` 0; `pnpm check:copy` 0; `pnpm check:frozen` 0. The auditor's probe showed the Edge runtime container reaches the loopback-bound emulator at `host.docker.internal:54390`. `deno check` is not installed locally; CI runs it on push.

Left open, recorded: the client's 10-second timeout and the emulator's standalone branch are proven by probes, not by a test; the emulator cannot produce a non-zero fee or webhook retries (later rounds drive repeats through `/__emulator/webhook`).
