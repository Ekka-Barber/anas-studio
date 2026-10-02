-- P08 round 2: the whole schema of the verified gateway and of the post-sale
-- operations (PLANS/P08-CONTRACT.md section 4), and the payment core
-- functions (section 6, "Payment core"). Later P08 migrations add functions
-- only. The earlier migrations stay untouched; a function that changes is
-- replaced here and restates its grants.
--
-- Nothing here calls Moyasar. The `payments` and `checkout` Edge Functions
-- fetch the payment and its invoice with the secret key and hand the
-- normalized objects to `apply_verified_payment`, which alone decides whether
-- an order is paid. Money is integer halalas; no tax (D34).
--
-- One lock order for every writer (contract, rules at the top): the order
-- row, the attempt row, every variant of the order in ascending id (digital
-- ones included), the coupon row, the reservations, the refund row. A review
-- payment's row is locked in the attempt's place. A function that finds its
-- order through an attempt reads that row without a lock, locks in this
-- order and reads again before it decides. Claims and leases use
-- `for update skip locked` and never wait, so they cannot join a cycle.
--
-- Provider text never reaches a column unbounded: ids, statuses and source
-- fields are length-checked, and `last_error`, `error` and review reasons
-- hold ASCII codes only.

-- 1. The P07 tables --------------------------------------------------------

-- `orders.status`: the six states (contract section 3). `access_token_version`
-- feeds the order link's token (section 5); `paid_at` is set with the paid
-- states.
alter table finance.orders drop constraint orders_status_check;
alter table finance.orders
  add constraint orders_status_check
    check (status in ('pending_payment', 'expired', 'cancelled', 'paid', 'paid_needs_resolution', 'refunded')),
  add column paid_at timestamptz,
  add column access_token_version integer not null default 0;

-- Preorder snapshots: what the buyer was shown, and the flag that decides
-- between stock and capacity at commit time.
alter table finance.order_items
  add column preorder boolean not null default false,
  add column preorder_ships_on date,
  add column preorder_note text;
alter table finance.inventory_reservations
  add column preorder boolean not null default false;

-- The email outbox's kinds (section 4); priorities stay 0 to 2.
alter table finance.email_outbox drop constraint email_outbox_kind_check;
alter table finance.email_outbox
  add constraint email_outbox_kind_check
    check (kind in (
      'receipt', 'contact_notice', 'availability', 'order_link', 'order_shipped',
      'order_refunded', 'order_ready', 'notify_confirm', 'owner_alert'
    ));

-- 2. Preorder on the catalog ---------------------------------------------

alter table public.product_variants
  add column preorder boolean not null default false,
  add column preorder_capacity integer check (preorder_capacity > 0),
  add column preorder_ships_on date,
  add column preorder_note text
    check (char_length(preorder_note) between 1 and 300 and preorder_note !~ '[[:cntrl:]]'),
  add constraint product_variants_preorder_complete
    check (not preorder or (preorder_capacity is not null and preorder_ships_on is not null and preorder_note is not null));

-- The public pages show the preorder state, its date and its note, never the
-- capacity. The owner writes the four preorder columns and, from now on, no
-- longer `digital_asset`: only `paid_asset_set` (round 7) writes it.
grant select (preorder, preorder_ships_on, preorder_note) on public.product_variants to anon;
revoke insert (digital_asset), update (digital_asset) on public.product_variants from authenticated;
grant insert (preorder, preorder_capacity, preorder_ships_on, preorder_note) on public.product_variants to authenticated;
grant update (preorder, preorder_capacity, preorder_ships_on, preorder_note) on public.product_variants to authenticated;

-- The row trigger of 20260930140000_audit2_fixes.sql also compares the
-- public preorder columns; the capacity and the stock are not public.
drop trigger product_variants_request_build_update on public.product_variants;
create trigger product_variants_request_build_update
  after update on public.product_variants
  for each row
  when (
    (old.product_id, old.sku, old.title, old.fulfillment, old.price_halalas, old.enabled, old.sort_order,
     old.preorder, old.preorder_ships_on, old.preorder_note)
    is distinct from
    (new.product_id, new.sku, new.title, new.fulfillment, new.price_halalas, new.enabled, new.sort_order,
     new.preorder, new.preorder_ships_on, new.preorder_note)
  )
  execute function public.catalog_request_build();

-- The preorder flag and its capacity are recorded with their old and new
-- values, like stock. Otherwise identical to 20260930120000_audit_fixes.sql.
create or replace function public.catalog_audit()
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
            'usage_limit', 'min_subtotal_halalas', 'starts_at', 'ends_at', 'product_ids', 'kind', 'code',
            'preorder', 'preorder_capacity'
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
revoke all on function public.catalog_audit() from public, anon, authenticated;

-- 3. The payment tables (finance: no API role has any grant) ---------------

-- One row per try at an invoice. Active means creating, pending or uncertain;
-- the partial unique index allows one per order. `next_check_at` is the only
-- thing that makes an attempt due for the reconciliation job.
create table finance.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references finance.orders (id),
  status text not null check (status in (
    'creating', 'pending', 'uncertain', 'paid', 'review', 'failed', 'expired', 'cancelled', 'abandoned'
  )),
  amount_halalas integer not null check (amount_halalas > 0),
  currency text not null default 'SAR' check (currency = 'SAR'),
  environment text not null check (environment in ('test', 'live')),
  provider_invoice_id text unique check (provider_invoice_id is null or char_length(provider_invoice_id) between 1 and 120),
  provider_payment_id text unique check (provider_payment_id is null or char_length(provider_payment_id) between 1 and 120),
  invoice_url text check (invoice_url is null or char_length(invoice_url) <= 2000),
  invoice_expires_at timestamptz not null,
  captured_halalas integer,
  fee_halalas integer,
  source_type text check (source_type is null or char_length(source_type) <= 60),
  source_company text check (source_company is null or char_length(source_company) <= 60),
  -- The payment's last fetched status.
  provider_status text check (provider_status is null or char_length(provider_status) <= 60),
  provider_refunded_halalas integer not null default 0 check (provider_refunded_halalas >= 0),
  paid_at timestamptz,
  fetched_at timestamptz,
  next_check_at timestamptz,
  check_count integer not null default 0,
  error_count integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_attempts_active on finance.payment_attempts (order_id)
  where status in ('creating', 'pending', 'uncertain');
create index payment_attempts_order on finance.payment_attempts (order_id);
create index payment_attempts_due on finance.payment_attempts (next_check_at) where next_check_at is not null;

-- Every charged payment that cannot settle an order: one row, keyed by the
-- provider's payment id, open until `closed_at`.
create table finance.payment_reviews (
  provider_payment_id text primary key check (char_length(provider_payment_id) between 1 and 120),
  provider_invoice_id text check (provider_invoice_id is null or char_length(provider_invoice_id) <= 120),
  -- Null for an invoice no attempt maps to.
  attempt_id uuid references finance.payment_attempts (id),
  order_id uuid references finance.orders (id),
  environment text not null check (environment in ('test', 'live')),
  amount_halalas integer,
  currency text check (currency is null or char_length(currency) <= 10),
  provider_status text check (provider_status is null or char_length(provider_status) <= 60),
  reason text not null check (reason in (
    'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNEXPECTED_STATUS', 'SECOND_PAYMENT', 'ORDER_ALREADY_PAID', 'UNMAPPED_INVOICE'
  )),
  provider_refunded_halalas integer not null default 0 check (provider_refunded_halalas >= 0),
  closed_at timestamptz,
  closed_reason text check (closed_reason is null or char_length(closed_reason) <= 300),
  created_at timestamptz not null default now()
);
create index payment_reviews_order on finance.payment_reviews (order_id) where order_id is not null;
create index payment_reviews_attempt on finance.payment_reviews (attempt_id) where attempt_id is not null;

-- Webhook events, durable before the webhook answers. The body is not
-- stored, only its hash.
create table finance.payment_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  type text check (char_length(type) <= 60),
  live boolean,
  provider_payment_id text check (provider_payment_id is null or provider_payment_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  payload_hash text check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text check (outcome is null or char_length(outcome) <= 60),
  error text check (error is null or char_length(error) <= 120),
  attempts integer not null default 0,
  next_check_at timestamptz
);
create index payment_events_due on finance.payment_events (next_check_at) where next_check_at is not null;
create index payment_events_payment on finance.payment_events (provider_payment_id) where provider_payment_id is not null;

-- The paid files (round 7 writes them) and what a paid digital item grants.
create table finance.paid_assets (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id),
  storage_key text not null unique check (char_length(storage_key) between 1 and 300),
  filename text not null check (
    char_length(filename) between 1 and 120 and filename !~ '[[:cntrl:]]' and filename !~ '[/\\]'
  ),
  mime text not null check (mime in ('application/pdf', 'application/epub+zip')),
  bytes bigint check (bytes > 0),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index paid_assets_variant on finance.paid_assets (variant_id);

create table finance.entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references finance.orders (id),
  order_item_id uuid not null unique references finance.order_items (id),
  variant_id uuid not null references public.product_variants (id),
  -- Null while the variant has no file yet (a digital preorder).
  asset_id uuid references finance.paid_assets (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 300)
);
create index entitlements_order on finance.entitlements (order_id);
create index entitlements_variant_waiting on finance.entitlements (variant_id)
  where asset_id is null and revoked_at is null;

create table finance.download_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  entitlement_id uuid not null references finance.entitlements (id),
  expires_at timestamptz not null default now() + interval '15 minutes',
  uses integer not null default 0 check (uses >= 0),
  max_uses integer not null default 3 check (max_uses >= 1),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index download_tokens_entitlement on finance.download_tokens (entitlement_id, created_at);

create table finance.fulfillments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references finance.orders (id),
  order_item_id uuid not null unique references finance.order_items (id),
  state text not null default 'preparing' check (state in ('preparing', 'shipped', 'delivered')),
  carrier text check (carrier is null or char_length(carrier) <= 80),
  tracking text check (tracking is null or char_length(tracking) <= 120),
  dedication_done boolean not null default false,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_by uuid,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create index fulfillments_order on finance.fulfillments (order_id);

create table finance.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references finance.orders (id),
  -- [{itemId, quantity}]
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  reason text not null check (char_length(reason) between 1 and 500),
  state text not null default 'requested' check (state in ('requested', 'approved', 'rejected', 'received', 'refunded')),
  staff_note text check (staff_note is null or char_length(staff_note) <= 500),
  decided_by uuid,
  received_by uuid,
  restocked jsonb,
  -- Its foreign key is added once `refunds` exists.
  refund_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index return_requests_order on finance.return_requests (order_id);

-- A refund's evidence is the payment's own refunded total (the provider
-- documents no refund id): at most one refund per payment is in flight.
create table finance.refunds (
  id uuid primary key default gen_random_uuid(),
  -- Null for an unmapped review payment.
  order_id uuid references finance.orders (id),
  -- Exactly one of the paying attempt and a review payment.
  attempt_id uuid references finance.payment_attempts (id),
  review_payment_id text references finance.payment_reviews (provider_payment_id),
  amount_halalas integer not null check (amount_halalas > 0),
  reason text not null check (char_length(reason) between 1 and 300),
  -- {items: [{itemId, amount}], shipping}; {} for an unallocated refund.
  allocation jsonb not null default '{}'::jsonb check (jsonb_typeof(allocation) = 'object'),
  status text not null check (status in ('submitting', 'uncertain', 'succeeded', 'failed')),
  idempotency_key uuid not null unique default gen_random_uuid(),
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  source text not null default 'admin' check (source in ('admin', 'provider_dashboard')),
  provider_refunded_before integer,
  provider_refunded_after integer,
  return_id uuid references finance.return_requests (id),
  requested_by uuid,
  error text check (error is null or char_length(error) <= 120),
  next_check_at timestamptz,
  check_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz,
  check ((attempt_id is null) <> (review_payment_id is null))
);
create unique index refunds_in_flight_attempt on finance.refunds (attempt_id)
  where status in ('submitting', 'uncertain');
create unique index refunds_in_flight_review on finance.refunds (review_payment_id)
  where status in ('submitting', 'uncertain');
create index refunds_attempt on finance.refunds (attempt_id) where attempt_id is not null;
create index refunds_order on finance.refunds (order_id) where order_id is not null;
create index refunds_due on finance.refunds (next_check_at) where next_check_at is not null;

alter table finance.return_requests
  add constraint return_requests_refund_id_fkey foreign key (refund_id) references finance.refunds (id);

-- Disputes and payout differences, recorded by hand from Moyasar's emails:
-- append-only per (kind, provider_ref); the latest row is the current state.
create table finance.disputes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('chargeback', 'payout_difference', 'fee_difference', 'other')),
  provider_ref text not null check (char_length(provider_ref) between 1 and 120),
  seq integer not null check (seq >= 1),
  -- Both null for a payout or fee difference.
  attempt_id uuid references finance.payment_attempts (id),
  review_payment_id text references finance.payment_reviews (provider_payment_id),
  environment text not null check (environment in ('test', 'live')),
  amount_halalas integer not null check (amount_halalas > 0),
  direction text not null check (direction in ('against_seller', 'for_seller')),
  occurred_on date not null,
  reason text not null check (char_length(reason) between 1 and 500),
  resolution text check (resolution is null or char_length(resolution) <= 500),
  decision text not null default 'none'
    check (decision in ('none', 'entitlement_revoked', 'entitlement_kept', 'fulfillment_stopped')),
  item_ids uuid[] not null default '{}',
  recorded_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, provider_ref, seq),
  check (attempt_id is null or review_payment_id is null)
);
create index disputes_attempt on finance.disputes (attempt_id) where attempt_id is not null;

-- Like public.audit_events: no role, the owner of the table included, edits
-- or deletes a row through a statement; a correction is a new row.
create function finance.disputes_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'disputes is append-only.' using errcode = 'insufficient_privilege';
end
$$;
revoke all on function finance.disputes_immutable() from public, anon, authenticated, service_role;
create trigger disputes_immutable
  before update or delete on finance.disputes
  for each row execute function finance.disputes_immutable();

-- One row per variant that ever had a subscriber (round 8 fills it).
create table finance.variant_availability (
  variant_id uuid primary key references public.product_variants (id) on delete cascade,
  sellable boolean not null default false,
  revision integer not null default 0,
  changed_at timestamptz not null default now()
);

-- "Tell me when it is back": staff read it; nobody writes through the API
-- (the `notify` function writes through its own SQL functions, round 8).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- The contact grammar, as customers.email.
  email text not null check (
    char_length(email) between 3 and 254
    and email = lower(btrim(email))
    and email ~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  ),
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  token_version integer not null default 1,
  consent_revision integer,
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  notified_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email, variant_id)
);
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated, service_role;
grant select on public.notifications to authenticated;
create policy notifications_read_staff on public.notifications
  for select to authenticated using ((select public.current_staff_role()) in ('owner', 'operations'));

-- The paid files' bucket: private, no policy, so only the service role (the
-- `admin` and `download` functions) reads or writes it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paid-files', 'paid-files', false, 104857600, array['application/pdf', 'application/epub+zip'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 4. Internal helpers (finance: no API role, service_role included) -------

-- One `owner_alert` outbox row per active owner; the dedupe key makes a
-- repeated alert a no-op. A subject too long for the key is shortened with
-- its md5, so an alert never fails its caller's transaction.
create function finance.owner_alert(p_alert text, p_subject text, p_payload jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
  select left(p_alert, 40) || ':'
           || case when char_length(p_subject) > 120 then left(p_subject, 80) || ':' || md5(p_subject) else p_subject end
           || ':' || s.user_id::text,
         'owner_alert', 0, lower(btrim(u.email)),
         jsonb_build_object('alert', p_alert) || coalesce(p_payload, '{}'::jsonb)
    from public.staff s
    join auth.users u on u.id = s.user_id
   where s.active and s.role = 'owner' and u.email is not null
  on conflict (dedupe_key) do nothing
$$;

-- Units of one variant taken by committed preorder reservations (their own
-- flag, not the variant's current one).
create function finance.preorder_committed(p_variant uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0)::integer
    from finance.inventory_reservations r
   where r.variant_id = p_variant and r.state = 'committed' and r.preorder
$$;

-- The one availability rule (contract section 4) for a variant's current
-- flags; null means unlimited (a digital variant that is not a preorder).
-- Stock is decremented when a reservation is committed, so committed units
-- are already out of `stock`; a preorder counts its committed units against
-- the capacity and ignores `stock`. The delivery-date rule (a date that has
-- passed is not for sale) is the pricing function's, not a count.
create function finance.availability(p_variant uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
           when v.preorder then
             greatest(coalesce(v.preorder_capacity, 0) - finance.preorder_committed(v.id) - finance.active_holds(v.id), 0)
           when v.stock is null then null
           else greatest(v.stock - finance.active_holds(v.id), 0)
         end
    from public.product_variants v
   where v.id = p_variant
$$;

-- "Fully refunded" (contract section 3): the item's refunded total is above
-- zero and equals its paid total, or its order is refunded. Only the refunds
-- of the paying attempt count, from their allocation.
create function finance.item_fully_refunded(p_item uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select o.status = 'refunded'
         or (x.refunded > 0 and x.refunded = i.line_subtotal_halalas - i.discount_halalas)
    from finance.order_items i
    join finance.orders o on o.id = i.order_id
   cross join lateral (
     select coalesce(sum((e ->> 'amount')::integer), 0) as refunded
       from finance.refunds r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.allocation -> 'items') = 'array' then r.allocation -> 'items' else '[]'::jsonb end
      ) e
      where r.order_id = i.order_id and r.attempt_id is not null and r.status = 'succeeded'
        and e ->> 'itemId' = i.id::text
   ) x
   where i.id = p_item
$$;

-- An attempt worth asking the provider about: it has an invoice id, and it is
-- pending or uncertain, or it closed and its invoice expired less than 24
-- hours ago. Never paid or review (the callers filter those out by status).
create function finance.attempt_worth_asking(p_status text, p_invoice_id text, p_invoice_expires_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_invoice_id is not null and (
    p_status in ('pending', 'uncertain')
    or (p_status in ('expired', 'cancelled', 'failed', 'abandoned') and p_invoice_expires_at > now() - interval '24 hours')
  )
$$;

-- On a paid attempt: a refund that exists at the provider and that the ledger
-- does not hold (confirmed plus in flight), and a payment status that is
-- neither paid nor refunded (a void, for instance), each one owner alert.
create function finance.attempt_provider_alerts(p_attempt uuid, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_attempt finance.payment_attempts;
  v_known integer;
begin
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt;
  if not found or v_attempt.status <> 'paid' then
    return;
  end if;
  select coalesce(sum(r.amount_halalas), 0)::integer into v_known
    from finance.refunds r
   where r.attempt_id = p_attempt and r.status in ('succeeded', 'submitting', 'uncertain');
  if v_attempt.provider_refunded_halalas > v_known then
    perform finance.owner_alert(
      'external_refund',
      p_attempt::text || ':' || v_attempt.provider_refunded_halalas,
      jsonb_build_object('attemptId', p_attempt, 'orderId', v_attempt.order_id, 'total', v_attempt.provider_refunded_halalas)
    );
  end if;
  if p_status not in ('paid', 'refunded') then
    perform finance.owner_alert(
      'provider_status',
      p_attempt::text || ':' || p_status,
      jsonb_build_object('attemptId', p_attempt, 'orderId', v_attempt.order_id, 'status', p_status)
    );
  end if;
end
$$;

-- What the buyer's return page may learn about an order in the configured
-- mode: {state, hasToken, invoiceUrl?, orderId?}. The same shape for a
-- missing order and for one of the other mode, so the reply reveals nothing
-- more. `pending` while an attempt is in creating, pending or uncertain and
-- the order is not settled: an attempt stays pending until the job closes
-- it, at least 10 minutes after its invoice expired, so a payment made in the
-- hold's last minute is never shown as "expired".
create function finance.payment_view(p_order_number text, p_access_token_hash text, p_mode text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_active finance.payment_attempts;
  v_token boolean;
  v_state text;
begin
  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, ''))) and o.environment = p_mode;
  if not found then
    return jsonb_build_object('state', 'unknown', 'hasToken', false);
  end if;
  v_token := v_order.access_token_hash is not distinct from p_access_token_hash
    and v_order.access_token_expires_at > now();
  select * into v_active
    from finance.payment_attempts a
   where a.order_id = v_order.id and a.status in ('creating', 'pending', 'uncertain');
  -- A settled order answers its own state first: another attempt of it that
  -- is still open (the job cancels its invoice) must not show "pending", nor
  -- hand out a second invoice to pay.
  v_state := case
    when v_order.status = 'paid' then 'paid'
    when v_order.status = 'paid_needs_resolution' then 'needs_resolution'
    when v_order.status = 'refunded' then 'refunded'
    when v_active.id is not null then 'pending'
    when exists (select 1 from finance.payment_reviews r where r.order_id = v_order.id and r.closed_at is null)
      and not exists (select 1 from finance.payment_attempts a where a.order_id = v_order.id and a.status = 'paid')
      then 'review'
    when v_order.status = 'expired' then 'expired'
    when v_order.status = 'cancelled' then 'cancelled'
    else 'pending'
  end;
  return jsonb_strip_nulls(jsonb_build_object(
    'state', v_state,
    'hasToken', v_token,
    'invoiceUrl', case when v_token and v_state = 'pending' and v_active.status = 'pending' then v_active.invoice_url end,
    'orderId', v_order.id
  ));
end
$$;

-- The commit logic, in one place: used by `apply_verified_payment` and, in a
-- later round, by `order_resolve`. The caller holds the order and the attempt
-- row. Under those locks it takes every variant of the order in ascending id
-- (digital ones included), the coupon and the reservations, and checks every
-- line that is not fully refunded:
-- - a line whose own hold is still held and unexpired needs only the units
--   to exist (`stock >= quantity`, or for a preorder `capacity - committed
--   preorder units >= quantity`): other orders' holds do not count against
--   it, it fails only when the owner lowered the stock or the capacity;
-- - a line whose hold was released or has expired is reacquired by the full
--   availability rule, other orders' holds included;
-- - the reservation's own preorder flag, not the variant's current one,
--   decides between stock and capacity.
-- When every line passes it commits and returns true; when a line fails it
-- returns false and has changed nothing.
create function finance.order_try_commit(p_order uuid, p_receipt_key text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_order finance.orders;
  r record;
  v_own boolean;
  v_free integer;
begin
  select * into v_order from finance.orders o where o.id = p_order;
  perform 1 from public.product_variants v
   where v.id in (select i.variant_id from finance.order_items i where i.order_id = p_order)
   order by v.id for update;
  if v_order.coupon_id is not null then
    perform 1 from public.coupons c where c.id = v_order.coupon_id for update;
  end if;
  perform 1 from finance.inventory_reservations x where x.order_id = p_order order by x.id for update;

  for r in
    select i.variant_id, i.quantity, v.stock, v.preorder_capacity,
           coalesce(x.state = 'held' and x.expires_at > now(), false) as own_hold,
           coalesce(x.preorder, false) as res_preorder
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      left join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     order by i.line_no
  loop
    v_own := r.own_hold;
    if r.res_preorder then
      v_free := coalesce(r.preorder_capacity, 0) - finance.preorder_committed(r.variant_id)
        - case when v_own then 0 else finance.active_holds(r.variant_id) end;
    elsif r.stock is not null then
      v_free := r.stock - case when v_own then 0 else finance.active_holds(r.variant_id) end;
    else
      continue;
    end if;
    if v_free < r.quantity then
      return false;
    end if;
  end loop;

  update finance.inventory_reservations x
     set state = 'committed', released_at = null
   where x.order_id = p_order and x.state <> 'committed'
     and x.variant_id in (
       select i.variant_id from finance.order_items i
        where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     );

  -- Stock goes down for non-preorder stocked lines through an ordinary
  -- UPDATE, so the catalog triggers audit it.
  for r in
    select v.id as variant_id, v.stock, v.low_stock_threshold, i.quantity
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      left join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and v.stock is not null and not coalesce(x.preorder, false)
       and not coalesce(finance.item_fully_refunded(i.id), false)
     order by v.id
  loop
    update public.product_variants set stock = stock - r.quantity where id = r.variant_id;
    if r.low_stock_threshold is not null and r.stock > r.low_stock_threshold
      and r.stock - r.quantity <= r.low_stock_threshold
    then
      perform finance.owner_alert(
        'low_stock', r.variant_id::text || ':' || p_order::text,
        jsonb_build_object('variantId', r.variant_id, 'orderId', p_order)
      );
    end if;
  end loop;

  -- The price was charged: the coupon is committed whatever its limit, dates
  -- or switch now say (the caller's audit row marks an over-limit commit).
  if v_order.coupon_id is not null then
    insert into finance.coupon_redemptions (coupon_id, order_id, state, expires_at)
    values (v_order.coupon_id, p_order, 'committed', v_order.hold_expires_at)
    on conflict (order_id) do update set state = 'committed', released_at = null;
  end if;

  insert into finance.entitlements (order_id, order_item_id, variant_id, asset_id)
  select i.order_id, i.id, i.variant_id,
         (select pa.id from finance.paid_assets pa where pa.variant_id = i.variant_id and pa.storage_key = v.digital_asset)
    from finance.order_items i
    join public.product_variants v on v.id = i.variant_id
   where i.order_id = p_order and i.fulfillment = 'digital' and not coalesce(finance.item_fully_refunded(i.id), false)
  on conflict (order_item_id) do nothing;

  insert into finance.fulfillments (order_id, order_item_id)
  select i.order_id, i.id
    from finance.order_items i
   where i.order_id = p_order and i.fulfillment in ('physical', 'signed')
     and not coalesce(finance.item_fully_refunded(i.id), false)
  on conflict (order_item_id) do nothing;

  insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
  values (p_receipt_key, 'receipt', 0, lower(btrim(v_order.customer_email)), jsonb_build_object('orderId', p_order))
  on conflict (dedupe_key) do nothing;
  return true;
end
$$;

-- 5. The payment core (service_role) ---------------------------------------

-- The buyer's order by number and token, and the one invoice attempt of the
-- `checkout` function's `create` (p_ip_hash null) and `pay` (the caller's
-- hash, throttled 30 per hour). Business refusals are replies; a throttle
-- raises 54000 like checkout. Every reply after the token check, a refusal
-- included, carries `order`, so `pay` can always answer the order.
create function public.payment_attempt_begin(
  p_order_number text, p_access_token_hash text, p_mode text, p_ip_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_attempt finance.payment_attempts;
begin
  if p_mode is null or p_mode not in ('test', 'live')
    or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
  then
    raise exception 'Invalid payment request.' using errcode = 'invalid_parameter_value';
  end if;
  if p_ip_hash is not null and not finance.rate_limit_take('payment-pay:ip', p_ip_hash, 30, interval '1 hour') then
    raise exception 'Too many payment requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- The token is checked before the row is locked, so guessed tokens never
  -- queue behind a real change to the order.
  select * into v_order from finance.orders o where o.order_number = upper(btrim(coalesce(p_order_number, '')));
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_order from finance.orders o where o.id = v_order.id for update;

  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_PAYABLE', 'status', v_order.status, 'reason', 'NOT_PENDING',
                              'order', finance.order_summary(v_order.id));
  end if;
  if v_order.environment <> p_mode then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_PAYABLE', 'status', v_order.status, 'reason', 'MODE_CHANGED',
                              'order', finance.order_summary(v_order.id));
  end if;
  if exists (select 1 from finance.payment_reviews r where r.order_id = v_order.id and r.closed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_PAYABLE', 'status', v_order.status, 'reason', 'UNDER_REVIEW',
                              'order', finance.order_summary(v_order.id));
  end if;
  if v_order.hold_expires_at < now() + interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'HOLD_EXPIRED', 'order', finance.order_summary(v_order.id));
  end if;
  if v_order.total_halalas < 100 then
    return jsonb_build_object('ok', false, 'code', 'TOTAL_BELOW_MINIMUM', 'order', finance.order_summary(v_order.id));
  end if;

  select * into v_attempt
    from finance.payment_attempts a
   where a.order_id = v_order.id and a.status in ('creating', 'pending', 'uncertain')
   for update;
  if found then
    -- A creating row older than 30 seconds belongs to a function that died
    -- (the provider call times out at 10): its outcome is unknown.
    if v_attempt.status = 'creating' and v_attempt.created_at <= now() - interval '30 seconds' then
      update finance.payment_attempts a
         set status = 'uncertain', next_check_at = now(), updated_at = now()
       where a.id = v_attempt.id
      returning * into v_attempt;
    end if;
    if v_attempt.status = 'pending' then
      return jsonb_build_object(
        'ok', true, 'state', 'pending', 'attemptId', v_attempt.id, 'invoiceUrl', v_attempt.invoice_url,
        'order', finance.order_summary(v_order.id)
      );
    elsif v_attempt.status = 'creating' then
      return jsonb_build_object(
        'ok', true, 'state', 'creating', 'attemptId', v_attempt.id, 'order', finance.order_summary(v_order.id)
      );
    end if;
    return jsonb_build_object(
      'ok', true, 'state', 'uncertain', 'attemptId', v_attempt.id, 'createdAt', v_attempt.created_at,
      'amount', v_attempt.amount_halalas, 'currency', v_attempt.currency, 'order', finance.order_summary(v_order.id)
    );
  end if;

  -- Only a new attempt is limited: an order that already has an active one
  -- keeps answering it.
  if (select count(*) from finance.payment_attempts a where a.order_id = v_order.id) >= 5 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_ATTEMPTS', 'order', finance.order_summary(v_order.id));
  end if;
  insert into finance.payment_attempts (order_id, status, amount_halalas, currency, environment, invoice_expires_at, next_check_at)
  values (v_order.id, 'creating', v_order.total_halalas, v_order.currency, v_order.environment, v_order.hold_expires_at,
          now() + interval '30 seconds')
  returning * into v_attempt;
  return jsonb_build_object(
    'ok', true, 'state', 'new', 'attemptId', v_attempt.id, 'amount', v_attempt.amount_halalas,
    'currency', v_attempt.currency, 'expiresAt', v_attempt.invoice_expires_at,
    'order', finance.order_summary(v_order.id)
  );
end
$$;

-- The provider answered the creation call: creating or uncertain becomes
-- pending, with the invoice's id and URL (and the provider's own expiry when
-- it echoed one). A conflicting id is a reply, never a raised 23505.
create function public.payment_attempt_created(
  p_attempt uuid, p_invoice_id text, p_invoice_url text, p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt finance.payment_attempts;
begin
  if p_attempt is null
    or coalesce(p_invoice_id, '') !~ '^[A-Za-z0-9._:-]{1,120}$'
    or coalesce(p_invoice_url, '') !~ '^https?://[^[:space:][:cntrl:]]+$'
    or char_length(p_invoice_url) > 2000
  then
    raise exception 'Invalid invoice.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  perform 1 from finance.orders o where o.id = v_attempt.order_id for update;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;

  if (v_attempt.provider_invoice_id is not null and v_attempt.provider_invoice_id <> p_invoice_id)
    or exists (select 1 from finance.payment_attempts a where a.provider_invoice_id = p_invoice_id and a.id <> p_attempt)
  then
    return jsonb_build_object('ok', false, 'code', 'INVOICE_CONFLICT');
  end if;

  begin
    if v_attempt.status in ('creating', 'uncertain') then
      update finance.payment_attempts a
         set status = 'pending', provider_invoice_id = p_invoice_id, invoice_url = p_invoice_url,
             invoice_expires_at = coalesce(p_expires_at, a.invoice_expires_at),
             next_check_at = now() + interval '1 minute', updated_at = now()
       where a.id = p_attempt;
      return jsonb_build_object('ok', true);
    elsif v_attempt.status = 'pending' then
      -- The same id again: nothing to do.
      return jsonb_build_object('ok', true);
    end if;
    -- Any other status: the invoice id is stored when the row has none, so a
    -- payment on it still reaches the attempt (late payment) and gets one
    -- last check; the status stays and the caller cancels the invoice.
    if v_attempt.provider_invoice_id is null then
      update finance.payment_attempts a
         set provider_invoice_id = p_invoice_id,
             next_check_at = case
               when a.status in ('failed', 'abandoned', 'expired', 'cancelled')
                 then greatest(a.invoice_expires_at, now()) + interval '10 minutes'
               else a.next_check_at
             end,
             updated_at = now()
       where a.id = p_attempt;
    end if;
    return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED');
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'INVOICE_CONFLICT');
  end;
end
$$;

-- The allowed moves only: creating to failed or uncertain, uncertain to
-- abandoned, pending to cancelled or expired. A closed attempt with an
-- invoice id gets one last check after its invoice expired plus 10 minutes;
-- one without an invoice id has nothing to check; uncertain is due at once.
create function public.payment_attempt_close(p_attempt uuid, p_status text, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt finance.payment_attempts;
begin
  if p_attempt is null or p_status is null
    or (p_error is not null and p_error !~ '^[A-Za-z0-9_.:-]{1,120}$')
  then
    raise exception 'Invalid attempt close.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  perform 1 from finance.orders o where o.id = v_attempt.order_id for update;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;

  if (v_attempt.status, p_status) not in (
    ('creating', 'failed'), ('creating', 'uncertain'), ('uncertain', 'abandoned'),
    ('pending', 'cancelled'), ('pending', 'expired')
  ) then
    return jsonb_build_object('ok', false, 'code', 'BAD_TRANSITION');
  end if;
  update finance.payment_attempts a
     set status = p_status,
         last_error = coalesce(p_error, a.last_error),
         next_check_at = case
           when p_status = 'uncertain' then now()
           when a.provider_invoice_id is not null then greatest(a.invoice_expires_at, now()) + interval '10 minutes'
           else null
         end,
         updated_at = now()
   where a.id = p_attempt;
  return jsonb_build_object('ok', true, 'status', p_status);
end
$$;

-- The one decision: is this fetched payment a settled one? Called by the
-- webhook, the invoice callback, the return page's verify and the job, always
-- with objects fetched by the secret key. Decides in the contract's order and
-- never raises for stock. See the contract, section 6, for each step.
create function public.apply_verified_payment(
  p_invoice_id text, p_payment jsonb, p_invoice jsonb, p_mode text, p_live boolean, p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_id text;
  v_status text;
  v_amount integer;
  v_currency text;
  v_fee integer;
  v_refunded integer;
  v_pay_invoice text;
  v_source_type text;
  v_source_company text;
  v_inv_id text;
  v_inv_amount integer;
  v_charged boolean;
  v_attempt finance.payment_attempts;
  v_order finance.orders;
  v_review finance.payment_reviews;
  v_reason text;
  v_outcome text;
  v_n integer;
  v_over boolean;
begin
  -- A malformed call raises; every business answer is a reply.
  if p_mode is null or p_mode not in ('test', 'live')
    or coalesce(p_invoice_id, '') = '' or char_length(p_invoice_id) > 120
    or jsonb_typeof(p_payment) is distinct from 'object'
    or jsonb_typeof(p_invoice) is distinct from 'object'
    or (p_event_id is not null and char_length(p_event_id) > 200)
  then
    raise exception 'Invalid payment.' using errcode = 'invalid_parameter_value';
  end if;
  v_pay_id := p_payment ->> 'id';
  v_status := p_payment ->> 'status';
  v_currency := left(p_payment ->> 'currency', 10);
  v_pay_invoice := p_payment ->> 'invoiceId';
  v_source_type := left(p_payment ->> 'sourceType', 60);
  v_source_company := left(p_payment ->> 'sourceCompany', 60);
  v_inv_id := p_invoice ->> 'id';
  if coalesce(v_pay_id, '') = '' or char_length(v_pay_id) > 120
    or coalesce(v_status, '') = '' or char_length(v_status) > 60
    or jsonb_typeof(p_payment -> 'amount') is distinct from 'number'
    or (p_payment ->> 'amount') !~ '^[0-9]{1,9}$'
  then
    raise exception 'Invalid payment.' using errcode = 'invalid_parameter_value';
  end if;
  v_amount := (p_payment ->> 'amount')::integer;
  v_fee := case when (p_payment ->> 'fee') ~ '^[0-9]{1,9}$' then (p_payment ->> 'fee')::integer end;
  v_refunded := case when (p_payment ->> 'refunded') ~ '^[0-9]{1,9}$' then (p_payment ->> 'refunded')::integer else 0 end;
  v_inv_amount := case when (p_invoice ->> 'amount') ~ '^[0-9]{1,9}$' then (p_invoice ->> 'amount')::integer end;

  -- 1. The payment and the invoice are the ones asked about.
  if v_pay_invoice is distinct from p_invoice_id or v_inv_id is distinct from p_invoice_id then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'INVOICE_MISMATCH');
  end if;
  v_charged := v_status in ('paid', 'refunded');

  -- 2. No attempt has this invoice: nothing to settle. A charged payment is
  --    money that must not be lost: it is a review payment (once), alerted.
  --    Only the review row is locked here, there is no order.
  select * into v_attempt from finance.payment_attempts a where a.provider_invoice_id = p_invoice_id;
  if not found then
    if v_charged then
      insert into finance.payment_reviews (
        provider_payment_id, provider_invoice_id, environment, amount_halalas, currency, provider_status, reason,
        provider_refunded_halalas
      )
      values (v_pay_id, p_invoice_id, p_mode, v_amount, v_currency, v_status, 'UNMAPPED_INVOICE', v_refunded)
      on conflict (provider_payment_id) do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        insert into public.audit_events (action, entity, entity_id, summary)
        values ('payment.review', 'payment', v_pay_id,
                jsonb_build_object('reason', 'UNMAPPED_INVOICE', 'amount', v_amount, 'invoiceId', p_invoice_id));
        perform finance.owner_alert(
          'payment_review', v_pay_id, jsonb_build_object('paymentId', v_pay_id, 'reason', 'UNMAPPED_INVOICE')
        );
      else
        update finance.payment_reviews r
           set provider_status = v_status, provider_refunded_halalas = greatest(r.provider_refunded_halalas, v_refunded)
         where r.provider_payment_id = v_pay_id;
      end if;
    end if;
    -- The read above took no lock: when `payment_attempt_created` mapped the
    -- invoice meanwhile, go on with the attempt (the review row just written
    -- is linked to it below, and the payment is never fulfilled).
    select * into v_attempt from finance.payment_attempts a where a.provider_invoice_id = p_invoice_id;
    if not found then
      return jsonb_build_object('outcome', 'unknown_invoice');
    end if;
  end if;

  -- 3. The mode: the configured one, and the webhook's `live` when it came
  --    from a webhook.
  if v_attempt.environment <> p_mode or (p_live is not null and p_live <> (p_mode = 'live')) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'MODE_MISMATCH');
  end if;
  -- A payment id the ledger already holds on another attempt does not belong
  -- to this invoice.
  if exists (select 1 from finance.payment_attempts a where a.provider_payment_id = v_pay_id and a.id <> v_attempt.id) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'INVOICE_MISMATCH');
  end if;

  -- Locks: the order, then the attempt, read again before deciding.
  select * into v_order from finance.orders o where o.id = v_attempt.order_id for update;
  select * into v_attempt from finance.payment_attempts a where a.id = v_attempt.id for update;

  -- 4. The payment is the attempt's own (its payment id, or the attempt has
  --    none yet): what was fetched is written whatever follows. A sibling
  --    payment (a failed one on a paid attempt) never overwrites it.
  if v_attempt.provider_payment_id is null or v_attempt.provider_payment_id = v_pay_id then
    update finance.payment_attempts a
       set fetched_at = now(), provider_status = v_status,
           provider_refunded_halalas = greatest(a.provider_refunded_halalas, v_refunded), updated_at = now()
     where a.id = v_attempt.id
    returning * into v_attempt;
    perform finance.attempt_provider_alerts(v_attempt.id, v_status);
  end if;

  -- 5 to 7. The statuses and the ways a charged payment cannot settle.
  v_reason := null;
  if v_status = 'captured' then
    -- Our own paying payment moved on at the provider: step 4 alerted.
    if v_attempt.status = 'paid' and v_attempt.provider_payment_id = v_pay_id then
      return jsonb_build_object('outcome', 'already_paid', 'orderNumber', v_order.order_number);
    end if;
    v_reason := 'UNEXPECTED_STATUS';
  elsif not v_charged then
    return jsonb_build_object('outcome', 'not_paid');
  elsif v_attempt.status = 'paid' and v_attempt.provider_payment_id = v_pay_id then
    return jsonb_build_object('outcome', 'already_paid', 'orderNumber', v_order.order_number);
  elsif v_attempt.status in ('paid', 'review') and v_attempt.provider_payment_id is distinct from v_pay_id then
    v_reason := 'SECOND_PAYMENT';
  elsif v_attempt.status = 'review' then
    v_reason := 'UNEXPECTED_STATUS';
  elsif v_amount <> v_attempt.amount_halalas or v_inv_amount is distinct from v_attempt.amount_halalas then
    v_reason := 'AMOUNT_MISMATCH';
  elsif v_currency is distinct from v_attempt.currency then
    v_reason := 'CURRENCY_MISMATCH';
  elsif v_order.status in ('paid', 'paid_needs_resolution', 'refunded')
    or exists (
      select 1 from finance.payment_attempts a
       where a.order_id = v_order.id and a.status = 'paid' and a.id <> v_attempt.id
    )
  then
    v_reason := 'ORDER_ALREADY_PAID';
  elsif exists (select 1 from finance.payment_reviews r where r.provider_payment_id = v_pay_id) then
    -- Recorded as an unmapped payment before this invoice was mapped: money
    -- already in review is never fulfilled.
    v_reason := 'UNMAPPED_INVOICE';
  end if;

  if v_reason is not null then
    -- A review payment: one row per payment id (inserted once), an unpaid
    -- attempt becomes review with the payment id and no further check, one
    -- owner alert, and the order is not touched.
    select * into v_review from finance.payment_reviews r where r.provider_payment_id = v_pay_id for update;
    if found then
      update finance.payment_reviews r
         set provider_status = v_status, provider_refunded_halalas = greatest(r.provider_refunded_halalas, v_refunded),
             attempt_id = coalesce(r.attempt_id, v_attempt.id), order_id = coalesce(r.order_id, v_order.id)
       where r.provider_payment_id = v_pay_id;
      v_reason := v_review.reason;
    else
      insert into finance.payment_reviews (
        provider_payment_id, provider_invoice_id, attempt_id, order_id, environment, amount_halalas, currency,
        provider_status, reason, provider_refunded_halalas
      )
      values (v_pay_id, p_invoice_id, v_attempt.id, v_order.id, v_attempt.environment, v_amount, v_currency,
              v_status, v_reason, v_refunded)
      -- A concurrent unmapped insert of the same payment: keep that row.
      on conflict (provider_payment_id) do nothing;
      insert into public.audit_events (action, entity, entity_id, summary)
      values ('payment.review', 'payment', v_pay_id,
              jsonb_build_object('reason', v_reason, 'amount', v_amount, 'attemptId', v_attempt.id,
                                 'orderNumber', v_order.order_number));
      perform finance.owner_alert(
        'payment_review', v_pay_id,
        jsonb_build_object('paymentId', v_pay_id, 'attemptId', v_attempt.id, 'orderId', v_order.id, 'reason', v_reason)
      );
    end if;
    update finance.payment_attempts a
       set status = 'review', provider_payment_id = v_pay_id, next_check_at = null, updated_at = now()
     where a.id = v_attempt.id and a.status not in ('paid', 'review');
    return jsonb_build_object('outcome', 'review', 'reason', v_reason, 'orderNumber', v_order.order_number);
  end if;

  -- 8. The first verified payment. Any other active attempt of the order is
  --    due at once, so the job cancels its invoice.
  update finance.payment_attempts a
     set next_check_at = now(), updated_at = now()
   where a.order_id = v_order.id and a.id <> v_attempt.id and a.status in ('creating', 'pending', 'uncertain');

  if finance.order_try_commit(v_order.id, 'receipt:' || v_order.id::text) then
    v_outcome := 'paid';
    update finance.orders o
       set status = 'paid', paid_at = now(), access_token_expires_at = now() + interval '7 days',
           version = o.version + 1, updated_at = now()
     where o.id = v_order.id;
  else
    -- A line cannot be delivered: the money is kept, nothing is committed,
    -- granted or decremented, and the owner is told.
    v_outcome := 'paid_needs_resolution';
    update finance.orders o
       set status = 'paid_needs_resolution', paid_at = now(), access_token_expires_at = now() + interval '7 days',
           version = o.version + 1, updated_at = now()
     where o.id = v_order.id;
    insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
    values ('receipt:' || v_order.id::text, 'receipt', 0, lower(btrim(v_order.customer_email)),
            jsonb_build_object('orderId', v_order.id))
    on conflict (dedupe_key) do nothing;
    perform finance.owner_alert(
      'needs_resolution', v_order.id::text, jsonb_build_object('orderId', v_order.id, 'attemptId', v_attempt.id)
    );
  end if;
  update finance.payment_attempts a
     set status = 'paid', provider_payment_id = v_pay_id, captured_halalas = v_amount, fee_halalas = v_fee,
         source_type = v_source_type, source_company = v_source_company, paid_at = now(), next_check_at = null,
         updated_at = now()
   where a.id = v_attempt.id;

  v_over := v_outcome = 'paid' and v_order.coupon_id is not null and exists (
    select 1 from public.coupons c
     where c.id = v_order.coupon_id and c.usage_limit is not null and finance.coupon_uses(c.id) > c.usage_limit
  );
  insert into public.audit_events (action, entity, entity_id, summary)
  values (
    'order.' || v_outcome, 'order', v_order.id::text,
    jsonb_build_object('orderNumber', v_order.order_number, 'amount', v_amount, 'attemptId', v_attempt.id, 'paymentId', v_pay_id)
      || case when p_event_id is not null then jsonb_build_object('eventId', p_event_id) else '{}'::jsonb end
      || case when v_over then jsonb_build_object('couponOverLimit', true) else '{}'::jsonb end
  );
  -- A payment that arrives already refunded at the provider is alerted too.
  perform finance.attempt_provider_alerts(v_attempt.id, v_status);
  return jsonb_build_object('outcome', v_outcome, 'orderNumber', v_order.order_number);
end
$$;

-- A webhook event, durable before the webhook answers: recorded once, then
-- owned by the reconciliation job until a final outcome clears its due time.
create function public.payment_event_record(
  p_event_id text, p_type text, p_live boolean, p_payment_id text, p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_processed boolean;
begin
  if coalesce(p_event_id, '') = '' or char_length(p_event_id) > 200
    or (p_payload_hash is not null and p_payload_hash !~ '^[0-9a-f]{64}$')
  then
    raise exception 'Invalid event.' using errcode = 'invalid_parameter_value';
  end if;
  insert into finance.payment_events (event_id, type, live, provider_payment_id, payload_hash, next_check_at)
  values (
    p_event_id, left(p_type, 60), p_live,
    case when lower(p_payment_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then lower(p_payment_id) end,
    p_payload_hash, now() + interval '30 seconds'
  )
  on conflict (event_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    return jsonb_build_object('state', 'recorded');
  end if;
  select e.processed_at is not null into v_processed from finance.payment_events e where e.event_id = p_event_id;
  return jsonb_build_object('state', 'duplicate', 'processed', coalesce(v_processed, false));
end
$$;

-- One processing result. A retry backs off 1, 2, 4 ... 60 minutes and is
-- exhausted at 10 attempts (one owner alert); any other outcome is final.
create function public.payment_event_result(p_event_id text, p_outcome text, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event finance.payment_events;
  v_attempts integer;
begin
  if coalesce(p_event_id, '') = '' or coalesce(p_outcome, '') = '' or char_length(p_outcome) > 60
    or (p_error is not null and p_error !~ '^[A-Za-z0-9_.:-]{1,120}$')
  then
    raise exception 'Invalid event result.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_event from finance.payment_events e where e.event_id = p_event_id for update;
  if not found or v_event.processed_at is not null then
    return;
  end if;
  v_attempts := v_event.attempts + 1;
  if p_outcome = 'retry' and v_attempts >= 10 then
    update finance.payment_events e
       set attempts = v_attempts, processed_at = now(), outcome = 'exhausted', error = p_error, next_check_at = null
     where e.event_id = p_event_id;
    perform finance.owner_alert('event_exhausted', p_event_id, jsonb_build_object('eventId', p_event_id));
  elsif p_outcome = 'retry' then
    update finance.payment_events e
       set attempts = v_attempts, error = p_error,
           next_check_at = now() + make_interval(mins => least(power(2, v_event.attempts), 60)::integer)
     where e.event_id = p_event_id;
  else
    update finance.payment_events e
       set attempts = v_attempts, processed_at = now(), outcome = p_outcome, error = p_error, next_check_at = null
     where e.event_id = p_event_id;
  end if;
end
$$;

-- The return page: the order's payment state and, when an attempt is worth
-- asking the provider about and has not been fetched in the last 5 seconds,
-- the attempt to fetch (this call sets `fetched_at`, so two callers do not
-- both fetch). Throttled 120 per hour per IP hash. It writes one column of
-- one attempt and holds no other lock, so it takes no part in the lock order.
create function public.payment_check_begin(
  p_order_number text, p_access_token_hash text, p_ip_hash text, p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_view jsonb;
  v_attempt uuid;
  v_invoice text;
begin
  if p_mode is null or p_mode not in ('test', 'live') or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid payment check.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('payment-check:ip', p_ip_hash, 120, interval '1 hour') then
    raise exception 'Too many checks; try again later.' using errcode = 'program_limit_exceeded';
  end if;
  v_view := finance.payment_view(p_order_number, p_access_token_hash, p_mode);
  if v_view ->> 'state' <> 'unknown' then
    update finance.payment_attempts a
       set fetched_at = now(), updated_at = now()
     where a.id = (
             select x.id from finance.payment_attempts x
              where x.order_id = (v_view ->> 'orderId')::uuid
                and finance.attempt_worth_asking(x.status, x.provider_invoice_id, x.invoice_expires_at)
                and (x.fetched_at is null or x.fetched_at < now() - interval '5 seconds')
              order by x.created_at desc
              limit 1
              for update skip locked
           )
       and (a.fetched_at is null or a.fetched_at < now() - interval '5 seconds')
    returning a.id, a.provider_invoice_id into v_attempt, v_invoice;
    if found then
      v_view := v_view || jsonb_build_object(
        'check', jsonb_build_object('attemptId', v_attempt, 'providerInvoiceId', v_invoice)
      );
    end if;
  end if;
  return v_view - 'orderId';
end
$$;

-- The same answer with no throttle hit and no check: the second read after a
-- settle.
create function public.payment_state(p_order_number text, p_access_token_hash text, p_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_mode is null or p_mode not in ('test', 'live') then
    raise exception 'Invalid payment state request.' using errcode = 'invalid_parameter_value';
  end if;
  return finance.payment_view(p_order_number, p_access_token_hash, p_mode) - 'orderId';
end
$$;

-- The invoice callback (unauthenticated): which attempt to fetch, under the
-- same "worth asking" and 5-second rules. Throttled 60 per hour per IP hash;
-- over the limit it answers {} silently.
create function public.payment_callback_begin(p_invoice_id text, p_ip_hash text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt uuid;
  v_invoice text;
begin
  if p_mode is null or p_mode not in ('test', 'live') or coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid callback.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('payment-callback:ip', p_ip_hash, 60, interval '1 hour') then
    return '{}'::jsonb;
  end if;
  if coalesce(p_invoice_id, '') = '' then
    return '{}'::jsonb;
  end if;
  update finance.payment_attempts a
     set fetched_at = now(), updated_at = now()
   where a.id = (
           select x.id from finance.payment_attempts x
            where x.provider_invoice_id = p_invoice_id and x.environment = p_mode
              and finance.attempt_worth_asking(x.status, x.provider_invoice_id, x.invoice_expires_at)
              and (x.fetched_at is null or x.fetched_at < now() - interval '5 seconds')
            limit 1
            for update skip locked
         )
     and (a.fetched_at is null or a.fetched_at < now() - interval '5 seconds')
  returning a.id, a.provider_invoice_id into v_attempt, v_invoice;
  if not found then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('check', jsonb_build_object('attemptId', v_attempt, 'providerInvoiceId', v_invoice));
end
$$;

-- The owner's «أعد الفحص»: the attempt's references, rechecked against the
-- owner's active role.
create function public.payment_attempt_ref(p_actor uuid, p_attempt uuid, p_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attempt finance.payment_attempts;
  v_number text;
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt and a.environment = p_mode;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select o.order_number into v_number from finance.orders o where o.id = v_attempt.order_id;
  return jsonb_build_object(
    'ok', true, 'attemptId', v_attempt.id, 'status', v_attempt.status,
    'providerInvoiceId', v_attempt.provider_invoice_id, 'providerPaymentId', v_attempt.provider_payment_id,
    'orderNumber', v_number, 'createdAt', v_attempt.created_at,
    'amount', v_attempt.amount_halalas, 'currency', v_attempt.currency
  );
end
$$;

-- The reconciliation job's work, leased: due attempts and refunds of the
-- configured mode and due events (an event of the other mode is closed by the
-- job as a mode mismatch). Due rows of the other mode are parked first. A lease pushes `next_check_at` two
-- minutes ahead, so an overlapping run does not take the same row; a
-- creating row older than 30 seconds first becomes uncertain.
create function public.payment_reconcile_claim(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts jsonb;
  v_events jsonb;
  v_refunds jsonb;
begin
  if p_mode is null or p_mode not in ('test', 'live') then
    raise exception 'Invalid mode.' using errcode = 'invalid_parameter_value';
  end if;

  -- Work of the other mode cannot be checked with this key. It loses its due
  -- time (so it neither wakes the job every minute nor blocks the retention
  -- purge for ever) and is marked; a person settles it from the dashboard.
  update finance.payment_attempts a
     set next_check_at = null, last_error = 'MODE_CHANGED', updated_at = now(),
         status = case when a.status in ('creating', 'pending', 'uncertain') then 'expired' else a.status end
   where a.environment <> p_mode and a.next_check_at <= now()
     and a.status not in ('paid', 'review');
  update finance.refunds r
     set next_check_at = null, error = 'MODE_CHANGED', updated_at = now()
   where r.status in ('submitting', 'uncertain') and r.next_check_at <= now()
     and coalesce(
           (select a.environment from finance.payment_attempts a where a.id = r.attempt_id),
           (select pr.environment from finance.payment_reviews pr where pr.provider_payment_id = r.review_payment_id)
         ) <> p_mode;

  with picked as (
    select a.id, a.next_check_at as due_at
      from finance.payment_attempts a
     where a.environment = p_mode and a.next_check_at <= now()
     order by a.next_check_at, a.id
     limit 10
     for update skip locked
  ), leased as (
    update finance.payment_attempts a
       set status = case
             when a.status = 'creating' and a.created_at <= now() - interval '30 seconds' then 'uncertain'
             else a.status
           end,
           next_check_at = now() + interval '2 minutes', updated_at = now()
      from picked
     where a.id = picked.id
    returning a.*, picked.due_at
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'attemptId', l.id, 'status', l.status, 'providerInvoiceId', l.provider_invoice_id,
               'orderNumber', o.order_number,
               'orderPaid', o.status in ('paid', 'paid_needs_resolution', 'refunded'),
               'createdAt', l.created_at, 'amount', l.amount_halalas, 'currency', l.currency
             )
             order by l.due_at, l.id
           ),
           '[]'::jsonb
         )
    into v_attempts
    from leased l
    join finance.orders o on o.id = l.order_id;

  with picked as (
    select e.event_id, e.next_check_at as due_at
      from finance.payment_events e
     where e.next_check_at <= now()
     order by e.next_check_at, e.event_id
     limit 10
     for update skip locked
  ), leased as (
    update finance.payment_events e
       set next_check_at = now() + interval '2 minutes'
      from picked
     where e.event_id = picked.event_id
    returning e.event_id, e.provider_payment_id, e.live, picked.due_at
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('eventId', l.event_id, 'paymentId', l.provider_payment_id, 'live', l.live)
             order by l.due_at, l.event_id
           ),
           '[]'::jsonb
         )
    into v_events
    from leased l;

  with picked as (
    select r.id, r.next_check_at as due_at
      from finance.refunds r
      left join finance.payment_attempts a on a.id = r.attempt_id
      left join finance.payment_reviews pr on pr.provider_payment_id = r.review_payment_id
     where r.status in ('submitting', 'uncertain') and r.next_check_at <= now()
       and coalesce(a.environment, pr.environment) = p_mode
     order by r.next_check_at, r.id
     limit 5
     for update of r skip locked
  ), leased as (
    update finance.refunds r
       set next_check_at = now() + interval '2 minutes', updated_at = now()
      from picked
     where r.id = picked.id
    returning r.id, r.attempt_id, r.review_payment_id, picked.due_at
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('refundId', l.id, 'providerPaymentId', coalesce(a.provider_payment_id, l.review_payment_id))
             order by l.due_at, l.id
           ),
           '[]'::jsonb
         )
    into v_refunds
    from leased l
    left join finance.payment_attempts a on a.id = l.attempt_id;

  return jsonb_build_object('attempts', v_attempts, 'events', v_events, 'refunds', v_refunds);
end
$$;

-- After a check that did not settle (a settle is `apply_verified_payment`).
-- A prompt (callback, verify, cancel) writes `fetched_at` only, so the
-- buyer's own return page never pushes the job's schedule out. The job's
-- backoff is 1, 2, 4 ... 30 minutes after a good answer and 1, 2, 4 ... 60
-- after an error. An attempt that is paid or review is never touched.
create function public.payment_attempt_checked(
  p_attempt uuid, p_source text, p_ok boolean, p_provider_status text, p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt finance.payment_attempts;
  v_status text;
  v_next timestamptz;
  v_unverified boolean := false;
begin
  if p_attempt is null or p_source is null or p_source not in ('job', 'prompt') or p_ok is null
    or (p_error is not null and p_error !~ '^[A-Za-z0-9_.:-]{1,120}$')
    or (p_provider_status is not null and char_length(p_provider_status) > 60)
  then
    raise exception 'Invalid attempt check.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt;
  if not found then
    return;
  end if;
  perform 1 from finance.orders o where o.id = v_attempt.order_id for update;
  select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;
  if v_attempt.status in ('paid', 'review') then
    return;
  end if;

  if p_source = 'prompt' then
    update finance.payment_attempts a set fetched_at = now(), updated_at = now() where a.id = p_attempt;
    return;
  end if;

  v_status := v_attempt.status;
  if not p_ok then
    v_next := now() + make_interval(mins => least(power(2, v_attempt.error_count), 60)::integer);
  elsif v_status in ('expired', 'cancelled', 'failed', 'abandoned') then
    -- The last check of a closed attempt, answered.
    v_next := null;
  else
    v_next := now() + make_interval(mins => least(power(2, v_attempt.check_count), 30)::integer);
  end if;
  -- A pending attempt whose invoice the provider calls expired or canceled,
  -- more than 10 minutes after its expiry (a payment in its last minute has
  -- landed by then), is closed as the provider says.
  if p_ok and v_status = 'pending' and p_provider_status in ('expired', 'canceled')
    and now() > v_attempt.invoice_expires_at + interval '10 minutes'
  then
    v_status := case p_provider_status when 'expired' then 'expired' else 'cancelled' end;
    v_next := null;
  end if;
  -- The terminal rule: 24 hours after its invoice expired nothing more is
  -- asked. What could not be verified is marked and alerted.
  if now() > v_attempt.invoice_expires_at + interval '24 hours' then
    v_next := null;
    if v_status in ('pending', 'uncertain') then
      v_status := 'expired';
    end if;
    v_unverified := not p_ok;
  end if;

  update finance.payment_attempts a
     set status = v_status,
         fetched_at = now(),
         check_count = case when p_ok then a.check_count + 1 else a.check_count end,
         error_count = case when p_ok then 0 else a.error_count + 1 end,
         last_error = case
           when v_unverified then 'UNVERIFIED'
           when not p_ok then coalesce(p_error, a.last_error)
           else a.last_error
         end,
         next_check_at = v_next,
         updated_at = now()
   where a.id = p_attempt;
  if v_unverified then
    perform finance.owner_alert(
      'attempt_unverified', p_attempt::text,
      jsonb_build_object('attemptId', p_attempt, 'orderId', v_attempt.order_id)
    );
  end if;
end
$$;

-- The uncertain resolution found more than one invoice that claims to be
-- this attempt's: the attempt stays uncertain and the owners are told once.
-- The only alert an Edge Function raises itself; `finance.owner_alert` stays
-- internal.
create function public.payment_attempt_duplicates(p_attempt uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  select a.order_id into v_order from finance.payment_attempts a where a.id = p_attempt;
  if not found then
    return;
  end if;
  perform finance.owner_alert(
    'attempt_duplicate_invoices', p_attempt::text, jsonb_build_object('attemptId', p_attempt, 'orderId', v_order)
  );
end
$$;

-- Wakes the reconciliation job when a row of the three kinds is due, like
-- `outbox_kick`; rows that wait for a person have no due time and never
-- trigger it. Without the Vault values it does nothing.
create function public.payments_kick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from finance.payment_attempts a where a.next_check_at <= now())
    and not exists (select 1 from finance.payment_events e where e.next_check_at <= now())
    and not exists (
      select 1 from finance.refunds r where r.status in ('submitting', 'uncertain') and r.next_check_at <= now()
    )
  then
    return false;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_secret';
  if v_url is null or v_secret is null then
    return false;
  end if;
  -- 15 s: a cold function start can exceed pg_net's 5 s default.
  perform net.http_post(
    url := v_url || '/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('job', 'payments_reconcile'),
    timeout_milliseconds := 15000
  );
  return true;
end
$$;

select cron.schedule('payments-reconcile', '* * * * *', 'select public.payments_kick()');

-- 6. Buyer retention (D42) -------------------------------------------------

-- Also deletes the payment attempts of the orders it removes and their
-- webhook events (by payment id), and leaves alone every order that still
-- has money or work attached: an attempt in creating, pending, uncertain,
-- paid or review, an attempt that still has a due time or could not be
-- verified, a review payment (open or closed: it holds a reference to the
-- order), or a dispute. Otherwise identical to 20260930130000_buyer_retention.sql.
create or replace function finance.buyer_retention_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orders uuid[];
  v_order_count integer := 0;
  v_customer_count integer;
begin
  -- The order rows are locked first (the one lock order), and an order a
  -- late payment is settling right now is skipped until tomorrow.
  select array_agg(x.id) into v_orders
  from (
    select o.id
    from finance.orders o
    where o.status in ('expired', 'cancelled')
      and o.updated_at < now() - interval '90 days'
      and not exists (
        select 1 from finance.payment_attempts a
         where a.order_id = o.id
           and (a.status in ('creating', 'pending', 'uncertain', 'paid', 'review')
                or a.next_check_at is not null
                or a.last_error = 'UNVERIFIED')
      )
      and not exists (select 1 from finance.payment_reviews r where r.order_id = o.id)
      and not exists (
        select 1 from finance.disputes d
         where d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = o.id)
      )
    for update of o skip locked
  ) x;

  if v_orders is not null then
    delete from finance.payment_events e
     where e.provider_payment_id in (
       select a.provider_payment_id from finance.payment_attempts a
        where a.order_id = any (v_orders) and a.provider_payment_id is not null
     );
    delete from finance.payment_attempts where order_id = any (v_orders);
    delete from finance.order_items where order_id = any (v_orders);
    delete from finance.inventory_reservations where order_id = any (v_orders);
    delete from finance.coupon_redemptions where order_id = any (v_orders);
    delete from finance.orders where id = any (v_orders);
    get diagnostics v_order_count = row_count;
  end if;

  delete from public.customers c
  where c.updated_at < now() - interval '90 days'
    and not exists (select 1 from finance.orders o where o.customer_id = c.id);
  get diagnostics v_customer_count = row_count;

  if v_order_count + v_customer_count > 0 then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('privacy.buyer_retention', 'orders', null,
            jsonb_build_object('orders', v_order_count, 'customers', v_customer_count));
  end if;
  return v_order_count + v_customer_count;
end
$$;
revoke all on function finance.buyer_retention_purge() from public, anon, authenticated, service_role;

-- 7. Grants -----------------------------------------------------------------

-- The server-only functions: service_role only (the Edge Functions' role).
revoke all on function public.payment_attempt_begin(text, text, text, text) from public, anon, authenticated;
revoke all on function public.payment_attempt_created(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.payment_attempt_close(uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_verified_payment(text, jsonb, jsonb, text, boolean, text) from public, anon, authenticated;
revoke all on function public.payment_event_record(text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.payment_event_result(text, text, text) from public, anon, authenticated;
revoke all on function public.payment_check_begin(text, text, text, text) from public, anon, authenticated;
revoke all on function public.payment_state(text, text, text) from public, anon, authenticated;
revoke all on function public.payment_callback_begin(text, text, text) from public, anon, authenticated;
revoke all on function public.payment_attempt_ref(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.payment_reconcile_claim(text) from public, anon, authenticated;
revoke all on function public.payment_attempt_checked(uuid, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.payments_kick() from public, anon, authenticated;
revoke all on function public.payment_attempt_duplicates(uuid) from public, anon, authenticated;

grant execute on function public.payment_attempt_begin(text, text, text, text) to service_role;
grant execute on function public.payment_attempt_created(uuid, text, text, timestamptz) to service_role;
grant execute on function public.payment_attempt_close(uuid, text, text) to service_role;
grant execute on function public.apply_verified_payment(text, jsonb, jsonb, text, boolean, text) to service_role;
grant execute on function public.payment_event_record(text, text, boolean, text, text) to service_role;
grant execute on function public.payment_event_result(text, text, text) to service_role;
grant execute on function public.payment_check_begin(text, text, text, text) to service_role;
grant execute on function public.payment_state(text, text, text) to service_role;
grant execute on function public.payment_callback_begin(text, text, text) to service_role;
grant execute on function public.payment_attempt_ref(uuid, uuid, text) to service_role;
grant execute on function public.payment_reconcile_claim(text) to service_role;
grant execute on function public.payment_attempt_checked(uuid, text, boolean, text, text) to service_role;
grant execute on function public.payments_kick() to service_role;
grant execute on function public.payment_attempt_duplicates(uuid) to service_role;

-- The helpers: nobody calls them through the API, service_role included;
-- the security definer functions above run them as their owner.
revoke all on function finance.owner_alert(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function finance.preorder_committed(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.availability(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.item_fully_refunded(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.attempt_worth_asking(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function finance.attempt_provider_alerts(uuid, text) from public, anon, authenticated, service_role;
revoke all on function finance.payment_view(text, text, text) from public, anon, authenticated, service_role;
revoke all on function finance.order_try_commit(uuid, text) from public, anon, authenticated, service_role;
