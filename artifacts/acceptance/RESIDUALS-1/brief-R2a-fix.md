# RESIDUALS-1, round R2a: the fix round's brief

The writer: a fresh `sonnet-worker` (Claude Sonnet 5.5, effort max). The orchestrator holds `.anasaq-execution.lock`
(package RESIDUALS-1, round R2a, branch `agent/residuals-1` at `708560a`). Do not create, edit or delete the lock. R2a's
writer built `brief-R2a.md`'s 18 items (uncommitted); an Opus auditor failed it on one major finding, and the
orchestrator ruled on every finding below. Same machine, same rules as `brief-R2a.md` ("Never", "Rules that bind every
item"): read that brief's two sections first, then this one. R2a's migration is not committed, so you edit it in place:
`supabase/migrations/20261015130000_residuals_r2a.sql`.

## Write only these paths

- `supabase/migrations/20261015130000_residuals_r2a.sql`
- `tests/integration/refunds.test.ts`, `outbox.test.ts`, `payment.test.ts`, `notify.test.ts`
- `docs/operations.md` (the paragraphs below)

Any other path: stop and report.

## The fixes (decided)

1. **F1, major: a row that may have been sent never becomes `pending` again.** In `outbox_result`, the give-back
   branches (QUOTA and PROVIDER_CONFIG, today at about lines 1391-1394): `status = case when o.possibly_sent or
   (o.attempts > 1 and v_next > o.first_attempt_at + interval '23 hours') then 'uncertain' else 'pending' end`, and
   `first_attempt_at = case when o.attempts = 1 and not o.possibly_sent then null else o.first_attempt_at end`. In
   `outbox_replay` (about line 1625): `status = case when o.possibly_sent and not (coalesce(v_ambiguous, false) or v_failed)
   then 'uncertain' else 'pending' end` (a replay that rotates the key clears the flag as today). If an existing test
   pins `pending` for a row that had an uncertain attempt, that test changes to `uncertain` and you say which; a row
   that never had one keeps today's answers. Tests (`outbox.test.ts`): a flagged row's QUOTA give-back stays
   `uncertain` and is not claimed past 23 hours from its first attempt; the same for PROVIDER_CONFIG; an in-window replay
   of a flagged row stays `uncertain`, and a QUOTA give-back after it keeps `first_attempt_at`. `docs/operations.md`
   (about lines 267-273) then states what the code does.
2. **F2, minor: rows already `uncertain` before the migration.** After the `alter table ... add column possibly_sent`:
   `update finance.email_outbox set possibly_sent = true where status = 'uncertain' and not possibly_sent;`
3. **F3 (item 1 revised by the orchestrator): a stale read at 15 minutes is NOT_APPLIED.** In `refund_settle`'s stale
   branch the clock now does exactly what the not-landed branch does: `if p_provider_refunded < v_origin` stays
   PROVIDER_TOTAL_DECREASED with its alert; else once `now() >= created_at + interval '15 minutes'`,
   `refund_fail(id, 'NOT_APPLIED')` with no alert (as the not-landed branch); else the back-off. A stale read is an
   out-of-order read, not a decrease, and `refund_record_external` adopts a late landing only from NOT_APPLIED. The test at
   `refunds.test.ts` (about line 1257) expects NOT_APPLIED and no `refund_total_decreased` alert at 15 minutes; add a case
   that a total below the origin still fails PROVIDER_TOTAL_DECREASED with its alert.
4. **F5, minor: a digital line takes no stock.** In `finance.order_try_commit`: select the line's own `i.fulfillment` in
   the first loop and judge by stock only when it is not `digital` (`elsif r.stock is not null and r.fulfillment <>
   'digital'`), and add `and i.fulfillment <> 'digital'` to the decrement loop. Test (`payment.test.ts`): a digital
   preorder line whose variant was made physical, not a preorder, with stock before payment: paid, the stock untouched.
5. **F6, minor: no deadlock between the backlog and a sign-up of the same address.** `notify_confirm_queue` takes
   `pg_advisory_xact_lock(hashtextextended('notify-confirm:' || v_note.email, 0))` before its first rate-limit take;
   `notify_confirm_backlog` calls `pg_try_advisory_xact_lock` on the same key for each row and skips the row (`continue`)
   when it is held. Test (`notify.test.ts`), deterministic: a second connection holds that advisory lock in an open
   transaction; the backlog completes without waiting (a short `statement_timeout` proves it) and leaves that row pending;
   after the release, the next backlog run queues it.
6. **F7, minor: the kick's timeout.** `payments_kick`'s `timeout_milliseconds` becomes 120000, and its comment says why:
   one run's 60 s budget plus the slowest single row (an uncertain row's adoption lists up to 5 pages at 10 s each); the
   hosted behaviour is still checked at P11. The test that asserts 90000 asserts 120000.
7. **P08-CKPT-07's race, made real.** The test at `refunds.test.ts` (about line 1328) holds the refund's lock (or row) on
   a third connection before both calls start, then releases it, so the two calls truly overlap (the way
   `checkout.test.ts:1263-1276` holds a row); three rounds.
8. **Wording (comments and docs only).** F8: `staff_directory`'s comment says the cut keeps the newest 1,000, active
   first, so while fewer than 1,000 members are active only inactive ones are cut. F9: `outbox_attention`'s comment and
   `docs/operations.md` (about lines 300-303) say the cut drops only rows nobody can act on while fewer than 200 rows are
   replayable. F4: `docs/operations.md` (about line 1313): a refund frees a preorder's capacity only for a line that has
   not shipped; for a shipped line it stays spent, and a copy that comes back is counted by raising the capacity by hand.

## Checks, then the report

1. `pnpm lint`, `pnpm typecheck`, `pnpm test`;
2. re-apply the whole migration to the local database in one transaction (it is idempotent; a `pg` script against `DB_URL`
   from `supabase status -o json`, refusing a non-loopback host), then `pnpm test:db` (all files). The local outbox's
   daily allowance may be spent today: if the outbox tests find no claim for that reason, you may move today's earlier
   sends back one day for the run and must restore every one of them afterwards, counting both (R2a's writer did this:
   86 moved, 86 restored); say exactly what you moved and restored;
3. a mutation each for fixes 1, 4 and 5: revert the fix in the file, re-apply, run its test file, see it fail, restore and
   re-apply;
4. no build is needed (no client file changes).

The report: per fix, the lines changed, the proof that ran and the mutation that failed it, the exact commands with exit
codes and counts, what you moved and restored in the outbox, anything not done and why. Do not accept your own work.
