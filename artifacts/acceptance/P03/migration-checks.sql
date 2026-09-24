-- P03 orchestrator checks: audit_events and staff_directory(). Run inside a
-- rolled-back transaction against the local stack only.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'editor@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner'),
  ('00000000-0000-0000-0000-0000000000e1', 'Editor', 'editor');
insert into public.audit_events (actor, action, entity, entity_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'staff.invite', 'staff', '00000000-0000-0000-0000-0000000000e1');

do $$ begin
  if has_table_privilege('anon', 'public.audit_events', 'select') then raise exception 'FAIL anon reads audit'; end if;
  if has_table_privilege('authenticated', 'public.audit_events', 'insert,update,delete') then raise exception 'FAIL authenticated writes audit'; end if;
  if has_function_privilege('anon', 'public.staff_directory()', 'execute') then raise exception 'FAIL anon executes directory'; end if;
  begin
    update public.audit_events set action = 'x';
    raise exception 'FAIL audit updated';
  exception when insufficient_privilege then raise notice 'PASS audit update refused (even for postgres)';
  end;
  begin
    delete from public.audit_events;
    raise exception 'FAIL audit deleted';
  exception when insufficient_privilege then raise notice 'PASS audit delete refused (even for postgres)';
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.audit_events) <> 0 then raise exception 'FAIL editor reads audit'; end if;
  raise notice 'PASS editor sees no audit rows';
  begin
    perform public.staff_directory();
    raise exception 'FAIL editor reads directory';
  exception when insufficient_privilege then raise notice 'PASS editor cannot read directory';
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.audit_events) <> 1 then raise exception 'FAIL owner cannot read audit'; end if;
  if (select count(*) from public.staff_directory()) <> 2 then raise exception 'FAIL owner directory'; end if;
  if (select email from public.staff_directory() where role = 'editor') <> 'editor@test.local' then raise exception 'FAIL directory email'; end if;
  raise notice 'PASS owner reads audit and directory';
end $$;
reset role;
rollback;
