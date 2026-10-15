# RESIDUALS-1, round R2a: the record

Started on the owner's word (2026-10-15: "Start R2a: one fresh Sonnet worker (effort max) on brief-R2a.md, an Opus
audit, under the lock."). Orchestrator Claude Opus 5.5 at effort max, on the owner's machine. The lock moved from R1 to
R2a on 2026-10-15 (base `708560a`, R1 committed and pushed, CI green on `708560a`, run 38749190503), with R2a's 25 exact
paths; added before they were written, with the reason in the lock: `tests/e2e/orders-admin.spec.ts`,
`docs/development.md`, `src/components/admin/EmailView.tsx`. Committed on the owner's word (2026-10-15: "Yes: commit R2a
on agent/residuals-1 (explicit paths only, not the .claude files), push the branch for CI, keep the lock, then brief
R2b."): the code as `5dcabd7`, these records in the commit after it, by explicit path; the branch pushed for CI; the
lock kept for R2b.

## Scope

R2a is the database half of R2 (`SCOPE.md`; R2's 25 entries split by layer after R1's writer reached the end of its run
before its checks did): CONTRACT-03 (= DB-POST-06), CONTRACT-10 (= EF-MONEY-10), CONTRACT-13 with DB-POST-08,
DB-COMMERCE-04, -06, -08, -09, DB-CORE-04, -07, DB-OPS-03 (= EF-ACCESS-05), DB-OPS-04, -06, -07, DB-POST-09,
EF-ADMIN-13, P08-CKPT-04, P08-CKPT-07, TEST-E2E-03. The decided fixes are in `brief-R2a.md`.

## 1. The writer

A fresh `sonnet-worker` (Claude Sonnet 5.5, effort max), 76 minutes, 262 tool calls: all 18 items in one migration,
`supabase/migrations/20261015130000_residuals_r2a.sql` (19 functions created again from their latest definitions, one
column, two triggers), with `src/lib/admin-orders.ts` (the count's parser, sum and comment), its tests and the two
runbooks. Departures it reported, ruled below: item 3 adds `providerStatus` (the voided paid attempts, less those
`externalRefunds` counts) and no refund kind (M1a-3c already counts the uncertain and the unscheduled ones); item 16
skips HOLD_EXPIRED only for a `pending` attempt whose invoice can still be paid; item 15 adds a column,
`finance.email_outbox.possibly_sent`. Its checks: lint, typecheck, copy, frozen 0; unit 2,632 passed and 39 skipped;
`test:db` 908 of 908; `orders-admin.spec.ts` and `owner-operations.spec.ts` 73 passed; build, export and budgets green
(`checkout.html` 149.7 KiB); a mutation per SQL item, each caught. To let the outbox tests claim mail it moved the day's
86 earlier sends back one day and restored all 86 (the local outbox keeps the provider's daily allowance).

## 2. The orchestrator's read

Each of the 19 functions extracted from its previous latest definition and diffed against the new copy
(`scratchpad/fn-extract.cjs`): only the item's lines moved (1 to 14 lines each). The money paths read in full:
`refund_settle`, `refund_succeed` (the preorder release), `payment_attempt_begin`, `order_try_commit`, `outbox_result`,
`outbox_claim`, the coupon fold in `checkout_price` and `checkout_create`; `notify_subscribe`'s loop (it can turn again
only if a purge deletes the row again each time); the products' triggers and `catalog_request_build`'s skip.

## 3. The audit, the fix round and the check

A fresh Claude Opus 5.5 auditor at effort max (`audit-brief-R2a.md`): **audit_failed**, on one major finding.

| Finding | Severity | Ruling | Done in |
|---|---|---|---|
| Item 3's count, item 16's narrowing | (departures) | Accepted | — |
| F1: a row that may have been sent could still go `pending` (a QUOTA or PROVIDER_CONFIG give-back, an in-window replay), escaping the 23-hour guard | major | Accepted | fix round: both give-back branches and `outbox_replay` keep it `uncertain`; four new tests, two changed from `pending` to `uncertain` (rows that had an uncertain attempt) |
| F2: rows already `uncertain` before the migration are not marked | minor | Accepted | fix round: a backfill after the new column |
| F3: item 1's clock could fail a refund PROVIDER_TOTAL_DECREASED from an out-of-order read, with a false alert, where NOT_APPLIED (which `refund_record_external` adopts) was right | minor | Accepted; the orchestrator revised its own item-1 ruling | fix round: a stale read at 15 minutes is `failed` NOT_APPLIED with no alert, exactly as the not-landed branch; below the origin stays a decrease with its alert |
| F4: the runbook still said a refund frees a preorder's capacity, false for a shipped line | minor | Accepted (docs) | fix round |
| F5: a digital preorder line whose variant was made physical could take stock | minor | Accepted | fix round: the line's own fulfilment in both loops of `order_try_commit` |
| F6: a deadlock between the backlog and a sign-up of the same address | minor | Accepted | fix round: a per-address advisory lock before the rate-limit takes, the backlog's try-lock |
| F7: the kick's 90 s did not cover the slowest row | minor | Accepted | fix round: 120 s |
| F8, F9: wording of the team list's and the mail list's caps | nit | Accepted | fix round |
| F10: the P08 contract described the old behaviour | nit | Accepted | the orchestrator (`PLANS/P08-CONTRACT.md`) |
| The e2e that summed the four old keys; the dev note on 1,000 staff rows | (known) | Accepted | the orchestrator |

The fix round (`brief-R2a-fix.md`): a fresh `sonnet-worker` (effort max), 44 minutes, 135 tool calls; `test:db` 917 of
917; mutations for F1 (5 tests failed), F5 (1) and F6 (2), the real file re-applied after each; it moved 107 of the
day's sends back for its runs and restored 98, the other 9 being test rows the outbox test file deletes in its own
setup. Then a fresh Claude Opus 5.5 check of the fix round (`audit-brief-R2a-fix.md`): **pass**, with two minor
findings and four nits, all taken by the orchestrator:

- minor 1: a possibly-sent row replayed inside its window now stays on the mail screen's list until the next run claims
  it; intended, so `docs/operations.md` and the comment in `EmailView.tsx` say so;
- minor 2: no test pinned the address lock before the rate-limit rows (what removes F6's cycle): the test now probes,
  while the sign-up waits on the lock, that both allowance rows can be locked (`for update nowait`); with the lock
  moved below the takes the test fails, «could not obtain lock on row in relation "rate_limits"» (55P03), and passes
  with the real file;
- nits: the kick's comment and the runbook name 110 s as the usual worst row, not a bound; two comments in
  `order_try_commit`; the outbox's wording in `docs/operations.md`; F2's backfill does not mark `exhausted` rows whose
  last attempt was uncertain, recorded (before launch no such row exists outside tests, and the hosted database starts
  from the migrations).

Also recorded: the fulfilment guard while a paying attempt is voided (the digest's "consider"), the owner's to decide;
a deploy applies this migration before the site (the admin's parser now expects `providerStatus`); the 120 s kick is
checked on the hosted project at P11.

## 4. Checks on the final tree

- `pnpm lint`, `pnpm typecheck`, `pnpm check:copy`, `pnpm check:frozen`: 0. `pnpm test`: 71 files, 2,632 passed and 39
  skipped.
- The migration re-applied to the local database in one transaction after the orchestrator's comment edits; the
  migration history holds `20261015130000`.
- `pnpm test:db` (all files): 886 passed and 31 failed, every failure in the three mail files (`outbox.test.ts` 24,
  `email-delivery.test.ts` 6, `order-emails.test.ts` 1), because the day's local allowance was spent (100 sends today:
  every claim came back empty). With today's 100 sends moved back one day and the three files run again: 97 of 97, and
  all 100 restored by id, none missing (`scratchpad/allowance.cjs`). So all 917 tests passed across the two runs; the
  fix round's own full run on a freed allowance was 917 of 917.
- The strengthened lock test and its mutation (the lock moved below the takes): failed with 55P03 on the mutant, passed on
  the real file.
- No client file changed after the writer's build (`EmailView.tsx` took a comment): its build, export and budgets stand
  (`checkout.html` 149.7 KiB), and the one e2e line the orchestrator changed (`orders-admin.spec.ts`, the sum) is typed
  and adds a key that is 0 locally.

## 5. The local database

Test data only, and heavily polluted by the day's runs: about 46,000 open outbox rows; at the default 5 s test timeout,
two old outbox tests time out on it (S04.2's ten-claim loops), and pass with a longer timeout. The package's acceptance
battery starts from `supabase db reset` and the two imports, on the owner's word (D48).
