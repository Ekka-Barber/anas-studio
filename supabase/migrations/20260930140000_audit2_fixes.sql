-- AUDIT-2, round R01-DB: the database findings, in one forward migration. The
-- earlier migrations stay untouched. Every function keeps its exact
-- signature (`create or replace`) and restates its grants, so the file is
-- re-runnable and each function's access is readable in one place.

-- 1. Stale-version conflicts of the commerce settings and the policy approval.
--    Raised as unique_violation, like publish_version and schedule_version
--    (20260930120000_audit_fixes.sql, section 5): PostgREST runs a request in
--    a hasql transaction that retries a 40001 without bound, so a
--    serialization_failure never answers, it pins a connection. The Data API
--    answers a unique_violation with 409 (23505); the `admin` function maps
--    that code to «تغيّرت الإعدادات من جلسة أخرى». Otherwise identical to
--    20260927130000_commerce_settings.sql and 20260927170000_policy_approval.sql.
create or replace function public.commerce_settings_save(
  p_actor uuid,
  p_expected_version integer,
  p_seller_legal_name text,
  p_seller_address text,
  p_seller_registration text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
  v_name text := case when p_seller_legal_name is null then null else btrim(p_seller_legal_name) end;
  v_address text := case when p_seller_address is null then null else btrim(p_seller_address) end;
  v_registration text := case when p_seller_registration is null then null else btrim(p_seller_registration) end;
  v_changed text[] := array[]::text[];
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from finance.commerce_settings where id = 1 for update;

  -- `is distinct from`, not `<>`: a null expected version is a conflict too.
  if p_expected_version is distinct from v_row.version then
    raise exception 'Commerce settings changed in another session.'
      using errcode = 'unique_violation';
  end if;

  if v_row.seller_legal_name is distinct from v_name then
    v_changed := array_append(v_changed, 'seller_legal_name');
  end if;
  if v_row.seller_address is distinct from v_address then
    v_changed := array_append(v_changed, 'seller_address');
  end if;
  if v_row.seller_registration is distinct from v_registration then
    v_changed := array_append(v_changed, 'seller_registration');
  end if;

  update finance.commerce_settings
  set seller_legal_name = v_name,
      seller_address = v_address,
      seller_registration = v_registration,
      version = v_row.version + 1,
      configured_at = now(),
      approved_by = p_actor
  where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.settings',
    'commerce_settings',
    '1',
    jsonb_build_object('version', v_row.version + 1, 'changed', to_jsonb(v_changed))
  );

  return v_row.version + 1;
end
$$;
revoke all on function public.commerce_settings_save(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.commerce_settings_save(uuid, integer, text, text, text) to service_role;

create or replace function public.commerce_policies_approve(p_actor uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
  v_store integer;
  v_delivery integer;
  v_refund integer;
  v_privacy integer;
  v_revisions jsonb;
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from finance.commerce_settings where id = 1 for update;

  -- `is distinct from`, not `<>`: a null expected version is a conflict too.
  if p_expected_version is distinct from v_row.version then
    raise exception 'Commerce settings changed in another session.'
      using errcode = 'unique_violation';
  end if;

  select seq into v_store from public.published_documents where collection = 'policies' and doc_id = 'store';
  select seq into v_delivery from public.published_documents where collection = 'policies' and doc_id = 'delivery';
  select seq into v_refund from public.published_documents where collection = 'policies' and doc_id = 'refund';
  select seq into v_privacy from public.published_documents where collection = 'policies' and doc_id = 'privacy';
  if v_store is null or v_delivery is null or v_refund is null then
    raise exception 'Publish the store, delivery and refund policies first.' using errcode = 'raise_exception';
  end if;

  v_revisions := jsonb_build_object('store', v_store, 'delivery', v_delivery, 'refund', v_refund)
    || case when v_privacy is null then '{}'::jsonb else jsonb_build_object('privacy', v_privacy) end;

  update finance.commerce_settings
     set policy_revisions = v_revisions,
         version = v_row.version + 1,
         configured_at = now(),
         approved_by = p_actor
   where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.policies',
    'commerce_settings',
    '1',
    jsonb_build_object('version', v_row.version + 1, 'revisions', v_revisions)
  );

  return jsonb_build_object('version', v_row.version + 1, 'policyRevisions', v_revisions);
end
$$;
revoke all on function public.commerce_policies_approve(uuid, integer) from public, anon, authenticated;
grant execute on function public.commerce_policies_approve(uuid, integer) to service_role;

-- 2. Publishing: the lock order, the first publication date, the schedule
--    check.
--
-- Every writer of one document takes the per-document advisory lock
-- `content_versions_next_seq` uses, before any row lock: publish_version,
-- schedule_version and cancel_schedule already did, archive_document and
-- publish_due now do too. Without it publish_due (content_versions row, then
-- published_documents) and publish_version or archive_document
-- (published_documents, then content_versions) took the same two locks in
-- opposite order and could deadlock on one document.

-- The first publication date of an archived document. archive_document
-- deletes the live row, and the next go-live would start a new date, which
-- the journal shows and sorts by. Private: `finance` is not exposed, and only
-- the security definer functions below touch it.
create table if not exists finance.content_first_published (
  collection public.content_collection not null,
  doc_id text not null,
  first_published_at timestamptz not null,
  primary key (collection, doc_id)
);

-- Otherwise identical to 20260925120000_content_versions_and_publishing.sql:
-- a document archived before keeps its first publication date.
create or replace function public.content_go_live(p_collection public.content_collection, p_doc_id text, p_seq integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
begin
  select v.data into v_data from public.content_versions v
  where v.collection = p_collection and v.doc_id = p_doc_id and v.seq = p_seq;
  if not found then
    raise exception 'Version not found.' using errcode = 'no_data_found';
  end if;
  insert into public.published_documents (collection, doc_id, seq, data, first_published_at)
  values (
    p_collection, p_doc_id, p_seq, v_data,
    coalesce(
      (select f.first_published_at from finance.content_first_published f
        where f.collection = p_collection and f.doc_id = p_doc_id),
      now()
    )
  )
  on conflict (collection, doc_id) do update
    set seq = excluded.seq, data = excluded.data, updated_at = now();
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
end
$$;
revoke all on function public.content_go_live(public.content_collection, text, integer) from public, anon, authenticated;

-- Rooms and site settings are always live: archiving them would break the
-- public site, so only posts and taxonomies can be archived. Keeps the first
-- publication date for a later republish, and takes the document lock first.
create or replace function public.archive_document(p_collection public.content_collection, p_doc_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  if p_collection not in ('posts', 'taxonomies') then
    raise exception 'Rooms and site settings cannot be archived.' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtext('content:' || p_collection::text || ':' || p_doc_id));
  insert into finance.content_first_published (collection, doc_id, first_published_at)
  select p.collection, p.doc_id, p.first_published_at
  from public.published_documents p
  where p.collection = p_collection and p.doc_id = p_doc_id
  on conflict (collection, doc_id) do update set first_published_at = excluded.first_published_at;
  delete from public.published_documents where collection = p_collection and doc_id = p_doc_id;
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (v_actor, 'content.archive', p_collection::text, p_doc_id);
  perform public.site_build_request();
end
$$;
revoke all on function public.archive_document(public.content_collection, text) from public, anon;
grant execute on function public.archive_document(public.content_collection, text) to authenticated;

-- A post whose slug another post already has live cannot go live (the
-- `published_documents_post_slug` index), so a schedule for it is refused
-- here, where the editor sees it. At the due time publish_due could only drop
-- the schedule and leave an audit row nobody reads. A document's own live row
-- does not count. Raised as unique_violation with the index name, which
-- src/lib/admin-publish.ts maps to the slug message. Otherwise identical to
-- 20260930120000_audit_fixes.sql.
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
  if p_collection = 'posts' and exists (
    select 1
    from public.content_versions v
    join public.published_documents p
      on p.collection = 'posts' and p.doc_id <> v.doc_id and (p.data ->> 'slug') = (v.data ->> 'slug')
    where v.collection = 'posts' and v.doc_id = p_doc_id and v.seq = p_seq
  ) then
    raise exception 'Another published post already uses this slug (published_documents_post_slug).'
      using errcode = 'unique_violation';
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
revoke all on function public.schedule_version(public.content_collection, text, integer, timestamptz) from public, anon;
grant execute on function public.schedule_version(public.content_collection, text, integer, timestamptz) to authenticated;

-- publish_due no longer locks the due version row first (`for update skip
-- locked`). It takes the document's advisory lock, like every other writer
-- (a document being published, scheduled, cancelled or archived right now is
-- left for the next minute), then locks the version row and checks that it is
-- still due: a publish or a cancel that ran meanwhile has cleared it, so a
-- stale scheduled seq never goes live over a newer manual publish. The rest
-- is identical to 20260930120000_audit_fixes.sql.
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
    order by v.publish_at
  loop
    continue when not pg_try_advisory_xact_lock(hashtext('content:' || r.collection::text || ':' || r.doc_id));
    perform 1
    from public.content_versions v
    where v.collection = r.collection and v.doc_id = r.doc_id and v.seq = r.seq
      and v.publish_at is not null and v.publish_at <= now()
    for update;
    continue when not found;
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
revoke all on function public.publish_due() from public, anon, authenticated;

-- 3. The admin's document list also carries the seq the pending schedule is
--    on, so the bar and the list can say which version will go live. A view
--    replaced in place can only gain columns at the end. Same access as
--    before: anon none, authenticated select (content_versions RLS applies).
create or replace view public.content_documents
with (security_invoker = true) as
select distinct on (v.collection, v.doc_id)
  v.collection,
  v.doc_id,
  v.seq as latest_seq,
  v.data as latest_data,
  v.created_at as latest_at,
  p.seq as live_seq,
  p.updated_at as live_at,
  (
    select s.publish_at from public.content_versions s
    where s.collection = v.collection and s.doc_id = v.doc_id and s.publish_at is not null
    order by s.publish_at limit 1
  ) as scheduled_at,
  (
    select s.seq from public.content_versions s
    where s.collection = v.collection and s.doc_id = v.doc_id and s.publish_at is not null
    order by s.publish_at limit 1
  ) as scheduled_seq
from public.content_versions v
left join public.published_documents p on p.collection = v.collection and p.doc_id = v.doc_id
order by v.collection, v.doc_id, v.seq desc;
revoke all on public.content_documents from anon;
grant select on public.content_documents to authenticated;

-- 4. Media.
--
-- The public build reads the alt text of the published images it renders.
-- Only this column beyond id and derivatives; name, folder, rights and
-- caption stay staff-only, and media_public_read still limits which rows
-- anon sees.
grant select (alt_ar) on public.media to anon;

-- Where a media id is used. A document whose latest version is the live one
-- and that is not scheduled is listed once, as live: the latest-version
-- branch skips it, so it no longer also shows as a draft. A later version
-- that differs from the live one is still a draft. Otherwise identical to
-- 20260926090000_media_library.sql.
create or replace function public.media_usage(p_id uuid)
returns table (collection public.content_collection, doc_id text, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.collection, p.doc_id, 'live'
  from public.published_documents p
  where jsonb_path_exists(p.data, 'strict $.** ? (@ == $id)', jsonb_build_object('id', p_id::text))
  union
  select v.collection, v.doc_id, case when v.publish_at is not null then 'scheduled' else 'draft' end
  from public.content_versions v
  where (
      v.publish_at is not null
      or v.seq = (
        select max(l.seq) from public.content_versions l
        where l.collection = v.collection and l.doc_id = v.doc_id
      )
    )
    and not (
      v.publish_at is null
      and exists (
        select 1 from public.published_documents p
        where p.collection = v.collection and p.doc_id = v.doc_id and p.seq = v.seq
      )
    )
    and jsonb_path_exists(v.data, 'strict $.** ? (@ == $id)', jsonb_build_object('id', p_id::text))
$$;
revoke all on function public.media_usage(uuid) from public, anon, authenticated;

-- 5. The contact form's daily cap matches what the outbox can send. Every
--    message queues one priority-1 notice per active owner or operations
--    member, and the outbox sends priority 1 only while the day's sends are
--    under DAILY_QUOTA - RESERVE = 80 (supabase/functions/_shared/outbox.ts).
--    At 200 messages a day the queue grew by 120 notices a day for one
--    recipient and a real visitor's notice waited behind spam for days. 40 a
--    day is at most 80 notices with two recipients.
--    ponytail: a fixed 40 holds for up to two recipients; scale the cap by
--    the recipient count if the notified team grows.
--    Otherwise identical to 20260926120000_contacts_and_email.sql.
create or replace function public.contact_submit(
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
    or not finance.rate_limit_take('contact:all', repeat('0', 64), 40, interval '1 day')
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
revoke all on function public.contact_submit(text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.contact_submit(text, text, text, text, uuid, text) to service_role;

-- 6. The email outbox.
--
-- A notice swept because its recipient is no longer an active owner or
-- operations member (RECIPIENT_INACTIVE) is not an open problem: nothing can
-- be replayed or fixed for it, and it would sit in the owner's «تحتاج انتباهًا»
-- count until the contacts purge removes it months later. It stays in the
-- outbox and the audit trail, but outbox_attention leaves it out. Otherwise
-- identical to 20260930120000_audit_fixes.sql.
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
  where (o.status in ('exhausted', 'uncertain', 'suppressed')
         or o.delivery in ('bounced', 'complained', 'failed'))
    and o.last_error is distinct from 'RECIPIENT_INACTIVE'
  order by o.created_at desc
  limit 200;
end
$$;
revoke all on function public.outbox_attention() from public, anon;
grant execute on function public.outbox_attention() to authenticated;

-- Two fixes in outbox_result; otherwise identical to 20260930120000_audit_fixes.sql.
--
-- S04.2 follow-up: when the only attempt so far (attempts = 1) was refused
-- with a QUOTA 429, nothing reached the provider, so no idempotency window
-- has started for this key. first_attempt_at is cleared and the window starts
-- at the next real attempt. Left set, a quota wait of a day or more made the
-- next ambiguous send look older than 23 hours, and a person had to confirm a
-- duplicate risk that did not exist. It is kept when attempts > 1, because an
-- earlier attempt may have been sent.
--
-- S04.4 follow-up: the accept reads the delivery events in its UPDATE and the
-- webhook (email_event_record) reads provider_id in its own, each with its own
-- statement snapshot, so two overlapping transactions each missed the other's
-- uncommitted write and the event was applied to no row. Both take this
-- per-message advisory lock first (before any row lock), so the second runs
-- its statements after the first has committed.
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
  if p_outcome = 'accepted' and p_provider_id is not null then
    perform pg_advisory_xact_lock(hashtext('email:' || p_provider_id));
  end if;
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
        first_attempt_at = case when o.attempts = 1 then null else o.first_attempt_at end,
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
revoke all on function public.outbox_result(bigint, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.outbox_result(bigint, uuid, text, text, text) to service_role;

-- The webhook half of the S04.4 follow-up above: the same per-message lock,
-- taken before the event is stored. Otherwise identical to
-- 20260926120000_contacts_and_email.sql.
create or replace function public.email_event_record(
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
  if p_provider_message_id is not null then
    perform pg_advisory_xact_lock(hashtext('email:' || p_provider_message_id));
  end if;
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
revoke all on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) to service_role;

-- 7. Site rebuilds.
--
-- Each request gets its own five attempts: a new request resets the failure
-- counter. The counter only went back to zero on a 2xx, so after one failing
-- episode (five in a row) every later request got a single try and no retry
-- (a transient 502 then left the published change unbuilt). Otherwise
-- identical to 20260927090000_static_site_and_functions.sql.
create or replace function public.site_build_request()
returns void
language sql
security definer
set search_path = ''
as $$
  update finance.site_builds set requested_at = now(), failures = 0 where id = 1;
$$;
revoke all on function public.site_build_request() from public, anon, authenticated;

-- A build is owed but no deploy hook is in Vault (the hosted project's
-- secret is missing or misnamed): one `site_build` run is recorded as
-- skipped with reason NO_HOOK, so the owner home no longer reads the same as
-- a site with nothing published. Written once per episode: not again while
-- the newest site_build run is already that. Otherwise identical to
-- 20260927120000_rebuild_delivery_and_media_sweep.sql.
create or replace function public.site_build_trigger()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.site_builds;
  v_hook text;
  v_answered boolean;
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_ok boolean;
begin
  select * into v_row from finance.site_builds where id = 1 for update;

  -- The last call's outcome, before any new call.
  if v_row.request_id is not null then
    select r.status_code, r.timed_out, r.error_msg into v_status, v_timed_out, v_error
    from net._http_response r where r.id = v_row.request_id;
    v_answered := found;
    -- pg_net answers within seconds (15 s timeout); after ten minutes with no
    -- answer the call is treated as lost.
    if not v_answered and v_row.triggered_at > now() - interval '10 minutes' then
      return false;
    end if;
    v_ok := v_answered and v_status between 200 and 299 and not coalesce(v_timed_out, false);
    insert into finance.job_runs (job, status, detail, started_at)
    values (
      'site_build',
      case when v_ok then 'ok' else 'failed' end,
      jsonb_strip_nulls(jsonb_build_object(
        'httpStatus', v_status,
        'timedOut', case when v_timed_out then true end,
        'error', left(v_error, 200),
        'noAnswer', case when not v_answered then true end,
        'attempt', v_row.failures + 1
      )),
      v_row.triggered_at
    );
    if v_ok then
      update finance.site_builds set request_id = null, failures = 0 where id = 1;
    else
      -- Re-arm: `triggered_at = null` makes the owed build due again.
      update finance.site_builds
      set request_id = null,
          failures = v_row.failures + 1,
          triggered_at = case when v_row.failures + 1 < 5 then null else triggered_at end
      where id = 1;
    end if;
    select * into v_row from finance.site_builds where id = 1;
  end if;

  if v_row.requested_at is null then
    return false;
  end if;
  if v_row.triggered_at is not null
     and (v_row.triggered_at >= v_row.requested_at or v_row.triggered_at > now() - interval '2 minutes') then
    return false;
  end if;
  select decrypted_secret into v_hook from vault.decrypted_secrets where name = 'pages_deploy_hook';
  if v_hook is null then
    if not exists (
      select 1 from (
        select j.status, j.detail from finance.job_runs j where j.job = 'site_build' order by j.id desc limit 1
      ) latest
      where latest.status = 'skipped' and latest.detail ->> 'reason' = 'NO_HOOK'
    ) then
      insert into finance.job_runs (job, status, detail, started_at)
      values ('site_build', 'skipped', jsonb_build_object('reason', 'NO_HOOK'), now());
    end if;
    return false;
  end if;
  update finance.site_builds
  set request_id = net.http_post(url := v_hook, body := '{}'::jsonb, timeout_milliseconds := 15000),
      triggered_at = now()
  where id = 1;
  return true;
end
$$;
revoke all on function public.site_build_trigger() from public, anon, authenticated;

-- 8. The catalog asks for a rebuild only when a variant's public fields
--    change. The old statement trigger `update of price_halalas, ...` fires
--    whenever a listed column is in the UPDATE's SET list, changed or not,
--    and even for a statement that matches no row. The admin's variant form
--    always sends all of them, so every save (a stock correction, no edit, a
--    lost version conflict) started a Pages build. Inserts and deletes stay a
--    statement trigger; an update is now a row trigger that compares the
--    public columns. Stock, the low-stock threshold and the digital asset
--    are not public and are not in the comparison.
drop trigger if exists product_variants_request_build on public.product_variants;
create trigger product_variants_request_build
  after insert or delete on public.product_variants
  for each statement execute function public.catalog_request_build();
drop trigger if exists product_variants_request_build_update on public.product_variants;
create trigger product_variants_request_build_update
  after update on public.product_variants
  for each row
  when (
    (old.product_id, old.sku, old.title, old.fulfillment, old.price_halalas, old.enabled, old.sort_order)
    is distinct from
    (new.product_id, new.sku, new.title, new.fulfillment, new.price_halalas, new.enabled, new.sort_order)
  )
  execute function public.catalog_request_build();

-- 9. pg_cron logs every run in cron.job_run_details and never purges it; four
--    jobs run every minute, about 2 million rows a year. One daily job keeps
--    the last seven days.
select cron.schedule(
  'cron-run-details-purge', '31 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
