# Brief: P06 round 3, step 4, the privacy erase functions (I31) and contact retention (D36)

You work under `.anasaq-execution.lock` at base commit `4540e95`. Do this one task, run the checks, report, stop. Read `docs/privacy-data-map.md` (the runbook these functions serve), `PLANS/ISSUES.md` I31 and `PLANS/DECISIONS.md` D08 and D36 first. The runbook is uncommitted in the working tree; read it, do not edit it.

## Goal

Two SQL functions the runbook calls from the Supabase SQL editor, with tests. No UI. No API role may call them.

## What to build

**Migration** `supabase/migrations/20260927140000_privacy_requests.sql`, in the style of `20260927130000_commerce_settings.sql` (security definer, `set search_path = ''`, qualified names).

1. `public.privacy_erase_staff(p_user uuid) returns jsonb`
   - Raise `object_not_in_prerequisite_state` if `public.staff` has an active row for `p_user` ("revoke first"). Raise `no_data_found` if there is no `auth.users` row.
   - `update auth.users set email = 'erased-' || p_user || '@erased.invalid', phone = null, raw_user_meta_data = '{}'::jsonb where id = p_user`.
   - Delete the user's rows from every `auth` table with a `user_id` column: `flow_state`, `identities`, `mfa_factors`, `oauth_authorizations`, `oauth_consents`, `one_time_tokens`, `refresh_tokens` (its `user_id` is `varchar`: compare with `p_user::text`), `sessions`, `webauthn_challenges`, `webauthn_credentials`. Also delete from `auth.audit_log_entries` where `payload->>'actor_id' = p_user::text` (that payload carries the email as `actor_username`).
   - `update public.staff set display_name = 'موظف سابق' where user_id = p_user`.
   - Never touch `public.audit_events` rows except to insert one: actor null, action `privacy.erase_staff`, entity `staff`, entity_id `p_user::text`, summary `{}`.
   - Return the number of rows removed per table. A second call on the same user succeeds and removes nothing.
2. `public.privacy_erase_contacts(p_ids uuid[]) returns integer`
   - Delete `finance.email_outbox` rows whose `payload->>'contactId'` is one of the ids and whose status is `pending`, `uncertain` or `exhausted`; keep sent rows. Then delete the `public.contacts` rows. Insert one audit row: actor null, action `privacy.erase_contacts`, entity `contacts`, entity_id the count as text, summary `{"count": n}` (never ids, names or addresses). Return the number of contacts deleted. A repeat call returns 0.
3. Contact retention (D36): a contact is deleted 90 days after its notice first reached a staff mailbox.
   - `finance.contacts_purge() returns integer`: delete every `public.contacts` row that has at least one `finance.email_outbox` notice (`payload->>'contactId'` = its id) with `status = 'sent'`, `delivery` not in `bounced`, `complained` or `failed`, and a `sent_at` more than 90 days ago, and that has no notice in `pending` or `sending`. Delete those contacts' outbox rows first, in the same function. Return the number of contacts deleted. Leave `finance.email_delivery_events` and `finance.email_suppressions` alone: they hold hashes, and a suppression must outlive the message.
   - `select cron.schedule('contacts-purge', '29 3 * * *', 'select finance.contacts_purge()');`, like `rate-limits-purge`.
   - `alter table public.contacts drop column retain_until;`: it was never set, and the period now lives in this function. Check first that nothing else references it (the orchestrator found no reference in `supabase/`, `src/`, `scripts/` or `tests/`).
4. `revoke all` on all three functions from `public, anon, authenticated, service_role`. No grants.

Apply with `supabase migration up --local`. If you must change the file after applying it, say so in the report; the orchestrator re-proves from a clean reset.

## Tests

New `tests/integration/privacy-requests.test.ts`, in the style of `tests/integration/static-site.test.ts` and `commerce-settings.test.ts`, using `tests/integration/support.ts` helpers (`createStaff`, `signIn`). Cover:
- Neither function is executable by `anon`, `authenticated` or `service_role`.
- `privacy_erase_staff` refuses an active member and changes nothing.
- On a revoked member (set `active = false` as the superuser, as the revoke path leaves it) who has signed in once (so identities, sessions, refresh tokens and an Auth log entry exist) and has at least one `audit_events` row: afterwards `auth.users.email` is the placeholder, no row in any listed table references them, no `auth.users` row holds the old address, the staff row reads «موظف سابق», their earlier `audit_events` rows are identical before and after (compare the rows as JSON), exactly one `privacy.erase_staff` row was added, and a second call succeeds with zero removals.
- `privacy_erase_contacts`: with two synthetic contacts, a pending and a sent outbox row for one of them, it deletes both contacts and the pending row, keeps the sent row, adds one audit row whose summary is `{"count": 2}`, and a repeat call returns 0.
- `contacts_purge`, inside a rolled-back transaction, with synthetic contacts: one whose notice was sent 91 days ago goes, and its outbox rows with it; one sent 89 days ago stays; one whose only sent notice bounced stays; one old contact with a second notice still `pending` stays; one old contact with no sent notice stays. `public.contacts` no longer has a `retain_until` column. The cron job `contacts-purge` exists.
Run the auth-touching cases on staff the test creates; never erase an existing account.

## Checks to run and report

`pnpm check`; `TEST_ENV=local DATABASE_URL=<DB_URL> pnpm test:db`.

## Paths you may write

`supabase/migrations/20260927140000_privacy_requests.sql`, `tests/integration/privacy-requests.test.ts`. Anything else: stop and ask.

## Report (40 lines or fewer)

Files changed; each check as `command → exit code` with counts; anything skipped or open.
