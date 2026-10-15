# RESIDUALS-1, round R2a: the auditor's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only. The writer was `sonnet-worker` (Claude Sonnet 5.5, effort
max). The orchestrator (Claude Opus 5.5, effort max) holds the lock, reads every money and migration line itself, and
rules on your findings.

## What to audit

The uncommitted diff on branch `agent/residuals-1` against `708560a`: `git diff 708560a` plus the untracked migration
`supabase/migrations/20261015130000_residuals_r2a.sql` (`git status --short`). `.claude/launch.json` and
`.claude/settings.json` are the owner's: never open them. The writer's brief, with the orchestrator's decided fixes, is
`artifacts/acceptance/RESIDUALS-1/brief-R2a.md` (18 items); each item's evidence is its block in
`artifacts/acceptance/FABLE-AUDIT/work/waveA/digest.md` or `waveB/digest.md`.

The migration creates again 19 functions, adds one column (`finance.email_outbox.possibly_sent`) and two triggers. Diff
every function against its previous latest definition (find it with `grep -ln` over `supabase/migrations/`, the newest
file wins; for `checkout_price` and `checkout_create` that is `20261015120000_residuals_r1.sql`): the item's change and
nothing else.

## What to verify

1. **Each item against its decided fix and its evidence.** The writer's departures, to rule on: item 3 counts the paid
   attempts the provider voided minus those `externalRefunds` already counts, and adds no refund kind (it reads M1a-3c's
   count as covering them; a `submitting` refund with a check scheduled is left to the job); item 15 adds a column
   `possibly_sent` instead of keeping a status, and leaves the QUOTA and PROVIDER_CONFIG branches as they were; item 16
   skips HOLD_EXPIRED only for a `pending` attempt whose invoice has not expired, not for `creating` or `uncertain` ones.
2. **Money and stock:** `refund_settle`'s new clock (can a refund that landed be failed, or one stay in flight for
   ever?); `order_try_commit` by the reservation (a line that takes stock without a reservation, a preorder line, a
   variant changed between the order and the payment, the lock order); the release of a preorder reservation on a full
   refund (item- and payment-level paths); `payment_attempt_begin`'s order of answers (a token forgotten, an invoice
   paid twice, an expired invoice handed out); the coupon fold (only the code's normalization changed in both
   functions; the quote hash unchanged).
3. **Mail and notifications:** the outbox's `possibly_sent` (every branch of `outbox_result` and the claim that can
   follow an uncertain attempt; the 23-hour guard; a replay that rotates the key; the column's grants and default);
   `outbox_attention`'s order; `outbox_replay`'s null; the notification purge's clock, `notify_subscribe`'s loop (can it
   spin?), the backlog's `skip locked`, the suppressed addresses.
4. **Triggers:** the products' update trigger and `catalog_request_build`'s skip (a publish, an unpublish, a slug change,
   a stale save, an insert or delete of a draft, a variant of a product that moves between draft and published).
5. **`staff_directory`**, `payments_kick`'s timeout, `orders_alerts`' new key and the client's parser and sum
   (`src/lib/admin-orders.ts`), and any other reader of `orders_alerts` (e2e specs included).
6. **Grants and safety:** every function keeps its `security definer`, `search_path`, revokes and grants; the new column
   is not readable where it should not be; nothing new is callable by `anon`.
7. **The tests prove what they claim**, and the docs claim nothing beyond what is built. Known to the orchestrator:
   `tests/e2e/orders-admin.spec.ts:1189` sums the four old keys (passes while `providerStatus` is 0);
   `docs/development.md:365-366` still says a new invite is hidden past 1,000 staff rows.

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no `docker` and no `supabase`
command: the orchestrator runs every check. `git diff`, `git show`, `git log`, `grep` and reading files are yours. No
polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Then what no test covers. Short and exact; no hedged verdict.
