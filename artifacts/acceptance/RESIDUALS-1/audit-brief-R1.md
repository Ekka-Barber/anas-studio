# RESIDUALS-1, round R1: the auditors' brief

Two fresh Claude Opus 5.5 auditors at effort max, read-only, each on one slice. The writer was `sonnet-worker`
(Claude Sonnet 5.5, effort max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, reads every money,
security and migration line itself, and rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against `2937c75`: `git diff 2937c75` plus the untracked migration
`supabase/migrations/20261015120000_residuals_r1.sql` (`git status --short`). `.claude/launch.json` and
`.claude/settings.json` were dirty before the round and are the owner's: never open them.

The writer's brief, with the orchestrator's decided fixes, is `artifacts/acceptance/RESIDUALS-1/brief-R1.md` (14
items); the round's scope is `SCOPE.md` beside it. Each item's evidence is named there (ISSUES entries in
`PLANS/ISSUES.md`; FABLE-AUDIT digests in `artifacts/acceptance/FABLE-AUDIT/work/wave{A,B,C}/digest.md`;
`artifacts/acceptance/FABLE-AUDIT/cloud/DEEP-AUDIT.md`; the P08 round files in `artifacts/acceptance/P08/rounds/`).

- **Slice A, the database and the Edge Functions:** the new migration (every function it creates or replaces, against
  that function's previous latest definition: find it with `grep -ln` over `supabase/migrations/`, the newest file
  wins); `supabase/functions/_shared/admin.ts`, `checkout.ts`, `email.ts`, `refunds.ts`,
  `supabase/functions/staff-admin/index.ts`, `supabase/config.toml`; and the integration and unit tests that prove them
  (`tests/integration/*`, `tests/unit/admin-function.test.ts`, `admin-refunds.test.ts`, `staff-admin-function.test.ts`,
  `email.test.ts`, `checkout.test.ts`).
- **Slice B, the client, the scripts and the documents:** `src/` (the admin's `CommerceSettingsForm`,
  `ReconciliationView`, `RefundView`, `MfaEnroll`, `StepUp`, `TeamView`, `CollectionForm`, `CollectionList`,
  `AdminShell`; `src/lib/admin-commerce.ts`, `admin-orders.ts`, `admin-money.ts`, `cart.ts`; the contact page; the
  store's `CartView`, `quote.ts`, `CheckoutForm`); `artifacts/soon/deploy.cjs` and its README;
  `tests/integration/support.ts`; the other unit tests and the e2e specs in the diff; `docs/operations.md`,
  `docs/development.md`.

Read across the boundary where a slice needs it (a client parser against the SQL that feeds it, a test against the
code it claims to prove).

## What to verify (each item of the brief that falls in your slice)

1. **Correctness against the brief's decided fix**, and against the item's evidence. Name any departure and whether
   it is better or worse.
2. **Money and stock (slice A):** `checkout_create`, `finance.checkout_price`, `reconciliation_list`,
   `commerce_settings_get`, `commerce_policies_approve` as rewritten: lock order unchanged and deadlock-free; every
   earlier fix in the replaced bodies kept (diff each against its previous definition line by line: AUDIT-1, AUDIT-2,
   P08 rounds, FABLE-AUDIT M1a to M2 and F3); grants, `security definer`, `search_path`, `revoke` from
   `public`/`anon`; the quote hash unchanged for an unrefused cart; `held` set exactly under `checkout_price`'s rule;
   `closedReviews` selects exactly the no-order payments closed by hand and not fully refunded, and both refund paths
   (`refund_request`, the external record) accept them and refuse what they should; the policy approval's comparison
   cannot be satisfied by a map the screen did not show (missing, extra, null, wrong type, a revision published in
   between), under concurrency with a publish (M2 item 8).
3. **Security (slice A):** FD-A-01's new branch in `staff-admin` (can a revoke now leave a member active, or report
   success while the ban did not hold? the audit row's truth); FD-A-02 (`expectedRefunded` required: every caller,
   including tests and e2e mocks; the request hash); the admin function's schemas (strict, bounded); error mapping
   (no SQL text leaks); `config.toml` comments true to what the settings do.
4. **The client (slice B):** the per-tab drafts (any path that still loses typed text, or offers another user's or
   another document's copy; sessionStorage blocked; a duplicated tab; the old key format; sign-out clearing); the
   never-saved list (another user's copies on a shared device; a copy whose document now exists); the contact email
   (only a valid address becomes a `mailto:`; the isolate; the no-JavaScript page); the refused line's name (escaping,
   length); the cart's city failure and retry (StrictMode double effect, a retry storm); the store settings' policy
   list and the approval's reload; the reconciliation section (empty, capped, test badge, controls); `MfaEnroll`'s
   sentence against both functions' real `STEP_UP_REQUIRED` cases; `TeamView`'s factor reading. Money pages stay calm
   (no new motion).
5. **Budget risk (slice B):** what the diff adds to the code of the checkout, orders and cart pages (`checkout.html`
   had 342 bytes of its 150 KiB budget left before the round). Estimate from the diff; do not build.
6. **Scripts (slice B):** `deploy.cjs` never prints a secret, takes the two variables from `.env` only, refuses
   without them, hands wrangler nothing else; `support.ts`'s staleness gate (command injection through `project_id`,
   the clock tolerance, a false pass, SQL-only files unaffected).
7. **The tests prove what they claim:** would each new test fail if its item's change were reverted? Conditional
   assertions that the data always sends one way; flakiness; cleanup of what they create.
8. **Documents:** no claim beyond what is built and proven.

Known to the orchestrator, for you to rule on too, not to rediscover: (a) `tests/e2e/orders-money.spec.ts:1288`, an
existing dispute test counted «لا شيء هنا.» 4 times and now sees 5 (the new section is always drawn); the writer
changed the expectation to 5 (lines 1313-1314), not yet re-run. (b) The new e2e "a no-order payment closed by hand
stays in its own section" (`orders-money.spec.ts` near :1246) failed after 6 s; cause not diagnosed. (c)
`tests/integration/orders-http.test.ts:343-351` sends `refund-create` without `expectedRefunded` and now gets 422
(outside the writer's paths; the orchestrator will fix it). Unrun so far: the SQL and e2e mutations, the staleness
gate's refusal shown live, the owner-alert mails on the real outbox path, the screenshots, the build and the budgets.

## Rules

Read-only: edit, create or delete no file anywhere. Never read or print `.env`, `supabase/functions/.env`,
`.env.local`, `.claude/settings*.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no `docker` and
no `supabase` command: an e2e batch is running on this machine against the local stack, and the orchestrator runs
every check itself. `git diff`, `git show`, `git log`, `grep` and reading files are yours. No polling loops.

## Report

A verdict for your slice, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit),
`file:line`, the evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged
verdict.
