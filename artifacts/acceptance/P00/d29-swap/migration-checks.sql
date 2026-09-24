\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'owner2@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'editor@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner One', 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'Owner Two', 'owner'),
  ('00000000-0000-0000-0000-0000000000e1', 'Editor', 'editor');
set constraints all immediate;

do $$
begin
  -- grants
  if has_table_privilege('anon', 'public.staff', 'select') then raise exception 'FAIL anon can select staff'; end if;
  if has_table_privilege('authenticated', 'public.staff', 'insert,update,delete') then raise exception 'FAIL authenticated can write staff'; end if;
  if not has_table_privilege('authenticated', 'public.staff', 'select') then raise exception 'FAIL authenticated cannot select staff'; end if;
  if has_function_privilege('anon', 'public.current_staff_role()', 'execute') then raise exception 'FAIL anon executes current_staff_role'; end if;
  if has_function_privilege('anon', 'public.health()', 'execute') or has_function_privilege('authenticated', 'public.health()', 'execute') then raise exception 'FAIL health executable by api roles'; end if;
  if has_function_privilege('authenticated', 'public.staff_keep_an_owner()', 'execute') then raise exception 'FAIL trigger fn executable'; end if;
  if (select rolbypassrls or rolsuper or rolcreaterole or rolcreatedb from pg_roles where rolname = 'app_server') then raise exception 'FAIL app_server privileged'; end if;
  if has_table_privilege('app_server', 'public.staff', 'select') then raise exception 'FAIL app_server can read staff'; end if;
  if has_schema_privilege('app_server', 'public', 'create') then raise exception 'FAIL app_server can create in public'; end if;
  raise notice 'PASS grants';

  -- last-owner guard
  update public.staff set role = 'editor' where user_id = '00000000-0000-0000-0000-0000000000a2';
  raise notice 'PASS demote one of two owners';
  begin
    update public.staff set active = false where user_id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL last owner deactivated';
  exception when check_violation then raise notice 'PASS last owner cannot be deactivated';
  end;
  begin
    update public.staff set role = 'operations' where user_id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL last owner demoted';
  exception when check_violation then raise notice 'PASS last owner cannot be demoted';
  end;
  begin
    delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL last owner auth user deleted';
  exception when check_violation then raise notice 'PASS last owner auth user cannot be deleted';
  end;
end $$;

-- RLS as real API roles
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.staff) <> 1 then raise exception 'FAIL editor sees other staff'; end if;
  if public.current_staff_role() is distinct from 'editor' then raise exception 'FAIL editor role'; end if;
  raise notice 'PASS editor sees only own row';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.staff) <> 3 then raise exception 'FAIL owner cannot see all staff'; end if;
  raise notice 'PASS owner sees all staff';
end $$;
reset role;
update public.staff set active = false where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ begin
  if public.current_staff_role() is not null then raise exception 'FAIL revoked editor keeps role'; end if;
  raise notice 'PASS revoked member has no role on next query';
end $$;
reset role;
rollback;
