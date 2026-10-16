# RESIDUALS-1, round R4c: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R4c, branch `agent/residuals-1` with R1 to
R4b committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI 2.106.0,
Docker Desktop with the development stack ANASAQ.ME running; Git Bash and PowerShell; no Deno. The package's rounds:
`SCOPE.md` (R4c: the tests); how the earlier rounds ended: `RECORD-R1.md` to `RECORD-R4b.md`.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `docs/development.md` (the test runs),
and each entry's block by its id in `artifacts/acceptance/FABLE-AUDIT/work/waveB/digest.md`: TEST-DB-04, TEST-UNIT-12,
TEST-DB-05, TEST-E2E-04, -07, -09, -13, -16, TEST-UNIT-02, -04, -13 and VENDOR-PAY-09. The line numbers there are from
before R1: find each spot by its text. Where this brief decides otherwise, it wins.

## Write only these paths

- `tests/integration/support.ts`, the new `tests/integration/local-db.ts` (item 1, if needed),
  `buyer-retention.test.ts`, `cron-jobs.test.ts`, `static-site.test.ts`, `outbox.test.ts`, `email-delivery.test.ts`,
  `order-emails.test.ts`, the new `tests/integration/table-grants.test.ts`
- `tests/e2e/store-admin.spec.ts`, `owner-operations.spec.ts`, `order-page.spec.ts`, `orders-admin.spec.ts`,
  `no-js.spec.ts`, `product-availability.spec.ts`, `helpers.ts`, the new `tests/e2e/global-teardown.ts`;
  `playwright.config.ts` (item 6's teardown only)
- `tests/unit/admin-function.test.ts`, `collections.test.ts`, `resend-webhook.test.ts`, the new
  `tests/unit/turnstile-actions.test.ts`
- `scripts/check-budgets.mjs`
- `docs/development.md` (items 1, 6 and 7)

Any other path: stop and report. No product code changes in this round.

## Never, and the rules

As `brief-R2a.md`'s "Never" and "Rules that bind every item", word for word, except its SQL rule (no SQL changes),
with these additions: a test that proves something must be shown to fail when that thing breaks (a mutation, reverted
and checked identical after); no test may leave the shared local database dirtier than before (what it changes, it
restores, by id); the local outbox's daily allowance may be spent: as in `brief-R2b.md`. Work in the order below. If
your run is cut short, your last message says what is built, what ran, and what is left.

## The items

1. **TEST-DB-04 with TEST-UNIT-12, which database the tests reach.** Decided: one check, used by every integration
   file that connects with `pg`: the URL is `DB_URL` from this project's `supabase status -o json`, and a
   `DATABASE_URL` that is set must name the same host and port, or the run stops with a sentence that says so. The pg
   helpers of `support.ts` use that checked URL (no hard-coded fallback), and `buyer-retention.test.ts`,
   `cron-jobs.test.ts` and `static-site.test.ts` use it too. If importing `support.ts` would make those three need the
   edge runtime or the API (CI runs them without the edge runtime), put the check in the new `local-db.ts` and import it
   from both. `docs/development.md` says so in one sentence. Proof: a mutation (accept any loopback URL) is caught by a
   unit-level check of the function (a different port refused; the same host and port accepted).
2. **TEST-DB-05, mail the tests park.** Decided: each test file that pushes other pending, uncertain or sending mail
   out of the way (`outbox.test.ts`'s park helper; `email-delivery.test.ts` and `order-emails.test.ts`'s equivalents)
   records the ids it moved with their old `next_at` and `first_attempt_at`, and restores exactly those in `afterAll`;
   rows created after the file started are left to their own tests. Proof: run the three files, then count the rows
   whose `next_at` is more than 12 hours ahead and that the files did not create: the same as before the run.
3. **TEST-E2E-04, tests that can run alone.** Decided: `store-admin.spec.ts`'s fixture product and variant and
   `owner-operations.spec.ts`'s contact and notice are made in a `beforeAll` of their `describe` (as the P08 blocks of
   the same files do with `seed()`); the owner home's test makes its own sweep run instead of relying on the sweep
   test's. Proof: `pnpm exec playwright test tests/e2e/store-admin.spec.ts -g "stale save"` and one owner-operations
   test alone each pass (if the e2e step runs: see Checks).
4. **TEST-E2E-07, the notify double press.** Decided: after `await expect(line).toBeFocused()`, `order-page.spec.ts`
   asserts `expect(calls).toHaveLength(4)` again (the refresh and download checks of the same file already do).
5. **TEST-E2E-09, branches the database always took the same way.** Decided: `orders-admin.spec.ts`'s list test makes
   enough orders through the harness (at least 51 of its own, so «المزيد» shows) and follows the real cursor
   unconditionally; `no-js.spec.ts` publishes one fixture post in a `beforeAll` and unpublishes it in an `afterAll`, and
   reads it without JavaScript unconditionally; `product-availability.spec.ts`'s skip on a live privacy policy becomes:
   take the privacy policy off inside the test and restore it after (by id, in a `finally`). Proof: each test, with its
   branch now always taken.
6. **TEST-E2E-13, what a run leaves behind.** Decided: `owner-operations.spec.ts`'s `afterAll` deletes the
   `contact_notice` mail its own contact queued (`payload ->> 'contactId'` equal to its contact); and a Playwright
   `globalTeardown` (`tests/e2e/global-teardown.ts`, wired in `playwright.config.ts`) deactivates the staff the run
   created: the addresses `helpers.ts` mints (`<label>-<ms>-<random>@example.com`) whose `<ms>` is not older than the
   run's start (the config records it once in an environment variable), by the same path the integration harness's
   `stop()` uses. `docs/development.md`'s note on staff pile-up says so. Proof: the count of active staff before and
   after an e2e file's run is the same.
7. **TEST-E2E-16, the budget that measured no product page.** Decided: `scripts/check-budgets.mjs` fails when the
   export holds no product page under `out/store/` other than the `_` placeholder (CI seeds the demo catalog before the
   build, so CI holds one; a local build without `pnpm db:demo-catalog` fails with a sentence that says to run it), and
   prints one line, not a failure, when it measured no journal article (none is published in CI; P10's performance pass
   measures one): no page kind escapes silently. `docs/development.md` names both. Proof: run `pnpm check:budgets` on
   the current `out/` (passes), then on a copy of `out/` with the product pages removed (fails).
8. **TEST-UNIT-02, the statistics cache.** Decided: the test configures analytics (the environment the function reads:
   `ANALYTICS_TOKEN`, `CLOUDFLARE_ZONE_ID`, `SITE_URL`) with a stubbed `fetch` that counts analytics calls, and moves
   the faked clock between calls: after 1 minute no new analytics fetch; after 6 minutes a second one; 31 seconds after
   an `unavailable` answer a refetch. It asserts the fetch counts, not `generatedAt`. Proof: deleting the cache check,
   and swapping the two lifetimes, each fail it.
9. **TEST-UNIT-04, the Turnstile actions.** Decided: a new unit test reads each form's widget action from its source
   (`useTurnstile('<action>')` in `ContactForm.tsx`, `AvailabilityForm.tsx`, `CheckoutBody.tsx` (the checkout's form
   since R4a) and `OrderPage.tsx`) and the action its function expects (`expectedAction: '<action>'` in
   `_shared/contact.ts`, `notify.ts`, `checkout.ts`, `orders.ts`), and requires each pair equal: contact, notify,
   checkout, order-recover. No product code changes. Proof: renaming one side's literal fails it.
10. **TEST-UNIT-13, the columns the forms write.** Decided: a new `pnpm test:db` test (`table-grants.test.ts`) reads
    `information_schema.column_privileges` for the role `authenticated` and checks that every key each table config's
    `toRow` writes is granted for the write the form makes (INSERT for a new row, UPDATE for an edit); the hand-copied
    `GRANTED` list and its test leave `collections.test.ts`. Proof: the test passes, and a config key that is not granted
    (added in a scratch copy, never committed) fails it.
11. **VENDOR-PAY-09, the Svix signature against Svix's own example.** Decided: one case in `resend-webhook.test.ts`
    calls `verifySvixSignature` with Svix's published example (docs.svix.com, "Verifying Webhooks Manually"): secret
    `whsec_plJ3nmyCDGBKInavdOK15jsl`, `svixId` `msg_loFOjxBNrRLzqYUf`, `timestamp` `1731705121`, `rawBody`
    `{"event_type":"ping","data":{"success":true}}`, `signatureHeader` `v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=`,
    and `now` at that timestamp: true (the orchestrator recomputed this HMAC locally: it matches). A changed body: false.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. `pnpm test:db` (all files; `TEST_ENV=local`, `DATABASE_URL` from `supabase status -o json`, never printed), with
   item 2's count before and after;
3. the mutations items 1, 7, 8, 9, 10 and 11 name;
4. only if free memory is at least 10 GB and there are fewer than 950 staff rows, once: `pnpm exec playwright test
   tests/e2e/order-page.spec.ts tests/e2e/no-js.spec.ts tests/e2e/product-availability.spec.ts
   tests/e2e/owner-operations.spec.ts tests/e2e/orders-admin.spec.ts tests/e2e/store-admin.spec.ts` (Playwright on
   `http://localhost:3000`; restore `next-env.d.ts` afterwards), then item 3's two single-test runs; otherwise say so and
   list the e2e tests you changed;
5. `pnpm build`, `pnpm check:export`, `pnpm check:budgets`.

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof that
ran and the mutation that failed it, the exact commands with exit codes and counts, what you moved and restored in the
database or the outbox, anything not done and why, and the risks left. Do not accept your own work.
