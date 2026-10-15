-- RESIDUALS-1, round R1: the SQL of the round, in one forward migration. Every
-- function is `create or replace` (a changed signature is dropped first) and
-- restates its grants, so the file is re-runnable. The earlier migrations stay
-- untouched. Each section says which item of the round it is and what it
-- changed in the function's latest definition; the rest is that definition.

-- 1. I44 (1): the policy approval approves the revisions the owner reviewed.
--
-- 1a. `commerce_settings_get` of 20261007110000_fable_audit_operations.sql,
--     with one more key. `publishedPolicies` lists, in the order store,
--     delivery, refund, privacy, each policy an approval would cover (the four
--     fixed documents that are published now): its document id, its title, the
--     published revision (`seq`, the identifier `policy_revisions` holds) and
--     when that revision went live (`updated_at` of the live row, which
--     `content_go_live` sets on every publish). The screen shows them and
--     sends exactly those revisions to the approval. Otherwise identical:
--
-- The browser form's read (owner only): the whole row as one jsonb object.
create or replace function public.commerce_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
begin
  if (select public.current_staff_role()) is distinct from 'owner' then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_row from finance.commerce_settings where id = 1;
  return jsonb_build_object(
    'checkoutEnabled', v_row.checkout_enabled,
    'sellerLegalName', v_row.seller_legal_name,
    'sellerAddress', v_row.seller_address,
    'sellerRegistration', v_row.seller_registration,
    'policyRevisions', v_row.policy_revisions,
    'currency', v_row.currency,
    'version', v_row.version,
    'configuredAt', v_row.configured_at,
    'checkoutOpen', v_row.checkout_enabled
      and v_row.seller_legal_name is not null
      and v_row.seller_registration is not null
      and v_row.policy_revisions <> '{}'::jsonb,
    'checkoutClosedReason', case
      when not v_row.checkout_enabled then 'SWITCH_OFF'
      when v_row.seller_legal_name is null or v_row.seller_registration is null then 'SELLER_UNSET'
      when v_row.policy_revisions = '{}'::jsonb then 'POLICIES_UNAPPROVED'
    end,
    'publishedPolicies', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', d.doc_id, 'title', d.data ->> 'title', 'seq', d.seq, 'publishedAt', d.updated_at)
               order by array_position(array['store', 'delivery', 'refund', 'privacy'], d.doc_id)
             )
        from public.published_documents d
       where d.collection = 'policies' and d.doc_id in ('store', 'delivery', 'refund', 'privacy')
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.commerce_settings_get() from public, anon;
grant execute on function public.commerce_settings_get() to authenticated;

-- 1b. `commerce_policies_approve` of 20260930140000_audit2_fixes.sql, with a
--     third argument, `p_revisions`: the revisions the owner's screen showed,
--     as {policy: seq}. After the same locks and checks as before (the owner;
--     the settings row, locked first, as the publish trigger's order requires;
--     the version; the three required policies published), the approval is
--     refused with object_not_in_prerequisite_state, and nothing is written,
--     unless the map equals what is published now key for key: a policy
--     missing from the map, an extra key or a revision that is no longer the
--     published one all differ. The two-argument signature is dropped, so no
--     caller can approve without saying what it approves. Otherwise identical:
--
-- Approves the published revisions of the store, delivery and refund policies
-- (and the privacy policy when it is published) as the ones a buyer accepts at
-- checkout: {version, policyRevisions}. A stale version is unique_violation,
-- a missing required policy raise_exception, a changed set of revisions
-- object_not_in_prerequisite_state.
drop function if exists public.commerce_policies_approve(uuid, integer);
create or replace function public.commerce_policies_approve(p_actor uuid, p_expected_version integer, p_revisions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
  v_store integer;
  v_delivery integer;
  v_refund integer;
  v_privacy integer;
  v_revisions jsonb;
begin
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

  select seq into v_store from public.published_documents where collection = 'policies' and doc_id = 'store';
  select seq into v_delivery from public.published_documents where collection = 'policies' and doc_id = 'delivery';
  select seq into v_refund from public.published_documents where collection = 'policies' and doc_id = 'refund';
  select seq into v_privacy from public.published_documents where collection = 'policies' and doc_id = 'privacy';
  if v_store is null or v_delivery is null or v_refund is null then
    raise exception 'Publish the store, delivery and refund policies first.' using errcode = 'raise_exception';
  end if;

  v_revisions := jsonb_build_object('store', v_store, 'delivery', v_delivery, 'refund', v_refund)
    || case when v_privacy is null then '{}'::jsonb else jsonb_build_object('privacy', v_privacy) end;

  -- I44 (1): the owner approves what the screen showed, and nothing else. A
  -- policy missing from the map, an extra key or a revision that is no longer
  -- the published one means the policies changed since the page was read, so
  -- nothing is written. `is distinct from`, not `<>`: a null or a map that is
  -- not an object differs too.
  if p_revisions is distinct from v_revisions then
    raise exception 'The published policies changed since the screen was read.'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update finance.commerce_settings
     set policy_revisions = v_revisions,
         version = v_row.version + 1,
         configured_at = now(),
         approved_by = p_actor
   where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.policies',
    'commerce_settings',
    '1',
    jsonb_build_object('version', v_row.version + 1, 'revisions', v_revisions)
  );

  return jsonb_build_object('version', v_row.version + 1, 'policyRevisions', v_revisions);
end
$$;
revoke all on function public.commerce_policies_approve(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_policies_approve(uuid, integer, jsonb) to service_role;

-- 2. I50 (3): `checkout_create` of 20261002110000_checkout_payment.sql, with
--    one change: when its own pricing under the locks refuses the cart, the
--    reply carries `held: true` beside the code when the first refusal is an
--    OUT_OF_STOCK that `checkout_price` marked held (the units exist and only
--    other orders' unpaid holds take them), the same rule as the quote's. A
--    create that is short of stock with no hold in the way answers without it.
--    The function passes it through and the checkout page words it. Otherwise
--    identical:
--
-- Creates one pending order and its holds, all or nothing (DATA "Checkout
-- transaction" 3). Business refusals return {ok:false, code, ...} and write
-- nothing but their throttle hit; malformed calls raise. The unpaid-hold
-- limits, the throttles and the preorder snapshot are as in
-- 20261002110000_checkout_payment.sql, where they are described.
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
    -- I50 (3): `held` is the first refusal's own, set by `checkout_price` under the same locks.
    return jsonb_build_object('ok', false, 'code', v_price -> 'errors' -> 0 ->> 'code', 'quote', v_price)
      || case when v_price -> 'errors' -> 0 ->> 'held' = 'true' then jsonb_build_object('held', true) else '{}'::jsonb end;
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
revoke all on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  to service_role;

-- 3. I51 (2): `finance.checkout_price` of 20261007120000_fable_audit_second_pass.sql,
--    with one change: a refusal of a line whose variant exists carries
--    `productTitle` and `variantTitle` (the product's and the variant's own
--    titles, at most 200 and 120 characters by their tables' checks), so the
--    cart can name a line it cannot price. That is every refusal made after
--    the variant is read: UNAVAILABLE, a digital line's quantity above one, a
--    dedication on a line that cannot carry one or one that is too long, and
--    OUT_OF_STOCK with or without `held`. A variant that no longer exists is
--    UNAVAILABLE with no titles. The quote hash is built from the priced
--    lines, the city, the shipping, the coupon and the totals, never from
--    `errors`, so no hash changes; the titles on the priced lines are not in
--    it either. Otherwise identical:
--
-- Otherwise identical to 20260927160000_catalog_and_checkout.sql, plus:
-- availability by `finance.availability` (stock, or preorder capacity, less
-- unpaid holds); a preorder whose delivery date is before today in Riyadh is
-- UNAVAILABLE; OUT_OF_STOCK carries `held: true` when the units exist and
-- only other orders' unpaid holds take them; each line carries `preorder`
-- (null, or `{shipsOn, note}` from the variant's current flag); the hash text
-- covers each line's preorder flag, date and note; TOTAL_BELOW_MINIMUM (100
-- halalas, the gateway's smallest invoice) when nothing else is wrong; a
-- digital line's quantity above one names `maximum: 1`.
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
  v_names jsonb;
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
    -- I51 (2): what a refusal below says of the line, when the variant exists and its product is published (the
    -- quote is public: a draft or archived product's title stays as hidden as its row, which RLS keeps from anon).
    v_names := case
      when found and v_row.status = 'published'
        then jsonb_build_object('productTitle', left(v_row.product_title, 200), 'variantTitle', left(v_row.variant_title, 120))
      else '{}'::jsonb
    end;
    -- A preorder whose delivery date has passed is not for sale: the buyer must not be shown it.
    if not found or not v_row.enabled or v_row.status <> 'published' or v_row.price_halalas is null
      or (v_row.preorder and v_row.preorder_ships_on < v_today)
    then
      v_errors := v_errors || (jsonb_build_object('code', 'UNAVAILABLE', 'line', v_index, 'variantId', v_variant_id) || v_names);
      continue;
    end if;
    -- A digital line is one copy: the order grants one entitlement per line, so
    -- a quantity above one would be charged for copies never given. The
    -- refusal names its maximum, which the 1 to 20 rule above does not.
    if v_row.fulfillment = 'digital' and v_qty <> 1 then
      v_errors := v_errors
        || (jsonb_build_object('code', 'INVALID_QUANTITY', 'line', v_index, 'variantId', v_variant_id, 'maximum', 1) || v_names);
      continue;
    end if;
    if v_dedication is not null and v_row.fulfillment <> 'signed' then
      v_errors := v_errors || (jsonb_build_object('code', 'DEDICATION_NOT_ALLOWED', 'line', v_index, 'variantId', v_variant_id) || v_names);
      continue;
    end if;
    if v_dedication is not null and (char_length(v_dedication) > 200 or v_dedication ~ '[[:cntrl:]]') then
      v_errors := v_errors || (jsonb_build_object('code', 'INVALID_DEDICATION', 'line', v_index, 'variantId', v_variant_id) || v_names);
      continue;
    end if;

    -- Null means unlimited (a digital variant that is not a preorder).
    v_available := finance.availability(v_variant_id);
    if v_available is not null and v_available < v_qty then
      v_error := jsonb_build_object(
        'code', 'OUT_OF_STOCK', 'line', v_index, 'variantId', v_variant_id, 'available', v_available
      ) || v_names;
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
revoke all on function finance.checkout_price(jsonb, text, text) from public, anon, authenticated, service_role;

-- 4. I50 (4): `reconciliation_list` of 20261007100000_fable_audit_payments.sql,
--    with one more list. `closedReviews` holds the review payments with no
--    order that the owner closed by hand (`closed_at` set, `closed_reason`
--    not `refunded`, which is the refund path's own word) and that are not
--    refunded in full by the ledger's confirmed refunds, newest closed first,
--    at most 50, in the row shape of `reviews` (`orderNumber` is always null:
--    these payments have no order). Such a payment can still be refunded
--    (`refund_request` and `refund_record_external` refuse only one closed as
--    `refunded`), so the screen keeps it reachable instead of letting it leave
--    every admin screen. `reviews` still lists the open ones only, and the
--    «تحتاج مطابقة» count (`orders_alerts`) is untouched. Otherwise identical:
--
-- What needs a person at the payment ledger, for the owner: attempts that are
-- uncertain, UNVERIFIED (and not settled since), paid with a provider status
-- other than paid or refunded (unless the money has all been refunded, which
-- is how a void ends), paid with a provider refunded total above the ledger's
-- confirmed plus in-flight refunds, or parked by the job for the other mode
-- with an invoice and not settled since (MODE_CHANGED); open review payments;
-- in-flight refunds (a refund parked for the other mode among them);
-- unprocessed webhook events and the exhausted ones that still need a person.
-- Each list is the newest 100 (the closed reviews, the newest 50).
-- {attempts: [attempt + orderNumber, refunded, reasons], reviews: [review +
-- orderNumber], closedReviews: [review + orderNumber (null)], refunds: [refund
-- + orderNumber], events: [event]}; `reasons` holds UNCERTAIN, UNVERIFIED,
-- PROVIDER_STATUS, EXTERNAL_REFUND, MODE_CHANGED.
create or replace function public.reconciliation_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform finance.require_staff(true);
  return jsonb_build_object(
    'attempts', coalesce((
      select jsonb_agg(
               finance.attempt_json(s.a) || jsonb_build_object(
                 'orderNumber', s.order_number, 'refunded', s.refunded, 'reasons', to_jsonb(s.reasons)
               )
               order by s.created_at desc, s.id
             )
        from (
          select * from (
            select a, a.id, a.created_at, o.order_number, finance.attempt_refunds_confirmed(a.id) as refunded,
                   array_remove(array[
                     case when a.status = 'uncertain' then 'UNCERTAIN' end,
                     case when a.last_error = 'UNVERIFIED' and a.status not in ('paid', 'review') then 'UNVERIFIED' end,
                     case when a.status = 'paid' and a.provider_status not in ('paid', 'refunded')
                            and finance.attempt_refunds_confirmed(a.id) < coalesce(a.captured_halalas, 0)
                          then 'PROVIDER_STATUS' end,
                     case when a.status = 'paid' and a.provider_refunded_halalas > finance.attempt_refunds_known(a.id)
                          then 'EXTERNAL_REFUND' end,
                     case when a.last_error = 'MODE_CHANGED' and a.status not in ('paid', 'review')
                            and a.provider_invoice_id is not null
                          then 'MODE_CHANGED' end
                   ], null) as reasons
              from finance.payment_attempts a
              join finance.orders o on o.id = a.order_id
          ) t
          where cardinality(t.reasons) > 0
          order by t.created_at desc, t.id
          limit 100
        ) s
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(finance.review_json(s.pr) || jsonb_build_object('orderNumber', s.order_number) order by s.created_at desc, s.provider_payment_id)
        from (
          select pr, pr.created_at, pr.provider_payment_id, o.order_number
            from finance.payment_reviews pr
            left join finance.orders o on o.id = pr.order_id
           where pr.closed_at is null
           order by pr.created_at desc, pr.provider_payment_id
           limit 100
        ) s
    ), '[]'::jsonb),
    'closedReviews', coalesce((
      select jsonb_agg(
               finance.review_json(s.pr) || jsonb_build_object('orderNumber', null::text)
               order by s.closed_at desc, s.provider_payment_id
             )
        from (
          select pr, pr.closed_at, pr.provider_payment_id
            from finance.payment_reviews pr
           where pr.order_id is null and pr.closed_at is not null
             and pr.closed_reason is distinct from 'refunded'
             and coalesce(pr.amount_halalas, 0) > (
               select coalesce(sum(r.amount_halalas), 0)
                 from finance.refunds r
                where r.review_payment_id = pr.provider_payment_id and r.status = 'succeeded'
             )
           order by pr.closed_at desc, pr.provider_payment_id
           limit 50
        ) s
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(finance.refund_json(s.r) || jsonb_build_object('orderNumber', s.order_number) order by s.created_at desc, s.id)
        from (
          select r, r.created_at, r.id, o.order_number
            from finance.refunds r
            left join finance.orders o on o.id = r.order_id
           where r.status in ('submitting', 'uncertain')
           order by r.created_at desc, r.id
           limit 100
        ) s
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(finance.event_json(s.e) order by s.received_at desc, s.event_id)
        from (
          select e, e.received_at, e.event_id
            from finance.payment_events e
           where e.processed_at is null or finance.event_needs_person(e)
           order by e.received_at desc, e.event_id
           limit 100
        ) s
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function public.reconciliation_list() from public, anon;
grant execute on function public.reconciliation_list() to authenticated;
