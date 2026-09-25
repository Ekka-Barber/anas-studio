-- P04 part 1: collections, drafts, versions and publishing (D20, D29).
--
-- One generic store: every save appends to content_versions; the live copy
-- is published_documents, the only content table anon can read. Publishing,
-- scheduling, cancelling and archiving run only through app_server (the
-- Worker, after it has verified the staff JWT and validated the data with the
-- collection's Zod schema); each function rechecks that actor against staff.

create extension if not exists pg_cron;

create type public.content_collection as enum ('site_settings', 'rooms', 'posts', 'taxonomies');

-- 1. Drafts and history.
create table public.content_versions (
  id bigint generated always as identity primary key,
  collection public.content_collection not null,
  doc_id text not null check (doc_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  seq integer not null check (seq >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 262144),
  author uuid default auth.uid() references auth.users (id) on delete set null,
  publish_at timestamptz,
  created_at timestamptz not null default now(),
  unique (collection, doc_id, seq)
);
alter table public.content_versions enable row level security;

-- Owners and editors read history and append drafts. Only these four columns
-- are insertable: author defaults to the caller, publish_at is set only by
-- schedule_version(). No update or delete for any API role.
grant select on public.content_versions to authenticated;
grant insert (collection, doc_id, seq, data) on public.content_versions to authenticated;
create policy content_versions_read on public.content_versions
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'editor'));
create policy content_versions_insert on public.content_versions
  for insert to authenticated
  with check (
    (select public.current_staff_role()) in ('owner', 'editor')
    and author = (select auth.uid())
  );

-- seq must be the next number for its document, serialized per document, so
-- a save based on a stale version fails instead of overwriting. Raised as
-- unique_violation so the Data API answers 409 Conflict.
create function public.content_versions_next_seq()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest integer;
begin
  perform pg_advisory_xact_lock(hashtext('content:' || new.collection::text || ':' || new.doc_id));
  select coalesce(max(v.seq), 0) into latest
  from public.content_versions v
  where v.collection = new.collection and v.doc_id = new.doc_id;
  if new.seq <> latest + 1 then
    raise exception 'Version conflict: the document changed since it was opened (expected %, got %).',
      latest + 1, new.seq
      using errcode = 'unique_violation';
  end if;
  return new;
end
$$;
revoke all on function public.content_versions_next_seq() from public, anon, authenticated;

create trigger content_versions_next_seq
  before insert on public.content_versions
  for each row execute function public.content_versions_next_seq();

-- 2. The live copy.
create table public.published_documents (
  collection public.content_collection not null,
  doc_id text not null,
  seq integer not null,
  data jsonb not null,
  first_published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, doc_id),
  foreign key (collection, doc_id, seq) references public.content_versions (collection, doc_id, seq)
);
create unique index published_documents_post_slug
  on public.published_documents ((data ->> 'slug'))
  where collection = 'posts';
alter table public.published_documents enable row level security;

grant select on public.published_documents to anon, authenticated;
create policy published_documents_read on public.published_documents
  for select to anon, authenticated
  using (true);

-- The admin's document list: latest version, live version and pending
-- schedule per document. security_invoker, so content_versions RLS applies.
create view public.content_documents
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
  ) as scheduled_at
from public.content_versions v
left join public.published_documents p on p.collection = v.collection and p.doc_id = v.doc_id
order by v.collection, v.doc_id, v.seq desc;
revoke all on public.content_documents from anon;
grant select on public.content_documents to authenticated;

-- 3. Publishing functions: app_server only.
create function public.content_assert_publisher(p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role in ('owner', 'editor')
  ) then
    raise exception 'Only an active owner or editor can publish.' using errcode = 'insufficient_privilege';
  end if;
end
$$;

create function public.content_go_live(p_collection public.content_collection, p_doc_id text, p_seq integer)
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
  insert into public.published_documents (collection, doc_id, seq, data)
  values (p_collection, p_doc_id, p_seq, v_data)
  on conflict (collection, doc_id) do update
    set seq = excluded.seq, data = excluded.data, updated_at = now();
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
end
$$;

create function public.publish_version(p_actor uuid, p_collection public.content_collection, p_doc_id text, p_seq integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.content_assert_publisher(p_actor);
  perform public.content_go_live(p_collection, p_doc_id, p_seq);
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'content.publish', p_collection::text, p_doc_id, jsonb_build_object('seq', p_seq));
end
$$;

create function public.schedule_version(
  p_actor uuid, p_collection public.content_collection, p_doc_id text, p_seq integer, p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.content_assert_publisher(p_actor);
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
  values (p_actor, 'content.schedule', p_collection::text, p_doc_id, jsonb_build_object('seq', p_seq, 'at', p_at));
end
$$;

create function public.cancel_schedule(p_actor uuid, p_collection public.content_collection, p_doc_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.content_assert_publisher(p_actor);
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (p_actor, 'content.unschedule', p_collection::text, p_doc_id);
end
$$;

-- Rooms and site settings are always live: archiving them would break the
-- public site, so only posts and taxonomies can be archived.
create function public.archive_document(p_actor uuid, p_collection public.content_collection, p_doc_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.content_assert_publisher(p_actor);
  if p_collection not in ('posts', 'taxonomies') then
    raise exception 'Rooms and site settings cannot be archived.' using errcode = 'invalid_parameter_value';
  end if;
  delete from public.published_documents where collection = p_collection and doc_id = p_doc_id;
  update public.content_versions
  set publish_at = null
  where collection = p_collection and doc_id = p_doc_id and publish_at is not null;
  insert into public.audit_events (actor, action, entity, entity_id)
  values (p_actor, 'content.archive', p_collection::text, p_doc_id);
end
$$;

-- 4. Scheduled publishing. pg_cron runs this every minute as postgres. When
--    it publishes anything it asks the site to revalidate those tags through
--    pg_net; the site URL and secret live in Vault (site_url,
--    revalidate_secret). Without them the content is still published and the
--    pages refresh on the next manual publish.
create function public.publish_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  published integer := 0;
  tags text[] := '{}';
  v_url text;
  v_secret text;
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
    tags := tags || ('content:' || r.collection::text) || ('content:' || r.collection::text || ':' || r.doc_id);
    published := published + 1;
  end loop;

  if published > 0 then
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'site_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'revalidate_secret';
    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url := v_url || '/api/revalidate',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
        body := jsonb_build_object('tags', to_jsonb(tags))
      );
    else
      raise warning 'publish_due: site_url or revalidate_secret missing from Vault; pages were not revalidated.';
    end if;
  end if;
  return published;
end
$$;

revoke all on function public.content_assert_publisher(uuid) from public, anon, authenticated;
revoke all on function public.content_go_live(public.content_collection, text, integer) from public, anon, authenticated;
revoke all on function public.publish_version(uuid, public.content_collection, text, integer) from public, anon, authenticated;
revoke all on function public.schedule_version(uuid, public.content_collection, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_schedule(uuid, public.content_collection, text) from public, anon, authenticated;
revoke all on function public.archive_document(uuid, public.content_collection, text) from public, anon, authenticated;
revoke all on function public.publish_due() from public, anon, authenticated;

grant usage on type public.content_collection to app_server;
grant execute on function public.publish_version(uuid, public.content_collection, text, integer) to app_server;
grant execute on function public.schedule_version(uuid, public.content_collection, text, integer, timestamptz) to app_server;
grant execute on function public.cancel_schedule(uuid, public.content_collection, text) to app_server;
grant execute on function public.archive_document(uuid, public.content_collection, text) to app_server;

select cron.schedule('content-publish-due', '* * * * *', 'select public.publish_due()');
