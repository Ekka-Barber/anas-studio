-- P07 round 1: the catalog and the checkout core (D06, D07, D34, D37; DATA
-- "Checkout transaction" and "Unpaid reservation abuse").
--
-- Catalog tables live in `public` under RLS, like the content tables: anon
-- reads published products, their enabled variants and the enabled city rates
-- (the static build and the cart need them); only an owner writes, and only
-- the columns granted below. Orders and their holds live in the private
-- `finance` schema, written by three `service_role` functions that the
-- `checkout` Edge Function calls: quote, create and cancel.
--
-- Design choices:
-- - Availability is computed, not counted: a physical or signed variant has
--   `stock - (quantities held by unexpired holds)` units left, read while the
--   variant row is locked. Concurrent checkouts of one variant serialize on
--   that lock, an expired hold stops counting the moment it expires (the
--   minute job only tidies its state), and there is no reserved counter that
--   could drift or be written through the Data API.
-- - The quote is stateless. `checkout_create` prices the cart again under the
--   locks and compares the result's hash with the one the buyer confirmed; any
--   difference (a price, a fee, a coupon, stock) returns QUOTE_CHANGED with the
--   new quote, so nobody is charged an amount they were not shown.
--   ponytail: no stored checkout_quotes table; P09 adds one if a booking hold
--   needs a stored quote.
-- - Checkout stays off. The P06 check that pinned `checkout_enabled` to false
--   is lifted, but no API path sets it: P08 adds the owner's switch behind the
--   verified payment gateway, and the local tests turn it on as the superuser.
-- - Money is integer halalas; sums use bigint and a cart above 500,000 SAR is
--   refused. No tax anywhere (D34).

-- 1. Store policies are a content collection (drafts, versions, publishing);
--    the owner's approved revisions live in `finance.commerce_settings`.
alter type public.content_collection add value if not exists 'policies';

-- 2. Shared triggers for the catalog tables.

-- Every update bumps the row's version, so the admin form's
-- `update ... where version = <read>` turns a concurrent edit into a conflict.
create function public.catalog_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end
$$;

-- DATA: "Record all financial and stock changes in audit". Prices, stock,
-- fees, coupon terms and status are recorded with their old and new values;
-- any other changed column (a title, a customer's name) by its name only.
create function public.catalog_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
begin
  for v_key in select distinct k from jsonb_object_keys(v_old || v_new) as k loop
    continue when v_key in ('version', 'created_at', 'updated_at', 'body');
    -- An insert's or delete's empty columns are not changes.
    continue when coalesce(v_old -> v_key, 'null'::jsonb) = coalesce(v_new -> v_key, 'null'::jsonb);
    if v_old -> v_key is distinct from v_new -> v_key then
      v_changes := v_changes || jsonb_build_object(
        v_key,
        case
          when v_key in (
            'price_halalas', 'stock', 'enabled', 'status', 'fee_halalas', 'percent_bp', 'amount_halalas',
            'usage_limit', 'min_subtotal_halalas', 'starts_at', 'ends_at'
          ) then jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key)
          else 'true'::jsonb
        end
      );
    end if;
  end loop;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    (select auth.uid()),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    jsonb_build_object('changes', v_changes)
  );
  return null;
end
$$;

-- Product and variant changes the public pages show ask for a site rebuild
-- (D32), coalesced by `site_build_trigger` like a content publish. A stock
-- change does not: the pages show prices, and the cart reads stock live.
create function public.catalog_request_build()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.site_build_request();
  return null;
end
$$;

-- 3. The catalog (public, RLS on).

create table public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200 and title !~ '[[:cntrl:]]'),
  summary text not null default '' check (char_length(summary) <= 500),
  -- Lexical JSON, validated in the admin and rendered through the D14 allowlist.
  body jsonb not null default '{"root":{"type":"root","children":[]}}'::jsonb
    check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 65536),
  -- A media-library id or an image manifest id, like the content image fields.
  cover_image text check (cover_image is null or char_length(cover_image) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  -- D37: rows of the demo catalog; only the local seed sets it.
  demo boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  sku text not null unique check (sku ~ '^[A-Z0-9][A-Z0-9-]{0,39}$'),
  title text not null check (char_length(btrim(title)) between 1 and 120 and title !~ '[[:cntrl:]]'),
  fulfillment text not null check (fulfillment in ('digital', 'physical', 'signed')),
  -- D06: null means not configured, so not for sale; never free by accident.
  price_halalas integer check (price_halalas is null or price_halalas between 1 and 10000000),
  enabled boolean not null default false,
  -- Finite stock for physical and signed editions; a digital variant has none.
  stock integer check (stock is null or stock >= 0),
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  -- The private Storage key of the paid file (P08 delivers it), digital only.
  digital_asset text check (digital_asset is null or char_length(digital_asset) between 1 and 300),
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((fulfillment = 'digital') = (stock is null)),
  check (fulfillment = 'digital' or digital_asset is null)
);
create index product_variants_product on public.product_variants (product_id);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  -- Stored upper case (the trigger below); buyers may type any case.
  code text not null unique check (code ~ '^[A-Z0-9]{3,32}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  percent_bp integer check (percent_bp is null or percent_bp between 1 and 10000),
  amount_halalas integer check (amount_halalas is null or amount_halalas between 1 and 10000000),
  starts_at timestamptz,
  ends_at timestamptz,
  -- Compared with the whole cart's subtotal.
  min_subtotal_halalas integer not null default 0 check (min_subtotal_halalas between 0 and 50000000),
  usage_limit integer check (usage_limit is null or usage_limit >= 1),
  -- Empty: every product. Otherwise only these products' lines are discounted.
  product_ids uuid[] not null default '{}' check (cardinality(product_ids) <= 100),
  enabled boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'percent') = (percent_bp is not null)),
  check ((kind = 'fixed') = (amount_halalas is not null)),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

create function public.coupon_code_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.code := upper(btrim(new.code));
  return new;
end
$$;

-- D09: a city without an enabled, configured fee is not served; an
-- unsupported city never means free delivery.
create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  city_key text not null unique check (city_key ~ '^[a-z][a-z0-9-]{1,40}$'),
  name_ar text not null check (char_length(btrim(name_ar)) between 1 and 80 and name_ar !~ '[[:cntrl:]]'),
  fee_halalas integer check (fee_halalas is null or fee_halalas between 0 and 1000000),
  enabled boolean not null default false,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Guest buyers (D08): one row per normalized email, written by checkout.
-- Staff read it; the owner may correct the name and phone. An order keeps its
-- own contact snapshot, so a profile change never rewrites an order.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (
    char_length(email) between 3 and 254
    and email = lower(btrim(email))
    and email ~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  ),
  name text not null check (char_length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  -- A Saudi mobile in the form `normalizeSaudiMobile` returns.
  phone text check (phone is null or phone ~ '^9665[0-9]{8}$'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_touch before update on public.products
  for each row execute function public.catalog_touch();
create trigger product_variants_touch before update on public.product_variants
  for each row execute function public.catalog_touch();
create trigger coupons_touch before update on public.coupons
  for each row execute function public.catalog_touch();
create trigger shipping_rates_touch before update on public.shipping_rates
  for each row execute function public.catalog_touch();
create trigger customers_touch before update on public.customers
  for each row execute function public.catalog_touch();
create trigger coupons_normalize before insert or update of code on public.coupons
  for each row execute function public.coupon_code_normalize();

create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.catalog_audit();
create trigger product_variants_audit after insert or update or delete on public.product_variants
  for each row execute function public.catalog_audit();
create trigger coupons_audit after insert or update or delete on public.coupons
  for each row execute function public.catalog_audit();
create trigger shipping_rates_audit after insert or update or delete on public.shipping_rates
  for each row execute function public.catalog_audit();
-- A new customer is written by checkout with its order; only later changes
-- are audited, and by column name only (personal data stays out of audit).
create trigger customers_audit after update or delete on public.customers
  for each row execute function public.catalog_audit();

create trigger products_request_build
  after insert or delete or update of slug, title, summary, body, cover_image, status, sort_order on public.products
  for each statement execute function public.catalog_request_build();
create trigger product_variants_request_build
  after insert or delete or update of product_id, sku, title, fulfillment, price_halalas, enabled, sort_order
  on public.product_variants
  for each statement execute function public.catalog_request_build();

-- 4. Who reads and writes the catalog. An owner configures it (DATA:
--    "owner configures catalog, prices, coupons, shipping"); every staff role
--    reads products, variants, rates and customers as orders need; anon reads
--    only what a visitor sees, and never stock, private files or coupons.
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.coupons enable row level security;
alter table public.shipping_rates enable row level security;
alter table public.customers enable row level security;

grant select on public.products to anon, authenticated;
grant insert (slug, title, summary, body, cover_image, status, sort_order) on public.products to authenticated;
grant update (slug, title, summary, body, cover_image, status, sort_order) on public.products to authenticated;
grant delete on public.products to authenticated;
create policy products_read_public on public.products
  for select to anon using (status = 'published');
create policy products_read_staff on public.products
  for select to authenticated using (status = 'published' or (select public.current_staff_role()) is not null);
create policy products_insert_owner on public.products
  for insert to authenticated with check ((select public.current_staff_role()) = 'owner');
create policy products_update_owner on public.products
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner') with check ((select public.current_staff_role()) = 'owner');
create policy products_delete_owner on public.products
  for delete to authenticated using ((select public.current_staff_role()) = 'owner');

grant select (id, product_id, sku, title, fulfillment, price_halalas, enabled, sort_order)
  on public.product_variants to anon;
grant select on public.product_variants to authenticated;
grant insert (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold, digital_asset, sort_order)
  on public.product_variants to authenticated;
grant update (product_id, sku, title, fulfillment, price_halalas, enabled, stock, low_stock_threshold, digital_asset, sort_order)
  on public.product_variants to authenticated;
grant delete on public.product_variants to authenticated;
create policy product_variants_read_public on public.product_variants
  for select to anon
  using (enabled and exists (select 1 from public.products p where p.id = product_id and p.status = 'published'));
create policy product_variants_read_staff on public.product_variants
  for select to authenticated using ((select public.current_staff_role()) is not null);
create policy product_variants_insert_owner on public.product_variants
  for insert to authenticated with check ((select public.current_staff_role()) = 'owner');
create policy product_variants_update_owner on public.product_variants
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner') with check ((select public.current_staff_role()) = 'owner');
create policy product_variants_delete_owner on public.product_variants
  for delete to authenticated using ((select public.current_staff_role()) = 'owner');

grant select, delete on public.coupons to authenticated;
grant insert (code, kind, percent_bp, amount_halalas, starts_at, ends_at, min_subtotal_halalas, usage_limit, product_ids, enabled)
  on public.coupons to authenticated;
grant update (code, kind, percent_bp, amount_halalas, starts_at, ends_at, min_subtotal_halalas, usage_limit, product_ids, enabled)
  on public.coupons to authenticated;
create policy coupons_read_owner on public.coupons
  for select to authenticated using ((select public.current_staff_role()) = 'owner');
create policy coupons_insert_owner on public.coupons
  for insert to authenticated with check ((select public.current_staff_role()) = 'owner');
create policy coupons_update_owner on public.coupons
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner') with check ((select public.current_staff_role()) = 'owner');
create policy coupons_delete_owner on public.coupons
  for delete to authenticated using ((select public.current_staff_role()) = 'owner');

grant select (id, city_key, name_ar, fee_halalas, enabled, sort_order) on public.shipping_rates to anon;
grant select, delete on public.shipping_rates to authenticated;
grant insert (city_key, name_ar, fee_halalas, enabled, sort_order) on public.shipping_rates to authenticated;
grant update (city_key, name_ar, fee_halalas, enabled, sort_order) on public.shipping_rates to authenticated;
create policy shipping_rates_read_public on public.shipping_rates
  for select to anon using (enabled and fee_halalas is not null);
create policy shipping_rates_read_staff on public.shipping_rates
  for select to authenticated using ((select public.current_staff_role()) is not null);
create policy shipping_rates_insert_owner on public.shipping_rates
  for insert to authenticated with check ((select public.current_staff_role()) = 'owner');
create policy shipping_rates_update_owner on public.shipping_rates
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner') with check ((select public.current_staff_role()) = 'owner');
create policy shipping_rates_delete_owner on public.shipping_rates
  for delete to authenticated using ((select public.current_staff_role()) = 'owner');

grant select on public.customers to authenticated;
grant update (name, phone) on public.customers to authenticated;
create policy customers_read_staff on public.customers
  for select to authenticated using ((select public.current_staff_role()) in ('owner', 'operations'));
create policy customers_update_owner on public.customers
  for update to authenticated
  using ((select public.current_staff_role()) = 'owner') with check ((select public.current_staff_role()) = 'owner');

-- 5. Orders and their holds (finance: no API role has any right here).

create table finance.orders (
  id uuid primary key default gen_random_uuid(),
  -- Public and random (no order volume leaks through it).
  order_number text not null unique check (order_number ~ '^[2-9A-HJ-NP-Z]{8}$'),
  -- DATA: hash-only, scoped, expiring order access (the `orders` page, P08).
  access_token_hash text not null check (access_token_hash ~ '^[0-9a-f]{64}$'),
  access_token_expires_at timestamptz not null,
  customer_id uuid not null references public.customers (id),
  -- Immutable contact and delivery snapshots.
  customer_email text not null,
  customer_name text not null,
  customer_phone text,
  city_key text,
  city_name_ar text,
  address text check (address is null or (char_length(address) between 5 and 500 and address !~ '[[:cntrl:]]')),
  -- The seller and the approved policy revisions at the time of the order.
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  policy_revisions jsonb not null check (jsonb_typeof(policy_revisions) = 'object'),
  subtotal_halalas integer not null check (subtotal_halalas >= 0),
  discount_halalas integer not null check (discount_halalas >= 0 and discount_halalas <= subtotal_halalas),
  shipping_halalas integer not null check (shipping_halalas >= 0),
  total_halalas integer not null check (total_halalas = subtotal_halalas - discount_halalas + shipping_halalas),
  currency text not null default 'SAR' check (currency = 'SAR'),
  coupon_id uuid references public.coupons (id),
  coupon_code text,
  environment text not null check (environment in ('test', 'live')),
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  checkout_session uuid not null,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  -- P08 adds the paid states.
  status text not null default 'pending_payment' check (status in ('pending_payment', 'expired', 'cancelled')),
  hold_expires_at timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A physical order carries a city and an address; a digital-only one neither.
  check ((city_key is null) = (address is null))
);
create index orders_pending_email on finance.orders (email_hash) where status = 'pending_payment';
create index orders_pending_session on finance.orders (checkout_session) where status = 'pending_payment';
create index orders_pending_expiry on finance.orders (hold_expires_at) where status = 'pending_payment';
create index orders_customer on finance.orders (customer_id);

create table finance.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references finance.orders (id),
  line_no smallint not null check (line_no between 1 and 50),
  variant_id uuid not null references public.product_variants (id),
  product_id uuid not null references public.products (id),
  sku text not null,
  product_title text not null,
  variant_title text not null,
  fulfillment text not null check (fulfillment in ('digital', 'physical', 'signed')),
  unit_price_halalas integer not null check (unit_price_halalas > 0),
  quantity integer not null check (quantity between 1 and 20),
  line_subtotal_halalas integer not null check (line_subtotal_halalas = unit_price_halalas * quantity),
  -- The line's share of the order discount (largest remainder, see below).
  discount_halalas integer not null check (discount_halalas between 0 and line_subtotal_halalas),
  dedication text check (dedication is null or (fulfillment = 'signed' and char_length(dedication) between 1 and 200)),
  unique (order_id, line_no),
  unique (order_id, variant_id)
);

create table finance.inventory_reservations (
  id bigint generated always as identity primary key,
  order_id uuid not null references finance.orders (id),
  variant_id uuid not null references public.product_variants (id),
  quantity integer not null check (quantity between 1 and 20),
  state text not null default 'held' check (state in ('held', 'committed', 'released')),
  -- A copy of the order's hold expiry, so availability needs no join.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (order_id, variant_id)
);
create index inventory_reservations_held on finance.inventory_reservations (variant_id) where state = 'held';

create table finance.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references public.coupons (id),
  order_id uuid not null unique references finance.orders (id),
  state text not null default 'held' check (state in ('held', 'committed', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index coupon_redemptions_live on finance.coupon_redemptions (coupon_id) where state in ('held', 'committed');

-- 6. Pricing.

-- Units of one variant held by unexpired holds.
create function finance.active_holds(p_variant_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0)::integer
  from finance.inventory_reservations r
  where r.variant_id = p_variant_id and r.state = 'held' and r.expires_at > now()
$$;

-- Uses of one coupon: paid ones plus unexpired holds.
create function finance.coupon_uses(p_coupon_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from finance.coupon_redemptions c
  where c.coupon_id = p_coupon_id
    and (c.state = 'committed' or (c.state = 'held' and c.expires_at > now()))
$$;

-- Eight characters without 0/O/1/I; 256 is a multiple of 32, so uniform.
create function finance.random_order_number()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(r.b, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i
$$;

-- Prices a cart from the current catalog. The browser's lines are
-- `[{variantId, quantity, dedication?}]`; totals never come from it. Line
-- errors name the line (1-based) and the variant; totals cover the valid
-- lines, so the cart can show what to remove. `quoteHash` covers every
-- amount, the lines, the city and the coupon.
create function finance.checkout_price(p_lines jsonb, p_city_key text, p_coupon_code text)
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
           p.id as product_id, p.slug as product_slug, p.title as product_title, p.status
      into v_row
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.id = v_variant_id;
    if not found or not v_row.enabled or v_row.status <> 'published' or v_row.price_halalas is null then
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

    v_available := null;
    if v_row.stock is not null then
      v_available := greatest(v_row.stock - finance.active_holds(v_variant_id), 0);
      if v_available < v_qty then
        v_errors := v_errors || jsonb_build_object(
          'code', 'OUT_OF_STOCK', 'line', v_index, 'variantId', v_variant_id, 'available', v_available
        );
        continue;
      end if;
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
      'available', v_available
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

  select coalesce(
           string_agg(
             concat_ws('|', l ->> 'line', l ->> 'variantId', l ->> 'quantity', l ->> 'unitPrice', l ->> 'discount', coalesce(l ->> 'dedication', '')),
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

-- An order as the buyer and the admin see it (no contact details).
create function finance.order_summary(p_order uuid)
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
                   'total', i.line_subtotal_halalas - i.discount_halalas
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

-- 7. The three server-only entry points (`checkout` Edge Function).

-- The cart page's live quote, with the store's switch and the approved
-- policy revisions the buyer must accept. Throttled per salted IP hash.
create function public.checkout_quote(p_ip_hash text, p_lines jsonb, p_city_key text, p_coupon_code text)
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
    || jsonb_build_object('checkoutEnabled', v_settings.checkout_enabled, 'policyRevisions', v_settings.policy_revisions);
end
$$;

-- Creates one pending order and its holds, all or nothing (DATA "Checkout
-- transaction" 3). Business refusals return {ok:false, code, ...} and write
-- nothing but their throttle hit; malformed calls raise.
--
-- Unpaid-hold limits (DATA "Unpaid reservation abuse"), enforced under
-- transaction-scoped advisory locks so two concurrent requests cannot both
-- pass: one unexpired pending order per normalized email and one per checkout
-- session. A new idempotency key neither adds a hold nor refreshes one; a
-- buyer who changed their mind cancels the held order first
-- (`checkout_cancel`). Throttles are secondary, so shared networks stay usable:
-- 10 orders per hour per salted IP hash, 5 per hour per email, 500 per day in
-- total; Turnstile runs in the function before this. Holds last 20 minutes.
-- Residual risk, recorded: many emails from many addresses can still hold
-- scarce stock for 20 minutes at a time; the throttles bound, not stop, that.
create function public.checkout_create(
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
  v_settings finance.commerce_settings;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_code text := nullif(upper(btrim(coalesce(p_coupon_code, ''))), '');
  v_email_hash text;
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

  -- 4. Throttles (secondary).
  if not finance.rate_limit_take('checkout:ip', p_ip_hash, 10, interval '1 hour')
    or not finance.rate_limit_take('checkout:email', v_email_hash, 5, interval '1 hour')
    or not finance.rate_limit_take('checkout:all', repeat('0', 64), 500, interval '1 day')
  then
    raise exception 'Too many checkouts; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- 5. Hold limits (primary). Locks in a fixed order: key, email, session.
  perform pg_advisory_xact_lock(hashtextextended('checkout:email:' || v_email_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('checkout:session:' || p_checkout_session::text, 0));
  if exists (
    select 1
      from finance.orders o
     where o.status = 'pending_payment'
       and o.hold_expires_at > now()
       and (o.email_hash = v_email_hash or o.checkout_session = p_checkout_session)
  ) then
    return jsonb_build_object('ok', false, 'code', 'ACTIVE_HOLD');
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

  -- 7. The customer. An existing profile is kept as it is; the order keeps
  --    its own snapshot of what this buyer typed.
  insert into public.customers (email, name, phone)
  values (v_email, v_name, v_phone)
  on conflict (email) do nothing;
  select c.id into v_customer from public.customers c where c.email = v_email;

  -- 8. The order, its lines, the stock holds and the coupon hold.
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
    unit_price_halalas, quantity, line_subtotal_halalas, discount_halalas, dedication
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
         l ->> 'dedication'
    from jsonb_array_elements(v_price -> 'lines') l;

  insert into finance.inventory_reservations (order_id, variant_id, quantity, expires_at)
  select v_order, (l ->> 'variantId')::uuid, (l ->> 'quantity')::integer, v_expires
    from jsonb_array_elements(v_price -> 'lines') l
   where l ->> 'fulfillment' <> 'digital';

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
-- answers NOT_FOUND, so the call reveals nothing.
create function public.checkout_cancel(p_order_number text, p_access_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
begin
  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, '')))
   for update;
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', true, 'status', v_order.status);
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

-- 8. Expired holds, every minute. Availability already ignores an expired
--    hold; this marks the order expired and releases its rows in bounded
--    batches.
create function finance.checkout_expire()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(x.id), '{}')
    into v_ids
    from (
      select o.id
        from finance.orders o
       where o.status = 'pending_payment' and o.hold_expires_at <= now()
       order by o.hold_expires_at
       limit 500
       for update skip locked
    ) x;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update finance.orders set status = 'expired', version = version + 1, updated_at = now() where id = any(v_ids);
  update finance.inventory_reservations set state = 'released', released_at = now()
   where order_id = any(v_ids) and state = 'held';
  update finance.coupon_redemptions set state = 'released', released_at = now()
   where order_id = any(v_ids) and state = 'held';
  insert into public.audit_events (action, entity, summary)
  values ('order.expired', 'order', jsonb_build_object('count', cardinality(v_ids)));
  return cardinality(v_ids);
end
$$;

select cron.schedule('checkout-expire', '* * * * *', 'select finance.checkout_expire()');

-- 9. Checkout may be switched on from now on; nothing in the API does it yet.
alter table finance.commerce_settings drop constraint commerce_settings_checkout_enabled_check;
comment on column finance.commerce_settings.checkout_enabled is
  'Off until P08 adds the owner''s switch behind the verified payment gateway; no API path sets it in P07.';

-- 10. Grants. Only the three entry points are callable, by service_role.
revoke all on function public.checkout_quote(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  from public, anon, authenticated;
revoke all on function public.checkout_cancel(text, text) from public, anon, authenticated;
grant execute on function public.checkout_quote(text, jsonb, text, text) to service_role;
grant execute on function public.checkout_create(uuid, text, uuid, text, text, text, text, jsonb, text, text, text, jsonb, text, text, text)
  to service_role;
grant execute on function public.checkout_cancel(text, text) to service_role;

revoke all on function finance.active_holds(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.coupon_uses(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.random_order_number() from public, anon, authenticated, service_role;
revoke all on function finance.checkout_price(jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function finance.order_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.checkout_expire() from public, anon, authenticated, service_role;

revoke all on function public.catalog_touch() from public, anon, authenticated;
revoke all on function public.catalog_audit() from public, anon, authenticated;
revoke all on function public.catalog_request_build() from public, anon, authenticated;
revoke all on function public.coupon_code_normalize() from public, anon, authenticated;
