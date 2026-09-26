-- P06 round 1: the contact inbox, the email outbox, delivery events,
-- suppression, form throttles and job runs (D16, DATA "Email delivery and
-- retries", "Unpaid reservation abuse" throttle rules).
--
-- Durable writes precede email: a contact message is stored, and its owner
-- notice queued, in one transaction before any provider is called. The
-- Worker (app_server) only calls the named functions below; the operational
-- tables live in the unexposed `finance` schema.

-- 0. The private schema. Not in the Data API (supabase/config.toml exposes
--    only `public`), and no API role has any right in it.
create schema if not exists finance;
revoke all on schema finance from public, anon, authenticated;

-- 1. Contact messages: the inbox. Owners and operations read them and set
--    status, notes and assignment; nobody inserts or deletes through the API.
create type public.contact_status as enum ('new', 'read', 'closed', 'spam');

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- The route's email grammar (EMAIL_SHAPE in src/app/api/contact/route.ts),
  -- shared verbatim: a header-safe local part, a bounded domain, and a TLD
  -- that is alphabetic or punycode (xn--, how the route stores IDN addresses
  -- like the Saudi Arabic TLD).
  email text not null check (
    char_length(email) between 3 and 254
    and email = lower(btrim(email))
    and email ~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  ),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  status public.contact_status not null default 'new',
  notes text check (notes is null or char_length(notes) <= 5000),
  assigned_to uuid references auth.users (id) on delete set null,
  -- The privacy policy revision shown with the form; null until policies
  -- exist (E08).
  policy_revision text check (policy_revision is null or char_length(policy_revision) <= 80),
  -- The browser's random key for one submission, so a double submit stores
  -- one message.
  submission_key uuid not null unique,
  -- Set by the approved retention rule (E08); nothing purges before then.
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_status_created on public.contacts (status, created_at desc);
alter table public.contacts enable row level security;

grant select on public.contacts to authenticated;
grant update (status, notes, assigned_to) on public.contacts to authenticated;
create policy contacts_inbox_read on public.contacts
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'operations'));
create policy contacts_inbox_update on public.contacts
  for update to authenticated
  using ((select public.current_staff_role()) in ('owner', 'operations'))
  with check ((select public.current_staff_role()) in ('owner', 'operations'));

create function public.contacts_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.contacts_touch() from public, anon, authenticated;
create trigger contacts_touch
  before update on public.contacts
  for each row execute function public.contacts_touch();

-- 2. Form throttles: counts per bucket, hashed key and fixed window. Keys
--    arrive already hashed with a daily salt (the Worker never sends a raw
--    IP); pg_cron drops windows older than two days.
create table finance.rate_limits (
  bucket text not null check (char_length(bucket) between 1 and 40),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key_hash, window_start)
);

-- Takes one hit; false when the window is already full.
create function finance.rate_limit_take(p_bucket text, p_key_hash text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window)
  );
  v_hits integer;
begin
  insert into finance.rate_limits as r (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, v_window, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end
$$;
revoke all on function finance.rate_limit_take(text, text, integer, interval) from public, anon, authenticated;

select cron.schedule(
  'rate-limits-purge', '17 3 * * *',
  $$delete from finance.rate_limits where window_start < now() - interval '2 days'$$
);

-- 3. The outbox. One row per message; the dedupe key makes enqueueing
--    idempotent. Priority 0 (receipts) goes before 1 (staff notices) and 2
--    (availability notices). Sign-in codes never enter the outbox: Supabase
--    Auth sends them over its own SMTP connection (I28), outside this
--    pipeline, so the daily reserve only bounds outbox volume against the
--    Resend daily limit those codes share. A row is "sent" when the
--    provider accepted it; delivery is tracked separately from webhooks.
create table finance.email_outbox (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  kind text not null check (kind in ('receipt', 'contact_notice', 'availability')),
  priority smallint not null check (priority between 0 and 2),
  recipient text not null check (char_length(recipient) between 3 and 254 and recipient = lower(btrim(recipient))),
  -- Minimal template data only; never a token, card or address.
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'uncertain', 'exhausted', 'suppressed')),
  delivery text check (delivery in ('delivered', 'delayed', 'bounced', 'complained', 'failed')),
  attempts integer not null default 0,
  -- The retry cap: a row is claimable only while attempts < max_attempts, so
  -- every path (retry, uncertain, an expired lease) is bounded and converges
  -- to "exhausted" instead of retrying forever.
  max_attempts integer not null default 8 check (max_attempts between 1 and 10),
  next_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  -- Sent as the provider's Idempotency-Key. The provider keeps keys for 24
  -- hours (Resend docs, idempotency keys); after that an uncertain send can
  -- no longer be retried safely with the same key.
  idempotency_key uuid not null default gen_random_uuid(),
  first_attempt_at timestamptz,
  provider_id text check (provider_id is null or char_length(provider_id) <= 120),
  last_error text check (last_error is null or char_length(last_error) <= 120),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index email_outbox_due on finance.email_outbox (priority, next_at) where status in ('pending', 'uncertain');
create index email_outbox_provider on finance.email_outbox (provider_id) where provider_id is not null;
-- The day/month quota counts in outbox_claim filter on sent_at; this partial
-- index keeps them off an ever-growing unindexed scan. Purging old sent rows
-- is round-3 backup/retention work.
create index if not exists email_outbox_sent_at_idx on finance.email_outbox (sent_at) where sent_at is not null;

create table finance.email_suppressions (
  recipient_hash text primary key check (recipient_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('bounced', 'complained', 'provider_suppressed', 'manual')),
  created_at timestamptz not null default now()
);

create table finance.email_delivery_events (
  -- The provider's event id (the svix-id header): a replayed or duplicated
  -- event is recorded once.
  provider_event_id text primary key check (char_length(provider_event_id) between 1 and 200),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 120),
  type text not null check (char_length(type) between 1 and 60),
  recipient_hash text check (recipient_hash is null or recipient_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz,
  -- Redacted evidence only (for example the bounce type and subtype).
  evidence jsonb not null default '{}'::jsonb check (pg_column_size(evidence) <= 4096),
  received_at timestamptz not null default now()
);

create function finance.recipient_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex')
$$;
revoke all on function finance.recipient_hash(text) from public, anon, authenticated;

create table finance.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (char_length(job) between 1 and 60),
  status text not null check (status in ('ok', 'partial', 'failed', 'skipped')),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 4096),
  started_at timestamptz not null,
  finished_at timestamptz not null default now()
);
create index job_runs_job_finished on finance.job_runs (job, finished_at desc);
select cron.schedule(
  'job-runs-purge', '23 3 * * *',
  $$delete from finance.job_runs where finished_at < now() - interval '30 days'$$
);

-- 4. Contact submission, app_server only. Throttles, the message and a
--    notice to every active owner and operations member commit together.
--    Limits (recorded in docs/operations.md): 5 per hour per salted IP hash,
--    3 per hour per email, 200 per day in total. A repeated submission key
--    returns the stored message and queues nothing new.
create function public.contact_submit(
  p_ip_hash text,
  p_name text,
  p_email text,
  p_message text,
  p_submission_key uuid,
  p_policy_revision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  select c.id into v_id from public.contacts c where c.submission_key = p_submission_key;
  if found then
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  if not finance.rate_limit_take('contact:ip', p_ip_hash, 5, interval '1 hour')
    or not finance.rate_limit_take('contact:email', finance.recipient_hash(v_email), 3, interval '1 hour')
    or not finance.rate_limit_take('contact:all', repeat('0', 64), 200, interval '1 day')
  then
    raise exception 'Too many messages; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  insert into public.contacts (name, email, message, submission_key, policy_revision)
  values (btrim(p_name), v_email, btrim(p_message), p_submission_key, p_policy_revision)
  returning id into v_id;

  insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
  select 'contact_notice:' || v_id::text || ':' || s.user_id::text, 'contact_notice', 1, lower(u.email),
         jsonb_build_object('contactId', v_id)
  from public.staff s
  join auth.users u on u.id = s.user_id
  where s.active and s.role in ('owner', 'operations') and u.email is not null;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end
$$;

-- 5. Dispatch, app_server only.
--
-- outbox_claim leases up to p_limit due rows, most important first:
-- - a row is claimable only while attempts < max_attempts (8 by default):
--   every path is bounded, and a row at the cap becomes "exhausted" with an
--   audit_events row, never a silent forever-retry;
-- - a lease that ran out while "sending" means the send may or may not have
--   reached the provider, so the row becomes "uncertain" ("exhausted" at the
--   cap), never "pending", and gets the same exponential backoff as a retry
--   (2^attempts minutes, capped at 60) so it converges instead of being
--   reclaimed every minute;
-- - an uncertain row is retried only while its idempotency key is still
--   inside the provider's 24-hour window (23 hours, for margin), so the retry
--   cannot send twice; after that only an owner can replay it;
-- - a suppressed recipient is never claimed; the row becomes "suppressed";
-- - when the day's sends reach p_daily_quota - p_reserve, priority 2
--   (availability notices) waits and 0 and 1 still go; the month's sends stop
--   at p_monthly_quota (Resend's free plan: 3,000/month).
create function public.outbox_claim(
  p_limit integer, p_lease_seconds integer, p_daily_quota integer, p_reserve integer,
  p_monthly_quota integer default 3000
)
returns table (
  id bigint, lease_id uuid, kind text, recipient text, payload jsonb, idempotency_key uuid, attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease uuid := gen_random_uuid();
  v_sent_today integer;
  v_sent_month integer;
begin
  with expired as (
    update finance.email_outbox o
    set status = case when o.attempts >= o.max_attempts then 'exhausted' else 'uncertain' end,
        next_at = now() + make_interval(mins => least(power(2, o.attempts), 60)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where o.status = 'sending' and o.lease_until < now()
    returning o.id, o.status, o.attempts, o.last_error
  )
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'email.exhausted', 'email_outbox', e.id::text,
         jsonb_build_object('status', 'sending', 'attempts', e.attempts, 'lastError', e.last_error)
  from expired e
  where e.status = 'exhausted';

  update finance.email_outbox o
  set status = 'suppressed', updated_at = now()
  where o.status in ('pending', 'uncertain')
    and exists (
      select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(o.recipient)
    );

  select count(*) filter (where o.sent_at >= date_trunc('day', now())),
         count(*) filter (where o.sent_at >= date_trunc('month', now()))
  into v_sent_today, v_sent_month
  from finance.email_outbox o;

  return query
  with due as (
    select o.id from finance.email_outbox o
    where o.next_at <= now()
      and o.attempts < o.max_attempts
      and (
        o.status = 'pending'
        or (o.status = 'uncertain' and o.first_attempt_at > now() - interval '23 hours')
      )
      and (o.priority < 2 or v_sent_today < p_daily_quota - p_reserve)
      and v_sent_today < p_daily_quota
      and v_sent_month < p_monthly_quota
    order by o.priority, o.next_at, o.id
    limit p_limit
    for update skip locked
  )
  update finance.email_outbox o
  set status = 'sending',
      lease_id = v_lease,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      attempts = o.attempts + 1,
      first_attempt_at = coalesce(o.first_attempt_at, now()),
      updated_at = now()
  from due
  where o.id = due.id
  returning o.id, o.lease_id, o.kind, o.recipient, o.payload, o.idempotency_key, o.attempts;
end
$$;

-- Records one send's outcome under its lease; a stale lease changes nothing.
-- p_outcome: 'accepted' (the provider took it), 'retry' (a transient error:
-- backoff, then exhausted after max_attempts), 'permanent' (exhausted now),
-- 'uncertain' (the request may have reached the provider: backoff, then
-- exhausted after max_attempts). Every exhaustion is terminal and is written
-- to audit_events as 'email.exhausted'.
create function public.outbox_result(
  p_id bigint, p_lease_id uuid, p_outcome text, p_provider_id text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
begin
  select * into o from finance.email_outbox where id = p_id and lease_id = p_lease_id and status = 'sending' for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'accepted' then
    update finance.email_outbox
    set status = 'sent', sent_at = now(), provider_id = p_provider_id, last_error = null,
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'uncertain' and o.attempts >= o.max_attempts then
    update finance.email_outbox
    set status = 'exhausted', last_error = left(p_error, 120),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('email.exhausted', 'email_outbox', p_id::text,
            jsonb_build_object('status', 'uncertain', 'attempts', o.attempts, 'lastError', left(p_error, 120)));
  elsif p_outcome = 'uncertain' then
    update finance.email_outbox
    set status = 'uncertain', last_error = left(p_error, 120),
        next_at = now() + make_interval(mins => least(power(2, o.attempts), 60)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' and o.attempts < o.max_attempts then
    update finance.email_outbox
    set status = 'pending', last_error = left(p_error, 120),
        next_at = now() + make_interval(mins => power(2, o.attempts)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome in ('retry', 'permanent') then
    update finance.email_outbox
    set status = 'exhausted', last_error = left(p_error, 120),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('email.exhausted', 'email_outbox', p_id::text,
            jsonb_build_object('status', p_outcome, 'attempts', o.attempts, 'lastError', left(p_error, 120)));
  else
    raise exception 'Unknown outcome.' using errcode = 'invalid_parameter_value';
  end if;
  return true;
end
$$;

-- A verified provider event, recorded once. Complaints and provider
-- suppressions suppress the recipient for every sender. A bounce suppresses
-- unless its type is temporary/soft/transient: Resend's webhook sends the
-- type capitalized, "Permanent" or "Temporary" (source:
-- artifacts/acceptance/P06/source-resend-bounced.md), lowercased here from
-- the `p_bounce_type` argument or the evidence `bounceType` key. A temporary
-- bounce only records the event, because the address may deliver later; a
-- missing or undocumented type suppresses conservatively — the raw type
-- stays in the evidence for an owner's manual un-suppression. A later
-- "delivered" never clears a suppression, and never overwrites a bounce or
-- complaint on the row.
create function public.email_event_record(
  p_event_id text, p_type text, p_provider_message_id text, p_recipient text,
  p_occurred_at timestamptz, p_evidence jsonb, p_bounce_type text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := case when p_recipient is null then null else finance.recipient_hash(p_recipient) end;
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_bounce_type text := coalesce(
    nullif(lower(btrim(v_evidence->>'bounceType')), ''),
    nullif(lower(btrim(p_bounce_type)), '')
  );
  v_delivery text;
begin
  insert into finance.email_delivery_events
    (provider_event_id, provider_message_id, type, recipient_hash, occurred_at, evidence)
  values (p_event_id, p_provider_message_id, p_type, v_hash, p_occurred_at, v_evidence)
  on conflict (provider_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_hash is not null and (
    p_type in ('email.complained', 'email.suppressed')
    or (
      p_type = 'email.bounced'
      and coalesce(v_bounce_type, '') not in ('temporary', 'soft', 'transient')
    )
  ) then
    insert into finance.email_suppressions (recipient_hash, reason)
    values (
      v_hash,
      case p_type when 'email.bounced' then 'bounced' when 'email.complained' then 'complained' else 'provider_suppressed' end
    )
    on conflict (recipient_hash) do nothing;
  end if;

  v_delivery := case p_type
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'failed'
    else null
  end;
  if v_delivery is not null and p_provider_message_id is not null then
    update finance.email_outbox o
    set delivery = v_delivery, updated_at = now()
    where o.provider_id = p_provider_message_id
      and (
        o.delivery is null
        or (o.delivery = 'delayed' and v_delivery <> 'delayed')
        or (o.delivery = 'delivered' and v_delivery in ('bounced', 'complained'))
      );
  end if;
  return 'recorded';
end
$$;

create function public.job_run_record(p_job text, p_status text, p_detail jsonb, p_started_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into finance.job_runs (job, status, detail, started_at)
  values (p_job, p_status, coalesce(p_detail, '{}'::jsonb), p_started_at)
$$;

-- The contact a notice is about, for the dispatcher to render the email. The
-- message text goes only to the staff notice address.
create function public.contact_for_notice(p_id uuid)
returns table (name text, email text, message text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name, c.email, c.message, c.created_at from public.contacts c where c.id = p_id
$$;

-- 6. Operations view for staff: outbox rows that need a person, and replay.
create function public.outbox_attention()
returns table (
  id bigint, kind text, recipient text, status text, delivery text, attempts integer,
  last_error text, first_attempt_at timestamptz, created_at timestamptz, replay_needs_confirmation boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see the outbox.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select o.id, o.kind, o.recipient, o.status, o.delivery, o.attempts, o.last_error, o.first_attempt_at, o.created_at,
         (o.status = 'uncertain' and o.first_attempt_at <= now() - interval '23 hours')
  from finance.email_outbox o
  where o.status in ('exhausted', 'uncertain', 'suppressed')
     or o.delivery in ('bounced', 'complained', 'failed')
  order by o.created_at desc
  limit 200;
end
$$;

-- Queues an exhausted or uncertain row again. A suppressed recipient is
-- refused. An uncertain row whose idempotency key has expired may already
-- have been sent, so replaying it needs p_accept_duplicate_risk and gets a
-- new key. The dedupe key (the business identity) never changes.
create function public.outbox_replay(p_id bigint, p_accept_duplicate_risk boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can replay email.' using errcode = 'insufficient_privilege';
  end if;
  select * into o from finance.email_outbox where id = p_id for update;
  if not found then
    raise exception 'Message not found.' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(o.recipient)) then
    raise exception 'The recipient is suppressed.' using errcode = 'check_violation';
  end if;
  if o.status not in ('exhausted', 'uncertain') then
    raise exception 'Only exhausted or uncertain messages can be replayed.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if o.status = 'uncertain' and o.first_attempt_at <= now() - interval '23 hours' and not p_accept_duplicate_risk then
    raise exception 'This message may already have been sent; confirm the duplicate risk.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update finance.email_outbox
  set status = 'pending', attempts = 0, next_at = now(), last_error = null,
      idempotency_key = case when o.status = 'uncertain' and o.first_attempt_at <= now() - interval '23 hours'
                             then gen_random_uuid() else o.idempotency_key end,
      first_attempt_at = case when o.status = 'uncertain' and o.first_attempt_at <= now() - interval '23 hours'
                              then null else o.first_attempt_at end,
      updated_at = now()
  where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'email.replay', 'email_outbox', p_id::text,
          jsonb_build_object('status', o.status, 'acceptedDuplicateRisk', p_accept_duplicate_risk));
end
$$;

-- The latest run of each job, for the owner home and backups view.
create function public.job_runs_latest()
returns table (job text, status text, detail jsonb, finished_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see job runs.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select distinct on (j.job) j.job, j.status, j.detail, j.finished_at
  from finance.job_runs j
  order by j.job, j.finished_at desc;
end
$$;

-- 7. Grants.
revoke all on function public.contacts_touch() from public, anon, authenticated;
revoke all on function public.contact_submit(text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.outbox_claim(integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.outbox_result(bigint, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.job_run_record(text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.contact_for_notice(uuid) from public, anon, authenticated;
revoke all on function public.outbox_attention() from public, anon;
revoke all on function public.outbox_replay(bigint, boolean) from public, anon;
revoke all on function public.job_runs_latest() from public, anon;

grant execute on function public.contact_submit(text, text, text, text, uuid, text) to app_server;
grant execute on function public.outbox_claim(integer, integer, integer, integer, integer) to app_server;
grant execute on function public.outbox_result(bigint, uuid, text, text, text) to app_server;
grant execute on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) to app_server;
grant execute on function public.job_run_record(text, text, jsonb, timestamptz) to app_server;
grant execute on function public.contact_for_notice(uuid) to app_server;
grant execute on function public.outbox_attention() to authenticated;
grant execute on function public.outbox_replay(bigint, boolean) to authenticated;
grant execute on function public.job_runs_latest() to authenticated;
