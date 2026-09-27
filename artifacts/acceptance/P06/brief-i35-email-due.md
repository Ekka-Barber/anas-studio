# Brief: P06, I35, the email job warns only when mail is waiting

You work under `.anasaq-execution.lock` at the commit that adds this brief. Do this one task, run the checks, report, stop. Read `PLANS/ISSUES.md` I35, `docs/operations.md` "The outbox schedule", `supabase/migrations/20260926120000_contacts_and_email.sql` (`finance.email_outbox`, `outbox_claim`, `job_runs_latest`) and `supabase/migrations/20260927090000_static_site_and_functions.sql` (`outbox_kick`) first.

## Why

Since D32, pg_cron calls `outbox_kick()` every minute and it wakes the `outbox` function only while a row is due, so on a quiet site the last `email_outbox` run can be hours old. The owner home (`src/components/admin/AdminHome.tsx`) still marks that job stale 10 minutes after its last run, a false alarm. Second defect, same predicate: `outbox_kick()` counts an `uncertain` row whose first attempt is more than 23 hours old as due, but `outbox_claim` never claims such a row (it needs a person's replay on the البريد screen), so one stuck row wakes the function and records a run every minute, forever.

## What to build

**Migration** `supabase/migrations/20260927150000_outbox_due_since.sql`, in the style of the two files above (`set search_path = ''`, qualified names).

1. `finance.outbox_due_since() returns timestamptz`, `language sql stable`, not security definer: the earliest moment a row the outbox job can act on became due, or null when none waits. A row counts when:
   - `status = 'pending'`, `next_at <= now()` and `attempts < max_attempts` (due since `next_at`);
   - `status = 'uncertain'`, `next_at <= now()`, `attempts < max_attempts` and `first_attempt_at > now() - interval '23 hours'` (due since `next_at`), the same window `outbox_claim` uses;
   - `status = 'sending'` and `lease_until < now()`, whatever its attempts, because the claim's expiry step must still run for it (due since `lease_until`).
   Return the minimum of those times. `revoke all ... from public, anon, authenticated, service_role`.
2. `public.outbox_due_since() returns timestamptz`, `language plpgsql stable security definer`: raise `insufficient_privilege` with the message 'Only an owner or operations can see the outbox.' unless `public.current_staff_role()` is owner or operations (copy the check from `outbox_attention`), then return `finance.outbox_due_since()`. Grants exactly like `job_runs_latest`: `revoke all ... from public, anon`, `grant execute ... to authenticated`.
3. `create or replace function public.outbox_kick()`, same signature and attributes (`language plpgsql security definer set search_path = ''`), identical except that the `if not exists (...)` block becomes `if finance.outbox_due_since() is null then return false; end if;`. Keep the Vault reads, the `net.http_post` call and its 15 s timeout unchanged; update its comment. Do not touch the cron schedule.

Apply with `supabase migration up --local`. If you change the file after applying it, say so in the report.

## The owner home

In `src/components/admin/AdminHome.tsx` only:
- `loadJobs()` calls `job_runs_latest` and `outbox_due_since` together; if either fails, the section shows «تعذّر التحميل» as it does today. Keep the answer (a timestamp string or null) in the `ok` state next to the runs.
- Remove `email_outbox` from `STALE_JOB_MS` and fix that constant's comment. The email line is in trouble only when `outbox_due_since` is more than 10 minutes old AND there is no `email_outbox` run or its `finished_at` is more than 10 minutes old. Then it shows, with `styles.error` like the other stale texts and also when the job has never run: «بريد ينتظر الإرسال منذ أكثر من 10 دقائق. تأكد من الجدولة.» (no em dash). Otherwise the line is unchanged: status and time, or «لم يعمل بعد».
- Put the rule in one small function with a short comment naming I35. Change no other job's behaviour, text or layout; the other em dashes on this screen belong to a later task.

## Tests

- `tests/integration/outbox.test.ts`, next to the `job_runs_latest` test: `outbox_due_since` answers owner and operations without error and refuses an editor with `42501`. Then, on the `postgres` client inside one transaction that ends in `rollback`: park every due row (pending/uncertain with `next_at <= now()` get `next_at = now() + interval '1 day'`; sending with `lease_until < now()` gets `lease_until = now() + interval '1 day'`) and assert `finance.outbox_due_since()` is null; insert (a) pending due 15 minutes ago, (b) pending due in an hour, (c) pending at `attempts = max_attempts` due 2 hours ago, (d) uncertain first attempted 24 hours ago and due 3 hours ago, (e) uncertain first attempted an hour ago and due 5 minutes ago, (f) sending at `attempts = max_attempts` whose lease expired 20 minutes ago, (g) one each of sent, exhausted and suppressed due 2 hours ago. Assert in SQL (`now()` is fixed inside the transaction) that the answer is `now() - interval '20 minutes'`; delete (f): 15 minutes; delete (a): 5 minutes; delete (e): null. Also assert with `has_function_privilege` that `anon`, `authenticated` and `service_role` cannot execute `finance.outbox_due_since()`.
- `tests/integration/static-site.test.ts`, the "outbox kick (D32)" test (inside its `rolledBack` block, with the Vault values created): a lone `uncertain` row first attempted 24 hours ago and due now gives `false`; an expired `sending` lease gives `true`.
- `tests/e2e/owner-operations.spec.ts`, a new test right after the backup test, named `the email job warns only when a row has waited more than 10 minutes (I35)`. First assert that `vault.decrypted_secrets` has no `functions_url` or `jobs_secret` (the premise: locally pg_cron's kick calls nothing, so a planted row stays due). Park every due row as in the integration test above (the `beforeAll` park misses expired `sending` leases, which now count), delete the `email_outbox` rows from `finance.job_runs` and insert one `ok` run that finished 3 hours ago. As a new owner: `/admin` shows «إرسال البريد: سليم» and not the warning. Insert one pending row with `next_at = now() - interval '15 minutes'` (unique `dedupe_key` and recipient, pushed to `fixtureRecipients`): after a reload the warning text is visible. Delete that row at the end of the test so later screens show a quiet site.

## Docs

`docs/operations.md` "The outbox schedule": say what due means (the three cases above; an uncertain row past 23 hours waits for a person on البريد and no longer wakes the function), and that the owner home warns only when a row has waited more than 10 minutes with no run in those 10 minutes (I35). Replace the sentence saying the home "shows the job as never run or stale".

## Checks to run and report

`supabase migration up --local`; `pnpm check`; `TEST_ENV=local DATABASE_URL=<DB_URL from supabase status -o json> pnpm test:db`; `pnpm exec playwright test tests/e2e/owner-operations.spec.ts` (Playwright starts its own server on `http://localhost:3000`; leave `PLAYWRIGHT_BASE_URL` unset). After the e2e run: `git checkout -- next-env.d.ts artifacts/acceptance/P06/screenshots/`.

## Paths you may write

`supabase/migrations/20260927150000_outbox_due_since.sql`, `src/components/admin/AdminHome.tsx`, `tests/integration/outbox.test.ts`, `tests/integration/static-site.test.ts`, `tests/e2e/owner-operations.spec.ts`, `docs/operations.md`. Anything else: stop and ask. Never read or print `.env`.

## Report (40 lines or fewer)

Files changed; each check as `command → exit code` with counts; anything skipped or open.
