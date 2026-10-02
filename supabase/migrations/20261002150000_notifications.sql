-- P08 round 8: notifications, "tell me when it is back" (PLANS/P08-CONTRACT.md
-- section 6, "Notifications (round 8)"). Functions and cron schedules only: the
-- tables `public.notifications` and `finance.variant_availability`, the outbox
-- kinds and the dispatcher's mail are earlier rounds'. The earlier migrations
-- stay untouched.
--
-- - `finance.variant_public_state` is the one rule for what a visitor may know of
--   a variant: `available`, `preorder`, `out_of_stock` or `unpriced`, or null when
--   the variant is not on the public shelf (disabled, or its product is not
--   published). It ignores unpaid holds, so a hold that comes and goes never
--   flaps it, and it reuses `finance.preorder_committed`, the helper checkout
--   counts a preorder's capacity with. `catalog_availability`, `notify_subscribe`
--   and the sweep all read it; nothing else decides what is for sale.
-- - `catalog_availability` is the page's read, for anon. It returns each state
--   and no number of any kind.
-- - `notify_subscribe` always answers `{ok: true}`. A request that is over the
--   visitor's own throttle raises 54000 like the other public functions (it says
--   nothing about any address or variant); everything else, an unknown or sellable
--   variant, an address that is already confirmed, a mail cap, is the same silence.
--   Mail caps are taken only when a mail is about to be queued, so a refused
--   request never spends the day's 30.
-- - The link functions: `notify_token_info`, `notify_confirm`, `notify_unsubscribe`.
--   The token itself is derived and compared in the Edge Function (nothing about
--   it is stored); the SQL only moves a row at the version the link was derived
--   for. The contract's three signatures carry no caller hash, so the per-IP
--   throttle of both link actions is its own small function, `notify_link_throttle`.
-- - `finance.availability_sweep` (every minute), `finance.notify_confirm_backlog`
--   (hourly) and `finance.notifications_purge` (daily).
--
-- Lock order: the variant's availability row, then its notifications. `notify_subscribe`
-- takes the availability row first and so does the sweep, so two of them never wait
-- for each other in a circle, and two sweeps at once queue each mail once. The purge
-- takes notification rows first, so it never waits for an availability row: it passes
-- by the ones another writer holds.

-- 1. The one rule ------------------------------------------------------------

-- A delivery date that has passed is not for sale (checkout's rule), so a
-- preorder past its date is out of stock for the visitor until the owner moves
-- the date. A digital variant that is not a preorder has no stock (null).
create function finance.variant_public_state(p_variant uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when v.price_halalas is null then 'unpriced'
           when v.preorder then
             case
               when v.preorder_ships_on >= (now() at time zone 'Asia/Riyadh')::date
                 and coalesce(v.preorder_capacity, 0) - finance.preorder_committed(v.id) > 0
               then 'preorder'
               else 'out_of_stock'
             end
           when v.stock is null or v.stock > 0 then 'available'
           else 'out_of_stock'
         end
    from public.product_variants v
    join public.products p on p.id = v.product_id
   where v.id = p_variant and v.enabled and p.status = 'published'
$$;

-- 2. The public read ----------------------------------------------------------

-- Every enabled variant of a published product with its public state. No stock,
-- no capacity, no count: the page learns what to offer, never how much is left.
-- ponytail: one lookup per variant; the catalog is tens of variants.
create function public.catalog_availability()
returns table (variant_id uuid, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.state
    from (select v.id, finance.variant_public_state(v.id) as state from public.product_variants v) s
   where s.state is not null
$$;

-- 3. Sign-up -------------------------------------------------------------------

-- The confirmation mail of a pending row, queued when the caps allow: one per
-- address per UTC day whatever the variant, five per address in 30 days (counted
-- from the outbox: a stranger who keeps signing a victim up, also after an
-- unsubscribe, is stopped there), and 30 a day in all (the outbox sends at most 30
-- as well). Every cap is silent: the row stays, and the hourly backlog job queues
-- what a cap held back, so a visitor who was told "sent" does get the mail. Queued
-- once per row, version and day (the dedupe key); `confirm_sent_at` records when,
-- which is what the link's seven days run from. Answers `queued`, or which cap
-- refused (`address`, `total`), or `gone` for a row that is not pending.
create function finance.notify_confirm_queue(p_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_note public.notifications;
begin
  select * into v_note from public.notifications n where n.id = p_id and n.status = 'pending' for update;
  if not found then
    return 'gone';
  end if;
  if (
    select count(*) from finance.email_outbox o
     where o.kind = 'notify_confirm' and o.recipient = v_note.email and o.created_at > now() - interval '30 days'
  ) >= 5 then
    return 'address';
  end if;
  -- The address first: a spent address must not also spend the day's total.
  if not finance.rate_limit_take('notify-confirm:email', finance.recipient_hash(v_note.email), 1, interval '1 day') then
    return 'address';
  end if;
  if not finance.rate_limit_take('notify-confirm:all', repeat('0', 64), 30, interval '1 day') then
    return 'total';
  end if;
  insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
  values ('notify_confirm:' || v_note.id::text || ':' || v_note.token_version::text || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
          'notify_confirm', 2, v_note.email, jsonb_build_object('notificationId', v_note.id))
  on conflict (dedupe_key) do nothing;
  if not found then
    return 'address';
  end if;
  update public.notifications n set confirm_sent_at = now() where n.id = p_id;
  return 'queued';
end
$$;

-- Hourly. The pending rows a cap left without their confirmation mail (the day's
-- 30 were spent, or the address had its mail for another variant that day), the
-- longest waiting first, until the day's total is spent. It takes notification
-- rows only, one at a time, so it waits for nobody's availability row. Answers
-- the mails queued.
-- ponytail: the 200 longest waiting per run; a row held by its address's caps is
-- passed over each hour until the purge takes it (7 days after its last request).
create function finance.notify_confirm_backlog()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_queued integer := 0;
begin
  for r in
    select n.id from public.notifications n
     where n.status = 'pending' and n.confirm_sent_at is null
     order by n.updated_at, n.id
     limit 200
  loop
    v_result := finance.notify_confirm_queue(r.id);
    exit when v_result = 'total';
    if v_result = 'queued' then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end
$$;

-- The visitor's request for a variant that is out of stock. Throttled 5 per hour
-- per caller hash (54000 when over, before anything is read). Then only a variant
-- that is published, enabled and out of stock does anything; for every other
-- variant the answer is the same `{ok: true}`. Creates the row as `pending`, or
-- re-opens an `unsubscribed` one as `pending` (a new subscription: its old links
-- died with the unsubscribe), and leaves a `confirmed` row exactly as it is. The
-- variant's availability row is created with `sellable = false`; a stale `true`
-- (the variant sold out again while nobody confirmed was waiting) is made false,
-- because the variant is out of stock now and its next restock must be a new
-- revision, one that every subscriber is told, whoever was told the last. Both
-- are decided under the availability row's lock, with the state read again: a
-- sign-up that waited behind a sweep which saw a restock stores nothing and
-- leaves the row as the sweep set it.
--
-- The confirmation mail is `finance.notify_confirm_queue`'s, with its caps.
create function public.notify_subscribe(p_ip_hash text, p_email text, p_variant uuid, p_consent_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note public.notifications;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or p_variant is null
    or char_length(v_email) not between 3 and 254
    or v_email !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  then
    raise exception 'Invalid notification request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('notify:ip', p_ip_hash, 5, interval '1 hour') then
    raise exception 'Too many requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  if finance.variant_public_state(p_variant) is distinct from 'out_of_stock' then
    return jsonb_build_object('ok', true);
  end if;

  -- The availability row, locked, and the state read again under it (a new statement sees what was committed while
  -- this one waited): a sweep that held the row may have seen a restock, and the variant is then on sale.
  insert into finance.variant_availability (variant_id) values (p_variant) on conflict (variant_id) do nothing;
  perform 1 from finance.variant_availability a where a.variant_id = p_variant for update;
  if finance.variant_public_state(p_variant) is distinct from 'out_of_stock' then
    return jsonb_build_object('ok', true);
  end if;
  update finance.variant_availability a set sellable = false, changed_at = now() where a.variant_id = p_variant and a.sellable;

  -- A confirmed row fails the update's condition: nothing changes and nothing returns.
  insert into public.notifications as n (email, variant_id, status, consent_revision)
  values (v_email, p_variant, 'pending', p_consent_revision)
  on conflict (email, variant_id) do update
    set status = 'pending',
        consent_revision = excluded.consent_revision,
        confirm_sent_at = case when n.status = 'unsubscribed' then null else n.confirm_sent_at end,
        confirmed_at = null,
        unsubscribed_at = null,
        updated_at = now()
    where n.status <> 'confirmed'
  returning n.* into v_note;
  if not found then
    return jsonb_build_object('ok', true);
  end if;

  perform finance.notify_confirm_queue(v_note.id);
  return jsonb_build_object('ok', true);
end
$$;

-- 4. The links ------------------------------------------------------------------

-- What the function needs to check a link: the version its mac was derived for,
-- the status and when the confirmation mail was queued. Null for an unknown id.
create function public.notify_token_info(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('tokenVersion', n.token_version, 'status', n.status, 'confirmSentAt', n.confirm_sent_at)
    from public.notifications n
   where n.id = p_id
$$;

-- The caller's allowance for the two link actions: 60 an hour per caller hash
-- (54000 when over). A link is clicked a few times; this only slows a guesser.
create function public.notify_link_throttle(p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid notification request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('notify-link:ip', p_ip_hash, 60, interval '1 hour') then
    raise exception 'Too many requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;
end
$$;

-- A `pending` row at the version the link was derived for becomes `confirmed`.
-- A repeat on a row that is already confirmed at that version answers the same
-- success; any other row, version or id is NOT_FOUND.
create function public.notify_confirm(p_id uuid, p_token_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_token_version is null then
    raise exception 'Invalid notification request.' using errcode = 'invalid_parameter_value';
  end if;
  update public.notifications n
     set status = 'confirmed', confirmed_at = now(), updated_at = now()
   where n.id = p_id and n.token_version = p_token_version and n.status = 'pending';
  if found or exists (
    select 1 from public.notifications n
     where n.id = p_id and n.token_version = p_token_version and n.status = 'confirmed'
  ) then
    return jsonb_build_object('ok', true, 'status', 'confirmed');
  end if;
  return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
end
$$;

-- A `pending` or `confirmed` row at that version becomes `unsubscribed` and its
-- version moves on, so every link mailed so far is dead (the next sign-up gets its
-- own). The mail it still had waiting goes with it: removed like the outbox rows
-- of an erased contact, so a later sign-up never revives a notice that was queued
-- for the earlier one. A row being sent right now (`sending`) and the sent history
-- stay; the dispatcher rechecks the status when it renders.
create function public.notify_unsubscribe(p_id uuid, p_token_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id is null or p_token_version is null then
    raise exception 'Invalid notification request.' using errcode = 'invalid_parameter_value';
  end if;
  update public.notifications n
     set status = 'unsubscribed', token_version = n.token_version + 1, unsubscribed_at = now(), updated_at = now()
   where n.id = p_id and n.token_version = p_token_version and n.status in ('pending', 'confirmed');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  delete from finance.email_outbox o
   where o.kind in ('notify_confirm', 'availability')
     and o.payload ->> 'notificationId' = p_id::text
     and o.status not in ('sent', 'sending');
  return jsonb_build_object('ok', true, 'status', 'unsubscribed');
end
$$;

-- 5. The sweep -----------------------------------------------------------------

-- Every minute. For each availability row that has a confirmed subscriber, and
-- only those: is the variant sellable now (on the public shelf, priced, and
-- `available` or `preorder`)? False to true adds one to the revision; true to
-- false just stores false. While the variant is sellable, each confirmed
-- subscriber who has not been told the row's revision gets one `availability` mail
-- and is marked told: everyone after the flip, and at the next run whoever
-- confirmed after it (the row is already true by then, and the flip made for the
-- others must not leave them out). A row starts false at the first subscription,
-- and a variant nobody confirmed for is never read at all. The rows are locked one
-- at a time in ascending id (a second run waits, then finds nothing to change), the
-- availability row before its notifications. While checkout is switched off the
-- sweep does nothing at all: nobody is told that something is back while nothing
-- can be bought, and no row moves, so opening the shop is what tells the
-- subscribers of what came back meanwhile, and closing and opening it again tells
-- nobody twice. Answers the mails queued.
create function finance.availability_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_sellable boolean;
  v_revision integer;
  v_queued integer := 0;
  v_count integer;
begin
  if not coalesce((select s.checkout_enabled from finance.commerce_settings s where s.id = 1), false) then
    return 0;
  end if;
  for r in
    select a.variant_id, a.sellable, a.revision
      from finance.variant_availability a
     where exists (
       select 1 from public.notifications n where n.variant_id = a.variant_id and n.status = 'confirmed'
     )
     order by a.variant_id
       for update of a
  loop
    -- A variant off the public shelf has no state at all: not sellable.
    v_sellable := coalesce(finance.variant_public_state(r.variant_id) in ('available', 'preorder'), false);
    if v_sellable then
      v_revision := r.revision;
      if not r.sellable then
        update finance.variant_availability a
           set sellable = true, revision = a.revision + 1, changed_at = now()
         where a.variant_id = r.variant_id
        returning a.revision into v_revision;
      end if;
      with due as (
        update public.notifications n
           set notified_revision = v_revision, updated_at = now()
         where n.variant_id = r.variant_id and n.status = 'confirmed' and n.notified_revision < v_revision
        returning n.id, n.email
      )
      insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
      select 'availability:' || r.variant_id::text || ':' || v_revision::text || ':' || d.id::text,
             'availability', 2, d.email, jsonb_build_object('notificationId', d.id)
        from due d
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif r.sellable then
      update finance.variant_availability a set sellable = false, changed_at = now() where a.variant_id = r.variant_id;
    end if;
  end loop;
  return v_queued;
end
$$;

-- 6. The purge -----------------------------------------------------------------

-- Daily. An `unsubscribed` row goes 30 days after it was unsubscribed and a
-- `pending` one 7 days after its last request (the confirmation link lives 7 days),
-- with the mail it still had unsent; a `confirmed` row never goes. An availability
-- row that no subscription refers to any more goes too. By then the purge holds
-- notification rows, and a sign-up takes the availability row first, so waiting for
-- one would be the reverse of that order and the two would deadlock: the purge
-- locks the orphan rows that nobody holds (a row a sign-up holds is no orphan, it
-- is getting its subscription) and the next run takes what it passed by. It
-- deletes what it locked in a new statement, which sees what a sign-up committed
-- meanwhile. One count-only audit row, like the buyer-retention purge; no address,
-- no id.
create function finance.notifications_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes integer;
  v_mail integer;
  v_orphans uuid[];
  v_availability integer;
begin
  with gone as (
    delete from public.notifications n
     where (n.status = 'unsubscribed' and n.unsubscribed_at < now() - interval '30 days')
        or (n.status = 'pending' and n.updated_at < now() - interval '7 days')
    returning n.id
  ), mail as (
    delete from finance.email_outbox o
     where o.kind in ('notify_confirm', 'availability')
       and o.payload ->> 'notificationId' in (select g.id::text from gone g)
       and o.status not in ('sent', 'sending')
    returning o.id
  )
  select (select count(*) from gone), (select count(*) from mail) into v_notes, v_mail;

  select coalesce(array_agg(o.variant_id), '{}') into v_orphans
    from (select a.variant_id
            from finance.variant_availability a
           where not exists (select 1 from public.notifications n where n.variant_id = a.variant_id)
             for update skip locked) o;
  delete from finance.variant_availability a
   where a.variant_id = any (v_orphans)
     and not exists (select 1 from public.notifications n where n.variant_id = a.variant_id);
  get diagnostics v_availability = row_count;

  if v_notes + v_mail + v_availability > 0 then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('privacy.notifications_purge', 'notifications', null,
            jsonb_build_object('notifications', v_notes, 'mail', v_mail, 'availability', v_availability));
  end if;
  return v_notes;
end
$$;

-- 7. Schedules -----------------------------------------------------------------

select cron.schedule('availability-sweep', '* * * * *', 'select finance.availability_sweep()');
select cron.schedule('notifications-purge', '37 3 * * *', 'select finance.notifications_purge()');
select cron.schedule('notify-confirm-backlog', '17 * * * *', 'select finance.notify_confirm_backlog()');

-- 8. Grants --------------------------------------------------------------------

-- The page reads the states as anon; nothing else here is public.
revoke all on function public.catalog_availability() from public;
grant execute on function public.catalog_availability() to anon, authenticated;

-- The Edge Function's role only.
revoke all on function public.notify_subscribe(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.notify_token_info(uuid) from public, anon, authenticated;
revoke all on function public.notify_link_throttle(text) from public, anon, authenticated;
revoke all on function public.notify_confirm(uuid, integer) from public, anon, authenticated;
revoke all on function public.notify_unsubscribe(uuid, integer) from public, anon, authenticated;
grant execute on function public.notify_subscribe(text, text, uuid, integer) to service_role;
grant execute on function public.notify_token_info(uuid) to service_role;
grant execute on function public.notify_link_throttle(text) to service_role;
grant execute on function public.notify_confirm(uuid, integer) to service_role;
grant execute on function public.notify_unsubscribe(uuid, integer) to service_role;

-- The rule and the two jobs: the migration role and pg_cron only.
revoke all on function finance.variant_public_state(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.availability_sweep() from public, anon, authenticated, service_role;
revoke all on function finance.notifications_purge() from public, anon, authenticated, service_role;
revoke all on function finance.notify_confirm_queue(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.notify_confirm_backlog() from public, anon, authenticated, service_role;
