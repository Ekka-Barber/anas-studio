-- P08 round 4: checkout meets the gateway (PLANS/P08-CONTRACT.md section 6,
-- "Checkout"; ISSUES I44 item 2 and I48 items 2 to 4). The earlier migrations
-- stay untouched: every function here is replaced with `create or replace`
-- under its own signature and restates its grants.
--
-- - `finance.checkout_price`: the one availability rule (contract section 4),
--   preorder lines with their date and note, a delivery date that has passed is
--   not for sale, OUT_OF_STOCK says when only other orders' unpaid holds are in
--   the way, and a total under the gateway's minimum is an error (a coupon can
--   bring a total to zero).
-- - `checkout_quote`: open only when the seller and the policies are set.
-- - `checkout_create`: no per-email hold and no per-email throttle (anyone
--   could hold a known address, and the refusal confirmed that a live order
--   exists); the daily total is spent only by an order that is created;
--   ACTIVE_HOLD hands the held order back to the buyer who made it; preorder
--   snapshots and reservations.
-- - `finance.order_summary`: each line carries its preorder note and date.
-- - `checkout_cancel`: refused while a payment attempt is active, so the
--   function settles the invoice with the provider first.
-- - `commerce_checkout_set`: the owner's switch.

-- 1. Pricing --------------------------------------------------------------

-- Otherwise identical to 20260927160000_catalog_and_checkout.sql, plus:
-- availability by `finance.availability` (stock, or preorder capacity, less
-- unpaid holds); a preorder whose delivery date is before today in Riyadh is
-- UNAVAILABLE; OUT_OF_STOCK carries `held: true` when the units exist and
-- only other orders' unpaid holds take them; each line carries `preorder`
-- (null, or `{shipsOn, note}` from the variant's current flag); the hash text
-- covers each line's preorder flag, date and note; TOTAL_BELOW_MINIMUM (100
-- halalas, the gateway's smallest invoice) when nothing else is wrong.
create or replace function finance.checkout_price(p_lines jsonb, p_city_key text, p_coupon_code text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_elem jsonb;
  v_index integer;
  v_seen uuid[] := array[]::uuid[];
  v_variant_id uuid;
  v_qty integer;
  v_dedication text;
  v_row record;
  v_available integer;
  v_error jsonb;
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_lines jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_physical boolean := false;
  v_shipping bigint := 0;
  v_city jsonb := null;
  v_rate public.shipping_rates;
  v_code text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_coupon public.coupons;
  v_coupon_json jsonb := null;
  v_eligible bigint := 0;
  v_discount bigint := 0;
  v_alloc jsonb;
  v_hash_text text;
  v_total bigint;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'INVALID_CART')));
  end if;
  if jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'EMPTY_CART')));
  end if;
  if jsonb_array_length(p_lines) > 50 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'TOO_MANY_LINES')));
  end if;

  for v_elem, v_index in
    select t.e, t.i::integer from jsonb_array_elements(p_lines) with ordinality as t(e, i)
  loop
    if jsonb_typeof(v_elem) is distinct from 'object'
      or coalesce(v_elem ->> 'variantId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_elem -> 'quantity') is distinct from 'number'
      or (v_elem ->> 'quantity') !~ '^[0-9]{1,2}$'
      or coalesce(jsonb_typeof(v_elem -> 'dedication'), 'null') not in ('string', 'null')
    then
      v_errors := v_errors || jsonb_build_object('code', 'INVALID_LINE', 'line', v_index);
      continue;
    end if;
    v_variant_id := (v_elem ->> 'variantId')::uuid;
    v_qty := (v_elem ->> 'quantity')::integer;
    v_dedication := nullif(btrim(coalesce(v_elem ->> 'dedication', '')), '');

    if v_qty < 1 or v_qty > 20 then
      v_errors := v_errors || jsonb_build_object('code', 'INVALID_QUANTITY', 'line', v_index, 'variantId', v_variant_id);
      continue;
    end if;
    if v_variant_id = any(v_seen) then
      v_errors := v_errors || jsonb_build_object('code', 'DUPLICATE_LINE', 'line', v_index, 'variantId', v_variant_id);
      continue;
    end if;
    v_seen := array_append(v_seen, v_variant_id);

    select v.sku, v.title as variant_title, v.fulfillment, v.price_halalas, v.enabled, v.stock,
           v.preorder, v.preorder_capacity, v.preorder_ships_on, v.preorder_note,
           p.id as product_id, p.slug as product_slug, p.title as product_title, p.status
      into v_row
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id;
    -- A preorder whose delivery date has passed is not for sale: the buyer must not be shown it.
    if not found or not v_row.enabled or v_row.status <> 'published' or v_row.price_halalas is null
      or (v_row.preorder and v_row.preorder_ships_on < v_today)
    then
      v_errors := v_errors || jsonb_build_object('code', 'UNAVAILABLE', 'line', v_index, 'variantId', v_variant_id);
      continue;
    end if;
    if v_dedication is not null and v_row.fulfillment <> 'signed' then
      v_errors := v_errors || jsonb_build_object('code', 'DEDICATION_NOT_ALLOWED', 'line', v_index, 'variantId', v_variant_id);
      continue;
    end if;
    if v_dedication is not null and (char_length(v_dedication) > 200 or v_dedication ~ '[[:cntrl:]]') then
      v_errors := v_errors || jsonb_build_object('code', 'INVALID_DEDICATION', 'line', v_index, 'variantId', v_variant_id);
      continue;
    end if;

    -- Null means unlimited (a digital variant that is not a preorder).
    v_available := finance.availability(v_variant_id);
    if v_available is not null and v_available < v_qty then
      v_error := jsonb_build_object(
        'code', 'OUT_OF_STOCK', 'line', v_index, 'variantId', v_variant_id, 'available', v_available
      );
      -- The units exist and other orders' unpaid holds take them: this comes back within 20 minutes.
      if (case when v_row.preorder then coalesce(v_row.preorder_capacity, 0) - finance.preorder_committed(v_variant_id) else v_row.stock end) >= v_qty then
        v_error := v_error || jsonb_build_object('held', true);
      end if;
      v_errors := v_errors || v_error;
      continue;
    end if;

    if v_row.fulfillment <> 'digital' then
      v_physical := true;
    end if;
    v_subtotal := v_subtotal + v_row.price_halalas::bigint * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'line', v_index,
      'variantId', v_variant_id,
      'productId', v_row.product_id,
      'productSlug', v_row.product_slug,
      'productTitle', v_row.product_title,
      'variantTitle', v_row.variant_title,
      'sku', v_row.sku,
      'fulfillment', v_row.fulfillment,
      'unitPrice', v_row.price_halalas,
      'quantity', v_qty,
      'subtotal', v_row.price_halalas::bigint * v_qty,
      'discount', 0,
      'dedication', v_dedication,
      'preorder', case when v_row.preorder then jsonb_build_object('shipsOn', v_row.preorder_ships_on, 'note', v_row.preorder_note) end
    );
  end loop;

  if v_subtotal > 50000000 then
    v_errors := v_errors || jsonb_build_object('code', 'CART_TOO_LARGE');
  end if;

  -- Delivery: a physical or signed line needs a served city; digital-only
  -- carts have no city, no address and no fee.
  if v_physical then
    if nullif(btrim(coalesce(p_city_key, '')), '') is null then
      v_errors := v_errors || jsonb_build_object('code', 'CITY_REQUIRED');
    else
      select * into v_rate from public.shipping_rates r where r.city_key = btrim(p_city_key);
      if not found or not v_rate.enabled or v_rate.fee_halalas is null then
        v_errors := v_errors || jsonb_build_object('code', 'CITY_UNSUPPORTED');
      else
        v_shipping := v_rate.fee_halalas;
        v_city := jsonb_build_object('key', v_rate.city_key, 'name', v_rate.name_ar, 'fee', v_rate.fee_halalas);
      end if;
    end if;
  end if;

  if v_code is not null then
    select * into v_coupon from public.coupons c where c.code = v_code;
    if not found or not v_coupon.enabled
      or (v_coupon.starts_at is not null and now() < v_coupon.starts_at)
      or (v_coupon.ends_at is not null and now() >= v_coupon.ends_at)
    then
      v_errors := v_errors || jsonb_build_object('code', 'COUPON_INVALID');
    elsif v_subtotal < v_coupon.min_subtotal_halalas then
      v_errors := v_errors || jsonb_build_object('code', 'COUPON_MIN_SUBTOTAL', 'minimum', v_coupon.min_subtotal_halalas);
    elsif v_coupon.usage_limit is not null and finance.coupon_uses(v_coupon.id) >= v_coupon.usage_limit then
      v_errors := v_errors || jsonb_build_object('code', 'COUPON_EXHAUSTED');
    else
      select coalesce(sum((l ->> 'subtotal')::bigint), 0) into v_eligible
        from jsonb_array_elements(v_lines) l
       where cardinality(v_coupon.product_ids) = 0 or (l ->> 'productId')::uuid = any(v_coupon.product_ids);
      if v_eligible = 0 then
        v_errors := v_errors || jsonb_build_object('code', 'COUPON_NOT_APPLICABLE');
      else
        -- Floor for a percentage; a fixed amount is capped at what it applies to.
        v_discount := case v_coupon.kind
          when 'percent' then (v_eligible * v_coupon.percent_bp) / 10000
          else least(v_coupon.amount_halalas::bigint, v_eligible)
        end;
        -- Largest-remainder allocation over the eligible lines, ties by line
        -- order: the line discounts always sum to the order discount, so a
        -- partial refund can follow them exactly.
        with eligible as (
          select (l ->> 'line')::integer as line_no, (l ->> 'subtotal')::bigint as sub
            from jsonb_array_elements(v_lines) l
           where cardinality(v_coupon.product_ids) = 0 or (l ->> 'productId')::uuid = any(v_coupon.product_ids)
        ), shares as (
          select line_no, (v_discount * sub) / v_eligible as base, (v_discount * sub) % v_eligible as rem
            from eligible
        ), ranked as (
          select line_no, base, row_number() over (order by rem desc, line_no) as rank
            from shares
        )
        select jsonb_object_agg(
                 line_no::text,
                 base + case when rank <= v_discount - (select sum(s.base) from shares s) then 1 else 0 end
               )
          into v_alloc
          from ranked;
        select jsonb_agg(
                 case when v_alloc ? (l ->> 'line') then jsonb_set(l, '{discount}', v_alloc -> (l ->> 'line')) else l end
                 order by (l ->> 'line')::integer
               )
          into v_lines
          from jsonb_array_elements(v_lines) l;
        v_coupon_json := jsonb_build_object('id', v_coupon.id, 'code', v_coupon.code, 'kind', v_coupon.kind, 'discount', v_discount);
      end if;
    end if;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_set(l, '{total}', to_jsonb((l ->> 'subtotal')::bigint - (l ->> 'discount')::bigint))
             order by (l ->> 'line')::integer
           ),
           '[]'::jsonb
         )
    into v_lines
    from jsonb_array_elements(v_lines) l;
  v_total := v_subtotal - v_discount + v_shipping;

  -- The gateway refuses an invoice under 100 halalas, so no order may be made
  -- for less (a coupon can bring the total to zero).
  if jsonb_array_length(v_errors) = 0 and v_total < 100 then
    v_errors := v_errors || jsonb_build_object('code', 'TOTAL_BELOW_MINIMUM', 'minimum', 100);
  end if;

  select coalesce(
           string_agg(
             concat_ws(
               '|', l ->> 'line', l ->> 'variantId', l ->> 'quantity', l ->> 'unitPrice', l ->> 'discount',
               coalesce(l ->> 'dedication', ''),
               case when jsonb_typeof(l -> 'preorder') = 'object' then '1' else '0' end,
               coalesce(l -> 'preorder' ->> 'shipsOn', ''), coalesce(l -> 'preorder' ->> 'note', '')
             ),
             ';' order by (l ->> 'line')::integer
           ),
           ''
         )
    into v_hash_text
    from jsonb_array_elements(v_lines) l;
  v_hash_text := concat_ws(
    '#', v_hash_text, coalesce(v_city ->> 'key', ''), v_shipping, coalesce(v_coupon_json ->> 'code', ''),
    v_discount, v_subtotal, v_total
  );

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'errors', v_errors,
    'lines', v_lines,
    'physical', v_physical,
    'city', v_city,
    'coupon', v_coupon_json,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'shipping', v_shipping,
    'total', v_total,
    'quoteHash', encode(sha256(convert_to(v_hash_text, 'UTF8')), 'hex')
  );
end
$$;

-- An order as the buyer and the admin see it (no contact details); each line
-- carries what the buyer was shown about a preorder, from the order's own snapshot.
create or replace function finance.order_summary(p_order uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'orderNumber', o.order_number,
    'status', o.status,
    'holdExpiresAt', o.hold_expires_at,
    'subtotal', o.subtotal_halalas,
    'discount', o.discount_halalas,
    'shipping', o.shipping_halalas,
    'total', o.total_halalas,
    'currency', o.currency,
    'environment', o.environment,
    'lines', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'sku', i.sku,
                   'productTitle', i.product_title,
                   'variantTitle', i.variant_title,
                   'fulfillment', i.fulfillment,
                   'quantity', i.quantity,
                   'unitPrice', i.unit_price_halalas,
                   'discount', i.discount_halalas,
                   'total', i.line_subtotal_halalas - i.discount_halalas,
                   'preorder', case when i.preorder then jsonb_build_object('shipsOn', i.preorder_ships_on, 'note', i.preorder_note) end
                 )
                 order by i.line_no
               )
          from finance.order_items i
         where i.order_id = o.id
      ),
      '[]'::jsonb
    )
  )
  from finance.orders o
  where o.id = p_order
$$;

-- 2. The three server-only entry points (`checkout` Edge Function) ---------

-- The cart page's live quote. Open means the switch is on, the seller is named
-- and the policies are approved: the same three things `checkout_create`
-- refuses for, so the page never shows a button that cannot work (I48 item 2).
-- The function also ANDs the payment configuration and the sandbox fence.
create or replace function public.checkout_quote(p_ip_hash text, p_lines jsonb, p_city_key text, p_coupon_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings finance.commerce_settings;
begin
  if not finance.rate_limit_take('checkout-quote:ip', p_ip_hash, 300, interval '1 hour') then
    raise exception 'Too many quotes; try again later.' using errcode = 'program_limit_exceeded';
  end if;
  select * into v_settings from finance.commerce_settings where id = 1;
  return finance.checkout_price(p_lines, p_city_key, p_coupon_code)
    || jsonb_build_object(
         'checkoutEnabled',
         v_settings.checkout_enabled
           and v_settings.seller_legal_name is not null
           and v_settings.seller_registration is not null
           and v_settings.policy_revisions <> '{}'::jsonb,
         'policyRevisions', v_settings.policy_revisions
       );
end
$$;

-- Creates one pending order and its holds, all or nothing (DATA "Checkout
-- transaction" 3). Business refusals return {ok:false, code, ...} and write
-- nothing but their throttle hit; malformed calls raise.
--
-- Unpaid-hold limits (contract section 13, item 1): one unexpired pending
-- order per checkout session, under a transaction-scoped advisory lock so two
-- concurrent requests cannot both pass. There is no per-email limit: anyone
-- could hold a known address, and the refusal told them a live order exists. A
-- new idempotency key neither adds a hold nor refreshes one. Throttles are
-- secondary, so shared networks stay usable: 10 orders per hour per salted IP
-- hash, and 500 per day in total, which only an order that is created spends
-- (a refused request does not). Turnstile runs in the function before this.
-- Holds last 20 minutes. Residual risk, recorded: many sessions from many
-- addresses can still hold scarce stock for 20 minutes at a time.
--
-- ACTIVE_HOLD means "this checkout session already holds an order". Only when
-- the request's email is the held order's own does it also hand that order
-- back (with the key and token version the function derives its token from):
-- the session id alone, which the table keeps in clear, is not enough.
--
-- Preorder lines keep what the buyer was shown (flag, date, note) on the order
-- item, and every preorder line, a digital one included, holds a reservation:
-- it counts against the variant's capacity.
create or replace function public.checkout_create(
  p_idempotency_key uuid,
  p_request_hash text,
  p_checkout_session uuid,
  p_ip_hash text,
  p_email text,
  p_name text,
  p_phone text,
  p_lines jsonb,
  p_city_key text,
  p_address text,
  p_coupon_code text,
  p_policy_revisions jsonb,
  p_quote_hash text,
  p_access_token_hash text,
  p_environment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing finance.orders;
  v_held finance.orders;
  v_settings finance.commerce_settings;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_code text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_email_hash text;
  v_reply jsonb;
  v_ids uuid[];
  v_price jsonb;
  v_customer uuid;
  v_order uuid;
  v_number text;
  v_tries integer := 0;
  v_expires timestamptz := now() + interval '20 minutes';
begin
  if p_idempotency_key is null or p_checkout_session is null
    or coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_access_token_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_environment, '') not in ('test', 'live')
  then
    raise exception 'Invalid checkout request.' using errcode = 'invalid_parameter_value';
  end if;

  -- 1. One request per key at a time. The same key and request return the
  --    same order (whatever its state now); another request is a conflict.
  perform pg_advisory_xact_lock(hashtextextended('checkout:key:' || p_idempotency_key::text, 0));
  select * into v_existing from finance.orders o where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'tokenMatches', v_existing.access_token_hash = p_access_token_hash,
      'order', finance.order_summary(v_existing.id)
    );
  end if;

  -- 2. The store must be open: checkout on, the seller named, the policies
  --    approved and accepted exactly as approved.
  select * into v_settings from finance.commerce_settings where id = 1;
  if not v_settings.checkout_enabled then
    return jsonb_build_object('ok', false, 'code', 'CHECKOUT_DISABLED');
  end if;
  if v_settings.seller_legal_name is null or v_settings.seller_registration is null then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_CONFIGURED');
  end if;
  if v_settings.policy_revisions = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'POLICIES_NOT_CONFIGURED');
  end if;
  if p_policy_revisions is distinct from v_settings.policy_revisions then
    return jsonb_build_object('ok', false, 'code', 'POLICY_CHANGED', 'policyRevisions', v_settings.policy_revisions);
  end if;

  -- 3. The database's own check of the contact details (the function checked
  --    them too).
  if char_length(v_email) not between 3 and 254
    or v_email !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
    or char_length(v_name) not between 1 and 120
    or v_name ~ '[[:cntrl:]]'
    or (v_phone is not null and v_phone !~ '^9665[0-9]{8}$')
  then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CONTACT');
  end if;
  v_email_hash := finance.recipient_hash(v_email);

  -- 4. The IP throttle (secondary).
  if not finance.rate_limit_take('checkout:ip', p_ip_hash, 10, interval '1 hour') then
    raise exception 'Too many checkouts; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- 5. The session hold (primary). Locks in a fixed order: key, session.
  perform pg_advisory_xact_lock(hashtextextended('checkout:session:' || p_checkout_session::text, 0));
  select * into v_held
    from finance.orders o
   where o.status = 'pending_payment' and o.hold_expires_at > now() and o.checkout_session = p_checkout_session;
  if found then
    v_reply := jsonb_build_object('ok', false, 'code', 'ACTIVE_HOLD', 'holdExpiresAt', v_held.hold_expires_at);
    if v_held.email_hash = v_email_hash then
      v_reply := v_reply || jsonb_build_object(
        'order', finance.order_summary(v_held.id),
        'idempotencyKey', v_held.idempotency_key,
        'tokenVersion', v_held.access_token_version
      );
    end if;
    return v_reply;
  end if;

  -- 6. Lock the cart's variants in id order, then the coupon (P08's payment
  --    commit takes the same order), and price again under the locks.
  select coalesce(array_agg(distinct (e ->> 'variantId')::uuid), '{}')
    into v_ids
    from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'object'
     and coalesce(e ->> 'variantId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  perform 1 from public.product_variants v where v.id = any(v_ids) order by v.id for update;
  if v_code is not null then
    perform 1 from public.coupons c where c.code = v_code for update;
  end if;

  v_price := finance.checkout_price(p_lines, p_city_key, p_coupon_code);
  if not (v_price ->> 'ok')::boolean then
    return jsonb_build_object('ok', false, 'code', v_price -> 'errors' -> 0 ->> 'code', 'quote', v_price);
  end if;
  if v_price ->> 'quoteHash' is distinct from p_quote_hash then
    return jsonb_build_object('ok', false, 'code', 'QUOTE_CHANGED', 'quote', v_price);
  end if;
  if (v_price ->> 'physical')::boolean then
    if v_address is null or char_length(v_address) not between 5 and 500 or v_address ~ '[[:cntrl:]]' then
      return jsonb_build_object('ok', false, 'code', 'ADDRESS_REQUIRED');
    end if;
    if v_phone is null then
      return jsonb_build_object('ok', false, 'code', 'PHONE_REQUIRED');
    end if;
  else
    v_address := null;
  end if;

  -- 7. The daily total (500), taken only now that an order will be created:
  --    every refusal above has already answered, so none of them spends it.
  if not finance.rate_limit_take('checkout:all', repeat('0', 64), 500, interval '1 day') then
    raise exception 'Too many checkouts; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- 8. The customer. An existing profile is kept as it is; the order keeps
  --    its own snapshot of what this buyer typed.
  insert into public.customers (email, name, phone)
  values (v_email, v_name, v_phone)
  on conflict (email) do nothing;
  select c.id into v_customer from public.customers c where c.email = v_email;

  -- 9. The order, its lines, the stock holds and the coupon hold.
  --    ponytail: two concurrent orders drawing the same random number (1 in
  --    10^12) fail on the unique index and the buyer retries.
  loop
    v_number := finance.random_order_number();
    exit when not exists (select 1 from finance.orders o where o.order_number = v_number);
    v_tries := v_tries + 1;
    if v_tries >= 5 then
      raise exception 'No free order number.';
    end if;
  end loop;

  insert into finance.orders (
    order_number, access_token_hash, access_token_expires_at, customer_id,
    customer_email, customer_name, customer_phone, city_key, city_name_ar, address,
    seller, policy_revisions,
    subtotal_halalas, discount_halalas, shipping_halalas, total_halalas,
    coupon_id, coupon_code, environment, idempotency_key, request_hash, checkout_session, email_hash,
    hold_expires_at
  )
  values (
    v_number, p_access_token_hash, now() + interval '7 days', v_customer,
    v_email, v_name, v_phone, v_price -> 'city' ->> 'key', v_price -> 'city' ->> 'name', v_address,
    jsonb_build_object(
      'legalName', v_settings.seller_legal_name,
      'address', v_settings.seller_address,
      'registration', v_settings.seller_registration
    ),
    v_settings.policy_revisions,
    (v_price ->> 'subtotal')::integer, (v_price ->> 'discount')::integer,
    (v_price ->> 'shipping')::integer, (v_price ->> 'total')::integer,
    (v_price -> 'coupon' ->> 'id')::uuid, v_price -> 'coupon' ->> 'code', p_environment,
    p_idempotency_key, p_request_hash, p_checkout_session, v_email_hash,
    v_expires
  )
  returning id into v_order;

  insert into finance.order_items (
    order_id, line_no, variant_id, product_id, sku, product_title, variant_title, fulfillment,
    unit_price_halalas, quantity, line_subtotal_halalas, discount_halalas, dedication,
    preorder, preorder_ships_on, preorder_note
  )
  select v_order,
         row_number() over (order by (l ->> 'line')::integer),
         (l ->> 'variantId')::uuid,
         (l ->> 'productId')::uuid,
         l ->> 'sku',
         l ->> 'productTitle',
         l ->> 'variantTitle',
         l ->> 'fulfillment',
         (l ->> 'unitPrice')::integer,
         (l ->> 'quantity')::integer,
         (l ->> 'subtotal')::integer,
         (l ->> 'discount')::integer,
         l ->> 'dedication',
         coalesce(jsonb_typeof(l -> 'preorder') = 'object', false),
         (l -> 'preorder' ->> 'shipsOn')::date,
         l -> 'preorder' ->> 'note'
    from jsonb_array_elements(v_price -> 'lines') l;

  -- A physical or signed line holds stock; a preorder line holds capacity,
  -- whatever it is (a digital preorder included). The flag is a snapshot: it,
  -- not the variant's current one, decides at payment, at order_resolve and at
  -- restock.
  insert into finance.inventory_reservations (order_id, variant_id, quantity, expires_at, preorder)
  select v_order, (l ->> 'variantId')::uuid, (l ->> 'quantity')::integer, v_expires,
         coalesce(jsonb_typeof(l -> 'preorder') = 'object', false)
    from jsonb_array_elements(v_price -> 'lines') l
   where l ->> 'fulfillment' <> 'digital' or jsonb_typeof(l -> 'preorder') = 'object';

  if jsonb_typeof(v_price -> 'coupon') = 'object' then
    insert into finance.coupon_redemptions (coupon_id, order_id, expires_at)
    values ((v_price -> 'coupon' ->> 'id')::uuid, v_order, v_expires);
  end if;

  insert into public.audit_events (action, entity, entity_id, summary)
  values (
    'order.created',
    'order',
    v_order::text,
    jsonb_build_object(
      'orderNumber', v_number,
      'total', (v_price ->> 'total')::integer,
      'lines', jsonb_array_length(v_price -> 'lines'),
      'environment', p_environment
    )
  );

  return jsonb_build_object('ok', true, 'duplicate', false, 'order', finance.order_summary(v_order));
end
$$;

-- The buyer cancels their own pending order (the token from `checkout_create`
-- proves it), which releases its holds at once. Anything else about the order
-- answers NOT_FOUND, so the call reveals nothing. While a payment attempt is
-- active an invoice may be payable at the provider, so nothing is cancelled
-- here: PAYMENT_ACTIVE hands the attempt to the function, which cancels the
-- invoice (or finds it paid) first. That answer is given 30 times per hour per
-- order, then the throttle (54000).
create or replace function public.checkout_cancel(p_order_number text, p_access_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_attempt finance.payment_attempts;
begin
  -- The token is checked before the row is locked, so guessed tokens never
  -- queue behind (or delay) a real change to the order.
  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, '')));
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_order from finance.orders o where o.id = v_order.id for update;
  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', true, 'status', v_order.status);
  end if;

  -- Under the order's lock no attempt can begin, so what is read here holds.
  select * into v_attempt
    from finance.payment_attempts a
   where a.order_id = v_order.id and a.status in ('creating', 'pending', 'uncertain');
  if found then
    -- Each such answer sends the function to the provider (cancel, then fetch).
    -- A healthy provider ends that in one round; while it fails, one order's
    -- token must not be a way to spend the provider's rate limit.
    if not finance.rate_limit_take(
      'checkout-cancel:order', encode(sha256(convert_to(v_order.id::text, 'UTF8')), 'hex'), 30, interval '1 hour'
    ) then
      raise exception 'Too many cancels; try again later.' using errcode = 'program_limit_exceeded';
    end if;
    return jsonb_build_object(
      'ok', false,
      'code', 'PAYMENT_ACTIVE',
      'attempt', jsonb_build_object(
        'attemptId', v_attempt.id, 'status', v_attempt.status, 'providerInvoiceId', v_attempt.provider_invoice_id
      )
    );
  end if;

  update finance.orders set status = 'cancelled', version = version + 1, updated_at = now() where id = v_order.id;
  update finance.inventory_reservations set state = 'released', released_at = now()
   where order_id = v_order.id and state = 'held';
  update finance.coupon_redemptions set state = 'released', released_at = now()
   where order_id = v_order.id and state = 'held';
  insert into public.audit_events (action, entity, entity_id, summary)
  values ('order.cancelled', 'order', v_order.id::text, jsonb_build_object('orderNumber', v_order.order_number, 'by', 'buyer'));
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end
$$;

-- 3. The owner's switch ---------------------------------------------------

-- Called by the `admin` Edge Function as `service_role` after its own aal2/TOTP
-- step-up check and its check that the payment settings work (the SQL cannot
-- see either), like `commerce_settings_save`: the owner is rechecked here and a
-- stale version raises unique_violation. Turning checkout on also needs the
-- seller named and the policies approved; the switch gates new orders only
-- (an order that exists can still be paid, cancelled and settled).
create function public.commerce_checkout_set(p_actor uuid, p_expected_version integer, p_enabled boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
begin
  if p_enabled is null then
    raise exception 'Invalid checkout switch.' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from finance.commerce_settings where id = 1 for update;

  -- `is distinct from`, not `<>`: a null expected version is a conflict too.
  if p_expected_version is distinct from v_row.version then
    raise exception 'Commerce settings changed in another session.'
      using errcode = 'unique_violation';
  end if;

  if p_enabled and (
    v_row.seller_legal_name is null or v_row.seller_registration is null or v_row.policy_revisions = '{}'::jsonb
  ) then
    raise exception 'Name the seller and approve the policies before opening checkout.'
      using errcode = 'raise_exception';
  end if;

  update finance.commerce_settings
  set checkout_enabled = p_enabled,
      version = v_row.version + 1
  where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.checkout',
    'commerce_settings',
    '1',
    jsonb_build_object('enabled', p_enabled, 'version', v_row.version + 1)
  );

  return v_row.version + 1;
end
$$;

comment on column finance.commerce_settings.checkout_enabled is
  'Off until the owner turns it on (commerce_checkout_set: a fresh TOTP, working payment settings, the seller named, the policies approved); gates new orders only.';

-- 4. Grants ------------------------------------------------------------------

revoke all on function public.checkout_quote(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function public.checkout_cancel(text, text) from public, anon, authenticated;
revoke all on function public.commerce_checkout_set(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.checkout_quote(text, jsonb, text, text) to service_role;
grant execute on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  to service_role;
grant execute on function public.checkout_cancel(text, text) to service_role;
grant execute on function public.commerce_checkout_set(uuid, integer, boolean) to service_role;

revoke all on function finance.checkout_price(jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function finance.order_summary(uuid) from public, anon, authenticated, service_role;
