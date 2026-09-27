-- P07 round 3: a product's cover image may come from the media library.
--
-- The public site reads a library image only when something public uses it
-- (P05, `media_is_published`); until now that meant a published document.
-- A published product's cover is public too, so the build can resolve it,
-- and no library image may be deleted while any product (of any status)
-- names it as its cover, just as content usage already blocks a delete.

-- 1. Public reads: a published document, or a published product's cover.
create or replace function public.media_is_published(p_id uuid)
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
  or exists (
    select 1 from public.products pr
    where pr.status = 'published' and pr.cover_image = p_id::text
  )
$$;

-- 2. The products using an image, for the library's "used in" list.
create function public.media_product_usage(p_id uuid)
returns table (product_id uuid, title text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'editor') then
    raise exception 'Only an owner or editor can see where media is used.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select pr.id, pr.title, pr.status
    from public.products pr
    where pr.cover_image = p_id::text
    order by pr.title;
end
$$;
revoke all on function public.media_product_usage(uuid) from public, anon, authenticated;
grant execute on function public.media_product_usage(uuid) to authenticated;

-- 3. The delete guard counts product covers too. Otherwise identical to
--    20260926090000_media_library.sql; `create or replace` keeps its grants.
create or replace function public.media_delete(p_actor uuid, p_id uuid)
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
  if exists (select 1 from public.media_usage(p_id))
    or exists (select 1 from public.products pr where pr.cover_image = p_id::text)
  then
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
