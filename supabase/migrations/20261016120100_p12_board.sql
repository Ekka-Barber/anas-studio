-- P12, round R1: the data of the projects board («لوحة المشاريع»; PLANS/P12-CONTRACT.md, version 2).
-- One forward migration, idempotent where Postgres allows it (`if not exists`, `create or replace`, `drop ... if exists`).
-- The board-only role is the enum value of the migration before this one (a new value cannot be used in the
-- transaction that adds it); nothing here names it, the four policies at the end name the roles that stay.
--
-- 1. The schema `board`: tables with RLS on and no policy, and no right for any API role. The Data API exposes `public`
--    alone (supabase/config.toml; a hosted project must not add `board` to its exposed schemas), so a request with
--    `Accept-Profile: board` is refused, and the schema's own privileges refuse it again.
-- 2. The helpers (schema `board`, never callable by a client): the refusal, the text rules, `board.caller()`,
--    `board.access(uuid)` and the lock every write starts with.
-- 3. The reads and 4. the writes: `public.board_*`, `security definer`, owned by postgres, `set search_path = ''`, revoked
--    from public and anon, granted to authenticated, each starting with `board.caller()`.
-- 5. The four policies that admitted any staff role, recreated with the roles named.
--
-- Decisions inside the contract (also in the round's report):
-- - Refusals: `raise exception using errcode, message = '<CODE>', detail`; STALE is 23505, every other code P0001.
-- - Every write locks the project row first (`board.enter`), then the columns it touches, then the cards in ascending id.
--   A project is found through its card, column or label without a lock (that id never changes), locked, and the access
--   is checked again after the lock, so a removal, a demotion or an archive that raced the call has committed by then.
--   Creating a project has no row to lock yet: it, and restoring a project, take one advisory lock for the 50-project cap.
-- - A write that finds nothing to change (the same name, the same position, a second restore, the same role) changes
--   nothing: no version bump, no activity row. A stale version is still refused first.
-- - Restoring a card or a project takes no version, but it does change the row, so it bumps the row's version.
-- - Neighbours renumbered by a move, an archive or a column delete change `position` only, not their version.
-- - The caps of people count the people the screens show: 30 active members who are not owners per project, 10 people
--   who can be assigned now per card. An inactive person's row never blocks; a reactivated one may return past a cap, and
--   the next save of that list must come back within it.
-- - The log is history: a `column_*` row names its column in `to_column`, and a `person_added` or `person_role_changed`
--   row keeps the role it gave in `role`.

-- 1. The schema and its tables -------------------------------------------------------------------------------------------

create schema if not exists board;
revoke all on schema board from public, anon, authenticated, service_role;

-- `created_by`, `added_by`, `actor` and `subject` are plain ids, not references: the history outlives an account (the
-- privacy erasure anonymises the staff row instead of deleting it).
create table if not exists board.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1
);

create table if not exists board.members (
  project_id uuid not null references board.projects (id) on delete cascade,
  user_id uuid not null references public.staff (user_id) on delete cascade,
  role text not null check (role in ('member', 'viewer')),
  added_by uuid not null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists members_user on board.members (user_id);

create table if not exists board.columns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references board.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position integer not null check (position >= 1),
  hidden boolean not null default false,
  is_done boolean not null default false,
  version integer not null default 1,
  -- Deferred to commit: a move renumbers the columns it passes in one statement.
  constraint columns_project_position unique (project_id, position) deferrable initially deferred,
  -- The target of the cards' composite reference: a card's column is in the card's project.
  constraint columns_id_project unique (id, project_id)
);
-- At most one done column per project.
create unique index if not exists columns_one_done on board.columns (project_id) where is_done;

create table if not exists board.labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references board.projects (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  tone text not null check (tone in ('saffron', 'coral', 'sand', 'aub')),
  version integer not null default 1
);
-- One name per project, case folded.
create unique index if not exists labels_project_name on board.labels (project_id, lower(name));

create table if not exists board.cards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references board.projects (id) on delete cascade,
  column_id uuid not null,
  position integer,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 5000),
  priority text not null default 'normal' check (priority in ('urgent', 'normal', 'low')),
  due_on date,
  done_at timestamptz,
  link_collection text check (link_collection in ('posts', 'rooms')),
  link_doc_id text check (link_doc_id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1,
  -- No `on delete` action: a column is deleted only once it holds no open card (the function moves its archived ones first),
  -- and deleting a whole project removes its columns and cards in one statement.
  constraint cards_column_in_project foreign key (column_id, project_id) references board.columns (id, project_id),
  -- An open card has a position, an archived one has none.
  constraint cards_open_has_position check ((archived_at is null) = (position is not null)),
  constraint cards_position_positive check (position is null or position >= 1),
  constraint cards_link_both check ((link_collection is null) = (link_doc_id is null)),
  -- Deferred to commit: a move renumbers the cards it passes in one statement; an archived card's null never clashes.
  constraint cards_column_position unique (column_id, position) deferrable initially deferred
);
create index if not exists cards_project on board.cards (project_id);
create index if not exists cards_due on board.cards (due_on) where archived_at is null and due_on is not null;

-- The label is the card's project's, and the person an owner or a `member` of it: checked by the functions (the only writers).
create table if not exists board.card_labels (
  card_id uuid not null references board.cards (id) on delete cascade,
  label_id uuid not null references board.labels (id) on delete cascade,
  primary key (card_id, label_id)
);
create index if not exists card_labels_label on board.card_labels (label_id);

create table if not exists board.card_people (
  card_id uuid not null references board.cards (id) on delete cascade,
  user_id uuid not null references public.staff (user_id) on delete cascade,
  primary key (card_id, user_id)
);
create index if not exists card_people_user on board.card_people (user_id);

create table if not exists board.checklist (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references board.cards (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  done boolean not null default false,
  position integer not null check (position >= 1)
);
create index if not exists checklist_card on board.checklist (card_id, position);

-- What changed and who changed it, never the text: `fields` holds field names only (a check, not a convention).
create table if not exists board.activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references board.projects (id) on delete cascade,
  card_id uuid references board.cards (id) on delete cascade,
  subject uuid,
  -- The role a `person_added` or `person_role_changed` row gave (a later change must not rewrite the sentence).
  role text check (role in ('member', 'viewer')),
  actor uuid not null,
  at timestamptz not null default now(),
  action text not null check (action in (
    'project_created', 'project_renamed', 'project_archived', 'project_restored',
    'person_added', 'person_role_changed', 'person_removed',
    'column_created', 'column_changed', 'column_moved', 'column_deleted',
    'label_created', 'label_changed', 'label_deleted',
    'card_created', 'card_edited', 'card_moved', 'card_archived', 'card_restored'
  )),
  fields text[] not null default '{}'
    check (fields <@ array['title', 'notes', 'priority', 'due_on', 'labels', 'people', 'checklist', 'link', 'name', 'hidden', 'done', 'tone']),
  -- A deleted column is named null (the sentence says «عمود محذوف»). A `column_*` row's column is its `to_column`.
  from_column uuid references board.columns (id) on delete set null,
  to_column uuid references board.columns (id) on delete set null
);
create index if not exists activity_project on board.activity (project_id, id desc);
create index if not exists activity_card on board.activity (card_id, id desc) where card_id is not null;

-- RLS on, no policy: deny all. No table or sequence is granted to any client role.
alter table board.projects enable row level security;
alter table board.members enable row level security;
alter table board.columns enable row level security;
alter table board.labels enable row level security;
alter table board.cards enable row level security;
alter table board.card_labels enable row level security;
alter table board.card_people enable row level security;
alter table board.checklist enable row level security;
alter table board.activity enable row level security;
revoke all on all tables in schema board from public, anon, authenticated, service_role;
revoke all on all sequences in schema board from public, anon, authenticated, service_role;

-- 2. Helpers -------------------------------------------------------------------------------------------------------------

-- The one refusal transport. STALE is 23505 (the house rule), every other code P0001; `detail` names the field of an
-- INVALID, the limit of a LIMIT, and is empty otherwise. Volatile on purpose: a constant call must never be folded.
create or replace function board.refuse(p_code text, p_detail text default '')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = case when p_code = 'STALE' then '23505' else 'P0001' end,
    message = p_code,
    detail = coalesce(p_detail, '');
end
$$;

-- A text field: no control characters (U+0000 to U+001F, U+007F to U+009F; a note allows line feeds), trimmed, and
-- between `p_min` and `p_max` characters. Refuses with INVALID and the field's name.
create or replace function board.clean(p_text text, p_field text, p_min integer, p_max integer, p_lines boolean default false)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_control text := case when p_lines then '[\x01-\x09\x0b-\x1f\x7f-\x9f]' else '[\x01-\x1f\x7f-\x9f]' end;
begin
  if p_text is null then
    perform board.refuse('INVALID', p_field);
  end if;
  if p_text ~ v_control then
    perform board.refuse('INVALID', p_field);
  end if;
  v_text := case when p_lines then btrim(p_text, E' \n') else btrim(p_text) end;
  if char_length(v_text) < p_min or char_length(v_text) > p_max then
    perform board.refuse('INVALID', p_field);
  end if;
  return v_text;
end
$$;

-- A calendar day `YYYY-MM-DD`, or null when the text is not a real day (2026-02-30 is not).
create or replace function board.parse_day(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return p_text::date;
exception when others then
  return null;
end
$$;

-- A JSON array of uuid strings as a sorted, distinct uuid[]; null when it is not one. ponytail: more than 100 elements is
-- refused outright (a card holds at most 10 people and a project 16 labels), so an array cannot be made to cost more than that.
create or replace function board.uuids(p_value jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    return null;
  end if;
  if jsonb_array_length(p_value) > 100 then
    return null;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_value) e
     where jsonb_typeof(e) is distinct from 'string'
        or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    return null;
  end if;
  return array(select distinct (e #>> '{}')::uuid as u from jsonb_array_elements(p_value) e order by u);
end
$$;

-- Whether a JSON value is an object whose keys are all among `p_allowed` (a null, a scalar or an array is not one). The checks are
-- apart on purpose: the order a SQL expression evaluates its operands in is not promised.
create or replace function board.only_keys(p_value jsonb, p_allowed text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    return false;
  end if;
  return not exists (select 1 from jsonb_object_keys(p_value) k where k <> all (p_allowed));
end
$$;

-- The active staff member who is calling (their id), else FORBIDDEN.
create or replace function board.caller()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select s.user_id into v_id from public.staff s where s.user_id = (select auth.uid()) and s.active;
  if v_id is null then
    perform board.refuse('FORBIDDEN');
  end if;
  return v_id;
end
$$;

create or replace function board.is_owner()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role = 'owner')
$$;

-- What the caller may read of the content (a link's title): owners and editors read the latest version, anyone else only what
-- is published and public.
create or replace function board.content_rights()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s where s.user_id = (select auth.uid()) and s.active and s.role in ('owner', 'editor')
  )
$$;

-- The caller's role on a project: 'owner', 'member', 'viewer', or null. An owner is checked first (an active owner, archived
-- projects included); anyone else needs an active staff row and a `members` row on a project that is not archived. A project
-- that does not exist is null for everyone.
create or replace function board.access(p_project uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_archived timestamptz;
  v_role text;
begin
  select p.archived_at into v_archived from board.projects p where p.id = p_project;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.staff s where s.user_id = v_uid and s.active and s.role = 'owner') then
    return 'owner';
  end if;
  if v_archived is not null then
    return null;
  end if;
  select m.role into v_role
    from board.members m
    join public.staff s on s.user_id = m.user_id and s.active
   where m.project_id = p_project and m.user_id = v_uid;
  return v_role;
end
$$;

-- The start of every write on a project: the access is checked (a cheap refusal before any lock), the project row is locked,
-- and the access is checked again, because the lock orders this call after any removal, demotion or archive that was
-- running. An unknown or unseen project is NOT_FOUND, a viewer (or, for `p_owner`, anyone but an owner) is FORBIDDEN.
-- Returns the caller's role.
create or replace function board.enter(p_project uuid, p_owner boolean)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
  v_pass integer;
begin
  for v_pass in 1..2 loop
    v_role := board.access(p_project);
    if v_role is null then
      perform board.refuse('NOT_FOUND');
    end if;
    if v_role = 'viewer' or (p_owner and v_role <> 'owner') then
      perform board.refuse('FORBIDDEN');
    end if;
    if v_pass = 1 then
      perform 1 from board.projects p where p.id = p_project for update;
      if not found then
        perform board.refuse('NOT_FOUND');
      end if;
    end if;
  end loop;
  return v_role;
end
$$;

-- One activity row: who did what, never any text.
create or replace function board.log(
  p_project uuid, p_card uuid, p_subject uuid, p_actor uuid, p_action text,
  p_fields text[] default '{}', p_from uuid default null, p_to uuid default null, p_role text default null
)
returns void
language sql
set search_path = ''
as $$
  insert into board.activity (project_id, card_id, subject, actor, action, fields, from_column, to_column, role)
  values (p_project, p_card, p_subject, p_actor, p_action, p_fields, p_from, p_to, p_role)
$$;

-- A person can be assigned to a card of the project when they are active and an owner or a `member` of it (a viewer never).
create or replace function board.is_assignable(p_project uuid, p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.staff s
     where s.user_id = p_user and s.active
       and (s.role = 'owner'
            or exists (select 1 from board.members m where m.project_id = p_project and m.user_id = p_user and m.role = 'member'))
  )
$$;

-- A project's people: every active owner, and its active members who are not owners. The names are the staff directory's
-- display names (public.staff.display_name), never an email.
create or replace function board.project_people(p_project uuid)
returns table (person uuid, person_name text, person_role text, rank integer)
language sql
stable
set search_path = ''
as $$
  select s.user_id, s.display_name, 'owner'::text, 0
    from public.staff s
   where s.active and s.role = 'owner'
  union all
  select s.user_id, s.display_name, m.role, 1
    from board.members m
    join public.staff s on s.user_id = m.user_id
   where m.project_id = p_project and s.active and s.role <> 'owner'
$$;

-- A document's display title from its data: the rule of `documentTitle` in src/admin/collections/index.ts.
create or replace function board.doc_title(p_collection text, p_doc_id text, p_data jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  with t as (
    select case when jsonb_typeof(p_data -> 'title') = 'string' then nullif(p_data ->> 'title', '') end as title,
           case when jsonb_typeof(p_data -> 'roomLabel') = 'string' then nullif(p_data ->> 'roomLabel', '') end as label
  )
  select case p_collection
    when 'rooms' then coalesce(
      case when t.label is not null and t.title is not null then t.label || ': ' || t.title end,
      t.title,
      case p_doc_id
        when 'started' then 'بدأتُ من هنا'
        when 'built' then 'بنيتُ هنا'
        when 'passed' then 'مررتُ من هنا'
        when 'shelf' then 'على الرف'
        when 'book' then 'كتبتُ هنا'
        else p_doc_id
      end)
    when 'posts' then coalesce(t.title, 'بلا عنوان')
    else p_doc_id
  end
  from t
$$;

-- A link's title under the caller's own content rights: the latest version's title for an owner or an editor; for anyone
-- else the published title of a document that is public (a room, or a visible post), otherwise null.
create or replace function board.link_title(p_collection text, p_doc_id text, p_privileged boolean)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_privileged then
    (select board.doc_title(v.collection::text, v.doc_id, v.data)
       from public.content_versions v
      where v.collection = p_collection::public.content_collection and v.doc_id = p_doc_id
      order by v.seq desc limit 1)
  else
    (select board.doc_title(d.collection::text, d.doc_id, d.data)
       from public.published_documents d
      where d.collection = p_collection::public.content_collection and d.doc_id = p_doc_id
        and (d.collection = 'rooms' or d.data -> 'visible' = 'true'::jsonb))
  end
$$;

-- Whether `board_link_targets` holds this document for a caller with these content rights.
create or replace function board.link_visible(p_collection text, p_doc_id text, p_privileged boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case when p_privileged then
    exists (select 1 from public.content_versions v
             where v.collection = p_collection::public.content_collection and v.doc_id = p_doc_id)
  else
    exists (select 1 from public.published_documents d
             where d.collection = p_collection::public.content_collection and d.doc_id = p_doc_id
               and (d.collection = 'rooms' or d.data -> 'visible' = 'true'::jsonb))
  end
$$;

-- The shapes the reads and the writes answer with.
create or replace function board.project_json(p board.projects)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'version', p.version, 'archived', p.archived_at is not null)
$$;

create or replace function board.column_json(k board.columns)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', k.id, 'name', k.name, 'position', k.position, 'hidden', k.hidden, 'isDone', k.is_done, 'version', k.version)
$$;

create or replace function board.label_json(l board.labels)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'name', l.name, 'tone', l.tone, 'version', l.version)
$$;

-- A card as `board_project` gives it. Labels are in the project's label order, people in name order, the checklist in its
-- own; people who are inactive, or no longer an owner or a `member` of the project, are left out.
create or replace function board.card_json(c board.cards, p_privileged boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'columnId', c.column_id,
    'position', c.position,
    'title', c.title,
    'notes', c.notes,
    'priority', c.priority,
    'dueOn', c.due_on,
    'doneAt', c.done_at,
    'labels', coalesce((
      select jsonb_agg(l.id order by lower(l.name), l.id)
        from board.card_labels cl join board.labels l on l.id = cl.label_id
       where cl.card_id = c.id
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(s.user_id order by s.display_name, s.user_id)
        from board.card_people cp join public.staff s on s.user_id = cp.user_id
       where cp.card_id = c.id and board.is_assignable(c.project_id, cp.user_id)
    ), '[]'::jsonb),
    'checklist', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'text', k.text, 'done', k.done) order by k.position, k.id)
        from board.checklist k
       where k.card_id = c.id
    ), '[]'::jsonb),
    'link', case when c.link_collection is null then null else jsonb_build_object(
      'collection', c.link_collection,
      'docId', c.link_doc_id,
      'title', board.link_title(c.link_collection, c.link_doc_id, p_privileged)
    ) end,
    'version', c.version
  )
$$;

revoke all on all functions in schema board from public, anon, authenticated, service_role;

-- 3. Reads ---------------------------------------------------------------------------------------------------------------

-- The caller's projects (owners: every one, archived ones flagged), with the open cards, the overdue ones and the people.
create or replace function public.board_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_owner boolean := board.is_owner();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'archived', p.archived_at is not null,
             'cards', (select count(*) from board.cards c where c.project_id = p.id and c.archived_at is null),
             'overdue', (
               select count(*) from board.cards c join board.columns k on k.id = c.column_id
                where c.project_id = p.id and c.archived_at is null and not k.is_done and c.due_on < v_today
             ),
             'people', (
               select coalesce(jsonb_agg(jsonb_build_object('id', q.person, 'name', q.person_name) order by q.rank, q.person_name, q.person), '[]'::jsonb)
                 from board.project_people(p.id) q
             )
           ) order by p.archived_at is not null, p.created_at, p.id)
      from board.projects p
     where v_owner
        or (p.archived_at is null and exists (select 1 from board.members m where m.project_id = p.id and m.user_id = v_actor))
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_projects() from public, anon, authenticated, service_role;
grant execute on function public.board_projects() to authenticated;

-- One project whole: its columns, labels, people and open cards, in one statement (one snapshot).
create or replace function public.board_project(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_role text := board.access(p_project);
  v_priv boolean := board.content_rights();
begin
  if v_role is null then
    perform board.refuse('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'project', (select board.project_json(p) from board.projects p where p.id = p_project),
    'role', v_role,
    'columns', coalesce((
      select jsonb_agg(board.column_json(k) order by k.position) from board.columns k where k.project_id = p_project
    ), '[]'::jsonb),
    'labels', coalesce((
      select jsonb_agg(board.label_json(l) order by lower(l.name), l.id) from board.labels l where l.project_id = p_project
    ), '[]'::jsonb),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object('id', q.person, 'name', q.person_name, 'role', q.person_role) order by q.rank, q.person_name, q.person), '[]'::jsonb)
        from board.project_people(p_project) q
    ),
    'cards', coalesce((
      select jsonb_agg(board.card_json(c, v_priv) order by k.position, c.position)
        from board.cards c join board.columns k on k.id = c.column_id
       where c.project_id = p_project and c.archived_at is null
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.board_project(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_project(uuid) to authenticated;

-- The documents a card can link to, under the caller's own content rights: owners and editors get every post and room (the
-- latest title); everyone else gets the rooms and the published, visible posts (the published title).
create or replace function public.board_link_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
begin
  if board.content_rights() then
    return coalesce((
      select jsonb_agg(jsonb_build_object('collection', t.collection, 'docId', t.doc_id, 'title', t.title) order by t.collection, t.title, t.doc_id)
        from (
          select distinct on (v.collection, v.doc_id)
                 v.collection::text as collection, v.doc_id, board.doc_title(v.collection::text, v.doc_id, v.data) as title
            from public.content_versions v
           where v.collection in ('posts', 'rooms')
           order by v.collection, v.doc_id, v.seq desc
        ) t
    ), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('collection', t.collection, 'docId', t.doc_id, 'title', t.title) order by t.collection, t.title, t.doc_id)
      from (
        select d.collection::text as collection, d.doc_id, board.doc_title(d.collection::text, d.doc_id, d.data) as title
          from public.published_documents d
         where d.collection = 'rooms' or (d.collection = 'posts' and d.data -> 'visible' = 'true'::jsonb)
      ) t
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_link_targets() from public, anon, authenticated, service_role;
grant execute on function public.board_link_targets() to authenticated;

-- A project's archived cards, newest first. ponytail: unbounded; page it if one project passes a few thousand archived cards.
create or replace function public.board_archived(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
begin
  if board.access(p_project) is null then
    perform board.refuse('NOT_FOUND');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'columnId', c.column_id, 'archivedAt', c.archived_at) order by c.archived_at desc, c.id)
      from board.cards c
     where c.project_id = p_project and c.archived_at is not null
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_archived(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_archived(uuid) to authenticated;

-- The caller's assigned open cards in the projects they can see (an archived project is not one), outside done columns:
-- by due day (none last), then priority.
create or replace function public.board_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'title', c.title, 'priority', c.priority, 'dueOn', c.due_on,
             'project', jsonb_build_object('id', p.id, 'name', p.name),
             'column', jsonb_build_object('id', k.id, 'name', k.name)
           ) order by c.due_on nulls last, array_position(array['urgent', 'normal', 'low'], c.priority), c.id)
      from board.card_people cp
      join board.cards c on c.id = cp.card_id and c.archived_at is null
      join board.projects p on p.id = c.project_id and p.archived_at is null
      join board.columns k on k.id = c.column_id and not k.is_done
     where cp.user_id = v_actor and board.is_assignable(c.project_id, v_actor)
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_mine() from public, anon, authenticated, service_role;
grant execute on function public.board_mine() to authenticated;

-- A project's numbers, counted from its rows: the open cards of each column, the overdue ones (due before today), the ones
-- due from today to six days after it, and the ones done in the last seven days. Days are Riyadh days.
create or replace function public.board_overview(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if board.access(p_project) is null then
    perform board.refuse('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id, 'name', k.name,
               'cards', (select count(*) from board.cards c where c.column_id = k.id and c.archived_at is null)
             ) order by k.position)
        from board.columns k where k.project_id = p_project
    ), '[]'::jsonb),
    'overdue', (
      select count(*) from board.cards c join board.columns k on k.id = c.column_id
       where c.project_id = p_project and c.archived_at is null and not k.is_done and c.due_on < v_today
    ),
    'thisWeek', (
      select count(*) from board.cards c join board.columns k on k.id = c.column_id
       where c.project_id = p_project and c.archived_at is null and not k.is_done and c.due_on between v_today and v_today + 6
    ),
    'doneThisWeek', (
      select count(*) from board.cards c
       where c.project_id = p_project and c.archived_at is null and c.done_at >= now() - interval '7 days'
    ),
    'hasDone', exists (select 1 from board.columns k where k.project_id = p_project and k.is_done)
  );
end
$$;
revoke all on function public.board_overview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_overview(uuid) to authenticated;

-- The owner's log: 50 rows, newest first, of the project or of one card, before an id. The card's title and the columns'
-- names are read from the rows now; the log itself holds no text.
create or replace function public.board_activity(p_project uuid, p_card uuid default null, p_before bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_role text := board.access(p_project);
begin
  if v_role is null then
    perform board.refuse('NOT_FOUND');
  end if;
  if v_role <> 'owner' then
    perform board.refuse('FORBIDDEN');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'at', a.at,
             'actor', jsonb_build_object('id', a.actor, 'name', coalesce(sa.display_name, '')),
             'action', a.action,
             'fields', to_jsonb(a.fields),
             'card', case when a.card_id is null then null else jsonb_build_object('id', a.card_id, 'title', c.title) end,
             'subject', case when a.subject is null then null else jsonb_build_object('id', a.subject, 'name', coalesce(ss.display_name, '')) end,
             'role', a.role,
             'from', fk.name,
             'to', tk.name
           ) order by a.id desc)
      from (
        select x.* from board.activity x
         where x.project_id = p_project
           and (p_card is null or x.card_id = p_card)
           and (p_before is null or x.id < p_before)
         order by x.id desc limit 50
      ) a
      left join public.staff sa on sa.user_id = a.actor
      left join public.staff ss on ss.user_id = a.subject
      left join board.cards c on c.id = a.card_id
      left join board.columns fk on fk.id = a.from_column
      left join board.columns tk on tk.id = a.to_column
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_activity(uuid, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.board_activity(uuid, uuid, bigint) to authenticated;

-- The admin home's due cards, earliest first, at most 20: owners see every project's, anyone else their own assigned ones;
-- overdue and due this week, outside done columns and archived projects.
create or replace function public.board_due()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_owner boolean := board.is_owner();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'title', d.title, 'dueOn', d.due_on,
             'project', jsonb_build_object('id', d.project_id, 'name', d.project_name)
           ) order by d.due_on, d.id)
      from (
        select c.id, c.title, c.due_on, p.id as project_id, p.name as project_name
          from board.cards c
          join board.projects p on p.id = c.project_id and p.archived_at is null
          join board.columns k on k.id = c.column_id and not k.is_done
         where c.archived_at is null and c.due_on <= v_today + 6
           and (v_owner
                or (exists (select 1 from board.card_people cp where cp.card_id = c.id and cp.user_id = v_actor)
                    and board.is_assignable(c.project_id, v_actor)))
         order by c.due_on, c.id
         limit 20
      ) d
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_due() from public, anon, authenticated, service_role;
grant execute on function public.board_due() to authenticated;

-- The active staff an owner can still add to a project: not owners, not already on it.
create or replace function public.board_staff(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_role text := board.access(p_project);
begin
  if v_role is null then
    perform board.refuse('NOT_FOUND');
  end if;
  if v_role <> 'owner' then
    perform board.refuse('FORBIDDEN');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.user_id, 'name', s.display_name, 'role', s.role::text) order by s.display_name, s.user_id)
      from public.staff s
     where s.active and s.role <> 'owner'
       and not exists (select 1 from board.members m where m.project_id = p_project and m.user_id = s.user_id)
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_staff(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_staff(uuid) to authenticated;

-- Every card of a project for the owner's CSV, archived ones included: open cards first, in board order, then the archived
-- ones, by column, newest first. Labels and people are names; the link carries the latest title (an owner reads drafts).
create or replace function public.board_export(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_role text := board.access(p_project);
  v_priv boolean := board.content_rights();
begin
  if v_role is null then
    perform board.refuse('NOT_FOUND');
  end if;
  if v_role <> 'owner' then
    perform board.refuse('FORBIDDEN');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             'title', c.title,
             'column', k.name,
             'priority', c.priority,
             'dueOn', c.due_on,
             'doneAt', c.done_at,
             'labels', coalesce((
               select jsonb_agg(l.name order by lower(l.name), l.id)
                 from board.card_labels cl join board.labels l on l.id = cl.label_id
                where cl.card_id = c.id
             ), '[]'::jsonb),
             'people', coalesce((
               select jsonb_agg(s.display_name order by s.display_name, s.user_id)
                 from board.card_people cp join public.staff s on s.user_id = cp.user_id
                where cp.card_id = c.id and board.is_assignable(c.project_id, cp.user_id)
             ), '[]'::jsonb),
             'checklist', coalesce((
               select jsonb_agg(jsonb_build_object('text', x.text, 'done', x.done) order by x.position, x.id)
                 from board.checklist x where x.card_id = c.id
             ), '[]'::jsonb),
             'notes', c.notes,
             'link', case when c.link_collection is null then null else jsonb_build_object(
               'collection', c.link_collection,
               'docId', c.link_doc_id,
               'title', board.link_title(c.link_collection, c.link_doc_id, v_priv)
             ) end,
             'archived', c.archived_at is not null
           ) order by (c.archived_at is not null), k.position, c.position, c.archived_at desc, c.id)
      from board.cards c join board.columns k on k.id = c.column_id
     where c.project_id = p_project
  ), '[]'::jsonb);
end
$$;
revoke all on function public.board_export(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_export(uuid) to authenticated;

-- 4. Writes: projects and people (owners) ------------------------------------------------------------------------------------

-- ponytail: one advisory lock for the cap of 50 open projects (a create has no project row to lock yet); a restore takes
-- its project row first and then this lock, and nothing takes a project row while holding it, so the two cannot deadlock.
create or replace function public.board_project_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_name text;
  v_project board.projects;
begin
  if not board.is_owner() then
    perform board.refuse('FORBIDDEN');
  end if;
  v_name := board.clean(p_name, 'name', 1, 80);
  perform pg_advisory_xact_lock(hashtext('board.projects'));
  if (select count(*) from board.projects p where p.archived_at is null) >= 50 then
    perform board.refuse('LIMIT', 'projects');
  end if;
  insert into board.projects (name, created_by) values (v_name, v_actor) returning * into v_project;
  perform board.log(v_project.id, null, null, v_actor, 'project_created');
  return board.project_json(v_project);
end
$$;
revoke all on function public.board_project_create(text) from public, anon, authenticated, service_role;
grant execute on function public.board_project_create(text) to authenticated;

create or replace function public.board_project_rename(p_project uuid, p_version integer, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project board.projects;
  v_name text;
begin
  perform board.enter(p_project, true);
  select * into v_project from board.projects p where p.id = p_project;
  if p_version is distinct from v_project.version then
    perform board.refuse('STALE');
  end if;
  v_name := board.clean(p_name, 'name', 1, 80);
  if v_name <> v_project.name then
    update board.projects p set name = v_name, version = p.version + 1, updated_at = now()
     where p.id = p_project returning * into v_project;
    perform board.log(p_project, null, null, v_actor, 'project_renamed', array['name']);
  end if;
  return board.project_json(v_project);
end
$$;
revoke all on function public.board_project_rename(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.board_project_rename(uuid, integer, text) to authenticated;

create or replace function public.board_project_archive(p_project uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project board.projects;
begin
  perform board.enter(p_project, true);
  select * into v_project from board.projects p where p.id = p_project;
  if p_version is distinct from v_project.version then
    perform board.refuse('STALE');
  end if;
  if v_project.archived_at is null then
    update board.projects p set archived_at = now(), version = p.version + 1, updated_at = now()
     where p.id = p_project returning * into v_project;
    perform board.log(p_project, null, null, v_actor, 'project_archived');
  end if;
  return board.project_json(v_project);
end
$$;
revoke all on function public.board_project_archive(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_project_archive(uuid, integer) to authenticated;

-- Restoring takes no version (the lock orders it), but it changes the row, so it bumps the version. A project that is not
-- archived is answered as it is. The cap of 50 open projects holds here too.
create or replace function public.board_project_restore(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project board.projects;
begin
  perform board.enter(p_project, true);
  select * into v_project from board.projects p where p.id = p_project;
  if v_project.archived_at is not null then
    perform pg_advisory_xact_lock(hashtext('board.projects'));
    if (select count(*) from board.projects p where p.archived_at is null) >= 50 then
      perform board.refuse('LIMIT', 'projects');
    end if;
    update board.projects p set archived_at = null, version = p.version + 1, updated_at = now()
     where p.id = p_project returning * into v_project;
    perform board.log(p_project, null, null, v_actor, 'project_restored');
  end if;
  return board.project_json(v_project);
end
$$;
revoke all on function public.board_project_restore(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_project_restore(uuid) to authenticated;

-- Deleted only once archived, with every row of it; the one record is the audit event (the project's id, no name).
create or replace function public.board_project_delete(p_project uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project board.projects;
begin
  perform board.enter(p_project, true);
  select * into v_project from board.projects p where p.id = p_project;
  if p_version is distinct from v_project.version then
    perform board.refuse('STALE');
  end if;
  if v_project.archived_at is null then
    perform board.refuse('INVALID');
  end if;
  delete from board.projects p where p.id = p_project;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (v_actor, 'board.project_deleted', 'board', p_project::text, '{}'::jsonb);
  return jsonb_build_object('id', p_project);
end
$$;
revoke all on function public.board_project_delete(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_project_delete(uuid, integer) to authenticated;

-- Adds a person or changes their role. Refuses an owner, an inactive or unknown person (INVALID people) and the 31st
-- (LIMIT people: the active members who are not owners, the people the owner sees). Turning a member into a viewer takes
-- them off the project's cards in the same transaction. The same role again changes nothing.
create or replace function public.board_person_set(p_project uuid, p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_person public.staff;
  v_current text;
begin
  perform board.enter(p_project, true);
  if p_role is null or p_role not in ('member', 'viewer') then
    perform board.refuse('INVALID', 'role');
  end if;
  select * into v_person from public.staff s where s.user_id = p_user;
  if not found or not v_person.active or v_person.role = 'owner' then
    perform board.refuse('INVALID', 'people');
  end if;
  select m.role into v_current from board.members m where m.project_id = p_project and m.user_id = p_user;
  if not found then
    if (select count(*) from board.members m join public.staff s on s.user_id = m.user_id
         where m.project_id = p_project and s.active and s.role <> 'owner') >= 30 then
      perform board.refuse('LIMIT', 'people');
    end if;
    insert into board.members (project_id, user_id, role, added_by) values (p_project, p_user, p_role, v_actor);
    perform board.log(p_project, null, p_user, v_actor, 'person_added', '{}', null, null, p_role);
  elsif v_current <> p_role then
    update board.members m set role = p_role where m.project_id = p_project and m.user_id = p_user;
    if p_role = 'viewer' then
      delete from board.card_people cp
       using board.cards c
       where cp.card_id = c.id and c.project_id = p_project and cp.user_id = p_user;
    end if;
    perform board.log(p_project, null, p_user, v_actor, 'person_role_changed', '{}', null, null, p_role);
  end if;
  return jsonb_build_object('id', p_user, 'name', v_person.display_name, 'role', p_role);
end
$$;
revoke all on function public.board_person_set(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.board_person_set(uuid, uuid, text) to authenticated;

-- Removes a person from a project: their `members` row and their assignments on its cards. Someone who is not on it
-- changes nothing.
create or replace function public.board_person_remove(p_project uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_removed text;
begin
  perform board.enter(p_project, true);
  delete from board.members m where m.project_id = p_project and m.user_id = p_user returning m.role into v_removed;
  if v_removed is not null then
    delete from board.card_people cp
     using board.cards c
     where cp.card_id = c.id and c.project_id = p_project and cp.user_id = p_user;
    perform board.log(p_project, null, p_user, v_actor, 'person_removed');
  end if;
  return jsonb_build_object('id', p_user);
end
$$;
revoke all on function public.board_person_remove(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_person_remove(uuid, uuid) to authenticated;

-- 4. Writes: columns (owners) ------------------------------------------------------------------------------------------------

create or replace function public.board_column_create(p_project uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_name text;
  v_column board.columns;
begin
  perform board.enter(p_project, true);
  v_name := board.clean(p_name, 'name', 1, 40);
  if (select count(*) from board.columns k where k.project_id = p_project) >= 12 then
    perform board.refuse('LIMIT', 'columns');
  end if;
  insert into board.columns (project_id, name, position)
  values (p_project, v_name, coalesce((select max(k.position) from board.columns k where k.project_id = p_project), 0) + 1)
  returning * into v_column;
  perform board.log(p_project, null, null, v_actor, 'column_created', '{}', null, v_column.id);
  return board.column_json(v_column);
end
$$;
revoke all on function public.board_column_create(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.board_column_create(uuid, text) to authenticated;

-- `name`, `hidden` and `isDone`. Marking a column done moves the mark off the project's other done column: the cards of
-- the column that loses it lose their `done_at`, the open cards of the one that gets it are done now.
create or replace function public.board_column_update(p_column uuid, p_version integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_column board.columns;
  v_name text;
  v_hidden boolean;
  v_done boolean;
  v_fields text[] := '{}';
  v_previous uuid;
begin
  select k.project_id into v_project from board.columns k where k.id = p_column;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, true);
  perform 1 from board.columns k where k.project_id = v_project order by k.id for update;
  select * into v_column from board.columns k where k.id = p_column;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_column.version then
    perform board.refuse('STALE');
  end if;
  if not board.only_keys(p_changes, array['name', 'hidden', 'isDone']) then
    perform board.refuse('INVALID');
  end if;
  v_name := v_column.name;
  v_hidden := v_column.hidden;
  v_done := v_column.is_done;
  if p_changes ? 'name' then
    if jsonb_typeof(p_changes -> 'name') is distinct from 'string' then
      perform board.refuse('INVALID', 'name');
    end if;
    v_name := board.clean(p_changes ->> 'name', 'name', 1, 40);
    if v_name <> v_column.name then
      v_fields := array_append(v_fields, 'name');
    end if;
  end if;
  if p_changes ? 'hidden' then
    if jsonb_typeof(p_changes -> 'hidden') is distinct from 'boolean' then
      perform board.refuse('INVALID');
    end if;
    v_hidden := (p_changes ->> 'hidden')::boolean;
    if v_hidden <> v_column.hidden then
      v_fields := array_append(v_fields, 'hidden');
    end if;
  end if;
  if p_changes ? 'isDone' then
    if jsonb_typeof(p_changes -> 'isDone') is distinct from 'boolean' then
      perform board.refuse('INVALID');
    end if;
    v_done := (p_changes ->> 'isDone')::boolean;
    if v_done <> v_column.is_done then
      v_fields := array_append(v_fields, 'done');
    end if;
  end if;
  if cardinality(v_fields) = 0 then
    return board.column_json(v_column);
  end if;

  if v_done <> v_column.is_done then
    -- The cards of every column whose mark changes, locked in ascending id before their `done_at` moves.
    perform 1 from board.cards c
     where c.column_id = p_column or c.column_id = (select k.id from board.columns k where k.project_id = v_project and k.is_done)
     order by c.id for update;
    if v_done then
      -- The mark leaves the project's other done column first (one done column per project, an index).
      update board.columns k set is_done = false, version = k.version + 1
       where k.project_id = v_project and k.is_done and k.id <> p_column
       returning k.id into v_previous;
      if v_previous is not null then
        update board.cards c set done_at = null where c.column_id = v_previous;
      end if;
      update board.cards c set done_at = coalesce(c.done_at, now()) where c.column_id = p_column and c.archived_at is null;
    else
      update board.cards c set done_at = null where c.column_id = p_column;
    end if;
  end if;
  update board.columns k set name = v_name, hidden = v_hidden, is_done = v_done, version = k.version + 1
   where k.id = p_column returning * into v_column;
  perform board.log(v_project, null, null, v_actor, 'column_changed',
    array(select f from unnest(array['name', 'hidden', 'done']) f where f = any (v_fields)), null, p_column);
  return board.column_json(v_column);
end
$$;
revoke all on function public.board_column_update(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.board_column_update(uuid, integer, jsonb) to authenticated;

-- Moves a column to a position (clamped to 1 to n) and renumbers the columns it passes; their version stays.
create or replace function public.board_column_move(p_column uuid, p_version integer, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_column board.columns;
  v_n integer;
  v_to integer;
begin
  select k.project_id into v_project from board.columns k where k.id = p_column;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, true);
  perform 1 from board.columns k where k.project_id = v_project order by k.id for update;
  select * into v_column from board.columns k where k.id = p_column;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_column.version then
    perform board.refuse('STALE');
  end if;
  if p_position is null then
    perform board.refuse('INVALID', 'position');
  end if;
  select count(*) into v_n from board.columns k where k.project_id = v_project;
  v_to := least(greatest(p_position, 1), v_n);
  if v_to <> v_column.position then
    if v_to > v_column.position then
      update board.columns k set position = k.position - 1
       where k.project_id = v_project and k.position > v_column.position and k.position <= v_to;
    else
      update board.columns k set position = k.position + 1
       where k.project_id = v_project and k.position >= v_to and k.position < v_column.position;
    end if;
    update board.columns k set position = v_to, version = k.version + 1 where k.id = p_column returning * into v_column;
    perform board.log(v_project, null, null, v_actor, 'column_moved', '{}', null, p_column);
  end if;
  return board.column_json(v_column);
end
$$;
revoke all on function public.board_column_move(uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_column_move(uuid, integer, integer) to authenticated;

-- Deleted only when it holds no open card (NOT_EMPTY); its archived cards move to the project's first column and keep no
-- position. A column that is the project's only one and still holds archived cards has nowhere to send them: NOT_EMPTY too.
create or replace function public.board_column_delete(p_column uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_column board.columns;
  v_first uuid;
begin
  select k.project_id into v_project from board.columns k where k.id = p_column;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, true);
  perform 1 from board.columns k where k.project_id = v_project order by k.id for update;
  select * into v_column from board.columns k where k.id = p_column;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_column.version then
    perform board.refuse('STALE');
  end if;
  perform 1 from board.cards c where c.column_id = p_column order by c.id for update;
  if exists (select 1 from board.cards c where c.column_id = p_column and c.archived_at is null) then
    perform board.refuse('NOT_EMPTY');
  end if;
  select k.id into v_first from board.columns k where k.project_id = v_project and k.id <> p_column order by k.position limit 1;
  if v_first is null and exists (select 1 from board.cards c where c.column_id = p_column) then
    perform board.refuse('NOT_EMPTY');
  end if;
  -- Only archived cards are left here; they keep no position, and a project without a done column has no done cards.
  update board.cards c set column_id = v_first, done_at = null where c.column_id = p_column;
  delete from board.columns k where k.id = p_column;
  update board.columns k set position = k.position - 1 where k.project_id = v_project and k.position > v_column.position;
  perform board.log(v_project, null, null, v_actor, 'column_deleted');
  return jsonb_build_object('id', p_column);
end
$$;
revoke all on function public.board_column_delete(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_column_delete(uuid, integer) to authenticated;

-- 4. Writes: labels (owners) -------------------------------------------------------------------------------------------------

create or replace function public.board_label_create(p_project uuid, p_name text, p_tone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_name text;
  v_label board.labels;
begin
  perform board.enter(p_project, true);
  v_name := board.clean(p_name, 'name', 1, 24);
  if p_tone is null or p_tone not in ('saffron', 'coral', 'sand', 'aub') then
    perform board.refuse('INVALID', 'tone');
  end if;
  if (select count(*) from board.labels l where l.project_id = p_project) >= 16 then
    perform board.refuse('LIMIT', 'labels');
  end if;
  if exists (select 1 from board.labels l where l.project_id = p_project and lower(l.name) = lower(v_name)) then
    perform board.refuse('INVALID', 'name');
  end if;
  insert into board.labels (project_id, name, tone) values (p_project, v_name, p_tone) returning * into v_label;
  perform board.log(p_project, null, null, v_actor, 'label_created');
  return board.label_json(v_label);
end
$$;
revoke all on function public.board_label_create(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.board_label_create(uuid, text, text) to authenticated;

create or replace function public.board_label_update(p_label uuid, p_version integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_label board.labels;
  v_name text;
  v_tone text;
  v_fields text[] := '{}';
begin
  select l.project_id into v_project from board.labels l where l.id = p_label;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, true);
  select * into v_label from board.labels l where l.id = p_label for update;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_label.version then
    perform board.refuse('STALE');
  end if;
  if not board.only_keys(p_changes, array['name', 'tone']) then
    perform board.refuse('INVALID');
  end if;
  v_name := v_label.name;
  v_tone := v_label.tone;
  if p_changes ? 'name' then
    if jsonb_typeof(p_changes -> 'name') is distinct from 'string' then
      perform board.refuse('INVALID', 'name');
    end if;
    v_name := board.clean(p_changes ->> 'name', 'name', 1, 24);
    if exists (select 1 from board.labels l where l.project_id = v_project and l.id <> p_label and lower(l.name) = lower(v_name)) then
      perform board.refuse('INVALID', 'name');
    end if;
    if v_name <> v_label.name then
      v_fields := array_append(v_fields, 'name');
    end if;
  end if;
  if p_changes ? 'tone' then
    if jsonb_typeof(p_changes -> 'tone') is distinct from 'string' or (p_changes ->> 'tone') not in ('saffron', 'coral', 'sand', 'aub') then
      perform board.refuse('INVALID', 'tone');
    end if;
    v_tone := p_changes ->> 'tone';
    if v_tone <> v_label.tone then
      v_fields := array_append(v_fields, 'tone');
    end if;
  end if;
  if cardinality(v_fields) > 0 then
    update board.labels l set name = v_name, tone = v_tone, version = l.version + 1 where l.id = p_label returning * into v_label;
    perform board.log(v_project, null, null, v_actor, 'label_changed', v_fields);
  end if;
  return board.label_json(v_label);
end
$$;
revoke all on function public.board_label_update(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.board_label_update(uuid, integer, jsonb) to authenticated;

-- Deleting a label takes it off the cards that hold it; their versions stay.
create or replace function public.board_label_delete(p_label uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_label board.labels;
begin
  select l.project_id into v_project from board.labels l where l.id = p_label;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, true);
  select * into v_label from board.labels l where l.id = p_label for update;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_label.version then
    perform board.refuse('STALE');
  end if;
  delete from board.labels l where l.id = p_label;
  perform board.log(v_project, null, null, v_actor, 'label_deleted');
  return jsonb_build_object('id', p_label);
end
$$;
revoke all on function public.board_label_delete(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_label_delete(uuid, integer) to authenticated;

-- 4. Writes: cards (owners and members) ----------------------------------------------------------------------------------------

-- A card goes last in its column; into the done column it is done now. At most 1,000 open cards per project.
create or replace function public.board_card_create(p_column uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_project uuid;
  v_column board.columns;
  v_title text;
  v_card board.cards;
begin
  select k.project_id into v_project from board.columns k where k.id = p_column;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, false);
  select * into v_column from board.columns k where k.id = p_column for update;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  v_title := board.clean(p_title, 'title', 1, 200);
  if (select count(*) from board.cards c where c.project_id = v_project and c.archived_at is null) >= 1000 then
    perform board.refuse('LIMIT', 'cards');
  end if;
  insert into board.cards (project_id, column_id, position, title, done_at, created_by)
  values (
    v_project, p_column,
    coalesce((select max(c.position) from board.cards c where c.column_id = p_column and c.archived_at is null), 0) + 1,
    v_title, case when v_column.is_done then now() end, v_actor
  )
  returning * into v_card;
  perform board.log(v_project, v_card.id, null, v_actor, 'card_created');
  return board.card_json(v_card, board.content_rights());
end
$$;
revoke all on function public.board_card_create(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.board_card_create(uuid, text) to authenticated;

-- Only the keys the caller changed arrive. A key whose value is the card's own changes nothing (and writes nothing); a
-- people list replaces the assignments of the people who can be assigned now, so the assignment of a deactivated person
-- survives until they are active again. The cap of 10 counts the people the card shows: a reactivated person may return
-- past it, and the next save of the people must come back within it.
create or replace function public.board_card_update(p_card uuid, p_version integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_priv boolean := board.content_rights();
  v_project uuid;
  v_card board.cards;
  v_title text;
  v_notes text;
  v_priority text;
  v_due date;
  v_link_collection text;
  v_link_doc text;
  v_fields text[] := '{}';
  v_value jsonb;
  v_labels uuid[];
  v_people uuid[];
  v_current uuid[];
  v_labels_changed boolean := false;
  v_people_changed boolean := false;
  v_norm jsonb;
  v_checklist_changed boolean := false;
  v_item jsonb;
  v_id uuid;
  v_seen uuid[] := '{}';
  v_text text;
begin
  select c.project_id into v_project from board.cards c where c.id = p_card;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, false);
  select * into v_card from board.cards c where c.id = p_card for update;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_version is distinct from v_card.version then
    perform board.refuse('STALE');
  end if;
  -- An archived card is not on the board: it is restored first.
  if v_card.archived_at is not null then
    perform board.refuse('NOT_FOUND');
  end if;
  if not board.only_keys(p_changes, array['title', 'notes', 'priority', 'dueOn', 'labels', 'people', 'checklist', 'link']) then
    perform board.refuse('INVALID');
  end if;
  v_title := v_card.title;
  v_notes := v_card.notes;
  v_priority := v_card.priority;
  v_due := v_card.due_on;
  v_link_collection := v_card.link_collection;
  v_link_doc := v_card.link_doc_id;

  if p_changes ? 'title' then
    if jsonb_typeof(p_changes -> 'title') is distinct from 'string' then
      perform board.refuse('INVALID', 'title');
    end if;
    v_title := board.clean(p_changes ->> 'title', 'title', 1, 200);
    if v_title <> v_card.title then
      v_fields := array_append(v_fields, 'title');
    end if;
  end if;
  if p_changes ? 'notes' then
    if jsonb_typeof(p_changes -> 'notes') is distinct from 'string' then
      perform board.refuse('INVALID', 'notes');
    end if;
    v_notes := board.clean(p_changes ->> 'notes', 'notes', 0, 5000, true);
    if v_notes <> v_card.notes then
      v_fields := array_append(v_fields, 'notes');
    end if;
  end if;
  if p_changes ? 'priority' then
    if jsonb_typeof(p_changes -> 'priority') is distinct from 'string' or (p_changes ->> 'priority') not in ('urgent', 'normal', 'low') then
      perform board.refuse('INVALID');
    end if;
    v_priority := p_changes ->> 'priority';
    if v_priority <> v_card.priority then
      v_fields := array_append(v_fields, 'priority');
    end if;
  end if;
  if p_changes ? 'dueOn' then
    v_value := p_changes -> 'dueOn';
    if jsonb_typeof(v_value) = 'null' then
      v_due := null;
    elsif jsonb_typeof(v_value) = 'string' then
      v_due := board.parse_day(v_value #>> '{}');
      if v_due is null then
        perform board.refuse('INVALID', 'due_on');
      end if;
    else
      perform board.refuse('INVALID', 'due_on');
    end if;
    if v_due is distinct from v_card.due_on then
      v_fields := array_append(v_fields, 'due_on');
    end if;
  end if;
  if p_changes ? 'labels' then
    v_labels := board.uuids(p_changes -> 'labels');
    if v_labels is null
       or exists (
         select 1 from unnest(v_labels) l
          where not exists (select 1 from board.labels b where b.id = l and b.project_id = v_project)
       ) then
      perform board.refuse('INVALID', 'labels');
    end if;
    v_current := array(select cl.label_id from board.card_labels cl where cl.card_id = p_card order by cl.label_id);
    v_labels_changed := v_labels is distinct from v_current;
    if v_labels_changed then
      v_fields := array_append(v_fields, 'labels');
    end if;
  end if;
  if p_changes ? 'people' then
    v_people := board.uuids(p_changes -> 'people');
    if v_people is null or exists (select 1 from unnest(v_people) u where not board.is_assignable(v_project, u)) then
      perform board.refuse('INVALID', 'people');
    end if;
    if cardinality(v_people) > 10 then
      perform board.refuse('LIMIT', 'card_people');
    end if;
    v_current := array(
      select cp.user_id from board.card_people cp
       where cp.card_id = p_card and board.is_assignable(v_project, cp.user_id) order by cp.user_id
    );
    v_people_changed := v_people is distinct from v_current;
    if v_people_changed then
      v_fields := array_append(v_fields, 'people');
    end if;
  end if;
  if p_changes ? 'checklist' then
    v_value := p_changes -> 'checklist';
    if jsonb_typeof(v_value) is distinct from 'array' then
      perform board.refuse('INVALID', 'checklist');
    end if;
    if jsonb_array_length(v_value) > 50 then
      perform board.refuse('LIMIT', 'checklist');
    end if;
    v_norm := '[]'::jsonb;
    for v_item in select e from jsonb_array_elements(v_value) e loop
      if not board.only_keys(v_item, array['id', 'text', 'done'])
         or jsonb_typeof(v_item -> 'text') is distinct from 'string'
         or jsonb_typeof(v_item -> 'done') is distinct from 'boolean' then
        perform board.refuse('INVALID', 'checklist');
      end if;
      v_text := board.clean(v_item ->> 'text', 'checklist', 1, 200);
      v_id := null;
      if v_item ? 'id' and jsonb_typeof(v_item -> 'id') <> 'null' then
        if jsonb_typeof(v_item -> 'id') <> 'string'
           or (v_item ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          perform board.refuse('INVALID', 'checklist');
        end if;
        v_id := (v_item ->> 'id')::uuid;
        -- An existing item of this card, used once.
        if v_id = any (v_seen) or not exists (select 1 from board.checklist x where x.id = v_id and x.card_id = p_card) then
          perform board.refuse('INVALID', 'checklist');
        end if;
        v_seen := array_append(v_seen, v_id);
      end if;
      v_norm := v_norm || jsonb_build_array(jsonb_build_object('id', v_id, 'text', v_text, 'done', (v_item ->> 'done')::boolean));
    end loop;
    v_checklist_changed := v_norm is distinct from coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'text', x.text, 'done', x.done) order by x.position, x.id)
        from board.checklist x where x.card_id = p_card
    ), '[]'::jsonb);
    if v_checklist_changed then
      v_fields := array_append(v_fields, 'checklist');
    end if;
  end if;
  if p_changes ? 'link' then
    v_value := p_changes -> 'link';
    if jsonb_typeof(v_value) = 'null' then
      v_link_collection := null;
      v_link_doc := null;
    elsif board.only_keys(v_value, array['collection', 'docId'])
          and jsonb_typeof(v_value -> 'collection') = 'string' and jsonb_typeof(v_value -> 'docId') = 'string'
          and (v_value ->> 'collection') in ('posts', 'rooms')
          and (v_value ->> 'docId') ~ '^[a-z0-9][a-z0-9-]{0,79}$' then
      v_link_collection := v_value ->> 'collection';
      v_link_doc := v_value ->> 'docId';
    else
      perform board.refuse('INVALID', 'link');
    end if;
    if v_link_collection is distinct from v_card.link_collection or v_link_doc is distinct from v_card.link_doc_id then
      -- Only a link the caller's own `board_link_targets` holds; taking the link off is always allowed.
      if v_link_collection is not null and not board.link_visible(v_link_collection, v_link_doc, v_priv) then
        perform board.refuse('INVALID', 'link');
      end if;
      v_fields := array_append(v_fields, 'link');
    end if;
  end if;

  if cardinality(v_fields) = 0 then
    return board.card_json(v_card, v_priv);
  end if;
  update board.cards c
     set title = v_title, notes = v_notes, priority = v_priority, due_on = v_due,
         link_collection = v_link_collection, link_doc_id = v_link_doc,
         version = c.version + 1, updated_at = now()
   where c.id = p_card
   returning * into v_card;
  if v_labels_changed then
    delete from board.card_labels cl where cl.card_id = p_card;
    insert into board.card_labels (card_id, label_id) select p_card, l from unnest(v_labels) l;
  end if;
  if v_people_changed then
    -- Only the people who can be assigned now are replaced; the rest (a deactivated person's) stay.
    delete from board.card_people cp
     where cp.card_id = p_card and board.is_assignable(v_project, cp.user_id) and cp.user_id <> all (v_people);
    insert into board.card_people (card_id, user_id) select p_card, u from unnest(v_people) u on conflict do nothing;
  end if;
  if v_checklist_changed then
    delete from board.checklist x
     where x.card_id = p_card
       and x.id <> all (array(select (e ->> 'id')::uuid from jsonb_array_elements(v_norm) e where jsonb_typeof(e -> 'id') = 'string'));
    update board.checklist x set text = n.text, done = n.done, position = n.ord
      from (
        select (t.e ->> 'id')::uuid as id, t.e ->> 'text' as text, (t.e ->> 'done')::boolean as done, t.ord::integer as ord
          from jsonb_array_elements(v_norm) with ordinality as t(e, ord)
         where jsonb_typeof(t.e -> 'id') = 'string'
      ) n
     where x.id = n.id and x.card_id = p_card;
    insert into board.checklist (card_id, text, done, position)
    select p_card, t.e ->> 'text', (t.e ->> 'done')::boolean, t.ord::integer
      from jsonb_array_elements(v_norm) with ordinality as t(e, ord)
     where jsonb_typeof(t.e -> 'id') = 'null';
  end if;
  perform board.log(v_project, p_card, null, v_actor, 'card_edited',
    array(select f from unnest(array['title', 'notes', 'priority', 'due_on', 'labels', 'people', 'checklist', 'link']) f where f = any (v_fields)));
  return board.card_json(v_card, v_priv);
end
$$;
revoke all on function public.board_card_update(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.board_card_update(uuid, integer, jsonb) to authenticated;

-- Moves a card to a column and a position (clamped to 1 to n + 1) and renumbers the cards it passes (their position only).
-- `done_at` is set when the card enters the done column and cleared when it leaves it. The answer is the card and the
-- positions of the columns it touched.
create or replace function public.board_card_move(p_card uuid, p_version integer, p_column uuid, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_priv boolean := board.content_rights();
  v_project uuid;
  v_card board.cards;
  v_to board.columns;
  v_from_column uuid;
  v_from_position integer;
  v_n integer;
  v_position integer;
begin
  select c.project_id into v_project from board.cards c where c.id = p_card;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, false);
  select * into v_card from board.cards c where c.id = p_card;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  select * into v_to from board.columns k where k.id = p_column and k.project_id = v_project;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  -- The columns it touches in ascending id, then the cards in ascending id.
  perform 1 from board.columns k where k.id in (v_card.column_id, p_column) order by k.id for update;
  perform 1 from board.cards c
   where c.id = p_card or (c.column_id in (v_card.column_id, p_column) and c.archived_at is null)
   order by c.id for update;
  select * into v_card from board.cards c where c.id = p_card;
  if p_version is distinct from v_card.version then
    perform board.refuse('STALE');
  end if;
  if v_card.archived_at is not null then
    perform board.refuse('NOT_FOUND');
  end if;
  if p_position is null then
    perform board.refuse('INVALID', 'position');
  end if;
  v_from_column := v_card.column_id;
  v_from_position := v_card.position;
  select count(*) into v_n from board.cards c where c.column_id = p_column and c.archived_at is null and c.id <> p_card;
  v_position := least(greatest(p_position, 1), v_n + 1);
  if p_column <> v_from_column or v_position <> v_from_position then
    if p_column <> v_from_column then
      update board.cards c set position = c.position - 1
       where c.column_id = v_from_column and c.archived_at is null and c.position > v_from_position;
      update board.cards c set position = c.position + 1
       where c.column_id = p_column and c.archived_at is null and c.position >= v_position;
    elsif v_position > v_from_position then
      update board.cards c set position = c.position - 1
       where c.column_id = p_column and c.archived_at is null and c.position > v_from_position and c.position <= v_position;
    else
      update board.cards c set position = c.position + 1
       where c.column_id = p_column and c.archived_at is null and c.position >= v_position and c.position < v_from_position;
    end if;
    update board.cards c
       set column_id = p_column, position = v_position, version = c.version + 1, updated_at = now(),
           done_at = case
             when not v_to.is_done then null
             when p_column = v_from_column then coalesce(c.done_at, now())
             else now()
           end
     where c.id = p_card
     returning * into v_card;
    perform board.log(v_project, p_card, null, v_actor, 'card_moved', '{}', v_from_column, p_column);
  end if;
  return jsonb_build_object(
    'card', board.card_json(v_card, v_priv),
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', k.id,
               'cards', coalesce((
                 select jsonb_agg(jsonb_build_object('id', c.id, 'position', c.position) order by c.position)
                   from board.cards c where c.column_id = k.id and c.archived_at is null
               ), '[]'::jsonb)
             ) order by k.position)
        from board.columns k where k.id in (v_from_column, p_column)
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.board_card_move(uuid, integer, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_card_move(uuid, integer, uuid, integer) to authenticated;

-- Archives a card: it keeps its column and loses its position, and the cards after it close the gap. An archived card is
-- answered as it is.
create or replace function public.board_card_archive(p_card uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_priv boolean := board.content_rights();
  v_project uuid;
  v_card board.cards;
  v_position integer;
begin
  select c.project_id into v_project from board.cards c where c.id = p_card;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, false);
  select * into v_card from board.cards c where c.id = p_card;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  perform 1 from board.columns k where k.id = v_card.column_id for update;
  perform 1 from board.cards c
   where c.id = p_card or (c.column_id = v_card.column_id and c.archived_at is null)
   order by c.id for update;
  select * into v_card from board.cards c where c.id = p_card;
  if p_version is distinct from v_card.version then
    perform board.refuse('STALE');
  end if;
  if v_card.archived_at is null then
    v_position := v_card.position;
    update board.cards c set archived_at = now(), position = null, version = c.version + 1, updated_at = now()
     where c.id = p_card returning * into v_card;
    update board.cards c set position = c.position - 1
     where c.column_id = v_card.column_id and c.archived_at is null and c.position > v_position;
    perform board.log(v_project, p_card, null, v_actor, 'card_archived');
  end if;
  return board.card_json(v_card, v_priv);
end
$$;
revoke all on function public.board_card_archive(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_card_archive(uuid, integer) to authenticated;

-- Restores an archived card to the end of its column (done now when that is the done column); an open card is answered as
-- it is. Takes no version, bumps the card's.
create or replace function public.board_card_restore(p_card uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := board.caller();
  v_priv boolean := board.content_rights();
  v_project uuid;
  v_card board.cards;
  v_column board.columns;
begin
  select c.project_id into v_project from board.cards c where c.id = p_card;
  if v_project is null then
    perform board.refuse('NOT_FOUND');
  end if;
  perform board.enter(v_project, false);
  select * into v_card from board.cards c where c.id = p_card;
  if not found then
    perform board.refuse('NOT_FOUND');
  end if;
  select * into v_column from board.columns k where k.id = v_card.column_id for update;
  perform 1 from board.cards c
   where c.id = p_card or (c.column_id = v_card.column_id and c.archived_at is null)
   order by c.id for update;
  select * into v_card from board.cards c where c.id = p_card;
  if v_card.archived_at is not null then
    if (select count(*) from board.cards c where c.project_id = v_project and c.archived_at is null) >= 1000 then
      perform board.refuse('LIMIT', 'cards');
    end if;
    update board.cards c
       set archived_at = null, version = c.version + 1, updated_at = now(),
           position = coalesce((select max(o.position) from board.cards o where o.column_id = c.column_id and o.archived_at is null), 0) + 1,
           done_at = case when v_column.is_done then now() end
     where c.id = p_card
     returning * into v_card;
    perform board.log(v_project, p_card, null, v_actor, 'card_restored');
  end if;
  return board.card_json(v_card, v_priv);
end
$$;
revoke all on function public.board_card_restore(uuid) from public, anon, authenticated, service_role;
grant execute on function public.board_card_restore(uuid) to authenticated;

-- 5. The wall outside the board ---------------------------------------------------------------------------------------------
-- Four policies admitted any staff role, and would admit the board-only role to the catalogue and to the hidden posts. They
-- are recreated with the roles that read them today named; nothing else about them changes.

drop policy if exists products_read_staff on public.products;
create policy products_read_staff on public.products
  for select to authenticated
  using (status = 'published' or (select public.current_staff_role()) in ('owner', 'editor', 'operations'));

drop policy if exists product_variants_read_staff on public.product_variants;
create policy product_variants_read_staff on public.product_variants
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'editor', 'operations'));

drop policy if exists shipping_rates_read_staff on public.shipping_rates;
create policy shipping_rates_read_staff on public.shipping_rates
  for select to authenticated
  using ((select public.current_staff_role()) in ('owner', 'editor', 'operations'));

drop policy if exists published_documents_staff_read on public.published_documents;
create policy published_documents_staff_read on public.published_documents
  for select to authenticated
  using (
    collection <> 'posts'
    or data -> 'visible' = 'true'::jsonb
    or (select public.current_staff_role()) in ('owner', 'editor', 'operations')
  );
