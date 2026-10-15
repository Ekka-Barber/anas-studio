# RESIDUALS-1, round R2a: the writer's brief

The writer: `sonnet-worker` (Claude Sonnet 5.5, effort max), a fresh agent. The orchestrator (Claude Opus 5.5, effort
max) holds `.anasaq-execution.lock` for this round (package RESIDUALS-1, round R2a, branch `agent/residuals-1` at
`708560a`, R1 committed). Do not create, edit or delete the lock. Windows 11, Node 24.19, pnpm 10.34.6, Supabase CLI
2.106.0, Docker Desktop with the development stack ANASAQ.ME running. Git Bash and PowerShell exist; no Deno (CI runs
`deno check`). The package's rounds: `SCOPE.md` beside this file; R1's record (`RECORD-R1.md`) shows how a round ends.

## Read first

`CLAUDE.md`, `AGENTS.md`, `PLANS/HANDOFF.md` ("Local stack", "Rules to keep"), `artifacts/acceptance/FABLE-AUDIT/REPORT.md`
Appendix B (the entries below), and each entry's block in `artifacts/acceptance/FABLE-AUDIT/work/waveA/digest.md` (or
`waveB`), found by its id: its EVIDENCE, IMPACT, FIX and PROOF. Where this brief decides otherwise, this brief wins.

## Write only these paths

- `supabase/migrations/20261015130000_residuals_r2a.sql` (new: every SQL change of this round, one file)
- `src/lib/admin-orders.ts`, `src/components/admin/AdminHome.tsx`, `src/components/admin/OrdersView.tsx` (item 3 only)
- tests: `tests/integration/refunds.test.ts`, `payment.test.ts`, `order-operations.test.ts`, `checkout.test.ts`,
  `outbox.test.ts`, `order-emails.test.ts`, `notify.test.ts`, `staff.test.ts`, `static-site.test.ts`, `stats.test.ts`,
  `cron-jobs.test.ts`; `tests/unit/admin-orders.test.ts`, `tests/unit/cron-jobs.test.ts`
- `docs/operations.md`, `docs/payments-runbook.md` (the paragraphs your items change)

Any other path: stop and report. `supabase/migrations/20261015120000_residuals_r1.sql` and every earlier migration stay
untouched: a function you change is created again in the new file.

## Never

Read or print `.env`, `supabase/functions/.env`, `.env.local`, `.claude/settings*.json` or `.mcp.json`. Touch `PLANS/`,
`_archive/`, `deploy/design/` or `artifacts/`. Run `supabase db reset`, `supabase start/stop`, `pnpm db:*`, `pnpm
backup`, `pnpm restore-check`, or any `docker` command except `docker restart supabase_edge_runtime_ANASAQ.ME` and
read-only `docker ps`/`docker inspect`. Reach Cloudflare or Moyasar. Install or upgrade a package. Commit, push, stash,
reset or switch branches. Spawn sub-agents. Poll (no sleep, until or tail loops): run each long command once, with a
timeout, or in the background with one completion notification.

## Rules that bind every item

- SQL: one forward migration, idempotent (`create or replace`; `drop ... if exists` for a changed signature or
  trigger), grants restated for every function it creates or replaces, `set search_path = ''`, the existing lock order
  kept. For each function you change, find its latest definition (search every migration; the newest file wins: for
  `checkout_price` and `checkout_create` that is R1's file) and change only what the item needs; a comment above it says
  which item changed what. Apply with `supabase migration up` (local). To try a repair, keep the file idempotent and
  re-apply it to the local database inside one transaction (a small `pg` script against `DB_URL` from `supabase status
  -o json`, refusing a non-loopback host), never with a reset.
- Smallest change that does the item; no new dependency; no abstraction for one use. Every refusal or reply the
  screens read keeps its shape unless the item says otherwise.
- Arabic product copy only where an item gives it; Latin digits; no em dash in product copy.
- Work in this order: the SQL items, `pnpm test:db`, then item 3's client part, then the checks. If your run is cut
  short, your last message says what is built, what ran, and what is left, as R1's writer did.

## The items

1. **CONTRACT-03 = DB-POST-06**, `refund_settle` (`20261002130000_refunds.sql:563`). Decided: in the stale-read branch
   (the provider's total below `before` and not below the origin), apply the not-landed branch's clock. Once `now() >=
   created_at + 15 minutes`: `refund_fail(id, 'PROVIDER_TOTAL_DECREASED')` and the `refund_total_decreased` owner alert,
   exactly as the decreased branch does (the total stayed below what was recorded). Before that: back off as the
   not-landed branch does (`check_count + 1`, the doubling capped at 60 minutes and at `created_at + 15 minutes`).
   Proof: `refunds.test.ts`, both sides of the 15 minutes.
2. **CONTRACT-10 = EF-MONEY-10**, `payments_kick` (`20261002100000_payment_core.sql:1671`). Decided: the `pg_net` call's
   `timeout_milliseconds` becomes 90000 (above the run's 60 s budget and one row), and its comment says why and that the
   hosted behaviour is checked at P11. Say how you verified it (a constant: reading is enough).
3. **CONTRACT-13 with DB-POST-08**, «تحتاج مطابقة»: `orders_alerts` (latest in
   `20261007110000_fable_audit_operations.sql`) and `src/lib/admin-orders.ts:213-250`. Decided: the count covers what
   `reconciliation_list` lists as needing a person; add what it leaves out today, by `reconciliation_list`'s own rules: the
   paid attempts the provider voided (the PROVIDER_STATUS reason) and the refunds in flight (`submitting` or `uncertain`;
   first check what M1a-3c already counts, and add only what is missing). The parser reads the new count, the sum
   includes it, and the comment at `admin-orders.ts:244` says exactly what the sum covers and what it leaves to the screen
   (the transient rows). The digest's "refuse `fulfillment_update` while the paying attempt is voided" is not built
   (recorded for the owner). Proof: `order-operations.test.ts`, each newly counted kind moves the count; `admin-orders.test.ts`,
   the parser and the sum; the two screens that show the count, if their text changes.
4. **DB-COMMERCE-04**, `finance.order_try_commit` (latest in `20261007100000_fable_audit_payments.sql`). Decided, the
   digest's fix: the stock check and the decrement go by the line's reservation (its preorder flag picks stock or
   capacity); a line without a reservation needs no stock. Check first that every line that takes stock has a
   reservation (round 4's rule), and say what you found. Proof: a variant whose fulfilment or stock column changed between
   the order and the payment commits by its reservation; every existing commit test stays green.
5. **DB-COMMERCE-06**, docs only. Decided: no mode-aware count (it would change the quote's core for a one-time
   transition). `docs/payments-runbook.md`, "Before live": a bullet that coupon uses and committed preorder units count
   orders of both modes, so a coupon or a preorder variant used in sandbox runs keeps those counts: use separate ones for
   the sandbox, or recreate them, before going live.
6. **DB-COMMERCE-08**, the products' build trigger (`20260927160000_catalog_and_checkout.sql:245`; the variants' fix at
   `20261002100000_payment_core.sql:76-86` is the model). Decided, the digest's fix: the statement trigger for insert
   and delete only; an update requests a build only when a public column changed and the product is or was published;
   `catalog_request_build` skips a row call for a variant whose product is not published. Proof: `static-site.test.ts`,
   a draft product's save, an unchanged save and a stale save request no build, a published product's title change does,
   a variant's price change on a draft product does not.
7. **DB-COMMERCE-09**, the coupon code (`checkout_price` and `checkout_create`, latest in
   `20261015120000_residuals_r1.sql`). Decided: the one normalization both use folds Arabic-Indic and Persian digits:
   `translate(upper(btrim(code)), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')`. Nothing else in the two functions
   changes; the Edge Function and the client stay as they are (the function's schema takes any characters, and the
   checkout page has 263 bytes of its budget left). Proof: `checkout.test.ts`, a code typed with each digit set applies.
8. **DB-CORE-04**, `outbox_attention` (latest in `20261007120000_fable_audit_second_pass.sql`). Decided: replayable
   rows (`exhausted`, `uncertain`) first, then the newest, so the 200 cap trims only rows past acting on. Proof:
   `outbox.test.ts`.
9. **DB-CORE-07**, `outbox_replay` (same file). Decided: `if v_ambiguous and not coalesce(p_accept_duplicate_risk,
   false) then`. Proof: `outbox.test.ts`, a null past the 23-hour window is refused as false is.
10. **DB-OPS-03 = EF-ACCESS-05**, the purge of pending notification rows (`20261002150000_notifications.sql:423` and
    its latest definition). Decided: a pending row is aged by `greatest(n.updated_at, coalesce(n.confirm_sent_at,
    n.updated_at))`, so the row lives as long as the link its mail carries. Proof: `notify.test.ts`, a row whose
    confirmation was queued late lives 7 days from that mail.
11. **DB-OPS-04**, `notify_subscribe` (its latest definition). Decided, the digest's fix: when the `for update` finds
    no availability row (the purge removed it), insert it again (`on conflict do nothing`) and lock it, until a row is
    held; then on as now. Proof: `notify.test.ts`, two connections in the digest's order.
12. **DB-OPS-06**, `notify_confirm_backlog`. Decided: it iterates with `for update skip locked`, so a row a sign-up
    holds is left for that sign-up or the next hour. Proof: `notify.test.ts`, a row locked on another connection is
    skipped, and nothing waits.
13. **DB-OPS-07**, suppressed addresses (`finance.email_suppressions`). Decided, the digest's fix: the availability
    sweep's due rows skip a suppressed address, and `notify_confirm_queue` (latest in `..._second_pass.sql`) answers
    `address` for one before any allowance is taken. Proof: `notify.test.ts`.
14. **DB-POST-09**, the release of a preorder reservation on a full refund (`20261002170000_stats_disputes.sql:200` and
    its latest definition). Decided, the digest's fix: release it only while no fulfilment of that order's line of that
    variant is `shipped` or `delivered`. Proof: a shipped line's full refund keeps its reservation, an unshipped one
    releases it (`refunds.test.ts` or `stats.test.ts`, wherever the release is tested today).
15. **EF-ADMIN-13**, the outbox's attempt result (`20260930140000_audit2_fixes.sql:593` and its latest definition).
    Decided, the digest's fix: a row that had any uncertain attempt stays `uncertain`, never `pending`, so the claim's
    23-hour guard applies. Proof: `outbox.test.ts`.
16. **P08-CKPT-04**, `payment_attempt_begin` (`20261002100000_payment_core.sql:772` and its latest definition). Decided,
    the digest's fix: the order's active attempt is answered (state `pending`, its URL) before the HOLD_EXPIRED check;
    HOLD_EXPIRED stays for a new attempt. Proof: `payment.test.ts`, a pending attempt with 30 seconds of hold left
    answers `pending` with its URL; the existing case at `payment.test.ts:762` (30 seconds left, no active attempt)
    stays HOLD_EXPIRED. (The contract's order of answers is the orchestrator's to update.)
17. **P08-CKPT-07**, tests only: `refunds.test.ts` races `refund_result` and `refund_settle` for one refund, as the
    digest's FIX describes, three rounds.
18. **TEST-E2E-03**, `staff_directory` (`20260925090000_audit_and_staff_directory.sql:71` and its latest definition).
    Decided: ordered `active desc, created_at desc`, so the newest active staff are never the ones cut. Proof:
    `staff.test.ts`.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:copy`, `pnpm check:frozen`;
2. `supabase migration up` (local), then `pnpm test:db` (all files; set `TEST_ENV=local` and `DATABASE_URL` from `supabase
   status -o json`, never printing it);
3. for one SQL item in each group (refunds, notifications, outbox, checkout, commit, attempt), a mutation: revert the
   item's change in the migration, re-apply, run its test file, see it fail, restore and re-apply. Report each;
4. if item 3 changed what a screen shows: free memory at least 10 GB, then `pnpm exec playwright test
   tests/e2e/orders-admin.spec.ts tests/e2e/owner-operations.spec.ts` once (Playwright on `http://localhost:3000`;
   restore `next-env.d.ts` afterwards);
5. `pnpm build`, `pnpm check:export`, `pnpm check:budgets` (the three largest pages).

The report: per item, what changed (files and lines), every decision you took inside this brief and why, the proof
that ran and the mutation that failed it, the exact commands with exit codes and counts, anything not done and why, and
the risks left. Do not accept your own work; the orchestrator and an Opus auditor read the diff.
