-- AUDIT-1, round DB: the database findings, in one forward migration. The
-- earlier migrations stay untouched. Every function keeps its exact
-- signature (`create or replace`), so the existing grants survive; the file
-- is re-runnable.

-- 1. S01.5: functions are deny-by-default. The old
--    `alter default privileges ... in schema public revoke ... from public`
--    revokes nothing, because Postgres grants EXECUTE to PUBLIC globally; a
--    schema-scoped revoke cannot remove a global default. Every current
--    function already revokes PUBLIC by hand (checked against pg_proc); this
--    makes the next one safe too, in `public` and in `finance`.
alter default privileges for role postgres revoke execute on functions from public;

-- 2. S01.4: staff sign in with an emailed code (D08), never a password. The
--    email provider stays on for the codes, so a password could otherwise be
--    set with `updateUser` from any staff session and used later. This Custom
--    Access Token hook refuses every password grant (403) and passes every
--    other method (otp, magiclink, totp, token_refresh, recovery, oauth ...)
--    through unchanged. Wired in supabase/config.toml and, for the hosted
--    project, in the Auth dashboard (Authentication, Hooks).
create or replace function public.deny_password_tokens(event jsonb)
returns jsonb
language plpgsql
stable
as $$
begin
  if event ->> 'authentication_method' = 'password' then
    return jsonb_build_object(
      'error',
      jsonb_build_object('http_code', 403, 'message', 'Password sign-in is disabled; use the emailed code.')
    );
  end if;
  return jsonb_build_object('claims', event -> 'claims');
end
$$;
grant usage on schema public to supabase_auth_admin;
revoke all on function public.deny_password_tokens(jsonb) from public, anon, authenticated;
grant execute on function public.deny_password_tokens(jsonb) to supabase_auth_admin;

-- 3. S01.1 and S02.4: what the public key can read of published content.
--    D20: a hidden post («ظاهر» off) is not public. The journal drops it at
--    build time, but the publishable key ships in the static export, so RLS
--    must hide it too. Staff (any active member) still read every row.
drop policy if exists published_documents_read on public.published_documents;
drop policy if exists published_documents_public_read on public.published_documents;
drop policy if exists published_documents_staff_read on public.published_documents;
-- `data -> 'visible' = 'true'` is a jsonb comparison: a malformed value hides
-- the row instead of erroring every anonymous read.
create policy published_documents_public_read on public.published_documents
  for select to anon
  using (collection <> 'posts' or data -> 'visible' = 'true'::jsonb);
create policy published_documents_staff_read on public.published_documents
  for select to authenticated
  using (
    collection <> 'posts'
    or data -> 'visible' = 'true'::jsonb
    or (select public.current_staff_role()) is not null
  );

-- The ids of every library image a public document or a published product
-- uses. A lowercase canonical UUID string anywhere in a public document
-- counts, exactly what `@ == $id` matched before, but the set is built once
-- per statement (a hashed subplan in the policy below), not once per media
-- row. A hidden post's images are not public. The product branch is guarded
-- by the same shape, because `cover_image` is free text.
create or replace function public.media_published_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (s #>> '{}')::uuid
  from public.published_documents p,
       jsonb_path_query(
         p.data,
         'strict $.** ? (@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")'
       ) s
  where p.collection <> 'posts' or p.data -> 'visible' = 'true'::jsonb
  union
  select pr.cover_image::uuid
  from public.products pr
  where pr.status = 'published'
    and pr.cover_image ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
revoke all on function public.media_published_ids() from public, anon, authenticated;
grant execute on function public.media_published_ids() to anon;

drop policy if exists media_public_read on public.media;
create policy media_public_read on public.media
  for select to anon
  using (id in (select public.media_published_ids()));

-- The same hidden-post rule for the per-id check (storage policies and the
-- admin still call it). Otherwise identical to 20260927180000_store_media.sql.
create or replace function public.media_is_published(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.published_documents p
    where (p.collection <> 'posts' or p.data -> 'visible' = 'true'::jsonb)
      and jsonb_path_exists(p.data, 'strict $.** ? (@ == $id)', jsonb_build_object('id', p_id::text))
  )
  or exists (
    select 1 from public.products pr
    where pr.status = 'published' and pr.cover_image = p_id::text
  )
$$;

-- 4. X1.1: what a buyer reads and accepts is what the owner approved. A
--    change to an approved policy document (a new seq, or removal) closes
--    checkout (POLICIES_NOT_CONFIGURED) until the owner approves again.
--    Republishing the approved seq changes nothing. One trigger on the live
--    copy covers publish_version, publish_due and any other writer.
create or replace function public.policies_reset_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection text;
  v_doc text;
  v_seq integer;
begin
  if tg_op = 'DELETE' then
    v_collection := old.collection::text;
    v_doc := old.doc_id;
  else
    v_collection := new.collection::text;
    v_doc := new.doc_id;
    v_seq := new.seq;
  end if;
  if v_collection <> 'policies' then
    return null;
  end if;
  update finance.commerce_settings
     set policy_revisions = '{}'::jsonb, version = version + 1
   where id = 1
     and policy_revisions ? v_doc
     and (policy_revisions ->> v_doc) is distinct from v_seq::text;
  if found then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('commerce.policies_reset', 'commerce_settings', '1', jsonb_build_object('policy', v_doc, 'seq', v_seq));
  end if;
  return null;
end
$$;
revoke all on function public.policies_reset_approval() from public, anon, authenticated;

drop trigger if exists policies_reset_approval on public.published_documents;
create trigger policies_reset_approval
  after insert or update or delete on public.published_documents
  for each row execute function public.policies_reset_approval();

-- 5. X2.3: publishing acts on the latest version only, serialized per
--    document with the key `content_versions_next_seq` uses. A stale tab
--    (its seq is older than the latest) is refused instead of silently
--    reverting newer live content. Raised as unique_violation, like
--    content_versions_next_seq, so the Data API answers 409 (PostgREST does
--    not answer a 40001 at all: the call hangs). A missing version still
--    answers no_data_found from content_go_live.
create or replace function public.publish_version(p_collection public.content_collection, p_doc_id text, p_seq integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  perform pg_advisory_xact_lock(hashtext('content:' || p_collection::text || ':' || p_doc_id));
  if p_seq < (select max(v.seq) from public.content_versions v where v.collection = p_collection and v.doc_id = p_doc_id) then
    raise exception 'The document changed since it was opened; reload it.' using errcode = 'unique_violation';
  end if;
  perform public.content_go_live(p_collection, p_doc_id, p_seq);
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (v_actor, 'content.publish', p_collection::text, p_doc_id, jsonb_build_object('seq', p_seq));
  perform public.site_build_request();
end
$$;

create or replace function public.schedule_version(
  p_collection public.content_collection, p_doc_id text, p_seq integer, p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  if p_at is null or p_at <= now() then
    raise exception 'The schedule time must be in the future.' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtext('content:' || p_collection::text || ':' || p_doc_id));
  if p_seq < (select max(v.seq) from public.content_versions v where v.collection = p_collection and v.doc_id = p_doc_id) then
    raise exception 'The document changed since it was opened; reload it.' using errcode = 'unique_violation';
  end if;
  -- One pending schedule per document.
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  update public.content_versions
  set publish_at = p_at
  where collection = p_collection and doc_id = p_doc_id and seq = p_seq;
  if not found then
    raise exception 'Version not found.' using errcode = 'no_data_found';
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (v_actor, 'content.schedule', p_collection::text, p_doc_id, jsonb_build_object('seq', p_seq, 'at', p_at));
end
$$;

create or replace function public.cancel_schedule(p_collection public.content_collection, p_doc_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  perform pg_advisory_xact_lock(hashtext('content:' || p_collection::text || ':' || p_doc_id));
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (v_actor, 'content.unschedule', p_collection::text, p_doc_id);
end
$$;

-- 6. S01.2: one failing scheduled document must not stop the others. Each
--    row runs in its own subtransaction; a row that fails (for example the
--    post-slug unique index) drops its schedule and is audited as
--    'content.publish_due_failed', so the owner can see it and the queue
--    keeps moving. The handler sets publish_at itself, because the savepoint
--    rollback also undoes content_go_live's own clear.
create or replace function public.publish_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  published integer := 0;
begin
  for r in
    select v.collection, v.doc_id, v.seq
    from public.content_versions v
    where v.publish_at is not null and v.publish_at <= now()
    for update skip locked
  loop
    begin
      perform public.content_go_live(r.collection, r.doc_id, r.seq);
      insert into public.audit_events (action, entity, entity_id, summary)
      values ('content.publish_due', r.collection::text, r.doc_id, jsonb_build_object('seq', r.seq));
      published := published + 1;
    exception when others then
      update public.content_versions
      set publish_at = null
      where collection = r.collection and doc_id = r.doc_id and seq = r.seq;
      insert into public.audit_events (action, entity, entity_id, summary)
      values ('content.publish_due_failed', r.collection::text, r.doc_id,
              jsonb_build_object('seq', r.seq, 'sqlstate', sqlstate));
    end;
  end loop;
  if published > 0 then
    perform public.site_build_request();
  end if;
  return published;
end
$$;

-- 7. S17.1: the 30-day purge keeps each job's newest run, so the owner home
--    still shows «آخر نسخة احتياطية أقدم من 30 يومًا» instead of «لا توجد
--    نسخة بعد» once the last backup is older than 30 days. The same name
--    replaces the old job's command.
select cron.schedule(
  'job-runs-purge', '23 3 * * *',
  $$delete from finance.job_runs j
    where j.finished_at < now() - interval '30 days'
      and exists (select 1 from finance.job_runs n where n.job = j.job and n.finished_at > j.finished_at)$$
);

-- 8. The email outbox.
--
-- S04.1: the reserve holds back everything but priority 0 (receipts), so a
-- contact-form flood cannot spend the last p_reserve sends of the day that
-- the sign-in codes (same Resend account, over SMTP) need.
-- S03.5: a contact notice goes only to a member who is still an active owner
-- or operations (D31); one queued for someone revoked or demoted meanwhile is
-- exhausted, not sent.
create or replace function public.outbox_claim(
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

  with gone as (
    update finance.email_outbox o
    set status = 'exhausted', last_error = 'RECIPIENT_INACTIVE', updated_at = now()
    where o.kind = 'contact_notice'
      and o.status in ('pending', 'uncertain')
      and not exists (
        select 1
        from public.staff s
        join auth.users u on u.id = s.user_id
        where s.active and s.role in ('owner', 'operations') and lower(u.email) = o.recipient
      )
    returning o.id, o.attempts
  )
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'email.exhausted', 'email_outbox', g.id::text,
         jsonb_build_object('attempts', g.attempts, 'lastError', 'RECIPIENT_INACTIVE')
  from gone g;

  select count(*) filter (where o.sent_at >= date_trunc('day', now(), 'UTC')),
         count(*)
  into v_sent_today, v_sent_month
  from finance.email_outbox o
  where o.sent_at >= date_trunc('month', now(), 'UTC');

  return query
  with due as (
    select o.id from finance.email_outbox o
    where o.next_at <= now()
      and o.attempts < o.max_attempts
      and (
        o.status = 'pending'
        or (o.status = 'uncertain' and o.first_attempt_at > now() - interval '23 hours')
      )
      and (o.priority = 0 or v_sent_today < p_daily_quota - p_reserve)
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

-- Looked up by the accepted branch of outbox_result below.
create index if not exists email_delivery_events_message
  on finance.email_delivery_events (provider_message_id) where provider_message_id is not null;

-- S04.2: a 'QUOTA' retry (Resend's daily or monthly quota answered 429) is
-- not a failed attempt. The row goes back to pending with the attempt given
-- back, due at the next 00:00 UTC (the daily quota's reset; a monthly one is
-- probed once a day), so a quota outage does not use up the retry budget.
-- If an earlier attempt may have reached the provider (attempts > 1) and the
-- wait outlasts the 23-hour idempotency window, the row is 'uncertain'
-- instead, so a person confirms the duplicate risk before a replay.
-- S04.4: when the provider accepts, a delivery or bounce event that already
-- arrived (the webhook can beat the reply) is applied to the row, by the
-- same precedence as email_event_record.
create or replace function public.outbox_result(
  p_id bigint, p_lease_id uuid, p_outcome text, p_provider_id text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
  v_next timestamptz := date_trunc('day', now(), 'UTC') + interval '1 day';
begin
  select * into o from finance.email_outbox where id = p_id and lease_id = p_lease_id and status = 'sending' for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'accepted' then
    update finance.email_outbox
    set status = 'sent', sent_at = now(), provider_id = p_provider_id, last_error = null,
        delivery = (
          select case e.type
                   when 'email.complained' then 'complained'
                   when 'email.bounced' then 'bounced'
                   when 'email.failed' then 'failed'
                   when 'email.suppressed' then 'failed'
                   when 'email.delivered' then 'delivered'
                   when 'email.delivery_delayed' then 'delayed'
                 end
          from finance.email_delivery_events e
          where e.provider_message_id = p_provider_id
            and e.type in ('email.complained', 'email.bounced', 'email.failed', 'email.suppressed',
                           'email.delivered', 'email.delivery_delayed')
          order by case e.type
                     when 'email.complained' then 1
                     when 'email.bounced' then 2
                     when 'email.failed' then 3
                     when 'email.suppressed' then 3
                     when 'email.delivered' then 4
                     else 5
                   end,
                   e.received_at desc
          limit 1
        ),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' and p_error = 'QUOTA' then
    update finance.email_outbox
    set status = case when o.attempts > 1 and v_next > o.first_attempt_at + interval '23 hours'
                      then 'uncertain' else 'pending' end,
        attempts = o.attempts - 1, last_error = 'QUOTA', next_at = v_next,
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

-- X1.3: an exhausted row can end on an uncertain send too, so it is
-- ambiguous by the same rule as an uncertain one: past the 23-hour
-- idempotency window a replay needs the duplicate-risk confirmation and a
-- fresh key.
create or replace function public.outbox_attention()
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
         (o.status in ('uncertain', 'exhausted') and o.first_attempt_at <= now() - interval '23 hours')
  from finance.email_outbox o
  where o.status in ('exhausted', 'uncertain', 'suppressed')
     or o.delivery in ('bounced', 'complained', 'failed')
  order by o.created_at desc
  limit 200;
end
$$;

-- S03.5 (replay): a contact notice is not replayed to someone who is no
-- longer an active owner or operations member (22023).
create or replace function public.outbox_replay(p_id bigint, p_accept_duplicate_risk boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
  v_ambiguous boolean;
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
  if o.kind = 'contact_notice' and not exists (
    select 1
    from public.staff s
    join auth.users u on u.id = s.user_id
    where s.active and s.role in ('owner', 'operations') and lower(u.email) = o.recipient
  ) then
    raise exception 'The recipient is no longer an active owner or operations member.'
      using errcode = 'invalid_parameter_value';
  end if;
  if o.status not in ('exhausted', 'uncertain') then
    raise exception 'Only exhausted or uncertain messages can be replayed.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_ambiguous := o.first_attempt_at <= now() - interval '23 hours';
  if v_ambiguous and not p_accept_duplicate_risk then
    raise exception 'This message may already have been sent; confirm the duplicate risk.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update finance.email_outbox
  set status = 'pending', attempts = 0, next_at = now(), last_error = null,
      idempotency_key = case when v_ambiguous then gen_random_uuid() else o.idempotency_key end,
      first_attempt_at = case when v_ambiguous then null else o.first_attempt_at end,
      updated_at = now()
  where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'email.replay', 'email_outbox', p_id::text,
          jsonb_build_object('status', o.status, 'acceptedDuplicateRisk', p_accept_duplicate_risk));
end
$$;

-- 9. S05.3 and S05.4: the audit trail names what it changed.
--
-- One 'order.expired' row per order (entity_id and order number), so a
-- stock or coupon release can be tied to its order. Otherwise identical to
-- 20260927160000_catalog_and_checkout.sql (not security definer; cron runs
-- it as its owner).
create or replace function finance.checkout_expire()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(x.id), '{}')
    into v_ids
    from (
      select o.id
        from finance.orders o
       where o.status = 'pending_payment' and o.hold_expires_at <= now()
       order by o.hold_expires_at
       limit 500
       for update skip locked
    ) x;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update finance.orders set status = 'expired', version = version + 1, updated_at = now() where id = any(v_ids);
  update finance.inventory_reservations set state = 'released', released_at = now()
   where order_id = any(v_ids) and state = 'held';
  update finance.coupon_redemptions set state = 'released', released_at = now()
   where order_id = any(v_ids) and state = 'held';
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'order.expired', 'order', o.id::text, jsonb_build_object('orderNumber', o.order_number)
    from finance.orders o
   where o.id = any(v_ids);
  return cardinality(v_ids);
end
$$;

-- A coupon's scope (product_ids), kind and code are coupon terms: recorded
-- with their old and new values like the rest. Otherwise identical to
-- 20260927160000_catalog_and_checkout.sql; the triggers pick up the new body.
create or replace function public.catalog_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  for v_key in select distinct k from jsonb_object_keys(v_old || v_new) as k loop
    continue when v_key in ('version', 'created_at', 'updated_at', 'body');
    -- An insert's or delete's empty columns are not changes.
    continue when coalesce(v_old -> v_key, 'null'::jsonb) = coalesce(v_new -> v_key, 'null'::jsonb);
    if v_old -> v_key is distinct from v_new -> v_key then
      v_changes := v_changes || jsonb_build_object(
        v_key,
        case
          when v_key in (
            'price_halalas', 'stock', 'enabled', 'status', 'fee_halalas', 'percent_bp', 'amount_halalas',
            'usage_limit', 'min_subtotal_halalas', 'starts_at', 'ends_at', 'product_ids', 'kind', 'code'
          ) then jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
          else 'true'::jsonb
        end
      );
    end if;
  end loop;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    jsonb_build_object('changes', v_changes)
  );
  return null;
end
$$;

-- 10. X2.6: a product cannot be saved with a library cover that is gone.
--     `cover_image` is free text (it may also name a manifest image), so only
--     a media-id-shaped value is checked. FOR KEY SHARE conflicts with
--     media_delete's FOR UPDATE, so a save and a delete of the same image
--     serialize and one of them is refused (23503). An unchanged cover is not
--     re-checked, so an old product stays editable.
create or replace function public.products_check_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_image ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (tg_op = 'INSERT' or new.cover_image is distinct from old.cover_image)
  then
    perform 1 from public.media m where m.id = new.cover_image::uuid for key share;
    if not found then
      raise exception 'The cover image is no longer in the library.' using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.products_check_cover() from public, anon, authenticated;

drop trigger if exists products_check_cover on public.products;
create trigger products_check_cover
  before insert or update of cover_image on public.products
  for each row execute function public.products_check_cover();
