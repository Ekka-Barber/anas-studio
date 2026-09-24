-- D29 foundation: deny-by-default grants, staff identity (D13) and the
-- app_server runtime login (D26). Content, finance and their policies arrive
-- in later packages, each granting exactly what it creates.

-- 1. Deny by default. Supabase grants every new object in `public` to anon
--    and authenticated; from here on each object is granted explicitly.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2. Staff: who may use the admin, and in which role.
create type public.staff_role as enum ('owner', 'editor', 'operations');

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

-- The caller's active role, or null. Every later policy calls this, so a
-- revoked member loses access on their next query. SECURITY DEFINER lets
-- policies read staff without a grant; search_path is empty and every name
-- is qualified.
create function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.role
  from public.staff s
  where s.user_id = (select auth.uid()) and s.active
$$;
revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;

-- Members read their own row; owners read every row. There is deliberately
-- no insert, update or delete policy: membership changes go through the
-- staff-admin Edge Function (owner at aal2) or the out-of-band bootstrap.
grant select on public.staff to authenticated;
create policy staff_read on public.staff
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_staff_role()) = 'owner');

-- At least one active owner must remain. Deferred to commit, and serialized
-- with a transaction-scoped advisory lock: under READ COMMITTED the check
-- statement takes its snapshot after the lock, so two concurrent demotions
-- of the last two owners cannot both pass. Deleting the last owner's auth
-- user is refused through the cascade as well.
create function public.staff_keep_an_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.staff owners'));
  if not exists (select 1 from public.staff s where s.role = 'owner' and s.active) then
    raise exception 'At least one active owner is required.' using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke all on function public.staff_keep_an_owner() from public, anon, authenticated;

create constraint trigger staff_keep_an_owner
  after update or delete on public.staff
  deferrable initially deferred
  for each row execute function public.staff_keep_an_owner();

-- 3. app_server: the Worker's only database login, through Hyperdrive.
--    No RLS bypass, no DDL, no table grants: EXECUTE on named functions only.
--    Its password is set outside migrations (seed.sql locally; the owner on
--    the hosted project).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_server') then
    create role app_server login noinherit nosuperuser nocreatedb nocreaterole nobypassrls noreplication;
  end if;
end
$$;
grant usage on schema public to app_server;

-- Health probe for /api/health: proves the connection and the EXECUTE grant.
create function public.health()
returns integer
language sql
stable
set search_path = ''
as $$
  select 1
$$;
revoke all on function public.health() from public, anon, authenticated;
grant execute on function public.health() to app_server;
