-- P05: the media library (D03, D15). Objects live in R2; this table records
-- what the Worker has verified. A media row is created only by
-- media_complete(), after the Worker has checked the uploaded bytes (magic
-- bytes, type, dimensions, sizes), so a row always means "verified".
--
-- R2 layout (keys are derived from the ticket id, which becomes the media id):
--   private bucket R2:          originals/<id>                (never served)
--                               quarantine/<id>/<width>.webp  (until verified)
--   public bucket MEDIA_PUBLIC: m/<id>/<width>.webp           (isolated origin)
--
-- Upload tickets are server-owned (actor, declared sizes, 5-minute expiry)
-- and invisible to every API role; only the app_server functions touch them.
-- Completion claims a ticket exactly once: after the claim no part can be
-- replaced and no second completion can run, so the Worker's cleanup after a
-- failed completion can never delete another request's result.

-- 1. Media.
create table public.media (
  id uuid primary key,
  purpose text not null check (purpose in ('image', 'logo')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- '/'-separated path, Arabic allowed; '' is the root.
  folder text not null default '' check (
    char_length(folder) <= 120 and folder !~ '[[:cntrl:]]' and folder !~ '(^/|/$|//)'
  ),
  alt_ar text not null check (char_length(btrim(alt_ar)) between 1 and 300),
  caption text check (caption is null or char_length(caption) <= 500),
  rights text not null check (char_length(btrim(rights)) between 1 and 300),
  original_key text not null unique,
  original_mime text not null check (original_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  original_bytes integer not null check (original_bytes between 1 and 15728640),
  original_width integer not null check (original_width >= 1),
  original_height integer not null check (original_height >= 1),
  original_md5 text check (original_md5 ~ '^[0-9a-f]{32}$'),
  crop jsonb not null check (jsonb_typeof(crop) = 'object'),
  derivatives jsonb not null check (
    jsonb_typeof(derivatives) = 'array' and jsonb_array_length(derivatives) between 1 and 4
  ),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (original_width::bigint * original_height <= 40000000)
);
create index media_folder_created on public.media (folder, created_at desc);
alter table public.media enable row level security;

-- Owners and editors see everything and may edit only the descriptive
-- columns. Keys, sizes and derivatives are written only by media_complete().
grant select on public.media to authenticated;
grant update (name, folder, alt_ar, caption, rights) on public.media to authenticated;
create policy media_staff_read on public.media
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'editor'));
create policy media_staff_update on public.media
  for update to authenticated
  using ((select public.current_staff_role()) in ('owner', 'editor'))
  with check ((select public.current_staff_role()) in ('owner', 'editor'));

create function public.media_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function public.media_touch() from public, anon, authenticated;
create trigger media_touch
  before update on public.media
  for each row execute function public.media_touch();

-- Whether a published document references this id anywhere in its data.
create function public.media_is_published(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.published_documents p
    where jsonb_path_exists(p.data, 'strict $.** ? (@ == $id)', jsonb_build_object('id', p_id::text))
  )
$$;
revoke all on function public.media_is_published(uuid) from public, anon, authenticated;
grant execute on function public.media_is_published(uuid) to anon;

-- The public site reads only the id and derivatives of media that a
-- published document uses, so an image uploaded for an unpublished draft
-- cannot be listed early. Preview reads as staff (policy above).
grant select (id, derivatives) on public.media to anon;
create policy media_public_read on public.media
  for select to anon
  using (public.media_is_published(id));

-- 2. Upload tickets: no API role has any grant.
create table public.media_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null references auth.users (id) on delete cascade,
  declared jsonb not null check (
    jsonb_typeof(declared) = 'object'
    and pg_column_size(declared) <= 8192
    and (declared -> 'original' ->> 'bytes')::bigint between 1 and 15728640
  ),
  expires_at timestamptz not null default now() + interval '5 minutes',
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index media_upload_tickets_open on public.media_upload_tickets (actor, expires_at)
  where completed_at is null;
alter table public.media_upload_tickets enable row level security;

-- 3. Where a media id is used: a live document, a pending schedule, or the
--    latest version of any document (its current draft). Older versions are
--    not counted; restoring one that points at deleted media fails the
--    publish check in src/lib/publish.ts.
create function public.media_usage(p_id uuid)
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
    and jsonb_path_exists(v.data, 'strict $.** ? (@ == $id)', jsonb_build_object('id', p_id::text))
$$;
revoke all on function public.media_usage(uuid) from public, anon, authenticated;

-- The library screen's "used in" list, for owners and editors.
create function public.media_where_used(p_id uuid)
returns table (collection public.content_collection, doc_id text, state text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'editor') then
    raise exception 'Only an owner or editor can see where media is used.' using errcode = 'insufficient_privilege';
  end if;
  return query select u.collection, u.doc_id, u.state from public.media_usage(p_id) u;
end
$$;
revoke all on function public.media_where_used(uuid) from public, anon, authenticated;
grant execute on function public.media_where_used(uuid) to authenticated;

-- Renames a folder and everything under it. Runs as the caller, so RLS and
-- the column grant on folder apply; the folder check validates the result.
create function public.media_rename_folder(p_from text, p_to text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_from = '' or p_to = '' then
    raise exception 'The root folder cannot be renamed or targeted.' using errcode = 'invalid_parameter_value';
  end if;
  update public.media
  set folder = p_to || substr(folder, char_length(p_from) + 1)
  where folder = p_from or left(folder, char_length(p_from) + 1) = p_from || '/';
  get diagnostics changed = row_count;
  return changed;
end
$$;
revoke all on function public.media_rename_folder(text, text) from public, anon, authenticated;
grant execute on function public.media_rename_folder(text, text) to authenticated;

-- 4. Ticket and promotion functions: app_server only. Each rechecks the
--    actor (the verified staff JWT subject) against staff.
create function public.media_create_ticket(p_actor uuid, p_declared jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_expires timestamptz;
begin
  perform public.content_assert_publisher(p_actor);
  if (
    select count(*) from public.media_upload_tickets t
    where t.actor = p_actor and t.completed_at is null and t.expires_at > now()
  ) >= 10 then
    raise exception 'Too many uploads in progress.' using errcode = 'program_limit_exceeded';
  end if;
  insert into public.media_upload_tickets (actor, declared)
  values (p_actor, p_declared)
  returning id, expires_at into v_id, v_expires;
  return jsonb_build_object('id', v_id, 'expiresAt', v_expires);
end
$$;

-- The declared sizes for a ticket that still accepts parts. Another actor's
-- ticket looks the same as a missing one.
create function public.media_ticket(p_actor uuid, p_ticket uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.media_upload_tickets;
begin
  perform public.content_assert_publisher(p_actor);
  select * into t from public.media_upload_tickets where id = p_ticket;
  if not found or t.actor <> p_actor then
    raise exception 'Upload ticket not found.' using errcode = 'no_data_found';
  end if;
  if t.claimed_at is not null or t.expires_at <= now() then
    raise exception 'Upload ticket expired or already used.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  return t.declared;
end
$$;

-- Starts completion: claims an open ticket once and returns its declaration.
-- A failed completion is not retried on the same ticket; the browser asks
-- for a new one.
create function public.media_claim(p_actor uuid, p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.media_upload_tickets;
begin
  perform public.content_assert_publisher(p_actor);
  select * into t from public.media_upload_tickets where id = p_ticket for update;
  if not found or t.actor <> p_actor then
    raise exception 'Upload ticket not found.' using errcode = 'no_data_found';
  end if;
  if t.claimed_at is not null or t.expires_at <= now() then
    raise exception 'Upload ticket expired or already used.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update public.media_upload_tickets set claimed_at = now() where id = p_ticket;
  return t.declared;
end
$$;

-- Records verified media from a claimed ticket's declaration. Called only
-- after the Worker has verified every object and copied the derivatives to
-- the public bucket. The expiry no longer applies once the ticket is claimed.
create function public.media_complete(p_actor uuid, p_ticket uuid, p_original_md5 text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.media_upload_tickets;
  v_derivatives jsonb;
begin
  perform public.content_assert_publisher(p_actor);
  select * into t from public.media_upload_tickets where id = p_ticket for update;
  if not found or t.actor <> p_actor then
    raise exception 'Upload ticket not found.' using errcode = 'no_data_found';
  end if;
  if t.claimed_at is null or t.completed_at is not null then
    raise exception 'Upload ticket not claimed or already used.' using errcode = 'object_not_in_prerequisite_state';
  end if;

  select jsonb_agg(
      jsonb_build_object(
        'width', (d ->> 'width')::integer,
        'height', (d ->> 'height')::integer,
        'bytes', (d ->> 'bytes')::integer,
        'key', 'm/' || p_ticket::text || '/' || ((d ->> 'width')::integer)::text || '.webp'
      )
      order by (d ->> 'width')::integer
    )
    into v_derivatives
  from jsonb_array_elements(t.declared -> 'derivatives') d;

  insert into public.media (
    id, purpose, name, folder, alt_ar, caption, rights,
    original_key, original_mime, original_bytes, original_width, original_height, original_md5,
    crop, derivatives, created_by
  ) values (
    p_ticket,
    t.declared ->> 'purpose',
    t.declared ->> 'name',
    coalesce(t.declared ->> 'folder', ''),
    t.declared ->> 'altAr',
    nullif(t.declared ->> 'caption', ''),
    t.declared ->> 'rights',
    'originals/' || p_ticket::text,
    t.declared -> 'original' ->> 'mime',
    (t.declared -> 'original' ->> 'bytes')::integer,
    (t.declared -> 'original' ->> 'width')::integer,
    (t.declared -> 'original' ->> 'height')::integer,
    p_original_md5,
    t.declared -> 'crop',
    v_derivatives,
    p_actor
  );
  update public.media_upload_tickets set completed_at = now() where id = p_ticket;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor, 'media.create', 'media', p_ticket::text,
    jsonb_build_object('purpose', t.declared ->> 'purpose', 'bytes', (t.declared -> 'original' ->> 'bytes')::integer)
  );
  return p_ticket;
end
$$;

-- Deletes unused media and returns its R2 keys for the Worker to remove.
-- ponytail: a draft saved between this check and the delete can still point
-- at the removed id; the publish check refuses it, so nothing broken goes live.
create function public.media_delete(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.media;
begin
  perform public.content_assert_publisher(p_actor);
  select * into m from public.media where id = p_id for update;
  if not found then
    raise exception 'Media not found.' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.media_usage(p_id)) then
    raise exception 'Media is in use.' using errcode = 'foreign_key_violation';
  end if;
  delete from public.media where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'media.delete', 'media', p_id::text, jsonb_build_object('name', m.name));
  return jsonb_build_object(
    'originalKey', m.original_key,
    'derivativeKeys', (select jsonb_agg(d ->> 'key') from jsonb_array_elements(m.derivatives) d)
  );
end
$$;

revoke all on function public.media_create_ticket(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.media_ticket(uuid, uuid) from public, anon, authenticated;
revoke all on function public.media_claim(uuid, uuid) from public, anon, authenticated;
revoke all on function public.media_complete(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.media_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.media_create_ticket(uuid, jsonb) to app_server;
grant execute on function public.media_ticket(uuid, uuid) to app_server;
grant execute on function public.media_claim(uuid, uuid) to app_server;
grant execute on function public.media_complete(uuid, uuid, text) to app_server;
grant execute on function public.media_delete(uuid, uuid) to app_server;
