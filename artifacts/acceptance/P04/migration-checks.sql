-- P04 part 1 orchestrator checks: content_versions, published_documents and
-- the publishing functions. Local stack only, inside a rolled-back transaction.
\set ON_ERROR_STOP on
begin;
-- Lets this session act as app_server; rolled back with everything else.
grant app_server to postgres;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'editor@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'ops@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner'),
  ('00000000-0000-0000-0000-0000000000e1', 'Editor', 'editor'),
  ('00000000-0000-0000-0000-0000000000f1', 'Ops', 'operations');

do $$ begin
  if has_table_privilege('anon', 'public.content_versions', 'select') then raise exception 'FAIL anon reads versions'; end if;
  if has_table_privilege('authenticated', 'public.content_versions', 'update') or has_table_privilege('authenticated', 'public.content_versions', 'delete') then raise exception 'FAIL authenticated edits history'; end if;
  if has_column_privilege('authenticated', 'public.content_versions', 'publish_at', 'insert') or has_column_privilege('authenticated', 'public.content_versions', 'author', 'insert') then raise exception 'FAIL authenticated sets publish_at/author'; end if;
  if has_table_privilege('authenticated', 'public.published_documents', 'insert,update,delete') or has_table_privilege('anon', 'public.published_documents', 'insert,update,delete') then raise exception 'FAIL API roles write live content'; end if;
  if has_table_privilege('anon', 'public.content_documents', 'select') then raise exception 'FAIL anon reads document list'; end if;
  if has_function_privilege('authenticated', 'public.publish_version(uuid,public.content_collection,text,integer)', 'execute') then raise exception 'FAIL authenticated can publish directly'; end if;
  if not has_function_privilege('app_server', 'public.publish_version(uuid,public.content_collection,text,integer)', 'execute') then raise exception 'FAIL app_server cannot publish'; end if;
  if has_function_privilege('app_server', 'public.publish_due()', 'execute') or has_function_privilege('app_server', 'public.content_go_live(public.content_collection,text,integer)', 'execute') then raise exception 'FAIL app_server reaches internal functions'; end if;
  if has_table_privilege('app_server', 'public.content_versions', 'select') then raise exception 'FAIL app_server reads tables'; end if;
  raise notice 'PASS grants';
end $$;

-- Editor appends drafts through RLS; a stale seq conflicts; operations cannot.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
insert into public.content_versions (collection, doc_id, seq, data) values ('posts', 'p1', 1, '{"slug":"hello","title":"مرحبا"}');
insert into public.content_versions (collection, doc_id, seq, data) values ('posts', 'p1', 2, '{"slug":"hello","title":"مرحبا ٢"}');
do $$ begin
  begin
    insert into public.content_versions (collection, doc_id, seq, data) values ('posts', 'p1', 2, '{"slug":"hello","title":"stale"}');
    raise exception 'FAIL stale save accepted';
  exception when unique_violation then raise notice 'PASS stale save conflicts';
  end;
  begin
    insert into public.content_versions (collection, doc_id, seq, data) values ('posts', 'p2', 5, '{}');
    raise exception 'FAIL skipped seq accepted';
  exception when unique_violation then raise notice 'PASS skipped seq refused';
  end;
  if (select author from public.content_versions where doc_id = 'p1' and seq = 1) <> '00000000-0000-0000-0000-0000000000e1' then raise exception 'FAIL author not the caller'; end if;
  if (select count(*) from public.content_documents where doc_id = 'p1' and latest_seq = 2 and live_seq is null) <> 1 then raise exception 'FAIL document list'; end if;
  raise notice 'PASS editor drafts, author and document list';
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.content_versions) <> 0 then raise exception 'FAIL operations reads drafts'; end if;
  begin
    insert into public.content_versions (collection, doc_id, seq, data) values ('posts', 'p3', 1, '{}');
    raise exception 'FAIL operations wrote a draft';
  exception when insufficient_privilege then raise notice 'PASS operations cannot read or write drafts';
  end;
end $$;
reset role;

-- Publishing as app_server with a verified actor.
set local role app_server;
do $$ begin
  begin
    perform public.publish_version('00000000-0000-0000-0000-0000000000f1', 'posts', 'p1', 1);
    raise exception 'FAIL operations actor published';
  exception when insufficient_privilege then raise notice 'PASS non-publisher actor refused';
  end;
  perform public.publish_version('00000000-0000-0000-0000-0000000000e1', 'posts', 'p1', 1);
  begin
    perform public.archive_document('00000000-0000-0000-0000-0000000000a1', 'rooms', 'started');
    raise exception 'FAIL room archived';
  exception when invalid_parameter_value then raise notice 'PASS rooms cannot be archived';
  end;
  begin
    perform public.schedule_version('00000000-0000-0000-0000-0000000000a1', 'posts', 'p1', 2, now() - interval '1 minute');
    raise exception 'FAIL past schedule accepted';
  exception when invalid_parameter_value then raise notice 'PASS past schedule refused';
  end;
  perform public.schedule_version('00000000-0000-0000-0000-0000000000a1', 'posts', 'p1', 2, now() + interval '1 hour');
end $$;
reset role;

set local role anon;
do $$ begin
  if (select data ->> 'title' from public.published_documents where doc_id = 'p1') <> 'مرحبا' then raise exception 'FAIL anon sees wrong live version'; end if;
  raise notice 'PASS anon reads version 1 live while version 2 is only scheduled';
end $$;
reset role;

-- A due schedule goes live through publish_due() and queues one revalidation.
update public.content_versions set publish_at = now() - interval '1 second' where doc_id = 'p1' and seq = 2;
do $$
declare before_count bigint; n integer;
begin
  select count(*) into before_count from net.http_request_queue;
  n := public.publish_due();
  if n <> 1 then raise exception 'FAIL publish_due published %', n; end if;
  if (select seq from public.published_documents where doc_id = 'p1') <> 2 then raise exception 'FAIL due version not live'; end if;
  if (select count(*) from public.content_versions where doc_id = 'p1' and publish_at is not null) <> 0 then raise exception 'FAIL schedule not cleared'; end if;
  if (select count(*) from net.http_request_queue) <> before_count + 1 then raise exception 'FAIL revalidation not queued'; end if;
  if (select convert_from(body, 'utf8') from net.http_request_queue order by id desc limit 1) not like '%content:posts:p1%' then raise exception 'FAIL revalidation tags'; end if;
  if public.publish_due() <> 0 then raise exception 'FAIL second run published again'; end if;
  raise notice 'PASS publish_due publishes once and queues one revalidation';
end $$;

set local role app_server;
do $$ begin
  perform public.archive_document('00000000-0000-0000-0000-0000000000e1', 'posts', 'p1');
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.published_documents where doc_id = 'p1') then raise exception 'FAIL archive left it live'; end if;
  if (select count(*) from public.audit_events where entity_id = 'p1') <> 4 then raise exception 'FAIL audit trail count %', (select count(*) from public.audit_events where entity_id = 'p1'); end if;
  raise notice 'PASS archive removes the live copy; publish, schedule, due and archive are audited';
end $$;
rollback;
