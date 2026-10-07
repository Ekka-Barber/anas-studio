-- FABLE-AUDIT, round M1b: the order operations findings, in one forward
-- migration. The earlier migrations stay untouched. Every replaced function
-- keeps its exact signature, return type, language, security and
-- `search_path` (`create or replace`), starts from its final definition (named
-- in its section), changes only what its section says, and restates its
-- grants. Money is integer halalas; codes are ASCII.
--
-- 1. `finance.order_stopped_items`: the items a dispute stopped, in one place.
-- 2. The lines still to ship leave those out (`finance.order_lines_to_ship`,
--    `orders_list`'s `to_ship`, `orders_alerts.toShip`), and `order_detail`
--    marks each item `stopped` for every staff role.
-- 3. `fulfillment_update`: REFUND_IN_FLIGHT, FULFILLMENT_STOPPED, a shipped
--    item's carrier and tracking can be corrected, and the shipped mail's link
--    opens.
-- 4. `finance.refund_succeed`: the refunded mail's link opens.
-- 5. `refund_request`: CHARGEBACK_RECORDED.
-- 6. `finance.checkout_price`: a digital line is one copy.
-- 7. `commerce_settings_get` says whether checkout is open, and why not; a
--    policy change that closes a switched-on checkout alerts the owners.
-- 8. `outbox_claim`: staff mail is never suppressed by the list, and the
--    sign-in codes keep the last five sends of the day.
-- 9. `outbox_result`: PROVIDER_CONFIG gives the attempt back and waits 15
--    minutes.
-- 10. `staff_sessions_end`: a revoked member's sessions end.
-- 11. `order_link_reissue`: the owner re-sends, rotates and re-addresses an
--     order's link.
-- 12. `dispute_record`: `entitlement_kept` gives back what the dispute revoked.
-- 13. `payment_attempt_checked`: an answered recheck clears MODE_CHANGED.

-- 1. The items of an order whose shipping a dispute stopped («إيقاف الشحن»).
--    A dispute's current state is its reference's latest row: the greatest seq
--    of its kind, provider reference and environment, as the statistics read
--    it. An item is stopped while the latest row of a reference whose target
--    (the attempt, or the review payment) belongs to the order has the decision
--    `fulfillment_stopped` and names it; a later row of that reference with
--    another decision lifts it. One place, so `fulfillment_update`, the lines
--    to ship, the list, the alerts and the order screen agree. Sorted and
--    distinct, empty when nothing is stopped. Private: no API role.
create function finance.order_stopped_items(p_order uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.item order by s.item), '{}')
    from finance.disputes d
   cross join lateral unnest(d.item_ids) as s(item)
   where d.decision = 'fulfillment_stopped'
     and (d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = p_order)
          or d.review_payment_id in (select pr.provider_payment_id from finance.payment_reviews pr where pr.order_id = p_order))
     and not exists (
       select 1 from finance.disputes n
        where n.kind = d.kind and n.provider_ref = d.provider_ref and n.environment = d.environment and n.seq > d.seq
     )
$$;
revoke all on function finance.order_stopped_items(uuid) from public, anon, authenticated, service_role;

-- 2a. `finance.order_lines_to_ship` of 20261002145000_order_operations.sql,
--     which leaves out a line a dispute stopped. Otherwise identical:
--
-- Lines of a paid order still to ship: a physical or signed item whose
-- fulfilment is `preparing`, that is not fully refunded and that no dispute
-- stopped (`finance.order_stopped_items`). Zero for an order that is not
-- `paid` and for a digital-only one (no fulfilment rows).
create or replace function finance.order_lines_to_ship(p_order uuid)
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
     and f.order_item_id <> all (finance.order_stopped_items(p_order))
$$;
revoke all on function finance.order_lines_to_ship(uuid) from public, anon, authenticated, service_role;

-- 2b. `orders_list` of 20261002145000_order_operations.sql, whose `to_ship`
--     filter leaves out a line a dispute stopped. Otherwise identical:
--
-- One page of orders, newest first, for owner and operations. `p_filter` is one
-- of all, paid, to_ship, needs_resolution, pending, refunded, review: `paid`,
-- `needs_resolution` (paid_needs_resolution), `pending` (pending_payment) and
-- `refunded` are the order's status, `to_ship` a paid order with a line still to
-- ship (being prepared, not fully refunded, not stopped by a dispute), `review`
-- an order with an open review payment. `p_query` is
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
create or replace function public.orders_list(p_filter text, p_query text, p_before timestamptz, p_limit integer)
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
                  and f.order_item_id <> all (finance.order_stopped_items(o.id))
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
revoke all on function public.orders_list(text, text, timestamptz, integer) from public, anon;
grant execute on function public.orders_list(text, text, timestamptz, integer) to authenticated;

-- 2c. `order_detail` of 20261002145000_order_operations.sql: each item says
--     whether a dispute stopped its shipping (`stopped`), for every staff role,
--     so operations see why it cannot ship; the `disputes` key stays the
--     owner's. Otherwise identical:
--
-- Everything the order screen shows, for owner and operations: the order with
-- its contact and delivery, its items (each with `stopped`), payment attempts
-- (provider ids, amounts, mode, source, fetch times), review payments, webhook
-- events (type, time, outcome), fulfilments, entitlements, refunds and
-- returns. For an owner only, also `disputes` and `audit` (the order's, its
-- refunds', returns' and review payments' audit rows): for operations those
-- keys are absent. No token, token hash, idempotency key, storage key or
-- invoice URL is in it.
-- {ok: true, order, items, attempts, reviews, events, fulfillments,
-- entitlements, refunds, returns[, disputes, audit]} or {ok: false, code:
-- 'NOT_FOUND'}.
-- ponytail: the audit read scans `public.audit_events` (no index on its
-- entity); an index belongs to a schema change, not to this migration.
create or replace function public.order_detail(p_order uuid)
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
  v_stopped uuid[];
begin
  v_role := finance.require_staff(false);
  select * into v_order from finance.orders o where o.id = p_order;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_stopped := finance.order_stopped_items(v_order.id);

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
                 'fullyRefunded', coalesce(finance.item_fully_refunded(i.id), false),
                 -- Shipping stopped by a dispute: every staff role sees it; the disputes stay the owner's.
                 'stopped', i.id = any (v_stopped)
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
revoke all on function public.order_detail(uuid) from public, anon;
grant execute on function public.order_detail(uuid) to authenticated;

-- 2d. `orders_alerts` of 20261007100000_fable_audit_payments.sql, whose
--     `toShip` leaves out a line a dispute stopped (the `to_ship` filter's
--     rule). Otherwise identical:
--
-- The admin home's alerts, for owner and operations: counts only, plus the
-- low-stock list. needsResolution: orders waiting for `order_resolve`; review:
-- open review payments; toShip: paid orders with a line still to ship (the
-- `to_ship` filter: being prepared, not fully refunded, not stopped by a
-- dispute); uncertainRefunds: refunds whose outcome is unknown, and
-- refunds still submitting that no check is scheduled for (the job stops
-- after 24 hours) or that the job parked for the other mode (MODE_CHANGED);
-- unverifiedAttempts: attempts the job could not verify (marked UNVERIFIED)
-- that no payment has settled and no answered recheck has cleared since, and
-- attempts with an invoice the job parked for the other mode (MODE_CHANGED,
-- the reconciliation screen's reason) that no payment has settled;
-- exhaustedEvents: webhook events the job gave up on, until the ledger settles
-- their payment or the owner dismisses them (`event_dismiss`); externalRefunds: paid attempts whose provider total is above the
-- ledger's confirmed plus in-flight refunds (a refund to record). lowStock: the
-- enabled, published, stocked variants at or under their threshold (not the
-- preorder ones: their stock is ignored), the fewest first, at most 100.
-- {needsResolution, review, toShip, uncertainRefunds, unverifiedAttempts,
-- exhaustedEvents, externalRefunds, lowStock: [{variantId, sku, title, stock,
-- threshold}]}; `title` is the product's.
-- ponytail: the stopped items are read once per line being prepared; a store
-- with thousands of open lines would read them once per order instead.
create or replace function public.orders_alerts()
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
         and f.order_item_id <> all (finance.order_stopped_items(f.order_id))
    ),
    'uncertainRefunds', (
      select count(*) from finance.refunds r
       where r.status = 'uncertain'
          or (r.status = 'submitting' and (r.next_check_at is null or r.error = 'MODE_CHANGED'))
    ),
    'unverifiedAttempts', (
      select count(*) from finance.payment_attempts a
       where a.status not in ('paid', 'review')
         and (a.last_error = 'UNVERIFIED' or (a.last_error = 'MODE_CHANGED' and a.provider_invoice_id is not null))
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
revoke all on function public.orders_alerts() from public, anon;
grant execute on function public.orders_alerts() to authenticated;

-- 3. `fulfillment_update` of 20261002145000_order_operations.sql, with four
--    changes: an item that a refund in flight allocates is REFUND_IN_FLIGHT;
--    an item a dispute stopped is not shipped (FULFILLMENT_STOPPED); when every
--    named item has shipped, another carrier or tracking is a correction, not
--    a BAD_TRANSITION; and the `order_shipped` mail renews the order's link so
--    that it opens. Otherwise identical:
--
-- Moves items of a paid order forward: preparing -> shipped -> delivered, never
-- back and never skipping `shipped`. `shipped` needs a carrier (at most 80
-- characters) and a tracking value (at most 120), trimmed, one line each (a
-- malformed one raises 22023); a signed item needs `dedication_done` first:
-- the call's `p_dedication_done` (null leaves it as it is) is applied to the
-- signed items still being prepared, so a call with `preparing` and
-- `p_dedication_done` only ticks the checklist, and one with `shipped` may tick
-- and ship together. `delivered` ignores carrier and tracking. Every id must be
-- the fulfilment of an item of this order, once (a digital item has none:
-- INVALID_ITEMS); a fully refunded item still being prepared is ITEM_REFUNDED,
-- and one that a refund in flight (submitting or uncertain) allocates is
-- REFUND_IN_FLIGHT; a move that is not forward, or a repeat of `shipped` with
-- another carrier or tracking in a call that also names an item that has not
-- shipped, is BAD_TRANSITION; an item a dispute stopped
-- (`finance.order_stopped_items`) is FULFILLMENT_STOPPED for `shipped`; a
-- signed item without `dedication_done` is DEDICATION_NOT_DONE; an order that
-- is not `paid` is ORDER_NOT_PAID. The call is all or nothing. A repeat of a
-- call that already holds (the same state, and for `shipped` the same carrier
-- and tracking) changes nothing and queues nothing. When every named item has
-- shipped and the carrier or tracking differ, the call corrects them: the rows
-- that differ take them, one audit row `fulfillment.corrected` with their ids
-- (never the text typed), no mail, and the reply adds `corrected: true`. One
-- `order_shipped` mail per call that moved something to shipped
-- (`order_shipped:<orderId>:<md5 of the moved item ids, sorted, joined by commas>`,
-- payload {orderId, itemIds}), with the order's link renewed to at least 7
-- days from now, and one audit row per call that changed anything.
-- {ok: true, changed, itemIds[, corrected]} where itemIds are the items that
-- changed, or {ok: false, code[, itemIds: the items at fault][, status]}.
create or replace function public.fulfillment_update(
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
  v_correct boolean;
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

  -- A correction: every named item has shipped already, so another carrier or
  -- tracking can only fix what was typed. It moves nothing and mails nothing.
  v_correct := p_state = 'shipped' and not exists (
    select 1 from finance.fulfillments f
     where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state <> 'shipped'
  );

  -- Forward moves only; what already holds is a repeat, not a move.
  select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
    from finance.fulfillments f
   where f.order_id = p_order and f.order_item_id = any (p_item_ids)
     and not case p_state
           when 'preparing' then f.state = 'preparing'
           when 'shipped' then f.state = 'preparing' or v_correct
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
    -- A refund in flight that allocates the item may still take it
    -- (`refund_request` takes the order's lock too, so none begins while this
    -- runs): nothing of it moves until that refund is decided, within minutes.
    select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
      from finance.fulfillments f
     where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'preparing'
       and exists (
         select 1 from finance.refunds r
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(r.allocation -> 'items') = 'array' then r.allocation -> 'items' else '[]'::jsonb end
          ) x
          where r.order_id = p_order and r.attempt_id is not null and r.status in ('submitting', 'uncertain')
            and x ->> 'itemId' = f.order_item_id::text
       );
    if cardinality(v_bad) > 0 then
      return jsonb_build_object('ok', false, 'code', 'REFUND_IN_FLIGHT', 'itemIds', to_jsonb(v_bad));
    end if;
  end if;

  -- The correction itself: the rows that differ take the new carrier and
  -- tracking, under an audit row of their own, and no mail is queued.
  if v_correct then
    with moved as (
      update finance.fulfillments f
         set carrier = v_carrier, tracking = v_tracking,
             updated_by = (select auth.uid()), version = f.version + 1, updated_at = now()
       where f.order_id = p_order and f.order_item_id = any (p_item_ids)
         and (f.carrier is distinct from v_carrier or f.tracking is distinct from v_tracking)
      returning f.order_item_id
    )
    select coalesce(array_agg(m.order_item_id order by m.order_item_id), '{}') into v_done from moved m;
    if cardinality(v_done) = 0 then
      return jsonb_build_object('ok', true, 'changed', 0, 'itemIds', to_jsonb(v_done));
    end if;
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values ((select auth.uid()), 'fulfillment.corrected', 'order', p_order::text,
            jsonb_build_object('orderNumber', v_order.order_number, 'itemIds', to_jsonb(v_done)));
    return jsonb_build_object('ok', true, 'changed', cardinality(v_done), 'itemIds', to_jsonb(v_done), 'corrected', true);
  end if;

  if p_state = 'shipped' then
    -- An item a dispute stopped is not shipped while that dispute's latest row
    -- says so (`finance.order_stopped_items`).
    select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
      from finance.fulfillments f
     where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state = 'preparing'
       and f.order_item_id = any (finance.order_stopped_items(p_order));
    if cardinality(v_bad) > 0 then
      return jsonb_build_object('ok', false, 'code', 'FULFILLMENT_STOPPED', 'itemIds', to_jsonb(v_bad));
    end if;

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
      -- The mail links to the order page, whose link expired 7 days after the
      -- payment: it is renewed so that the link opens, and never shortened.
      update finance.orders o
         set access_token_expires_at = greatest(o.access_token_expires_at, now() + interval '7 days'), updated_at = now()
       where o.id = p_order;
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
revoke all on function public.fulfillment_update(uuid, uuid[], text, text, text, boolean) from public, anon;
grant execute on function public.fulfillment_update(uuid, uuid[], text, text, text, boolean) to authenticated;

-- 4. `finance.refund_succeed` of 20261002170000_stats_disputes.sql, with one
--    change: with the `order_refunded` mail, the order's link is renewed to at
--    least 7 days from now, so that the mail's link opens (it expired 7 days
--    after the payment). Otherwise identical:
--
-- The success effects, in one place, shared by `refund_result`,
-- `refund_settle` and `refund_record_external`. The caller holds every lock of
-- the refund (`finance.refund_lock` with effects) and has checked that the
-- refund may succeed. Marks the refund succeeded and then:
-- - a paying attempt: its provider total; the order becomes `refunded` when the
--   confirmed refunds equal the captured amount; an entitlement is revoked
--   (`finance.entitlements_revoke`) for an item whose refunded total is above
--   zero and equals what it cost, and for every item (a zero-paid one
--   included) once the order is refunded (`finance.item_fully_refunded` is
--   that rule); the preorder reservations of such items are released, so
--   their capacity is free again; a linked return becomes `refunded`; one
--   `order_refunded` mail, and the order's link renewed. Stock is never
--   touched: an unshipped refunded unit goes back on sale only when the owner
--   edits it.
-- - a review payment: its provider total, and the row is closed when its
--   refunds equal its amount. The order is never touched.
-- One audit row, named by the caller (`refund.succeeded`, `refund.external`,
-- `refund.late_applied`), without a contact detail.
create or replace function finance.refund_succeed(p_refund uuid, p_after integer, p_actor uuid, p_audit text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_refund finance.refunds;
  v_order finance.orders;
  v_attempt finance.payment_attempts;
  v_review finance.payment_reviews;
  v_confirmed integer;
begin
  update finance.refunds r
     set status = 'succeeded', succeeded_at = coalesce(r.succeeded_at, now()), provider_refunded_after = p_after,
         error = null, next_check_at = null, updated_at = now()
   where r.id = p_refund
  returning * into v_refund;

  if v_refund.attempt_id is not null then
    update finance.payment_attempts a
       set provider_refunded_halalas = greatest(a.provider_refunded_halalas, p_after), updated_at = now()
     where a.id = v_refund.attempt_id
    returning * into v_attempt;
    select coalesce(sum(r.amount_halalas), 0)::integer into v_confirmed
      from finance.refunds r where r.attempt_id = v_attempt.id and r.status = 'succeeded';
    select * into v_order from finance.orders o where o.id = v_refund.order_id;
    if v_confirmed >= v_attempt.captured_halalas and v_order.status in ('paid', 'paid_needs_resolution') then
      update finance.orders o set status = 'refunded', version = o.version + 1, updated_at = now() where o.id = v_order.id;
    end if;
    perform finance.entitlements_revoke(
      v_order.id,
      array(
        select e.order_item_id from finance.entitlements e
         where e.order_id = v_order.id and e.revoked_at is null
           and coalesce(finance.item_fully_refunded(e.order_item_id), false)
      ),
      'refund'
    );
    update finance.inventory_reservations x
       set state = 'released', released_at = now()
     where x.order_id = v_order.id and x.preorder and x.state <> 'released'
       and x.variant_id in (
         select i.variant_id from finance.order_items i
          where i.order_id = v_order.id and coalesce(finance.item_fully_refunded(i.id), false)
       );
    if v_refund.return_id is not null then
      update finance.return_requests q
         set state = 'refunded', refund_id = v_refund.id, updated_at = now()
       where q.id = v_refund.return_id and q.state = 'received' and q.refund_id is null;
    end if;
    insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
    values ('order_refunded:' || v_refund.id::text, 'order_refunded', 0, lower(btrim(v_order.customer_email)),
            jsonb_build_object('orderId', v_order.id, 'refundId', v_refund.id))
    on conflict (dedupe_key) do nothing;
    -- The mail links to the order page: its link is renewed so that it opens,
    -- and never shortened.
    update finance.orders o
       set access_token_expires_at = greatest(o.access_token_expires_at, now() + interval '7 days'), updated_at = now()
     where o.id = v_order.id;
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (p_actor, p_audit, 'refund', v_refund.id::text,
            jsonb_build_object('amount', v_refund.amount_halalas, 'source', v_refund.source,
                               'orderNumber', v_order.order_number, 'attemptId', v_attempt.id));
  else
    update finance.payment_reviews pr
       set provider_refunded_halalas = greatest(pr.provider_refunded_halalas, p_after)
     where pr.provider_payment_id = v_refund.review_payment_id
    returning * into v_review;
    select coalesce(sum(r.amount_halalas), 0)::integer into v_confirmed
      from finance.refunds r where r.review_payment_id = v_review.provider_payment_id and r.status = 'succeeded';
    if v_confirmed >= coalesce(v_review.amount_halalas, 0) then
      update finance.payment_reviews pr
         set closed_at = coalesce(pr.closed_at, now()), closed_reason = coalesce(pr.closed_reason, 'refunded')
       where pr.provider_payment_id = v_review.provider_payment_id;
    end if;
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (p_actor, p_audit, 'refund', v_refund.id::text,
            jsonb_build_object('amount', v_refund.amount_halalas, 'source', v_refund.source,
                               'paymentId', v_review.provider_payment_id));
  end if;
end
$$;
revoke all on function finance.refund_succeed(uuid, integer, uuid, text) from public, anon, authenticated, service_role;

-- 5. `refund_request` of 20261002130000_refunds.sql, with one more refusal:
--    CHARGEBACK_RECORDED. Otherwise identical:
--
-- Reserves the balance for one refund, under the locks. `p_provider_refunded`
-- is the payment's `refunded` total the Edge Function fetched a moment ago.
-- A paid attempt whose chargeback the seller lost (the latest row of a
-- `chargeback` reference of the attempt is `against_seller`) is
-- CHARGEBACK_RECORDED, after the provider's total and before the balance.
-- Business refusals are replies; a caller that is not an active owner, or a
-- malformed call, raises.
create or replace function public.refund_request(
  p_actor uuid, p_order uuid, p_attempt uuid, p_review_payment text, p_amount integer, p_reason text,
  p_allocation jsonb, p_idempotency_key uuid, p_request_hash text, p_return uuid, p_provider_refunded integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_attempt finance.payment_attempts;
  v_review finance.payment_reviews;
  v_existing finance.refunds;
  v_return finance.return_requests;
  v_allocation jsonb := coalesce(p_allocation, '{}'::jsonb);
  v_captured integer;
  v_confirmed integer;
  v_in_flight boolean;
  v_id uuid;
begin
  if not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  if (p_attempt is null) = (p_review_payment is null) or p_amount is null or p_amount < 1
    or p_reason is null or char_length(p_reason) not between 1 and 300 or p_reason ~ '[[:cntrl:]]'
    or p_idempotency_key is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_provider_refunded is null or p_provider_refunded < 0
  then
    raise exception 'Invalid refund.' using errcode = 'invalid_parameter_value';
  end if;

  -- The target and its locks: the order, then the attempt (or the review
  -- payment, alone when it has no order). The order is read without a lock
  -- first and the target again under the lock.
  if p_attempt is not null then
    select a.order_id into v_order_id from finance.payment_attempts a where a.id = p_attempt;
    if not found or p_order is distinct from v_order_id then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    perform 1 from finance.orders o where o.id = v_order_id for update;
    select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;
  else
    select pr.order_id into v_order_id from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment;
    if not found or (p_order is not null and p_order is distinct from v_order_id) then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    if v_order_id is not null then
      perform 1 from finance.orders o where o.id = v_order_id for update;
    end if;
    select * into v_review from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment for update;
    -- A review payment can be linked to its order after the first read; its refund row says so.
    v_order_id := v_review.order_id;
  end if;

  -- The same key and the same request is the same refund, whatever has
  -- happened to it since: nothing else happens. The same key for another
  -- request is a conflict.
  select * into v_existing from finance.refunds r where r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is not distinct from p_request_hash
      and v_existing.attempt_id is not distinct from p_attempt
      and v_existing.review_payment_id is not distinct from p_review_payment
    then
      return jsonb_build_object(
        'ok', true, 'state', 'duplicate', 'refundId', v_existing.id, 'status', v_existing.status,
        'amount', v_existing.amount_halalas
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  -- A paid attempt, or a review payment that is not closed as refunded (one
  -- the owner closed by hand can still be refunded).
  if p_attempt is not null then
    if v_attempt.status <> 'paid' then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    v_captured := coalesce(v_attempt.captured_halalas, 0);
    select coalesce(sum(r.amount_halalas) filter (where r.status = 'succeeded'), 0)::integer,
           coalesce(bool_or(r.status in ('submitting', 'uncertain')), false)
      into v_confirmed, v_in_flight
      from finance.refunds r where r.attempt_id = p_attempt;
  else
    if v_review.closed_at is not null and v_review.closed_reason is not distinct from 'refunded' then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    v_captured := coalesce(v_review.amount_halalas, 0);
    select coalesce(sum(r.amount_halalas) filter (where r.status = 'succeeded'), 0)::integer,
           coalesce(bool_or(r.status in ('submitting', 'uncertain')), false)
      into v_confirmed, v_in_flight
      from finance.refunds r where r.review_payment_id = p_review_payment;
  end if;

  -- Checked first: an unsettled refund of our own is never mistaken for one
  -- made outside.
  if v_in_flight then
    return jsonb_build_object('ok', false, 'code', 'REFUND_IN_FLIGHT');
  end if;

  if p_attempt is not null then
    update finance.payment_attempts a
       set provider_refunded_halalas = greatest(a.provider_refunded_halalas, p_provider_refunded), updated_at = now()
     where a.id = p_attempt;
  else
    update finance.payment_reviews pr
       set provider_refunded_halalas = greatest(pr.provider_refunded_halalas, p_provider_refunded)
     where pr.provider_payment_id = p_review_payment;
  end if;
  -- A refund exists at the provider that the ledger does not hold (the owner
  -- records it first), or the provider shows less than the ledger.
  if p_provider_refunded > v_confirmed then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_AHEAD');
  end if;
  if p_provider_refunded < v_confirmed then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_BEHIND');
  end if;
  -- A chargeback the seller lost has already given the money back through the
  -- card's bank: a refund would pay it twice. A dispute's current state is its
  -- reference's latest row, so a later row for the seller lifts this.
  if p_attempt is not null and exists (
    select 1 from finance.disputes d
     where d.attempt_id = p_attempt and d.kind = 'chargeback' and d.direction = 'against_seller'
       and not exists (
         select 1 from finance.disputes n
          where n.kind = d.kind and n.provider_ref = d.provider_ref and n.environment = d.environment and n.seq > d.seq
       )
  ) then
    return jsonb_build_object('ok', false, 'code', 'CHARGEBACK_RECORDED');
  end if;
  if v_confirmed::bigint + p_amount > v_captured then
    return jsonb_build_object('ok', false, 'code', 'EXCEEDS_BALANCE');
  end if;

  if p_attempt is not null then
    if not finance.refund_allocation_ok(v_order_id, p_attempt, p_amount, v_allocation) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ALLOCATION');
    end if;
  elsif v_allocation <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ALLOCATION');
  end if;

  -- A return that was received and has no refund yet (a review payment's
  -- refund never moves an order, so it links to none).
  if p_return is not null then
    if p_attempt is null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_RETURN');
    end if;
    select * into v_return from finance.return_requests q where q.id = p_return and q.order_id = v_order_id for update;
    if not found or v_return.state <> 'received' or v_return.refund_id is not null then
      return jsonb_build_object('ok', false, 'code', 'INVALID_RETURN');
    end if;
  end if;

  insert into finance.refunds (
    order_id, attempt_id, review_payment_id, amount_halalas, reason, allocation, status, idempotency_key, request_hash,
    source, provider_refunded_before, provider_refunded_origin, return_id, requested_by, next_check_at
  )
  values (
    v_order_id, p_attempt, p_review_payment, p_amount, p_reason, v_allocation, 'submitting', p_idempotency_key,
    p_request_hash, 'admin', p_provider_refunded, p_provider_refunded, p_return, p_actor, now() + interval '1 minute'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  -- The lookup above is serialised by this target's locks only: the same key sent at the same moment for another
  -- target is found here, by the unique index, once that request has committed.
  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'refund.requested', 'refund', v_id::text,
          jsonb_build_object('amount', p_amount, 'attemptId', p_attempt, 'paymentId', p_review_payment));
  return jsonb_build_object(
    'ok', true, 'state', 'new', 'refundId', v_id,
    'providerPaymentId', coalesce(v_attempt.provider_payment_id, p_review_payment), 'amount', p_amount
  );
end
$$;
revoke all on function public.refund_request(uuid, uuid, uuid, text, integer, text, jsonb, uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.refund_request(uuid, uuid, uuid, text, integer, text, jsonb, uuid, text, uuid, integer) to service_role;

-- 6. `finance.checkout_price` of 20261002110000_checkout_payment.sql: a
--    digital line of a quantity other than 1 is INVALID_QUANTITY (the shape of
--    the quantity refusal, with its line and variant), once the variant is
--    known to be for sale. Otherwise identical:
--
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
    -- A digital line is one copy: the order grants one entitlement per line, so
    -- a quantity above one would be charged for copies never given.
    if v_row.fulfillment = 'digital' and v_qty <> 1 then
      v_errors := v_errors || jsonb_build_object('code', 'INVALID_QUANTITY', 'line', v_index, 'variantId', v_variant_id);
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
revoke all on function finance.checkout_price(jsonb, text, text) from public, anon, authenticated, service_role;

-- 7a. `commerce_settings_get` of 20260927130000_commerce_settings.sql, with
--     two more keys. `checkoutOpen` is the cart's own rule (`checkout_quote`'s
--     `checkoutEnabled`, 20261002110000_checkout_payment.sql: the switch on,
--     the seller named and registered, the policies approved), so the admin
--     never says open while a policy change has closed the store;
--     `checkoutClosedReason` is null while it is open, else the first that
--     applies of SWITCH_OFF, SELLER_UNSET and POLICIES_UNAPPROVED. Otherwise
--     identical:
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
    end
  );
end
$$;
revoke all on function public.commerce_settings_get() from public, anon;
grant execute on function public.commerce_settings_get() to authenticated;

-- 7b. The policy trigger of 20260930120000_audit_fixes.sql, with one change:
--     a reset made while checkout is switched on queues one owner alert
--     `policies_reset` (`finance.owner_alert`, payload {policy, seq}), keyed by
--     the policy and its new seq (`removed` when the policy was taken down).
--     No SQL lists the alert kinds: `alert_email_data` answers an unknown one
--     with its code alone. Otherwise identical:
--
-- X1.1: what a buyer reads and accepts is what the owner approved. A
-- change to an approved policy document (a new seq, or removal) closes
-- checkout (POLICIES_NOT_CONFIGURED) until the owner approves again.
-- Republishing the approved seq changes nothing. One trigger on the live
-- copy covers publish_version, publish_due and any other writer.
create or replace function public.policies_reset_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection text;
  v_doc text;
  v_seq integer;
  v_open boolean;
begin
  if tg_op = 'DELETE' then
    v_collection := old.collection::text;
    v_doc := old.doc_id;
  else
    v_collection := new.collection::text;
    v_doc := new.doc_id;
    v_seq := new.seq;
  end if;
  if v_collection <> 'policies' then
    return null;
  end if;
  update finance.commerce_settings
     set policy_revisions = '{}'::jsonb, version = version + 1
   where id = 1
     and policy_revisions ? v_doc
     and (policy_revisions ->> v_doc) is distinct from v_seq::text
  returning checkout_enabled into v_open;
  if found then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('commerce.policies_reset', 'commerce_settings', '1', jsonb_build_object('policy', v_doc, 'seq', v_seq));
    -- The switch is on, so the store has just closed while the admin's switch
    -- still says open: the owners are told, once per change. A removed policy
    -- has no seq.
    if v_open then
      perform finance.owner_alert(
        'policies_reset', v_doc || ':' || coalesce(v_seq::text, 'removed'), jsonb_build_object('policy', v_doc, 'seq', v_seq)
      );
    end if;
  end if;
  return null;
end
$$;
revoke all on function public.policies_reset_approval() from public, anon, authenticated;

-- 8. `outbox_claim` of 20261002120000_order_emails.sql, with two changes:
--    the suppression list never holds back a contact notice or an owner
--    alert, and priority 0 stops five sends before the daily quota. Otherwise
--    identical:
--
-- Section 8 of the contract: three tiers instead of two, by the row's priority.
-- Priority 0 (receipt, order_shipped, order_refunded, order_ready, owner_alert:
-- only a payment or a staff action causes them) goes while the day's sends are
-- under p_daily_quota - 5: the Resend account also sends Supabase Auth's
-- sign-in codes, which the outbox never sees, so the last five sends of the
-- day are kept for them; priority 1 (contact_notice, order_link) only under
-- p_daily_quota - p_reserve; priority 2 (notify_confirm, availability) only
-- under p_daily_quota - p_reserve - p_low_reserve. So availability notices wait
-- before recovery links, and those before receipts. On top of the tiers a day
-- sends at most 20 order links and 30 confirmation mails, so neither can take
-- the whole band; a kind at its cap waits for the next UTC day and the others
-- still go. Contact notices have no cap here: `contact_submit` takes at most 40
-- messages a day, and one message is a notice to each active recipient. Like the daily quota these are counted from
-- the sends already made: a batch claimed at once (p_limit above 1) could
-- overshoot them, and the dispatcher claims one row at a time.
--
-- Otherwise identical to 20260930120000_audit_fixes.sql, including the leases,
-- the attempts cap, the 23-hour idempotency window, the suppressions (a
-- buyer's mail to a suppressed address is suppressed; staff mail is not) and
-- the monthly quota. A notice or an alert queued for someone who is no longer
-- an active owner (an owner or operations member for a contact notice) is
-- exhausted, not sent.
create or replace function public.outbox_claim(
  p_limit integer, p_lease_seconds integer, p_daily_quota integer, p_reserve integer,
  p_monthly_quota integer default 3000, p_low_reserve integer default 30
)
returns table (
  id bigint, lease_id uuid, kind text, recipient text, payload jsonb, idempotency_key uuid, attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease uuid := gen_random_uuid();
  v_sent_today integer;
  v_sent_month integer;
  v_link_today integer;
  v_confirm_today integer;
begin
  with expired as (
    update finance.email_outbox o
    set status = case when o.attempts >= o.max_attempts then 'exhausted' else 'uncertain' end,
        next_at = now() + make_interval(mins => least(power(2, o.attempts), 60)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where o.status = 'sending' and o.lease_until < now()
    returning o.id, o.status, o.attempts, o.last_error
  )
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'email.exhausted', 'email_outbox', e.id::text,
         jsonb_build_object('status', 'sending', 'attempts', e.attempts, 'lastError', e.last_error)
  from expired e
  where e.status = 'exhausted';

  -- Staff mail is never held back by the list: a contact notice or an owner
  -- alert goes out, and a refusal exhausts it through the normal path, which
  -- the owner home counts.
  update finance.email_outbox o
  set status = 'suppressed', updated_at = now()
  where o.status in ('pending', 'uncertain')
    and o.kind not in ('contact_notice', 'owner_alert')
    and exists (
      select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(o.recipient)
    );

  with gone as (
    update finance.email_outbox o
    set status = 'exhausted', last_error = 'RECIPIENT_INACTIVE', updated_at = now()
    where o.kind in ('contact_notice', 'owner_alert')
      and o.status in ('pending', 'uncertain')
      and not exists (
        select 1
        from public.staff s
        join auth.users u on u.id = s.user_id
        where s.active and lower(u.email) = o.recipient
          and (s.role = 'owner' or (o.kind = 'contact_notice' and s.role = 'operations'))
      )
    returning o.id, o.attempts
  )
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'email.exhausted', 'email_outbox', g.id::text,
         jsonb_build_object('attempts', g.attempts, 'lastError', 'RECIPIENT_INACTIVE')
  from gone g;

  -- One range scan of email_outbox_sent_at_idx: today lies inside this month,
  -- so the month bound covers every count. Resend's quotas are UTC days and
  -- months, so the bounds are pinned to UTC, not the session time zone.
  select count(*) filter (where o.sent_at >= date_trunc('day', now(), 'UTC')),
         count(*) filter (where o.sent_at >= date_trunc('day', now(), 'UTC') and o.kind = 'order_link'),
         count(*) filter (where o.sent_at >= date_trunc('day', now(), 'UTC') and o.kind = 'notify_confirm'),
         count(*)
  into v_sent_today, v_link_today, v_confirm_today, v_sent_month
  from finance.email_outbox o
  where o.sent_at >= date_trunc('month', now(), 'UTC');

  return query
  with due as (
    select o.id from finance.email_outbox o
    where o.next_at <= now()
      and o.attempts < o.max_attempts
      and (
        o.status = 'pending'
        or (o.status = 'uncertain' and o.first_attempt_at > now() - interval '23 hours')
      )
      and v_sent_today < p_daily_quota - case o.priority when 0 then 5 when 1 then p_reserve else p_reserve + p_low_reserve end
      and (o.kind <> 'order_link' or v_link_today < 20)
      and (o.kind <> 'notify_confirm' or v_confirm_today < 30)
      and v_sent_month < p_monthly_quota
    order by o.priority, o.next_at, o.id
    limit p_limit
    for update skip locked
  )
  update finance.email_outbox o
  set status = 'sending',
      lease_id = v_lease,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      attempts = o.attempts + 1,
      first_attempt_at = coalesce(o.first_attempt_at, now()),
      updated_at = now()
  from due
  where o.id = due.id
  returning o.id, o.lease_id, o.kind, o.recipient, o.payload, o.idempotency_key, o.attempts;
end
$$;
revoke all on function public.outbox_claim(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.outbox_claim(integer, integer, integer, integer, integer, integer) to service_role;

-- 9. `outbox_result` of 20260930140000_audit2_fixes.sql: a PROVIDER_CONFIG
--    retry (the account refused the call: a revoked key or an unverified
--    domain, which no retry of this row can fix) is treated like a QUOTA one:
--    the attempt is given back, so the row never exhausts while the owner
--    fixes the account, and a refused first attempt starts no idempotency
--    window; it waits 15 minutes instead of the next UTC day, stays pending
--    (uncertain only past the 23-hour window, as for QUOTA) and keeps
--    PROVIDER_CONFIG as its last error. Otherwise identical:
--
-- Two fixes in outbox_result; otherwise identical to 20260930120000_audit_fixes.sql.
--
-- S04.2 follow-up: when the only attempt so far (attempts = 1) was refused
-- with a QUOTA 429, nothing reached the provider, so no idempotency window
-- has started for this key. first_attempt_at is cleared and the window starts
-- at the next real attempt. Left set, a quota wait of a day or more made the
-- next ambiguous send look older than 23 hours, and a person had to confirm a
-- duplicate risk that did not exist. It is kept when attempts > 1, because an
-- earlier attempt may have been sent.
--
-- S04.4 follow-up: the accept reads the delivery events in its UPDATE and the
-- webhook (email_event_record) reads provider_id in its own, each with its own
-- statement snapshot, so two overlapping transactions each missed the other's
-- uncommitted write and the event was applied to no row. Both take this
-- per-message advisory lock first (before any row lock), so the second runs
-- its statements after the first has committed.
create or replace function public.outbox_result(
  p_id bigint, p_lease_id uuid, p_outcome text, p_provider_id text, p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
  v_next timestamptz := date_trunc('day', now(), 'UTC') + interval '1 day';
begin
  if p_outcome = 'accepted' and p_provider_id is not null then
    perform pg_advisory_xact_lock(hashtext('email:' || p_provider_id));
  end if;
  select * into o from finance.email_outbox where id = p_id and lease_id = p_lease_id and status = 'sending' for update;
  if not found then
    return false;
  end if;
  if p_outcome = 'accepted' then
    update finance.email_outbox
    set status = 'sent', sent_at = now(), provider_id = p_provider_id, last_error = null,
        delivery = (
          select case e.type
                   when 'email.complained' then 'complained'
                   when 'email.bounced' then 'bounced'
                   when 'email.failed' then 'failed'
                   when 'email.suppressed' then 'failed'
                   when 'email.delivered' then 'delivered'
                   when 'email.delivery_delayed' then 'delayed'
                 end
          from finance.email_delivery_events e
          where e.provider_message_id = p_provider_id
            and e.type in ('email.complained', 'email.bounced', 'email.failed', 'email.suppressed',
                           'email.delivered', 'email.delivery_delayed')
          order by case e.type
                     when 'email.complained' then 1
                     when 'email.bounced' then 2
                     when 'email.failed' then 3
                     when 'email.suppressed' then 3
                     when 'email.delivered' then 4
                     else 5
                   end,
                   e.received_at desc
          limit 1
        ),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' and p_error in ('QUOTA', 'PROVIDER_CONFIG') then
    if p_error = 'PROVIDER_CONFIG' then
      v_next := now() + interval '15 minutes';
    end if;
    update finance.email_outbox
    set status = case when o.attempts > 1 and v_next > o.first_attempt_at + interval '23 hours'
                      then 'uncertain' else 'pending' end,
        attempts = o.attempts - 1, last_error = p_error, next_at = v_next,
        first_attempt_at = case when o.attempts = 1 then null else o.first_attempt_at end,
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'uncertain' and o.attempts >= o.max_attempts then
    update finance.email_outbox
    set status = 'exhausted', last_error = left(p_error, 120),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('email.exhausted', 'email_outbox', p_id::text,
            jsonb_build_object('status', 'uncertain', 'attempts', o.attempts, 'lastError', left(p_error, 120)));
  elsif p_outcome = 'uncertain' then
    update finance.email_outbox
    set status = 'uncertain', last_error = left(p_error, 120),
        next_at = now() + make_interval(mins => least(power(2, o.attempts), 60)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' and o.attempts < o.max_attempts then
    update finance.email_outbox
    set status = 'pending', last_error = left(p_error, 120),
        next_at = now() + make_interval(mins => power(2, o.attempts)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome in ('retry', 'permanent') then
    update finance.email_outbox
    set status = 'exhausted', last_error = left(p_error, 120),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('email.exhausted', 'email_outbox', p_id::text,
            jsonb_build_object('status', p_outcome, 'attempts', o.attempts, 'lastError', left(p_error, 120)));
  else
    raise exception 'Unknown outcome.' using errcode = 'invalid_parameter_value';
  end if;
  return true;
end
$$;
revoke all on function public.outbox_result(bigint, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.outbox_result(bigint, uuid, text, text, text) to service_role;

-- 10. Ends every session of a staff member: the `staff-admin` function runs it
--     when the owner revokes a member, since revoking (`active = false`) never
--     ended the member's sessions and a refresh token kept renewing their
--     access. Deletes the member's Auth refresh tokens (`user_id` is a varchar
--     there) and sessions, as `privacy_erase_staff` does; an access token
--     already issued lives until it expires, and every staff function rechecks
--     the member's active row meanwhile. Answers how many sessions it ended.
--     The server's only (`service_role`).
create function public.staff_sessions_end(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.staff_sessions_end(uuid) from public, anon, authenticated;
grant execute on function public.staff_sessions_end(uuid) to service_role;

-- 11. The owner re-sends an order's link, rotates it, and corrects a mistyped
--     address: until now only recovery (to the address the order already has),
--     `paid_asset_set` and `order_resolve` renewed a link. The Edge Function
--     derives the next version's token from the order's key, as recovery does
--     (`recoveryItems`), and hands only its peppered hash. For a paid,
--     under-review or refunded order, under the order's lock: the version must
--     be the order's next one (VERSION_MISMATCH otherwise, so two calls at once
--     agree on one token); the old token dies and the new one lives 7 days. A
--     new address (`p_email`; null keeps the order's) is checked like
--     checkout's (lower, trimmed, the same shape: INVALID_EMAIL otherwise) and
--     replaces the order's address and its hash. One `order_link` mail to the
--     order's (new) address, keyed like recovery's
--     (`order_link:<orderId>:<version>:<UTC day>`, priority 1). Audit
--     `order.link_reissued` with the order number and whether the address
--     changed, never the address. Owner only (42501 for anyone else, before
--     anything is read); a malformed version or hash raises 22023.
--     {ok: true, version, emailChanged} or {ok: false, code: NOT_FOUND |
--     BAD_STATUS (with `status`) | VERSION_MISMATCH | INVALID_EMAIL}.
create function public.order_link_reissue(p_order uuid, p_version integer, p_token_hash text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_email text := lower(btrim(p_email));
  v_changed boolean;
begin
  perform finance.require_staff(true);
  if p_version is null or p_version < 1 or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid link reissue.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_order from finance.orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status not in ('paid', 'paid_needs_resolution', 'refunded') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', v_order.status);
  end if;
  if p_version <> v_order.access_token_version + 1 then
    return jsonb_build_object('ok', false, 'code', 'VERSION_MISMATCH');
  end if;
  if v_email is not null and (
    char_length(v_email) not between 3 and 254
    or v_email !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EMAIL');
  end if;
  v_changed := v_email is not null and v_email <> lower(btrim(v_order.customer_email));

  update finance.orders o
     set access_token_hash = p_token_hash, access_token_version = p_version,
         access_token_expires_at = now() + interval '7 days',
         customer_email = case when v_changed then v_email else o.customer_email end,
         email_hash = case when v_changed then finance.recipient_hash(v_email) else o.email_hash end,
         updated_at = now()
   where o.id = p_order;
  insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
  values ('order_link:' || p_order::text || ':' || p_version::text || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
          'order_link', 1, case when v_changed then v_email else lower(btrim(v_order.customer_email)) end,
          jsonb_build_object('orderId', p_order))
  on conflict (dedupe_key) do nothing;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'order.link_reissued', 'order', p_order::text,
          jsonb_build_object('orderNumber', v_order.order_number, 'emailChanged', v_changed));
  return jsonb_build_object('ok', true, 'version', p_version, 'emailChanged', v_changed);
end
$$;
revoke all on function public.order_link_reissue(uuid, integer, text, text) from public, anon;
grant execute on function public.order_link_reissue(uuid, integer, text, text) to authenticated;

-- 12. `dispute_record` of 20261002170000_stats_disputes.sql, with one change:
--     a row whose decision is `entitlement_kept` gives back what an earlier
--     `entitlement_revoked` row of the same reference revoked, and its audit
--     row counts them (`restored`). Its `fulfillment_stopped` rows now stop
--     the shipping (section 1). Otherwise identical:
--
-- The owner records what Moyasar's emails and settlement files say about a
-- chargeback or a payout or fee difference; the API shows none of it. Rows are
-- append-only per reference (`kind`, `provider_ref`): `p_follows` is the seq of
-- the row this one follows (0 for the first), so the row's seq is `p_follows + 1`.
-- - Owner recheck from `p_actor` (42501), like `refund_request`; a malformed call
--   raises 22023 (a bad field, both targets, no target for a chargeback or an
--   `other`, items named for a decision that does not act on them or missing for
--   one that does).
-- - The target is a `paid` attempt (`NOT_FOUND` for an unknown one or one of the
--   other environment, `NOT_DISPUTABLE` when it is not paid) or a review payment
--   of `p_environment`; a payout or a fee difference may name none.
-- - A repeat: when the row at seq `p_follows + 1` already exists it is answered
--   (`duplicate: true`) before anything else is judged, and nothing changes, so a
--   repeated reconciliation never counts twice; two calls at once for the same
--   place end the same way (the unique key decides: one inserts, the other
--   answers that row). A row of the other environment at that place is
--   `REFERENCE_IN_USE`.
-- - A follow-up needs its predecessor in this environment (`NO_PREDECESSOR`) and
--   names the same target (the same attempt or review payment, or none when the
--   first row had none: `TARGET_MISMATCH`): a reference is one dispute about one
--   payment, so the order screen and the statistics read the same rows.
-- - `entitlement_revoked` names digital items of the target's order (each has an
--   entitlement) and revokes them through `finance.entitlements_revoke`;
--   `entitlement_kept` names none and grants again what the reference's earlier
--   `entitlement_revoked` rows revoked (revoked for the dispute, of items not
--   fully refunded); `fulfillment_stopped` names items whose fulfilment is still
--   `preparing`, which are not shipped while it is the reference's latest row
--   (`finance.order_stopped_items`); `INVALID_ITEMS` otherwise (an order the
--   target does not have included). A dispute never creates a refund and never
--   changes an attempt, an order's status, a fulfilment or stock.
-- Locks: the order row first when the target has an order, then the attempt (a
-- review payment's row in its place). A review payment can be linked to its
-- order between the first read and its lock; the order is then the row it has
-- after the lock, as in `refund_request`.
-- Audit `dispute.recorded`: the reference, the amount, the kind and the decision
-- (and for `entitlement_kept` how many entitlements it gave back, `restored`),
-- never the reason or the resolution. {ok: true, duplicate, dispute} with the row
-- as `finance.dispute_json` shows it, or {ok: false, code: NOT_FOUND |
-- NOT_DISPUTABLE | NO_PREDECESSOR | TARGET_MISMATCH | INVALID_ITEMS | REFERENCE_IN_USE}.
create or replace function public.dispute_record(
  p_actor uuid, p_kind text, p_provider_ref text, p_follows integer, p_attempt uuid, p_review_payment text,
  p_amount integer, p_direction text, p_occurred_on date, p_reason text, p_resolution text, p_decision text,
  p_item_ids uuid[], p_environment text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items uuid[] := coalesce(p_item_ids, '{}'::uuid[]);
  v_order_id uuid;
  v_attempt finance.payment_attempts;
  v_review finance.payment_reviews;
  v_reply jsonb;
  v_row finance.disputes;
  v_restored integer := 0;
begin
  if not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind is null or p_kind not in ('chargeback', 'payout_difference', 'fee_difference', 'other')
    or p_provider_ref is null or char_length(p_provider_ref) not between 1 and 120
    or p_provider_ref ~ '[[:cntrl:]]' or p_provider_ref <> btrim(p_provider_ref)
    or p_follows is null or p_follows not between 0 and 1000
    or p_amount is null or p_amount < 1
    or p_direction is null or p_direction not in ('against_seller', 'for_seller')
    or p_occurred_on is null or p_occurred_on > (now() at time zone 'Asia/Riyadh')::date
    or p_reason is null or char_length(p_reason) not between 1 and 500 or p_reason ~ '[[:cntrl:]]'
    or (p_resolution is not null and (char_length(p_resolution) not between 1 and 500 or p_resolution ~ '[[:cntrl:]]'))
    or p_decision is null or p_decision not in ('none', 'entitlement_revoked', 'entitlement_kept', 'fulfillment_stopped')
    or p_environment is null or p_environment not in ('test', 'live')
    -- At most one target; only a payout or a fee difference may name none.
    or (p_attempt is not null and p_review_payment is not null)
    or (p_attempt is null and p_review_payment is null and p_kind not in ('payout_difference', 'fee_difference'))
    or (p_review_payment is not null and char_length(p_review_payment) not between 1 and 120)
    -- The items: distinct, at most an order's lines, named exactly when the decision acts on them.
    or array_position(v_items, null) is not null
    or cardinality(v_items) > 50
    or cardinality(v_items) <> (select count(distinct i) from unnest(v_items) i)
    or (p_decision in ('entitlement_revoked', 'fulfillment_stopped')) <> (cardinality(v_items) > 0)
  then
    raise exception 'Invalid dispute.' using errcode = 'invalid_parameter_value';
  end if;

  -- The target and its locks: the order, then the attempt (or the review
  -- payment, alone when it has no order). The order is read without a lock first
  -- and the target again under the lock.
  if p_attempt is not null then
    select a.order_id into v_order_id
      from finance.payment_attempts a where a.id = p_attempt and a.environment = p_environment;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    perform 1 from finance.orders o where o.id = v_order_id for update;
    select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  elsif p_review_payment is not null then
    select pr.order_id into v_order_id
      from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment and pr.environment = p_environment;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    if v_order_id is not null then
      perform 1 from finance.orders o where o.id = v_order_id for update;
    end if;
    select * into v_review from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
    v_order_id := v_review.order_id;
  end if;

  v_reply := finance.dispute_place(p_kind, p_provider_ref, p_follows + 1, p_environment);
  if v_reply is not null then
    return v_reply;
  end if;
  if p_follows > 0 and not exists (
    select 1 from finance.disputes d
     where d.kind = p_kind and d.provider_ref = p_provider_ref and d.seq = p_follows and d.environment = p_environment
  ) then
    return jsonb_build_object('ok', false, 'code', 'NO_PREDECESSOR');
  end if;
  if p_follows > 0 and exists (
    select 1 from finance.disputes d
     where d.kind = p_kind and d.provider_ref = p_provider_ref and d.seq = p_follows
       and (d.attempt_id is distinct from p_attempt or d.review_payment_id is distinct from p_review_payment)
  ) then
    return jsonb_build_object('ok', false, 'code', 'TARGET_MISMATCH');
  end if;
  if p_attempt is not null and v_attempt.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'NOT_DISPUTABLE');
  end if;
  if p_decision = 'entitlement_revoked' then
    if v_order_id is null or exists (
      select 1 from unnest(v_items) i
       where not exists (select 1 from finance.entitlements e where e.order_id = v_order_id and e.order_item_id = i)
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
  elsif p_decision = 'fulfillment_stopped' then
    if v_order_id is null or exists (
      select 1 from unnest(v_items) i
       where not exists (
         select 1 from finance.fulfillments f where f.order_id = v_order_id and f.order_item_id = i and f.state = 'preparing'
       )
    ) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
  end if;

  insert into finance.disputes (
    kind, provider_ref, seq, attempt_id, review_payment_id, environment, amount_halalas, direction, occurred_on,
    reason, resolution, decision, item_ids, recorded_by
  )
  values (
    p_kind, p_provider_ref, p_follows + 1, p_attempt, p_review_payment, p_environment, p_amount, p_direction, p_occurred_on,
    p_reason, p_resolution, p_decision, v_items, p_actor
  )
  on conflict (kind, provider_ref, seq) do nothing
  returning * into v_row;
  if not found then
    -- Another call took this place meanwhile (the unique key decides, and a
    -- reference with no order has no lock to queue on): its row is the answer.
    return finance.dispute_place(p_kind, p_provider_ref, p_follows + 1, p_environment);
  end if;

  if p_decision = 'entitlement_revoked' then
    perform finance.entitlements_revoke(v_order_id, v_items, 'dispute');
  elsif p_decision = 'entitlement_kept' and v_order_id is not null then
    -- The files are kept after all: what an earlier row of this reference
    -- revoked is granted again, for the items of the order not fully refunded
    -- (a refund's revocation stands).
    update finance.entitlements e
       set revoked_at = null, revoke_reason = null
     where e.order_id = v_order_id and e.revoked_at is not null and e.revoke_reason = 'dispute'
       and e.order_item_id in (
         select unnest(d.item_ids) from finance.disputes d
          where d.kind = p_kind and d.provider_ref = p_provider_ref and d.environment = p_environment
            and d.seq < v_row.seq and d.decision = 'entitlement_revoked'
       )
       and not coalesce(finance.item_fully_refunded(e.order_item_id), false);
    get diagnostics v_restored = row_count;
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'dispute.recorded', 'dispute', v_row.id::text,
          jsonb_build_object('reference', p_provider_ref, 'amount', p_amount, 'kind', p_kind, 'decision', p_decision)
            || case when p_decision = 'entitlement_kept' then jsonb_build_object('restored', v_restored) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'duplicate', false, 'dispute', finance.dispute_json(v_row));
end
$$;
revoke all on function public.dispute_record(uuid, text, text, integer, uuid, text, integer, text, date, text, text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.dispute_record(uuid, text, text, integer, uuid, text, integer, text, date, text, text, text, uuid[], text) to service_role;

-- 13. `payment_attempt_checked` of 20261002145000_order_operations.sql, with
--     one change: a prompt the provider answered clears MODE_CHANGED as it
--     clears UNVERIFIED. The job parks work of the other mode with that mark
--     (20261007100000_fable_audit_payments.sql) and nothing cleared it: once the
--     owner switched the mode back and the recheck («أعد الفحص») found the
--     invoice unpaid, the attempt stayed on the reconciliation screen and in
--     the admin home's count, and its order was never erasable. A paid answer
--     settles the attempt as before. Otherwise identical:
--
-- Round 2's `payment_attempt_checked`, with one change: a prompt (the owner's
-- recheck, a callback, the return page) that the provider answered clears
-- `UNVERIFIED`, the mark the job leaves on an attempt it could not verify
-- before giving up. Until then nothing a person did could clear it. Everything
-- else is as round 2 wrote it.
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
    -- A prompt the provider answered is a verification: it clears the mark the job left when it gave up, and the one
    -- it left on work of the other mode (the key that answered is the configured one again).
    update finance.payment_attempts a
       set fetched_at = now(), updated_at = now(),
           last_error = case when p_ok and a.last_error in ('UNVERIFIED', 'MODE_CHANGED') then null else a.last_error end
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
revoke all on function public.payment_attempt_checked(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.payment_attempt_checked(uuid, text, boolean, text, text) to service_role;
