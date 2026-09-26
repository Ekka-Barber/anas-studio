-- D32 (owner, 2026-09-26): the public site is static files on Cloudflare
-- Pages, rebuilt by a deploy hook after publishing, and every server task is
-- a Supabase Edge Function. There is no Worker, no Hyperdrive and no
-- `app_server` login any more:
--
-- 1. Staff publish straight from the admin: the publishing functions take
--    the actor from `auth.uid()` and are granted to `authenticated`. The
--    owner/editor recheck stays inside them (content_assert_publisher).
-- 2. Server-only functions (contact, outbox, webhook, media) are granted to
--    `service_role`, which exists only inside the Edge Functions.
-- 3. Site rebuilds: publishing records a build request; pg_cron calls the
--    Pages deploy hook at most once per two minutes, so a burst of publishes
--    is one build.
-- 4. The email outbox runs from pg_cron through the `outbox` function.
-- 5. Media lives in two Storage buckets.
-- 6. `app_server` and its health probe are dropped.
--
-- The earlier migrations stay untouched; this one replaces what changed.

-- The rebuild and outbox triggers below call out over HTTP through pg_net.
-- It ships enabled with Supabase Postgres; the explicit create keeps a
-- self-managed or CI database honest instead of failing at cron time.
create extension if not exists pg_net;

-- 1. Publishing as the signed-in staff member ------------------------------

drop function public.publish_version(uuid, public.content_collection, text, integer);
drop function public.schedule_version(uuid, public.content_collection, text, integer, timestamptz);
drop function public.cancel_schedule(uuid, public.content_collection, text);
drop function public.archive_document(uuid, public.content_collection, text);

-- 3. (defined first: the publishing functions below call it)
-- One row: when the site last asked for a rebuild, and when a build was last
-- triggered. Private (`finance` is not exposed).
create table finance.site_builds (
  id integer primary key default 1 check (id = 1),
  requested_at timestamptz,
  triggered_at timestamptz
);
insert into finance.site_builds (id) values (1);

create function public.site_build_request()
returns void
language sql
security definer
set search_path = ''
as $$
  update finance.site_builds set requested_at = now() where id = 1;
$$;

create function public.publish_version(p_collection public.content_collection, p_doc_id text, p_seq integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  perform public.content_go_live(p_collection, p_doc_id, p_seq);
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (v_actor, 'content.publish', p_collection::text, p_doc_id, jsonb_build_object('seq', p_seq));
  perform public.site_build_request();
end
$$;

create function public.schedule_version(
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

create function public.cancel_schedule(p_collection public.content_collection, p_doc_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.content_assert_publisher(v_actor);
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (v_actor, 'content.unschedule', p_collection::text, p_doc_id);
end
$$;

-- Rooms and site settings are always live: archiving them would break the
-- public site, so only posts and taxonomies can be archived.
create function public.archive_document(p_collection public.content_collection, p_doc_id text)
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
  delete from public.published_documents where collection = p_collection and doc_id = p_doc_id;
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (v_actor, 'content.archive', p_collection::text, p_doc_id);
  perform public.site_build_request();
end
$$;

-- Scheduled publishing: the same job, now asking for a rebuild instead of
-- posting revalidation tags to the retired Worker route.
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
    perform public.content_go_live(r.collection, r.doc_id, r.seq);
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('content.publish_due', r.collection::text, r.doc_id, jsonb_build_object('seq', r.seq));
    published := published + 1;
  end loop;
  if published > 0 then
    perform public.site_build_request();
  end if;
  return published;
end
$$;

revoke all on function public.publish_version(public.content_collection, text, integer) from public, anon;
revoke all on function public.schedule_version(public.content_collection, text, integer, timestamptz) from public, anon;
revoke all on function public.cancel_schedule(public.content_collection, text) from public, anon;
revoke all on function public.archive_document(public.content_collection, text) from public, anon;
grant execute on function public.publish_version(public.content_collection, text, integer) to authenticated;
grant execute on function public.schedule_version(public.content_collection, text, integer, timestamptz) to authenticated;
grant execute on function public.cancel_schedule(public.content_collection, text) to authenticated;
grant execute on function public.archive_document(public.content_collection, text) to authenticated;

-- 3. The rebuild trigger ---------------------------------------------------
-- Calls the Pages deploy hook (Vault `pages_deploy_hook`, set by the owner on
-- the hosted project) when a build was requested after the last trigger and
-- the last trigger is at least two minutes old. Without the hook (the local
-- stack, where `next dev` renders live data anyway) it does nothing.
create function public.site_build_trigger()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.site_builds;
  v_hook text;
begin
  select * into v_row from finance.site_builds where id = 1 for update;
  if v_row.requested_at is null then
    return false;
  end if;
  if v_row.triggered_at is not null
     and (v_row.triggered_at >= v_row.requested_at or v_row.triggered_at > now() - interval '2 minutes') then
    return false;
  end if;
  select decrypted_secret into v_hook from vault.decrypted_secrets where name = 'pages_deploy_hook';
  if v_hook is null then
    return false;
  end if;
  perform net.http_post(url := v_hook, body := '{}'::jsonb, timeout_milliseconds := 15000);
  update finance.site_builds set triggered_at = now() where id = 1;
  return true;
end
$$;

select cron.schedule('site-build-trigger', '* * * * *', 'select public.site_build_trigger()');

-- 4. The email outbox, run by pg_cron ---------------------------------------
-- Calls the `outbox` Edge Function (Vault `functions_url`, e.g.
-- https://<ref>.supabase.co/functions/v1, and `jobs_secret`) only while a
-- row is due, so an idle site makes no calls. Without the Vault values it
-- does nothing; the owner home then shows the job as never run or stale.
create function public.outbox_kick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from finance.email_outbox o
    where (o.status in ('pending', 'uncertain') and o.next_at <= now() and o.attempts < o.max_attempts)
       or (o.status = 'sending' and o.lease_until < now())
  ) then
    return false;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    return false;
  end if;
  -- 15 s: a cold function start can exceed pg_net's 5 s default.
  perform net.http_post(
    url := v_url || '/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  return true;
end
$$;

select cron.schedule('email-outbox', '* * * * *', 'select public.outbox_kick()');

revoke all on function public.site_build_request() from public, anon, authenticated;
revoke all on function public.site_build_trigger() from public, anon, authenticated;
revoke all on function public.outbox_kick() from public, anon, authenticated;

-- 2. Server-only functions: service_role (inside the Edge Functions) --------

grant execute on function public.contact_submit(text, text, text, text, uuid, text) to service_role;
grant execute on function public.contact_for_notice(uuid) to service_role;
grant execute on function public.outbox_claim(integer, integer, integer, integer, integer) to service_role;
grant execute on function public.outbox_result(bigint, uuid, text, text, text) to service_role;
grant execute on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) to service_role;
grant execute on function public.job_run_record(text, text, jsonb, timestamptz) to service_role;
grant execute on function public.media_create_ticket(uuid, jsonb) to service_role;
grant execute on function public.media_ticket(uuid, uuid) to service_role;
grant execute on function public.media_claim(uuid, uuid) to service_role;
grant execute on function public.media_complete(uuid, uuid, text) to service_role;
grant execute on function public.media_delete(uuid, uuid) to service_role;

-- 6. app_server is gone ------------------------------------------------------

-- Each grant it ever received is revoked by name (the p_actor functions and
-- `health()` take theirs with them), then the role goes. Named revokes, not
-- `drop owned by`, which the hosted `postgres` role may not be allowed to run.
drop function public.health();
revoke execute on function public.contact_submit(text, text, text, text, uuid, text) from app_server;
revoke execute on function public.contact_for_notice(uuid) from app_server;
revoke execute on function public.outbox_claim(integer, integer, integer, integer, integer) from app_server;
revoke execute on function public.outbox_result(bigint, uuid, text, text, text) from app_server;
revoke execute on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) from app_server;
revoke execute on function public.job_run_record(text, text, jsonb, timestamptz) from app_server;
revoke execute on function public.media_create_ticket(uuid, jsonb) from app_server;
revoke execute on function public.media_ticket(uuid, uuid) from app_server;
revoke execute on function public.media_claim(uuid, uuid) from app_server;
revoke execute on function public.media_complete(uuid, uuid, text) from app_server;
revoke execute on function public.media_delete(uuid, uuid) from app_server;
revoke usage on type public.content_collection from app_server;
revoke usage on schema public from app_server;
drop role app_server;

-- 5. Storage ------------------------------------------------------------------
-- `media-private`: originals and the upload quarantine; no policies, so only
-- the service role (the `admin` function) reads or writes it, and the
-- browser uploads through the signed URLs that function issues.
-- `media-public`: checked WebP derivatives only, public read. The limits
-- match `supabase/functions/_shared/media.ts`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-private', 'media-private', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('media-public', 'media-public', true, 4194304, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
