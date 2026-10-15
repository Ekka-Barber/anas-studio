# RESIDUALS-1, round R2a: the fix check's brief

A fresh Claude Opus 5.5 auditor at effort max, read-only, on the fix round that followed R2a's audit. R2a's auditor failed
the round (`audit-brief-R2a.md`; its findings F1 to F10 are restated in `brief-R2a-fix.md` with the orchestrator's
rulings); a fresh `sonnet-worker` then made the eight fixes of `brief-R2a-fix.md`. The orchestrator rules on your
findings.

## What to check

The uncommitted tree on `agent/residuals-1` against `708560a` (`git diff 708560a` plus the untracked
`supabase/migrations/20261015130000_residuals_r2a.sql`). R2a's own items were audited already; check the fix round:

1. Each of the eight fixes against `brief-R2a-fix.md`, exactly: F1 in `outbox_result`'s give-back branches and in
   `outbox_replay` (every branch that can now leave a row `pending`, `uncertain` or `exhausted`, the 23-hour guard, a
   key rotation, `first_attempt_at`); F2's backfill; F3 in `refund_settle` (the three outcomes of the stale branch, and
   that `refund_record_external` adopts the NOT_APPLIED it now makes); F5 in `order_try_commit` (the line's own
   fulfilment in both loops; a physical or signed line is judged as before); F6's advisory lock (the key, its order
   against the rate-limit rows, the backlog's try-lock and `continue`, a lock taken twice in one transaction, and no new
   deadlock with the sweep or a sign-up); F7's timeout and comment; the P08-CKPT-07 race test (does it now overlap?);
   the wording of F4, F8 and F9.
2. Nothing else in the migration moved: diff each function the fixes touched against R2a's audited text where you can
   (the auditor's report quoted line numbers), and against its previous latest definition.
3. The tests: each new or changed test fails if its fix is reverted; the tests changed from `pending` to `uncertain` are
   the rows that had an uncertain attempt; no assertion was loosened.
4. The docs in `docs/operations.md` claim nothing beyond the code. Known and the orchestrator's: `docs/payments-runbook.md`
   lines 181 and 259 (the kick's 120 s; the stale read's NOT_APPLIED), and `PLANS/P08-CONTRACT.md` (F10).

## Rules

Read-only: edit, create or delete no file. Never read or print `.env`, `supabase/functions/.env`, `.env.local`,
`.claude/settings*.json` or `.mcp.json`. Run no tests, no `pnpm` script, no Playwright, no `docker` and no `supabase`
command. `git diff`, `git show`, `grep` and reading files are yours. No polling loops.

## Report

A verdict, `pass` or `audit_failed`. Then each finding with a severity (blocking, major, minor, nit), `file:line`, the
evidence it rests on, and a concrete fix. Short and exact; no hedged verdict.
