-- P08 round 7b: order operations (PLANS/P08-CONTRACT.md section 6, "Order
-- operations (round 7b)"). Functions only: the tables are round 2's (and one
-- of round 2's functions is replaced, at the end). These are
-- the staff's functions for orders, fulfilment, returns, resolution, alerts
-- and reconciliation. They are granted to `authenticated` and recheck the
-- caller's role inside, from the caller's own active staff row
-- (`finance.require_staff`): an owner or an operations member, an owner alone
-- where the contract says so. An editor, a revoked or inactive member and anon
-- are refused with 42501, like the other staff functions.
--
-- One lock order for every writer (contract, rules at the top): the order row,
-- then the return row, then the order's variants in ascending id;
-- `order_resolve` also takes the paying attempt (before the variants, as
-- `apply_verified_payment` does) and then whatever `finance.order_try_commit`
-- takes. A function that finds its order through a return reads that row
-- without a lock, locks the order, then the return, and decides on what it
-- reads after the locks. Every writer here starts at the order row, like
-- `apply_verified_payment`, the refund functions, `paid_asset_set` and
-- `return_request_create`, so none of them can deadlock against those.
--
-- Business refusals are replies (`{ok: false, code}`); a malformed call raises
-- 22023. Money is integer halalas. No token, token hash, idempotency key or
-- storage key is ever put in a reply, and no free text a person typed is
-- copied into an audit row.

-- 1. Internal helpers (finance: no API role, service_role included) ---------

-- The caller's role, rechecked against the caller's own active staff row (a
-- revoked or inactive member has none): an owner or an operations member, an
-- owner alone when `p_owner_only`. Anyone else is refused (42501).
create function finance.require_staff(p_owner_only boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text := (select public.current_staff_role())::text;
begin
  if v_role is null or v_role not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can manage orders.' using errcode = 'insufficient_privilege';
  end if;
  if p_owner_only and v_role <> 'owner' then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  return v_role;
end
$$;

-- Lines of a paid order still to ship: a physical or signed item whose
-- fulfilment is `preparing` and that is not fully refunded. Zero for an order
-- that is not `paid` and for a digital-only one (no fulfilment rows).
create function finance.order_lines_to_ship(p_order uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from finance.fulfillments f
    join finance.orders o on o.id = f.order_id
   where f.order_id = p_order and o.status = 'paid' and f.state = 'preparing'
     and not coalesce(finance.item_fully_refunded(f.order_item_id), false)
$$;

-- The confirmed refunds of an order's paying attempt, in halalas (a review
-- payment's refund never counts).
create function finance.order_refunded_total(p_order uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.amount_halalas), 0)::integer
    from finance.refunds r
   where r.order_id = p_order and r.attempt_id is not null and r.status = 'succeeded'
$$;

-- What the ledger holds of an attempt's refunds: the confirmed ones, and those
-- plus the in-flight ones (what the provider's total is compared with, as the
-- `external_refund` alert does).
create function finance.attempt_refunds_confirmed(p_attempt uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.amount_halalas), 0)::integer from finance.refunds r where r.attempt_id = p_attempt and r.status = 'succeeded'
$$;

create function finance.attempt_refunds_known(p_attempt uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(r.amount_halalas), 0)::integer
    from finance.refunds r
   where r.attempt_id = p_attempt and r.status in ('succeeded', 'submitting', 'uncertain')
$$;

-- The rows of the payment ledger as the staff see them: provider ids, amounts,
-- statuses and times, never the invoice URL, a key or a request hash.
create function finance.attempt_json(a finance.payment_attempts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'orderId', a.order_id, 'status', a.status, 'environment', a.environment,
    'amount', a.amount_halalas, 'currency', a.currency,
    'providerInvoiceId', a.provider_invoice_id, 'providerPaymentId', a.provider_payment_id,
    'providerStatus', a.provider_status, 'providerRefunded', a.provider_refunded_halalas,
    'captured', a.captured_halalas, 'fee', a.fee_halalas,
    'sourceType', a.source_type, 'sourceCompany', a.source_company,
    'invoiceExpiresAt', a.invoice_expires_at, 'paidAt', a.paid_at, 'fetchedAt', a.fetched_at,
    'checkCount', a.check_count, 'errorCount', a.error_count, 'lastError', a.last_error,
    'createdAt', a.created_at
  )
$$;

create function finance.review_json(pr finance.payment_reviews)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'paymentId', pr.provider_payment_id, 'invoiceId', pr.provider_invoice_id,
    'attemptId', pr.attempt_id, 'orderId', pr.order_id, 'environment', pr.environment,
    'amount', pr.amount_halalas, 'currency', pr.currency, 'providerStatus', pr.provider_status,
    'reason', pr.reason, 'providerRefunded', pr.provider_refunded_halalas,
    'refunded', (
      select coalesce(sum(r.amount_halalas), 0)::integer
        from finance.refunds r where r.review_payment_id = pr.provider_payment_id and r.status = 'succeeded'
    ),
    'closedAt', pr.closed_at, 'closedReason', pr.closed_reason, 'createdAt', pr.created_at
  )
$$;

create function finance.refund_json(r finance.refunds)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'orderId', r.order_id, 'attemptId', r.attempt_id, 'reviewPaymentId', r.review_payment_id,
    'returnId', r.return_id, 'status', r.status, 'amount', r.amount_halalas, 'reason', r.reason,
    'source', r.source, 'allocation', r.allocation,
    'providerRefundedBefore', r.provider_refunded_before, 'providerRefundedAfter', r.provider_refunded_after,
    'error', r.error, 'nextCheckAt', r.next_check_at, 'createdAt', r.created_at, 'succeededAt', r.succeeded_at
  )
$$;

create function finance.event_json(e finance.payment_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'eventId', e.event_id, 'type', e.type, 'live', e.live, 'paymentId', e.provider_payment_id,
    'receivedAt', e.received_at, 'processedAt', e.processed_at, 'outcome', e.outcome, 'error', e.error,
    'attempts', e.attempts, 'nextCheckAt', e.next_check_at
  )
$$;

-- An exhausted webhook event still needs a person unless the ledger has settled
-- its payment since (a paid attempt or a review payment holds it) or the owner
-- dismissed it.
create function finance.event_needs_person(e finance.payment_events)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(e.outcome = 'exhausted', false)
     and not exists (
       select 1 from finance.payment_attempts a where a.provider_payment_id = e.provider_payment_id and a.status = 'paid'
     )
     and not exists (select 1 from finance.payment_reviews pr where pr.provider_payment_id = e.provider_payment_id)
$$;

-- 2. Reading: the list, the order screen, the alerts, the reconciliation ----

-- One page of orders, newest first, for owner and operations. `p_filter` is one
-- of all, paid, to_ship, needs_resolution, pending, refunded, review: `paid`,
-- `needs_resolution` (paid_needs_resolution), `pending` (pending_payment) and
-- `refunded` are the order's status, `to_ship` a paid order with a line still to
-- ship, `review` an order with an open review payment. `p_query` is
-- null, an exact order number, or an email, normalized like checkout does and
-- matched through `email_hash` (never a LIKE over addresses): the customer's
-- history. At most 50 rows (the limit is clamped to 1..50, null is 50); keyset on
-- `created_at`: pass the reply's `next` back as `p_before`, unchanged.
-- {rows: [{id, orderNumber, status, environment, createdAt, paidAt, total, name,
-- email, items, toShip, refunded, review}], next}.
-- ponytail: the keyset is `created_at` alone, so rows created in the same
-- microsecond could straddle a page edge; an order is one transaction of its
-- own and no two checkouts share a timestamp. Add the id to the key if bulk
-- inserts ever matter.
create function public.orders_list(p_filter text, p_query text, p_before timestamptz, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_number text;
  v_hash text;
  v_rows jsonb;
  v_next timestamptz;
begin
  perform finance.require_staff(false);
  if p_filter is null or p_filter not in ('all', 'paid', 'to_ship', 'needs_resolution', 'pending', 'refunded', 'review') then
    raise exception 'Invalid order filter.' using errcode = 'invalid_parameter_value';
  end if;
  if v_query is not null then
    if upper(v_query) ~ '^[2-9A-HJ-NP-Z]{8}$' then
      v_number := upper(v_query);
    elsif char_length(v_query) between 3 and 254
      and lower(v_query) ~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
    then
      v_hash := finance.recipient_hash(v_query);
    else
      raise exception 'Invalid order search.' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  with page as (
    select o.id, o.order_number, o.status, o.environment, o.created_at, o.paid_at, o.total_halalas,
           o.customer_name, o.customer_email
      from finance.orders o
     where (p_before is null or o.created_at < p_before)
       and (v_number is null or o.order_number = v_number)
       and (v_hash is null or o.email_hash = v_hash)
       and case p_filter
             when 'paid' then o.status = 'paid'
             when 'to_ship' then o.status = 'paid' and exists (
               select 1 from finance.fulfillments f
                where f.order_id = o.id and f.state = 'preparing'
                  and not coalesce(finance.item_fully_refunded(f.order_item_id), false)
             )
             when 'needs_resolution' then o.status = 'paid_needs_resolution'
             when 'pending' then o.status = 'pending_payment'
             when 'refunded' then o.status = 'refunded'
             when 'review' then exists (
               select 1 from finance.payment_reviews pr where pr.order_id = o.id and pr.closed_at is null
             )
             else true
           end
     order by o.created_at desc, o.id desc
     limit v_limit + 1
  ), shown as (
    select p.* from page p order by p.created_at desc, p.id desc limit v_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', s.id, 'orderNumber', s.order_number, 'status', s.status, 'environment', s.environment,
               'createdAt', s.created_at, 'paidAt', s.paid_at, 'total', s.total_halalas,
               'name', s.customer_name, 'email', s.customer_email,
               'items', (select count(*) from finance.order_items i where i.order_id = s.id),
               'toShip', finance.order_lines_to_ship(s.id),
               'refunded', finance.order_refunded_total(s.id),
               'review', exists (select 1 from finance.payment_reviews pr where pr.order_id = s.id and pr.closed_at is null)
             )
             order by s.created_at desc, s.id desc
           ),
           '[]'::jsonb
         ),
         case when (select count(*) from page) > v_limit then min(s.created_at) end
    into v_rows, v_next
    from shown s;
  return jsonb_build_object('rows', v_rows, 'next', v_next);
end
$$;

-- Everything the order screen shows, for owner and operations: the order with
-- its contact and delivery, its items, payment attempts (provider ids,
-- amounts, mode, source, fetch times), review payments, webhook events (type,
-- time, outcome), fulfilments, entitlements, refunds and returns. For an owner
-- only, also `disputes` and `audit` (the order's, its refunds', returns' and
-- review payments' audit rows): for operations those keys are absent. No token,
-- token hash, idempotency key, storage key or invoice URL is in it.
-- {ok: true, order, items, attempts, reviews, events, fulfillments,
-- entitlements, refunds, returns[, disputes, audit]} or {ok: false, code:
-- 'NOT_FOUND'}.
-- ponytail: the audit read scans `public.audit_events` (no index on its
-- entity); an index belongs to a schema change, not to this migration.
create function public.order_detail(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_order finance.orders;
  v_detail jsonb;
begin
  v_role := finance.require_staff(false);
  select * into v_order from finance.orders o where o.id = p_order;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  v_detail := jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_order.id, 'orderNumber', v_order.order_number, 'status', v_order.status,
      'environment', v_order.environment, 'createdAt', v_order.created_at, 'updatedAt', v_order.updated_at,
      'paidAt', v_order.paid_at, 'holdExpiresAt', v_order.hold_expires_at,
      'subtotal', v_order.subtotal_halalas, 'discount', v_order.discount_halalas,
      'shipping', v_order.shipping_halalas, 'total', v_order.total_halalas, 'currency', v_order.currency,
      'couponCode', v_order.coupon_code, 'refunded', finance.order_refunded_total(v_order.id),
      'contact', jsonb_build_object('name', v_order.customer_name, 'email', v_order.customer_email, 'phone', v_order.customer_phone),
      'delivery', jsonb_build_object('cityKey', v_order.city_key, 'city', v_order.city_name_ar, 'address', v_order.address)
    ),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', i.id, 'lineNo', i.line_no, 'sku', i.sku, 'productTitle', i.product_title,
                 'variantTitle', i.variant_title, 'fulfillment', i.fulfillment, 'quantity', i.quantity,
                 'unitPrice', i.unit_price_halalas, 'discount', i.discount_halalas,
                 'total', i.line_subtotal_halalas - i.discount_halalas, 'dedication', i.dedication,
                 'preorder', case when i.preorder then jsonb_build_object('shipsOn', i.preorder_ships_on, 'note', i.preorder_note) end,
                 -- What the item's own refunds (the allocated ones) add up to.
                 'refunded', (
                   select coalesce(sum((x ->> 'amount')::integer), 0)::integer
                     from finance.refunds r
                    cross join lateral jsonb_array_elements(
                      case when jsonb_typeof(r.allocation -> 'items') = 'array' then r.allocation -> 'items' else '[]'::jsonb end
                    ) x
                    where r.order_id = i.order_id and r.attempt_id is not null and r.status = 'succeeded'
                      and x ->> 'itemId' = i.id::text
                 ),
                 'fullyRefunded', coalesce(finance.item_fully_refunded(i.id), false)
               )
               order by i.line_no
             )
        from finance.order_items i
       where i.order_id = v_order.id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(finance.attempt_json(a) order by a.created_at, a.id)
        from finance.payment_attempts a where a.order_id = v_order.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(finance.review_json(pr) order by pr.created_at, pr.provider_payment_id)
        from finance.payment_reviews pr where pr.order_id = v_order.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(finance.event_json(e) order by e.received_at desc, e.event_id)
        from (
          select ev.*
            from finance.payment_events ev
           where ev.provider_payment_id in (
                   select a.provider_payment_id from finance.payment_attempts a
                    where a.order_id = v_order.id and a.provider_payment_id is not null
                   union
                   select pr.provider_payment_id from finance.payment_reviews pr where pr.order_id = v_order.id
                 )
           order by ev.received_at desc, ev.event_id
           limit 100
        ) e
    ), '[]'::jsonb),
    'fulfillments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', f.id, 'itemId', f.order_item_id, 'state', f.state, 'carrier', f.carrier, 'tracking', f.tracking,
                 'dedicationDone', f.dedication_done, 'shippedAt', f.shipped_at, 'deliveredAt', f.delivered_at,
                 'updatedAt', f.updated_at
               )
               order by i.line_no
             )
        from finance.fulfillments f
        join finance.order_items i on i.id = f.order_item_id
       where f.order_id = v_order.id
    ), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', e.id, 'itemId', e.order_item_id, 'grantedAt', e.granted_at, 'revokedAt', e.revoked_at,
                 'revokeReason', e.revoke_reason, 'hasFile', e.asset_id is not null, 'filename', pa.filename
               )
               order by i.line_no
             )
        from finance.entitlements e
        join finance.order_items i on i.id = e.order_item_id
        left join finance.paid_assets pa on pa.id = e.asset_id
       where e.order_id = v_order.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(finance.refund_json(r) order by r.created_at, r.id)
        from finance.refunds r where r.order_id = v_order.id
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', q.id, 'state', q.state, 'items', q.items, 'reason', q.reason, 'staffNote', q.staff_note,
                 'restocked', q.restocked, 'refundId', q.refund_id, 'createdAt', q.created_at, 'updatedAt', q.updated_at
               )
               order by q.created_at, q.id
             )
        from finance.return_requests q where q.order_id = v_order.id
    ), '[]'::jsonb)
  );

  if v_role = 'owner' then
    v_detail := v_detail || jsonb_build_object(
      'disputes', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', d.id, 'kind', d.kind, 'providerRef', d.provider_ref, 'seq', d.seq,
                   'attemptId', d.attempt_id, 'reviewPaymentId', d.review_payment_id, 'environment', d.environment,
                   'amount', d.amount_halalas, 'direction', d.direction, 'occurredOn', d.occurred_on,
                   'reason', d.reason, 'resolution', d.resolution, 'decision', d.decision, 'itemIds', d.item_ids,
                   'createdAt', d.created_at
                 )
                 order by d.provider_ref, d.seq
               )
          from finance.disputes d
         where d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = v_order.id)
            or d.review_payment_id in (select pr.provider_payment_id from finance.payment_reviews pr where pr.order_id = v_order.id)
      ), '[]'::jsonb),
      'audit', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'id', x.id, 'at', x.at, 'actor', x.actor, 'action', x.action, 'entity', x.entity,
                   'entityId', x.entity_id, 'summary', x.summary
                 )
                 order by x.id desc
               )
          from (
            select ae.*
              from public.audit_events ae
             where (ae.entity = 'order' and ae.entity_id = v_order.id::text)
                or (ae.entity = 'refund' and ae.entity_id in (select r.id::text from finance.refunds r where r.order_id = v_order.id))
                or (ae.entity = 'return' and ae.entity_id in (select q.id::text from finance.return_requests q where q.order_id = v_order.id))
                or (ae.entity = 'payment' and ae.entity_id in (
                      select pr.provider_payment_id from finance.payment_reviews pr where pr.order_id = v_order.id
                    ))
             order by ae.id desc
             limit 200
          ) x
      ), '[]'::jsonb)
    );
  end if;
  return v_detail;
end
$$;

-- The admin home's alerts, for owner and operations: counts only, plus the
-- low-stock list. needsResolution: orders waiting for `order_resolve`; review:
-- open review payments; toShip: paid orders with a line still to ship (the
-- `to_ship` filter); uncertainRefunds: refunds whose outcome is unknown;
-- unverifiedAttempts: attempts the job could not verify (marked UNVERIFIED)
-- that no payment has settled and no answered recheck has cleared since;
-- exhaustedEvents: webhook events the job gave up on, until the ledger settles
-- their payment or the owner dismisses them (`event_dismiss`); externalRefunds: paid attempts whose provider total is above the
-- ledger's confirmed plus in-flight refunds (a refund to record). lowStock: the
-- enabled, published, stocked variants at or under their threshold (not the
-- preorder ones: their stock is ignored), the fewest first, at most 100.
-- {needsResolution, review, toShip, uncertainRefunds, unverifiedAttempts,
-- exhaustedEvents, externalRefunds, lowStock: [{variantId, sku, title, stock,
-- threshold}]}; `title` is the product's.
create function public.orders_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform finance.require_staff(false);
  return jsonb_build_object(
    'needsResolution', (select count(*) from finance.orders o where o.status = 'paid_needs_resolution'),
    'review', (select count(*) from finance.payment_reviews pr where pr.closed_at is null),
    -- From the lines still being prepared (the open work), not from every paid order ever.
    'toShip', (
      select count(distinct f.order_id)
        from finance.fulfillments f
        join finance.orders o on o.id = f.order_id
       where f.state = 'preparing' and o.status = 'paid'
         and not coalesce(finance.item_fully_refunded(f.order_item_id), false)
    ),
    'uncertainRefunds', (select count(*) from finance.refunds r where r.status = 'uncertain'),
    'unverifiedAttempts', (
      select count(*) from finance.payment_attempts a
       where a.last_error = 'UNVERIFIED' and a.status not in ('paid', 'review')
    ),
    'exhaustedEvents', (select count(*) from finance.payment_events e where finance.event_needs_person(e)),
    'externalRefunds', (
      select count(*) from finance.payment_attempts a
       where a.status = 'paid' and a.provider_refunded_halalas > finance.attempt_refunds_known(a.id)
    ),
    'lowStock', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'variantId', s.id, 'sku', s.sku, 'title', s.title, 'stock', s.stock, 'threshold', s.low_stock_threshold
               )
               order by s.stock, s.sku
             )
        from (
          select v.id, v.sku, p.title, v.stock, v.low_stock_threshold
            from public.product_variants v
            join public.products p on p.id = v.product_id
           where v.enabled and p.status = 'published' and not v.preorder
             and v.stock is not null and v.low_stock_threshold is not null and v.stock <= v.low_stock_threshold
           order by v.stock, v.sku
           limit 100
        ) s
    ), '[]'::jsonb)
  );
end
$$;

-- What needs a person at the payment ledger, for the owner: attempts that are
-- uncertain, UNVERIFIED (and not settled since), paid with a provider status
-- other than paid or refunded (unless the money has all been refunded, which
-- is how a void ends), or paid with a provider refunded total above the ledger's
-- confirmed plus in-flight refunds; open review payments; in-flight refunds;
-- unprocessed webhook events and the exhausted ones that still need a person. Each list is the newest 100.
-- {attempts: [attempt + orderNumber, refunded, reasons], reviews: [review +
-- orderNumber], refunds: [refund + orderNumber], events: [event]}; `reasons`
-- holds UNCERTAIN, UNVERIFIED, PROVIDER_STATUS, EXTERNAL_REFUND.
create function public.reconciliation_list()
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
                          then 'EXTERNAL_REFUND' end
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

-- 3. Fulfilment --------------------------------------------------------------

-- Moves items of a paid order forward: preparing -> shipped -> delivered, never
-- back and never skipping `shipped`. `shipped` needs a carrier (at most 80
-- characters) and a tracking value (at most 120), trimmed, one line each (a
-- malformed one raises 22023); a signed item needs `dedication_done` first:
-- the call's `p_dedication_done` (null leaves it as it is) is applied to the
-- signed items still being prepared, so a call with `preparing` and
-- `p_dedication_done` only ticks the checklist, and one with `shipped` may tick
-- and ship together. `delivered` ignores carrier and tracking. Every id must be
-- the fulfilment of an item of this order, once (a digital item has none:
-- INVALID_ITEMS); a fully refunded item still being prepared is ITEM_REFUNDED;
-- a move that is not forward, or a repeat of `shipped` with another carrier or
-- tracking, is BAD_TRANSITION; a signed item without `dedication_done` is
-- DEDICATION_NOT_DONE; an order that is not `paid` is ORDER_NOT_PAID. The call
-- is all or nothing. A repeat of a call that already holds (the same state, and
-- for `shipped` the same carrier and tracking) changes nothing and queues
-- nothing. One `order_shipped` mail per call that moved something to shipped
-- (`order_shipped:<orderId>:<md5 of the moved item ids, sorted, joined by commas>`,
-- payload {orderId, itemIds}), and one audit row per call that changed anything.
-- {ok: true, changed, itemIds} where itemIds are the items that changed, or
-- {ok: false, code[, itemIds: the items at fault][, status]}.
create function public.fulfillment_update(
  p_order uuid, p_item_ids uuid[], p_state text, p_carrier text, p_tracking text, p_dedication_done boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_carrier text := btrim(coalesce(p_carrier, ''));
  v_tracking text := btrim(coalesce(p_tracking, ''));
  v_bad uuid[];
  v_done uuid[] := '{}';
begin
  perform finance.require_staff(false);
  if p_state is null or p_state not in ('preparing', 'shipped', 'delivered')
    or p_item_ids is null or cardinality(p_item_ids) not between 1 and 50
    or exists (select 1 from unnest(p_item_ids) u(id) where u.id is null)
    or (p_state = 'shipped' and (
      char_length(v_carrier) not between 1 and 80 or v_carrier ~ '[[:cntrl:]]'
      or char_length(v_tracking) not between 1 and 120 or v_tracking ~ '[[:cntrl:]]'
    ))
  then
    raise exception 'Invalid fulfilment update.' using errcode = 'invalid_parameter_value';
  end if;

  -- The order's lock first; every fact below is read after it.
  select * into v_order from finance.orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_PAID', 'status', v_order.status);
  end if;

  -- Every id is the fulfilment of an item of this order, once.
  select coalesce(array_agg(u.id order by u.id), '{}') into v_bad
    from unnest(p_item_ids) u(id)
   where not exists (select 1 from finance.fulfillments f where f.order_item_id = u.id and f.order_id = p_order);
  if cardinality(v_bad) > 0 or (select count(distinct u.id) from unnest(p_item_ids) u(id)) <> cardinality(p_item_ids) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS', 'itemIds', to_jsonb(v_bad));
  end if;

  -- Forward moves only; what already holds is a repeat, not a move.
  select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
    from finance.fulfillments f
   where f.order_id = p_order and f.order_item_id = any (p_item_ids)
     and not case p_state
           when 'preparing' then f.state = 'preparing'
           when 'shipped' then f.state = 'preparing'
             or (f.state = 'shipped' and f.carrier is not distinct from v_carrier and f.tracking is not distinct from v_tracking)
           else f.state in ('shipped', 'delivered')
         end;
  if cardinality(v_bad) > 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_TRANSITION', 'itemIds', to_jsonb(v_bad));
  end if;

  -- A fully refunded item cannot be prepared further or shipped; one that has
  -- shipped may still be marked delivered.
  if p_state in ('preparing', 'shipped') then
    select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
      from finance.fulfillments f
     where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'preparing'
       and coalesce(finance.item_fully_refunded(f.order_item_id), false);
    if cardinality(v_bad) > 0 then
      return jsonb_build_object('ok', false, 'code', 'ITEM_REFUNDED', 'itemIds', to_jsonb(v_bad));
    end if;
  end if;

  if p_state = 'shipped' then
    select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
      from finance.fulfillments f
      join finance.order_items i on i.id = f.order_item_id
     where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'preparing'
       and i.fulfillment = 'signed' and not coalesce(p_dedication_done, f.dedication_done);
    if cardinality(v_bad) > 0 then
      return jsonb_build_object('ok', false, 'code', 'DEDICATION_NOT_DONE', 'itemIds', to_jsonb(v_bad));
    end if;

    with moved as (
      update finance.fulfillments f
         set state = 'shipped', carrier = v_carrier, tracking = v_tracking, shipped_at = now(),
             dedication_done = case
               when i.fulfillment = 'signed' then coalesce(p_dedication_done, f.dedication_done) else f.dedication_done
             end,
             updated_by = (select auth.uid()), version = f.version + 1, updated_at = now()
        from finance.order_items i
       where i.id = f.order_item_id and f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'preparing'
      returning f.order_item_id
    )
    select coalesce(array_agg(m.order_item_id order by m.order_item_id), '{}') into v_done from moved m;
    if cardinality(v_done) > 0 then
      insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
      values ('order_shipped:' || p_order::text || ':' || md5(array_to_string(v_done, ',')), 'order_shipped', 0,
              lower(btrim(v_order.customer_email)), jsonb_build_object('orderId', p_order, 'itemIds', to_jsonb(v_done)))
      on conflict (dedupe_key) do nothing;
    end if;
  elsif p_state = 'delivered' then
    with moved as (
      update finance.fulfillments f
         set state = 'delivered', delivered_at = now(),
             updated_by = (select auth.uid()), version = f.version + 1, updated_at = now()
       where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'shipped'
      returning f.order_item_id
    )
    select coalesce(array_agg(m.order_item_id order by m.order_item_id), '{}') into v_done from moved m;
  else
    -- The signed checklist, ticked (or unticked) while the item is still prepared.
    with moved as (
      update finance.fulfillments f
         set dedication_done = p_dedication_done,
             updated_by = (select auth.uid()), version = f.version + 1, updated_at = now()
        from finance.order_items i
       where i.id = f.order_item_id and f.order_id = p_order and f.order_item_id = any (p_item_ids)
         and f.state = 'preparing' and i.fulfillment = 'signed'
         and p_dedication_done is not null and f.dedication_done is distinct from p_dedication_done
      returning f.order_item_id
    )
    select coalesce(array_agg(m.order_item_id order by m.order_item_id), '{}') into v_done from moved m;
  end if;

  if cardinality(v_done) > 0 then
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values ((select auth.uid()), 'fulfillment.updated', 'order', p_order::text,
            jsonb_build_object('orderNumber', v_order.order_number, 'state', p_state, 'itemIds', to_jsonb(v_done)));
  end if;
  return jsonb_build_object('ok', true, 'changed', cardinality(v_done), 'itemIds', to_jsonb(v_done));
end
$$;

-- 4. Returns -----------------------------------------------------------------

-- A staff decision on a buyer's request: `approved` or `rejected`, from
-- `requested` only (anything else is BAD_TRANSITION with the return's `state`),
-- under the order's lock and then the return's. The note (at most 500
-- characters, one line) is optional. {ok: true, returnId, state} or {ok: false,
-- code: NOT_FOUND | BAD_TRANSITION}.
create function public.return_decide(p_return uuid, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order finance.orders;
  v_return finance.return_requests;
begin
  perform finance.require_staff(false);
  if p_decision is null or p_decision not in ('approved', 'rejected')
    or (v_note is not null and (char_length(v_note) > 500 or v_note ~ '[[:cntrl:]]'))
  then
    raise exception 'Invalid return decision.' using errcode = 'invalid_parameter_value';
  end if;

  -- The return's order is read without a lock, then locked, then the return.
  select o.* into v_order
    from finance.orders o
   where o.id = (select q.order_id from finance.return_requests q where q.id = p_return)
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_return from finance.return_requests q where q.id = p_return for update;
  if v_return.state <> 'requested' then
    return jsonb_build_object('ok', false, 'code', 'BAD_TRANSITION', 'state', v_return.state);
  end if;

  update finance.return_requests q
     set state = p_decision, staff_note = v_note, decided_by = (select auth.uid()), updated_at = now()
   where q.id = p_return;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'return.decided', 'return', p_return::text,
          jsonb_build_object('orderNumber', v_order.order_number, 'decision', p_decision));
  return jsonb_build_object('ok', true, 'returnId', p_return, 'state', p_decision);
end
$$;

-- The goods arrived: `approved` -> `received`, once. Owner or operations;
-- `p_restock` (`[{itemId, quantity}]`, null or `[]` for none) may be non-empty
-- only for an owner (operations mark the goods received; only the owner says they
-- are sellable again): anyone else raises 42501. Every item must belong to the
-- return, once, each quantity a positive integer at most the return's own for it
-- (INVALID_ITEMS otherwise, and nothing changes). Under the order's lock, the
-- return's and then the variants' in ascending id, the quantities are added to
-- the variants' stock, only for lines whose reservation was not a preorder (a
-- preorder's stock is ignored); a restock entry for such a line is accepted and
-- adds nothing. This is the only place stock comes back: a refund never restores
-- it. The audit row records each variant's stock from and to; `restocked` on the
-- return keeps what was put back. {ok: true, returnId, state: 'received',
-- restocked: [{itemId, variantId, quantity, from, to}]} or {ok: false, code:
-- NOT_FOUND | BAD_TRANSITION | INVALID_ITEMS}.
create function public.return_receive(p_return uuid, p_restock jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_restock jsonb;
  v_order finance.orders;
  v_return finance.return_requests;
  e jsonb;
  r record;
  v_item uuid;
  v_qty integer;
  v_max integer;
  v_seen uuid[] := '{}';
  v_to integer;
  v_applied jsonb := '[]'::jsonb;
  v_trail jsonb := '[]'::jsonb;
begin
  v_role := finance.require_staff(false);
  if p_restock is not null and jsonb_typeof(p_restock) not in ('array', 'null') then
    raise exception 'Invalid restock.' using errcode = 'invalid_parameter_value';
  end if;
  v_restock := case when jsonb_typeof(p_restock) = 'array' then p_restock else '[]'::jsonb end;
  if jsonb_array_length(v_restock) > 0 and v_role <> 'owner' then
    raise exception 'Only an owner can put returned goods back on sale.' using errcode = 'insufficient_privilege';
  end if;

  -- The return's order is read without a lock, then locked, then the return.
  select o.* into v_order
    from finance.orders o
   where o.id = (select q.order_id from finance.return_requests q where q.id = p_return)
     for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_return from finance.return_requests q where q.id = p_return for update;
  if v_return.state <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'BAD_TRANSITION', 'state', v_return.state);
  end if;

  if jsonb_array_length(v_restock) > 50 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;
  for e in select x.value from jsonb_array_elements(v_restock) x loop
    if jsonb_typeof(e) <> 'object'
      or exists (select 1 from jsonb_object_keys(e) k where k not in ('itemId', 'quantity'))
      or coalesce(e ->> 'itemId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e -> 'quantity') is distinct from 'number'
      or (e ->> 'quantity') !~ '^[1-9][0-9]{0,2}$'
    then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_item := (e ->> 'itemId')::uuid;
    v_qty := (e ->> 'quantity')::integer;
    if v_item = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_seen := v_seen || v_item;
    select (x.value ->> 'quantity')::integer into v_max
      from jsonb_array_elements(v_return.items) x where x.value ->> 'itemId' = v_item::text;
    if not found or v_qty > v_max then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
  end loop;

  -- The variants, in ascending id, then the stock under their locks.
  perform 1 from public.product_variants v
   where v.id in (select i.variant_id from finance.order_items i where i.order_id = v_order.id and i.id = any (v_seen))
   order by v.id for update;
  for r in
    select (x.value ->> 'itemId')::uuid as item_id, (x.value ->> 'quantity')::integer as qty,
           i.variant_id, v.stock, coalesce(res.preorder, false) as preorder
      from jsonb_array_elements(v_restock) x
      join finance.order_items i on i.id = (x.value ->> 'itemId')::uuid and i.order_id = v_order.id
      join public.product_variants v on v.id = i.variant_id
      left join finance.inventory_reservations res on res.order_id = i.order_id and res.variant_id = i.variant_id
     order by i.variant_id
  loop
    continue when r.preorder or r.stock is null;
    -- An ordinary UPDATE, so the catalog triggers audit the stock change too.
    update public.product_variants v set stock = v.stock + r.qty where v.id = r.variant_id returning v.stock into v_to;
    v_applied := v_applied || jsonb_build_object('itemId', r.item_id, 'quantity', r.qty);
    v_trail := v_trail || jsonb_build_object(
      'itemId', r.item_id, 'variantId', r.variant_id, 'quantity', r.qty, 'from', v_to - r.qty, 'to', v_to
    );
  end loop;

  update finance.return_requests q
     set state = 'received', received_by = (select auth.uid()), restocked = v_applied, updated_at = now()
   where q.id = p_return;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'return.received', 'return', p_return::text,
          jsonb_build_object('orderNumber', v_order.order_number, 'restocked', v_trail));
  return jsonb_build_object('ok', true, 'returnId', p_return, 'state', 'received', 'restocked', v_trail);
end
$$;

-- 5. Resolution and review ---------------------------------------------------

-- The owner delivers an order that was paid when its stock was gone
-- (`paid_needs_resolution`). Fully refunded lines are skipped; every other line
-- must be available now, or the answer is STOCK_UNAVAILABLE and nothing changes.
-- On success it does for the remaining lines what a paid commit does, through
-- `finance.order_try_commit` itself (reservations, stock, coupon, entitlements,
-- fulfilments and the receipt, keyed `receipt:<orderId>:resolved`), the order
-- becomes `paid` with a fresh 7-day link, audit `order.resolved`. Locks: the
-- order, the paying attempt, then what the commit takes (the variants in
-- ascending id, the coupon, the reservations). While a refund of the order is
-- in flight the answer is REFUND_IN_FLIGHT: that refund may still take a line
-- this would commit (its stock taken, then never shipped), and it is decided
-- within minutes. {ok: true, orderNumber, status: 'paid'} or {ok: false, code:
-- NOT_FOUND | NOT_RESOLVABLE (with `status`) | REFUND_IN_FLIGHT |
-- STOCK_UNAVAILABLE}.
create function public.order_resolve(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
begin
  perform finance.require_staff(true);
  select * into v_order from finance.orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'paid_needs_resolution' then
    return jsonb_build_object('ok', false, 'code', 'NOT_RESOLVABLE', 'status', v_order.status);
  end if;
  perform 1 from finance.payment_attempts a where a.order_id = p_order and a.status = 'paid' for update;
  -- `refund_request` takes the order's lock too, so none can begin from here on.
  if exists (
    select 1 from finance.refunds r
     where r.order_id = p_order and r.attempt_id is not null and r.status in ('submitting', 'uncertain')
  ) then
    return jsonb_build_object('ok', false, 'code', 'REFUND_IN_FLIGHT');
  end if;

  if not finance.order_try_commit(p_order, 'receipt:' || p_order::text || ':resolved') then
    return jsonb_build_object('ok', false, 'code', 'STOCK_UNAVAILABLE');
  end if;
  update finance.orders o
     set status = 'paid', access_token_expires_at = now() + interval '7 days', version = o.version + 1, updated_at = now()
   where o.id = p_order;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'order.resolved', 'order', p_order::text,
          jsonb_build_object('orderNumber', v_order.order_number, 'amount', v_order.total_halalas));
  return jsonb_build_object('ok', true, 'orderNumber', v_order.order_number, 'status', 'paid');
end
$$;

-- The owner closes an open review payment with a reason (money the bank
-- reversed, for instance): `closed_at` and `closed_reason`; audit. The payment
-- stays refundable (`refund_request` refuses only one closed as `refunded`,
-- which is the reason the refund path writes: a person may not use it). The
-- reason is 1 to 300 characters, one line. Under the order's lock when the
-- payment has an order, then the payment's row. {ok: true, paymentId, closedAt}
-- or {ok: false, code: NOT_FOUND | ALREADY_CLOSED}.
create function public.review_close(p_payment text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order uuid;
  v_review finance.payment_reviews;
begin
  perform finance.require_staff(true);
  if char_length(coalesce(p_payment, '')) not between 1 and 120
    or char_length(v_reason) not between 1 and 300 or v_reason ~ '[[:cntrl:]]' or v_reason = 'refunded'
  then
    raise exception 'Invalid review close.' using errcode = 'invalid_parameter_value';
  end if;

  select pr.order_id into v_order from finance.payment_reviews pr where pr.provider_payment_id = p_payment;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order is not null then
    perform 1 from finance.orders o where o.id = v_order for update;
  end if;
  select * into v_review from finance.payment_reviews pr where pr.provider_payment_id = p_payment for update;
  if v_review.closed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;

  update finance.payment_reviews pr
     set closed_at = now(), closed_reason = v_reason
   where pr.provider_payment_id = p_payment;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'payment.review_closed', 'payment', p_payment,
          jsonb_build_object('amount', v_review.amount_halalas, 'reviewReason', v_review.reason, 'orderId', v_review.order_id));
  return jsonb_build_object('ok', true, 'paymentId', p_payment, 'closedAt', (
    select pr.closed_at from finance.payment_reviews pr where pr.provider_payment_id = p_payment
  ));
end
$$;

-- 6. Settling the two alerts that had no way back -------------------------------

-- The owner has looked at a webhook event the job gave up on (the provider's
-- dashboard shows what the payment was) and files it: `exhausted` becomes
-- `dismissed`, with an audit row. {ok: true, eventId} or {ok: false, code:
-- NOT_FOUND | NOT_EXHAUSTED}.
create function public.event_dismiss(p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment text;
begin
  perform finance.require_staff(true);
  if char_length(coalesce(p_event, '')) not between 1 and 200 then
    raise exception 'Invalid event.' using errcode = 'invalid_parameter_value';
  end if;
  update finance.payment_events e
     set outcome = 'dismissed', processed_at = coalesce(e.processed_at, now()), next_check_at = null
   where e.event_id = p_event and e.outcome = 'exhausted'
  returning e.provider_payment_id into v_payment;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', case when exists (select 1 from finance.payment_events e where e.event_id = p_event) then 'NOT_EXHAUSTED' else 'NOT_FOUND' end
    );
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'payment.event_dismissed', 'payment_event', p_event, jsonb_build_object('paymentId', v_payment));
  return jsonb_build_object('ok', true, 'eventId', p_event);
end
$$;

-- Round 2's `payment_attempt_checked`, with one change: a prompt (the owner's
-- recheck, a callback, the return page) that the provider answered clears
-- `UNVERIFIED`, the mark the job leaves on an attempt it could not verify
-- before giving up. Until then nothing a person did could clear it. Everything
-- else is as round 2 wrote it; the grants stay.
create or replace function public.payment_attempt_checked(
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
    -- A prompt the provider answered is a verification: it clears the mark the job left when it gave up.
    update finance.payment_attempts a
       set fetched_at = now(), updated_at = now(),
           last_error = case when p_ok and a.last_error = 'UNVERIFIED' then null else a.last_error end
     where a.id = p_attempt;
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

-- 7. Grants -------------------------------------------------------------------

-- The staff functions: the role is rechecked inside, so anon and public have
-- nothing (the other staff functions do the same).
revoke all on function public.orders_list(text, text, timestamptz, integer) from public, anon;
revoke all on function public.order_detail(uuid) from public, anon;
revoke all on function public.fulfillment_update(uuid, uuid[], text, text, text, boolean) from public, anon;
revoke all on function public.return_decide(uuid, text, text) from public, anon;
revoke all on function public.return_receive(uuid, jsonb) from public, anon;
revoke all on function public.order_resolve(uuid) from public, anon;
revoke all on function public.orders_alerts() from public, anon;
revoke all on function public.reconciliation_list() from public, anon;
revoke all on function public.review_close(text, text) from public, anon;
revoke all on function public.event_dismiss(text) from public, anon;
grant execute on function public.orders_list(text, text, timestamptz, integer) to authenticated;
grant execute on function public.order_detail(uuid) to authenticated;
grant execute on function public.fulfillment_update(uuid, uuid[], text, text, text, boolean) to authenticated;
grant execute on function public.return_decide(uuid, text, text) to authenticated;
grant execute on function public.return_receive(uuid, jsonb) to authenticated;
grant execute on function public.order_resolve(uuid) to authenticated;
grant execute on function public.orders_alerts() to authenticated;
grant execute on function public.reconciliation_list() to authenticated;
grant execute on function public.review_close(text, text) to authenticated;
grant execute on function public.event_dismiss(text) to authenticated;

-- The helpers: nobody calls them through the API, service_role included; the
-- security definer functions above run them as their owner.
revoke all on function finance.require_staff(boolean) from public, anon, authenticated, service_role;
revoke all on function finance.order_lines_to_ship(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.order_refunded_total(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.attempt_refunds_confirmed(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.attempt_refunds_known(uuid) from public, anon, authenticated, service_role;
revoke all on function finance.attempt_json(finance.payment_attempts) from public, anon, authenticated, service_role;
revoke all on function finance.review_json(finance.payment_reviews) from public, anon, authenticated, service_role;
revoke all on function finance.refund_json(finance.refunds) from public, anon, authenticated, service_role;
revoke all on function finance.event_json(finance.payment_events) from public, anon, authenticated, service_role;
revoke all on function finance.event_needs_person(finance.payment_events) from public, anon, authenticated, service_role;
