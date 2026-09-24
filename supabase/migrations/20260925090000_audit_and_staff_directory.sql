-- P03: the security audit trail, the owner's team directory, and the
-- staff-admin Edge Function's table rights.

-- 1. audit_events: append-only. The staff-admin Edge Function writes here
--    with the secret key (inside Supabase); later SQL functions write as
--    their definer. API roles never insert, update or delete, and a trigger
--    refuses update and delete for every role, so the trail cannot be edited
--    through any application path.
create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  entity text not null check (char_length(entity) between 1 and 80),
  entity_id text,
  summary jsonb not null default '{}'::jsonb
);
alter table public.audit_events enable row level security;

grant select on public.audit_events to authenticated;
create policy audit_events_owner_read on public.audit_events
  for select to authenticated
  using ((select public.current_staff_role()) = 'owner');

create function public.audit_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only.' using errcode = 'insufficient_privilege';
end
$$;
revoke all on function public.audit_events_immutable() from public, anon, authenticated;

create trigger audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.audit_events_immutable();

-- 2. staff_directory(): the team screen's list, owner only. Emails stay in
--    auth.users (no copy that could drift); has_totp shows who has enrolled
--    an authenticator app.
create function public.staff_directory()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.staff_role,
  active boolean,
  has_totp boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_staff_role()) is distinct from 'owner' then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.user_id, u.email::text, s.display_name, s.role, s.active,
           exists (
             select 1 from auth.mfa_factors f
             where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
           ),
           s.created_at
    from public.staff s
    join auth.users u on u.id = s.user_id
    order by s.created_at;
end
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- 3. service_role: new tables are not granted to any API role by default
--    (auto_expose_new_tables is off), so the staff-admin Edge Function gets
--    exactly what it uses: read and write staff rows (the last-owner trigger
--    still applies) and append audit events. No delete on either table.
grant select, insert, update on public.staff to service_role;
grant insert on public.audit_events to service_role;
