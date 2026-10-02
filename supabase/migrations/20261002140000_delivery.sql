-- P08 round 7: delivery (PLANS/P08-CONTRACT.md section 6, "Delivery (round 7)").
-- Functions and one index: the entitlements, the paid assets, the download
-- tokens, the fulfilments, the return requests and the `paid-files` bucket are
-- round 2's.
--
-- What the buyer's order page and its three actions need:
-- - `order_access` is the buyer's view of an order by number and token;
-- - `order_recover_list` and `order_recover_apply` reissue a link without ever
--   telling whether an address has orders and without killing a working link;
-- - `download_issue` and `download_redeem` turn the order token into a 15-minute
--   download token, and that into at most three 60-second file links (the Edge
--   function signs the link; the storage key only ever travels to it);
-- - `return_request_create` is the buyer's return request;
-- and for the owner `paid_asset_set` attaches a verified file to a digital
-- variant, hands it to the orders that were waiting for it and mails them.
--
-- Every buyer function is bound to the configured mode (`p_mode`): an order of
-- the other mode is not found, so a sandbox order's link shows nothing, issues
-- no download, files no return and is never mailed once the site is live.
-- `paid_asset_set` is the owner's and fills the waiting orders of either mode.
--
-- A buyer's token is compared before any lock is taken, so a guess never
-- queues behind a real change. Writers lock in the contract's order (the order
-- rows in ascending id, then the variant). The entitlement row is the only lock
-- `download_issue` takes, alone, and the token row the only one
-- `download_redeem` takes, so neither can cross another writer's order.
-- A throttle raises 54000 like the other buyer functions, except recovery,
-- which must answer the same whatever happened and so never raises.

-- Recovery looks an address up by its hash among the orders that have a link
-- worth sending.
create index orders_email_recent on finance.orders (email_hash, created_at desc)
  where status in ('paid', 'paid_needs_resolution', 'refunded');

-- 1. Internal helper (finance: no API role, service_role included) ---------

-- What a buyer may still ask to return of one item: what was bought less the
-- quantities of its earlier requests that were not rejected. Null when the item
-- cannot be returned at all: the order is not `paid`, or the item is digital or
-- not yet shipped. One rule for the order page and for the request.
create function finance.item_returnable(p_item uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
           when o.status = 'paid' and i.fulfillment in ('physical', 'signed') and f.state in ('shipped', 'delivered')
             then greatest(
               i.quantity - coalesce((
                 select sum((x.value ->> 'quantity')::integer)
                   from finance.return_requests q
                  cross join lateral jsonb_array_elements(q.items) x
                  where q.order_id = i.order_id and q.state <> 'rejected' and x.value ->> 'itemId' = i.id::text
               ), 0),
               0
             )::integer
         end
    from finance.order_items i
    join finance.orders o on o.id = i.order_id
    left join finance.fulfillments f on f.order_item_id = i.id
   where i.id = p_item
$$;

-- 2. The buyer's order page ------------------------------------------------

-- The buyer's view of one order, by its number and token, in the configured
-- mode: one answer, NOT_FOUND, for an unknown number, a wrong or an expired
-- token and an order of the other mode. Throttled 120 per hour per IP hash. No
-- contact detail, no provider id, no storage key and no token is in the reply;
-- the payment state is the one the return page reads. One statement, so the
-- whole reply comes from one snapshot.
create function public.order_access(p_order_number text, p_access_token_hash text, p_ip_hash text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
begin
  if p_mode is null or p_mode not in ('test', 'live') or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid order request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('order-access:ip', p_ip_hash, 120, interval '1 hour') then
    raise exception 'Too many order requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, ''))) and o.environment = p_mode;
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return (
    select jsonb_build_object(
      'ok', true,
      'order', finance.order_summary(o.id) || jsonb_build_object(
        'paidAt', o.paid_at,
        -- Only the refunds of the paying attempt count; a review payment's never do.
        'refunded', (
          select coalesce(sum(r.amount_halalas), 0)::integer
            from finance.refunds r
           where r.order_id = o.id and r.attempt_id is not null and r.status = 'succeeded'
        ),
        'testMode', p_mode = 'test'
      ),
      'payment', finance.payment_view(o.order_number, p_access_token_hash, p_mode) - 'orderId' - 'hasToken',
      'items', (
        select coalesce(jsonb_agg(
                 jsonb_build_object(
                   'itemId', i.id,
                   'title', i.product_title,
                   'variantTitle', i.variant_title,
                   'quantity', i.quantity,
                   'fulfillment', i.fulfillment,
                   'preorder', case when i.preorder then jsonb_build_object('shipsOn', i.preorder_ships_on, 'note', i.preorder_note) end,
                   'returnable', coalesce(finance.item_returnable(i.id), 0)
                 ) || jsonb_strip_nulls(jsonb_build_object(
                   'state', f.state,
                   'carrier', f.carrier,
                   'tracking', f.tracking,
                   -- A file the buyer can ask for: granted, with a file, and the order not refunded.
                   'download', case when e.id is not null then jsonb_build_object(
                     'available', e.asset_id is not null and e.revoked_at is null and o.status <> 'refunded',
                     'revoked', e.revoked_at is not null
                   ) end
                 ))
                 order by i.line_no
               ), '[]'::jsonb)
          from finance.order_items i
          left join finance.fulfillments f on f.order_item_id = i.id
          left join finance.entitlements e on e.order_item_id = i.id
         where i.order_id = o.id
      ),
      'returns', (
        select coalesce(jsonb_agg(
                 jsonb_build_object('id', q.id, 'state', q.state, 'createdAt', q.created_at) order by q.created_at, q.id
               ), '[]'::jsonb)
          from finance.return_requests q
         where q.order_id = o.id
      )
    )
      from finance.orders o
     where o.id = v_order.id
  );
end
$$;

-- 3. Recovery: a new link by email, without enumeration --------------------

-- Up to 5 of an address's most recent paid, under-review (paid_needs_resolution)
-- or refunded orders of the configured mode, for the function to derive links from. Throttled 3 per
-- hour per email hash and 10 per hour per IP hash, and silently: over a limit
-- the answer is the empty list, the same as for an address with no order, so
-- nothing tells the caller which happened. The IP bucket is taken first, so a
-- flooding address cannot spend more of an email's allowance than its own.
create function public.order_recover_list(p_ip_hash text, p_email text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or char_length(v_email) not between 3 and 254
    or p_mode is null or p_mode not in ('test', 'live')
  then
    raise exception 'Invalid recovery request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('order-recover:ip', p_ip_hash, 10, interval '1 hour') then
    return '[]'::jsonb;
  end if;
  if not finance.rate_limit_take('order-recover:email', finance.recipient_hash(v_email), 3, interval '1 hour') then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'orderId', s.id, 'idempotencyKey', s.idempotency_key, 'tokenVersion', s.access_token_version,
               'expired', s.access_token_expires_at <= now()
             ) order by s.created_at desc, s.id desc
           ), '[]'::jsonb)
      from (
        select o.id, o.idempotency_key, o.access_token_version, o.access_token_expires_at, o.created_at
          from finance.orders o
         where o.email_hash = finance.recipient_hash(v_email)
           and o.environment = p_mode
           and o.status in ('paid', 'paid_needs_resolution', 'refunded')
         order by o.created_at desc, o.id desc
         limit 5
      ) s
  );
end
$$;

-- Applies what the function derived from the list: `[{orderId, version, tokenHash?}]`.
-- A working link is never replaced: with no hash the order keeps its token and
-- only its expiry is renewed (and only while the token is still unexpired and at
-- the version the list showed). An expired link gets the next version's hash, once:
-- the update is guarded on the version the list showed, so two requests at once
-- agree on one new token and the second finds nothing to change. A link that has
-- come back to life since the list (a file attached) is left alone. Each order
-- that changed gets at most one `order_link` mail per UTC day, and at most 20 such
-- mails are queued a day in all (the dispatcher sends at most 20 as well). The
-- orders are taken in ascending id. Answers how many mails it queued.
create function public.order_recover_apply(p_ip_hash text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_email text;
  v_key text;
  v_queued integer := 0;
  v_day text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 5 then
    raise exception 'Invalid recovery request.' using errcode = 'invalid_parameter_value';
  end if;
  for r in
    select (x.value ->> 'orderId')::uuid as order_id, (x.value ->> 'version')::integer as version, x.value ->> 'tokenHash' as token_hash
      from jsonb_array_elements(p_items) x
     order by 1
  loop
    v_email := null;
    if r.token_hash is null then
      update finance.orders o
         set access_token_expires_at = now() + interval '7 days', updated_at = now()
       where o.id = r.order_id and o.access_token_version = r.version and o.access_token_expires_at > now()
      returning o.customer_email into v_email;
    else
      update finance.orders o
         set access_token_hash = r.token_hash, access_token_version = r.version,
             access_token_expires_at = now() + interval '7 days', updated_at = now()
       where o.id = r.order_id and o.access_token_version = r.version - 1 and o.access_token_expires_at <= now()
      returning o.customer_email into v_email;
    end if;
    continue when v_email is null;

    v_key := 'order_link:' || r.order_id::text || ':' || r.version::text || ':' || v_day;
    if not exists (select 1 from finance.email_outbox m where m.dedupe_key = v_key)
      and finance.rate_limit_take('order-link:day', repeat('0', 64), 20, interval '1 day')
    then
      insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
      values (v_key, 'order_link', 1, lower(btrim(v_email)), jsonb_build_object('orderId', r.order_id))
      on conflict (dedupe_key) do nothing;
      if found then
        v_queued := v_queued + 1;
      end if;
    end if;
  end loop;
  return v_queued;
end
$$;

-- 4. Downloads --------------------------------------------------------------

-- The order token for a 15-minute download token. The order token must match;
-- the item must have a granted, unrevoked entitlement with a file; the order is
-- not refunded; at most 10 tokens per entitlement in 24 hours. Only the token's
-- hash is stored. The entitlement row is locked (alone) so two requests at once
-- cannot both take the last of the 10, and every fact is read again under it.
-- NOT_FOUND for every other failure: a wrong number or token, an item with no
-- file to give, a revoked file and a refunded order look the same.
create function public.download_issue(
  p_order_number text, p_access_token_hash text, p_item uuid, p_download_token_hash text, p_ip_hash text, p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_ent finance.entitlements;
  v_status text;
  v_expires timestamptz;
begin
  if p_item is null or coalesce(p_download_token_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
    or p_mode is null or p_mode not in ('test', 'live')
  then
    raise exception 'Invalid download request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('download-issue:ip', p_ip_hash, 120, interval '1 hour') then
    raise exception 'Too many download requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, ''))) and o.environment = p_mode;
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  select * into v_ent from finance.entitlements e where e.order_item_id = p_item and e.order_id = v_order.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select o.status into v_status from finance.orders o where o.id = v_order.id;
  if v_ent.revoked_at is not null or v_ent.asset_id is null or v_status = 'refunded' then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if (
    select count(*) from finance.download_tokens t
     where t.entitlement_id = v_ent.id and t.created_at > now() - interval '1 day'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_DOWNLOADS');
  end if;

  insert into finance.download_tokens (token_hash, entitlement_id)
  values (p_download_token_hash, v_ent.id)
  returning expires_at into v_expires;
  return jsonb_build_object('ok', true, 'expiresAt', v_expires);
end
$$;

-- A download token for the file it leads to, at most `max_uses` (3) times. The
-- token row is locked, so any number of requests at once together take at most
-- `max_uses`; the entitlement and the order are read after the lock. The only
-- answer to every failure (an unknown token, an expired or spent one, a revoked
-- entitlement, a refunded order, an order of the other mode) is NOT_FOUND. The storage key goes to the Edge
-- function only, which puts it inside a 60-second signed link.
create function public.download_redeem(p_download_token_hash text, p_ip_hash text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token finance.download_tokens;
  v_ent finance.entitlements;
  v_asset finance.paid_assets;
  v_status text;
begin
  if coalesce(p_download_token_hash, '') !~ '^[0-9a-f]{64}$' or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
    or p_mode is null or p_mode not in ('test', 'live')
  then
    raise exception 'Invalid download request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('download-redeem:ip', p_ip_hash, 120, interval '1 hour') then
    raise exception 'Too many download requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  select * into v_token from finance.download_tokens t where t.token_hash = p_download_token_hash for update;
  if not found or v_token.expires_at <= now() or v_token.uses >= v_token.max_uses then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_ent from finance.entitlements e where e.id = v_token.entitlement_id;
  if v_ent.revoked_at is not null or v_ent.asset_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select o.status into v_status from finance.orders o where o.id = v_ent.order_id and o.environment = p_mode;
  if not found or v_status = 'refunded' then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_asset from finance.paid_assets a where a.id = v_ent.asset_id;

  update finance.download_tokens t
     set uses = t.uses + 1, last_used_at = now()
   where t.token_hash = p_download_token_hash;
  return jsonb_build_object('ok', true, 'storageKey', v_asset.storage_key, 'filename', v_asset.filename, 'mime', v_asset.mime);
end
$$;

-- 5. The paid file ---------------------------------------------------------

-- The owner's file for a digital variant, after the Edge function has checked
-- the object and moved it to `assets/<variant>/<asset id>` (the asset's own id
-- is the key's last part). Owner recheck; the variant must be digital. Locks, in
-- the contract's order, the orders whose entitlements it will change (read
-- without a lock first, locked in ascending id) and then the variant; after the
-- variant lock no order can newly wait for this variant (`order_try_commit` takes
-- that lock too), so the waiting entitlements are read again and any order that
-- appeared between the two reads is locked without waiting: a lock held by
-- another writer there answers 55P03 (try again), never a deadlock.
-- Inserts the asset and points the variant at it. A granted entitlement of the
-- variant that has no file gets this one, its order a fresh 7-day link, and the
-- buyer one `order_ready` mail per entitlement (a digital preorder, delivered
-- when the file exists). An entitlement that already has a file keeps it and a
-- revoked one gets nothing.
create function public.paid_asset_set(
  p_actor uuid, p_variant uuid, p_storage_key text, p_filename text, p_mime text, p_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.product_variants;
  v_asset uuid;
  v_orders uuid[];
  v_late uuid[];
  r record;
  v_filled integer := 0;
begin
  if not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  if p_variant is null or p_filename is null or p_mime is null or p_bytes is null
    or coalesce(p_storage_key, '') !~ ('^assets/' || p_variant::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  then
    raise exception 'Invalid paid file.' using errcode = 'invalid_parameter_value';
  end if;
  v_asset := substring(p_storage_key from '[^/]+$')::uuid;

  select * into v_variant from public.product_variants v where v.id = p_variant;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_variant.fulfillment <> 'digital' then
    return jsonb_build_object('ok', false, 'code', 'NOT_DIGITAL');
  end if;

  select coalesce(array_agg(distinct e.order_id order by e.order_id), '{}') into v_orders
    from finance.entitlements e
   where e.variant_id = p_variant and e.asset_id is null and e.revoked_at is null;
  perform 1 from finance.orders o where o.id = any (v_orders) order by o.id for update;
  select * into v_variant from public.product_variants v where v.id = p_variant for update;
  if v_variant.fulfillment <> 'digital' then
    return jsonb_build_object('ok', false, 'code', 'NOT_DIGITAL');
  end if;
  select coalesce(array_agg(distinct e.order_id order by e.order_id), '{}') into v_late
    from finance.entitlements e
   where e.variant_id = p_variant and e.asset_id is null and e.revoked_at is null and e.order_id <> all (v_orders);
  if cardinality(v_late) > 0 then
    perform 1 from finance.orders o where o.id = any (v_late) order by o.id for update nowait;
  end if;

  insert into finance.paid_assets (id, variant_id, storage_key, filename, mime, bytes, created_by)
  values (v_asset, p_variant, p_storage_key, p_filename, p_mime, p_bytes, p_actor);
  update public.product_variants set digital_asset = p_storage_key where id = p_variant;

  for r in
    with waiting as (
      update finance.entitlements e
         set asset_id = v_asset
       where e.variant_id = p_variant and e.asset_id is null and e.revoked_at is null
      returning e.id, e.order_id, e.order_item_id
    )
    select w.id, w.order_id, w.order_item_id, o.customer_email
      from waiting w
      join finance.orders o on o.id = w.order_id
  loop
    update finance.orders o
       set access_token_expires_at = now() + interval '7 days', updated_at = now()
     where o.id = r.order_id;
    insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
    values ('order_ready:' || r.id::text, 'order_ready', 0, lower(btrim(r.customer_email)),
            jsonb_build_object('orderId', r.order_id, 'itemIds', jsonb_build_array(r.order_item_id)))
    on conflict (dedupe_key) do nothing;
    v_filled := v_filled + 1;
  end loop;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'paid_asset.set', 'product_variants', p_variant::text,
          jsonb_build_object('assetId', v_asset, 'mime', p_mime, 'bytes', p_bytes, 'waiting', v_filled));
  return jsonb_build_object('ok', true, 'assetId', v_asset, 'filled', v_filled);
end
$$;

-- Upload parts the owner never completed: objects under `incoming/` of the paid
-- files' bucket older than 24 hours, oldest first. Nothing under `assets/` is
-- ever listed. The `media_sweep` job removes them through the Storage API.
create function public.paid_files_sweep_candidates(p_limit integer)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.name), '{}')
  from (
    select o.name
    from storage.objects o
    where o.bucket_id = 'paid-files'
      and o.name like 'incoming/%'
      and o.created_at < now() - interval '24 hours'
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 1), 1), 1000)
  ) s
$$;

-- 6. The buyer's return request --------------------------------------------

-- A request for a `paid` order whose physical or signed items have shipped:
-- `[{itemId, quantity}]`, each quantity within `finance.item_returnable`. At most
-- 5 requests a day per order (counted under the order's lock, so two at once
-- cannot both be the fifth) and 20 an hour per IP hash. Nothing is refunded and no
-- stock moves: the staff decide (round 7b). NOT_FOUND for a wrong number or token;
-- NOT_RETURNABLE when the order is not paid or an item cannot be returned (digital,
-- not shipped); INVALID_ITEMS for a malformed list, an item that is not the
-- order's, a repeated item or a quantity above what is still returnable.
create function public.return_request_create(
  p_order_number text, p_access_token_hash text, p_items jsonb, p_reason text, p_ip_hash text, p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_items jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  e jsonb;
  v_item uuid;
  v_qty integer;
  v_max integer;
  v_id uuid;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or char_length(v_reason) not between 1 and 500 or v_reason ~ '[[:cntrl:]]'
    or p_mode is null or p_mode not in ('test', 'live')
  then
    raise exception 'Invalid return request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('return-request:ip', p_ip_hash, 20, interval '1 hour') then
    raise exception 'Too many return requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- The token is checked before the row is locked, so guessed tokens never
  -- queue behind a real change to the order.
  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, ''))) and o.environment = p_mode;
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_order from finance.orders o where o.id = v_order.id for update;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'NOT_RETURNABLE');
  end if;
  if (
    select count(*) from finance.return_requests q
     where q.order_id = v_order.id and q.created_at > now() - interval '1 day'
  ) >= 5 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REQUESTS');
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;
  for e in select x.value from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(e) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('itemId', 'quantity')) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if coalesce(e ->> 'itemId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e -> 'quantity') is distinct from 'number'
    then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if (e ->> 'quantity') !~ '^[1-9][0-9]{0,2}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_item := (e ->> 'itemId')::uuid;
    v_qty := (e ->> 'quantity')::integer;
    if v_item = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_seen := v_seen || v_item;
    perform 1 from finance.order_items i where i.id = v_item and i.order_id = v_order.id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_max := finance.item_returnable(v_item);
    if v_max is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_RETURNABLE');
    end if;
    if v_qty > v_max then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_items := v_items || jsonb_build_object('itemId', v_item, 'quantity', v_qty);
  end loop;

  insert into finance.return_requests (order_id, items, reason)
  values (v_order.id, v_items, v_reason)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'returnId', v_id);
end
$$;

-- 7. Grants -----------------------------------------------------------------

-- Server-only: the Edge functions call them as service_role.
revoke all on function public.order_access(text, text, text, text) from public, anon, authenticated;
revoke all on function public.order_recover_list(text, text, text) from public, anon, authenticated;
revoke all on function public.order_recover_apply(text, jsonb) from public, anon, authenticated;
revoke all on function public.download_issue(text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.download_redeem(text, text, text) from public, anon, authenticated;
revoke all on function public.paid_asset_set(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.paid_files_sweep_candidates(integer) from public, anon, authenticated;
revoke all on function public.return_request_create(text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.order_access(text, text, text, text) to service_role;
grant execute on function public.order_recover_list(text, text, text) to service_role;
grant execute on function public.order_recover_apply(text, jsonb) to service_role;
grant execute on function public.download_issue(text, text, uuid, text, text, text) to service_role;
grant execute on function public.download_redeem(text, text, text) to service_role;
grant execute on function public.paid_asset_set(uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.paid_files_sweep_candidates(integer) to service_role;
grant execute on function public.return_request_create(text, text, jsonb, text, text, text) to service_role;

revoke all on function finance.item_returnable(uuid) from public, anon, authenticated, service_role;
