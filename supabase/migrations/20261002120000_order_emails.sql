-- P08 round 5: order mail (PLANS/P08-CONTRACT.md section 6, "Order mail", and
-- section 8, "Mail budget"). The earlier migrations stay untouched: the claim,
-- the replay and the attention view are replaced here and restate their grants.
--
-- - `order_email_data`, `notify_email_data` and `alert_email_data` hand the
--   dispatcher what a mail shows. The dispatcher derives every link's token
--   itself, from the order's idempotency key or the subscription id and a
--   version; no token is ever written to the database.
-- - `outbox_claim` gains the third tier and the per-kind daily caps, and the
--   inactive-recipient rule covers `owner_alert`; `outbox_replay` likewise.
-- - `outbox_attention` leaves out the rows the dispatcher closed because the
--   state moved on (an unsubscribe or a confirmation that came after the mail
--   was queued, a file revoked since): nothing is left for a person to do.

-- 1. Data for the mail ------------------------------------------------------

-- A payload id as a uuid, or null when it is not shaped like one: a payload is
-- written by our own SQL, but a row that cannot be rendered must never raise.
create function finance.uuid_or_null(p_text text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_text::uuid end
$$;

-- What every mail about an order shows, from the order's own snapshots (its
-- row, its items and the seller as they were when it was placed), so a later
-- price or title change never rewrites a receipt. `refund` only when a
-- succeeded refund of this order is asked for, `shipment` only when some of the
-- asked items are shipped or delivered (one call of `fulfillment_update` sets
-- one carrier and one tracking value for all its items). `idempotencyKey` and
-- `tokenVersion` let the dispatcher derive the order link's token. An unknown
-- order answers null.
create function public.order_email_data(p_order uuid, p_refund uuid default null, p_item_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_data jsonb;
  v_refund jsonb;
  v_shipment jsonb;
begin
  select * into v_order from finance.orders o where o.id = p_order;
  if not found then
    return null;
  end if;

  v_data := jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'environment', v_order.environment,
    'customerName', v_order.customer_name,
    'customerEmail', v_order.customer_email,
    'idempotencyKey', v_order.idempotency_key,
    'tokenVersion', v_order.access_token_version,
    'totals', jsonb_build_object(
      'subtotal', v_order.subtotal_halalas,
      'discount', v_order.discount_halalas,
      'shipping', v_order.shipping_halalas,
      'total', v_order.total_halalas
    ),
    'lines', coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'itemId', i.id,
                   'title', i.product_title,
                   'variantTitle', i.variant_title,
                   'quantity', i.quantity,
                   'total', i.line_subtotal_halalas - i.discount_halalas,
                   'fulfillment', i.fulfillment,
                   'preorder', case when i.preorder then jsonb_build_object('shipsOn', i.preorder_ships_on, 'note', i.preorder_note) end,
                   -- A line's file: true when its entitlement holds one, false when the entitlement still waits
                   -- for it (a digital preorder), null when nothing will hand one out (not digital, revoked, or a
                   -- refunded line that was never granted).
                   'hasFile', case when e.order_item_id is not null and e.revoked_at is null then e.asset_id is not null end
                 )
                 order by i.line_no
               )
          from finance.order_items i
          left join finance.entitlements e on e.order_item_id = i.id
         where i.order_id = v_order.id
      ),
      '[]'::jsonb
    ),
    'seller', v_order.seller,
    'paidAt', v_order.paid_at,
    -- Only the refunds of the paying attempt count; a review payment's never do.
    'refundedHalalas', (
      select coalesce(sum(r.amount_halalas), 0)::integer
        from finance.refunds r
       where r.order_id = v_order.id and r.attempt_id is not null and r.status = 'succeeded'
    )
  );

  if p_refund is not null then
    select jsonb_build_object('amount', r.amount_halalas) into v_refund
      from finance.refunds r
     where r.id = p_refund and r.order_id = v_order.id and r.status = 'succeeded';
    if v_refund is not null then
      v_data := v_data || jsonb_build_object('refund', v_refund);
    end if;
  end if;

  if p_item_ids is not null then
    select jsonb_build_object(
             'carrier', (array_agg(f.carrier order by i.line_no))[1],
             'tracking', (array_agg(f.tracking order by i.line_no))[1],
             'itemIds', jsonb_agg(f.order_item_id order by i.line_no)
           )
      into v_shipment
      from finance.fulfillments f
      join finance.order_items i on i.id = f.order_item_id
     where f.order_id = v_order.id and f.order_item_id = any (p_item_ids)
       and f.state in ('shipped', 'delivered') and f.carrier is not null and f.tracking is not null
    having count(*) > 0;
    if v_shipment is not null then
      v_data := v_data || jsonb_build_object('shipment', v_shipment);
    end if;
  end if;

  return v_data;
end
$$;

-- What a confirmation or an availability mail shows about a subscription. The
-- dispatcher rechecks `status` itself: a confirmation goes only while the row
-- is `pending`, an availability notice only while it is `confirmed`. Null when
-- the subscription is gone.
create function public.notify_email_data(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'status', n.status,
           'tokenVersion', n.token_version,
           'email', n.email,
           'productTitle', p.title,
           'variantTitle', v.title,
           'slug', p.slug
         )
    from public.notifications n
    join public.product_variants v on v.id = n.variant_id
    join public.products p on p.id = v.product_id
   where n.id = p_id
$$;

-- The few facts an owner alert shows, by alert type: the order number, a SKU
-- and its stock, amounts in halalas, the reason code. Never a buyer's contact
-- details, a token, a card, an address or a provider payload. Every alert name
-- the migrations write so far is covered, and the three the refund round will
-- (`refund_mismatch`, `refund_unverified`, `refund_total_decreased`, which carry
-- a `refundId`); an alert
-- not known here, or whose rows are gone, answers `{alert}` alone and the
-- dispatcher sends a generic line with its code.
create function public.alert_email_data(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alert text := p_payload ->> 'alert';
  v_attempt finance.payment_attempts;
  v_refund finance.refunds;
  v_review finance.payment_reviews;
  v_number text;
  v_total integer;
  v_facts jsonb;
begin
  select * into v_attempt from finance.payment_attempts a where a.id = finance.uuid_or_null(p_payload ->> 'attemptId');
  select * into v_refund from finance.refunds r where r.id = finance.uuid_or_null(p_payload ->> 'refundId');
  select * into v_review from finance.payment_reviews pr where pr.provider_payment_id = p_payload ->> 'paymentId';
  select o.order_number, o.total_halalas into v_number, v_total
    from finance.orders o
   where o.id = coalesce(
     finance.uuid_or_null(p_payload ->> 'orderId'), v_attempt.order_id, v_refund.order_id, v_review.order_id
   );

  v_facts := case v_alert
    when 'low_stock' then (
      select jsonb_build_object('sku', v.sku, 'stock', v.stock, 'threshold', v.low_stock_threshold)
        from public.product_variants v
       where v.id = finance.uuid_or_null(p_payload ->> 'variantId')
    )
    when 'needs_resolution' then jsonb_build_object('amount', v_total)
    when 'payment_review' then jsonb_build_object(
      'amount', v_review.amount_halalas, 'reason', v_review.reason, 'paymentId', v_review.provider_payment_id
    )
    when 'external_refund' then jsonb_build_object(
      'total', case when p_payload ->> 'total' ~ '^[0-9]{1,9}$' then (p_payload ->> 'total')::integer end
    )
    when 'provider_status' then jsonb_build_object('status', p_payload ->> 'status')
    when 'event_exhausted' then (
      select jsonb_build_object('eventType', e.type, 'paymentId', e.provider_payment_id)
        from finance.payment_events e
       where e.event_id = p_payload ->> 'eventId'
    )
    when 'attempt_unverified' then jsonb_build_object('amount', v_attempt.amount_halalas)
    when 'attempt_duplicate_invoices' then jsonb_build_object('amount', v_attempt.amount_halalas)
    when 'refund_mismatch' then jsonb_build_object('amount', v_refund.amount_halalas)
    when 'refund_unverified' then jsonb_build_object('amount', v_refund.amount_halalas)
    when 'refund_total_decreased' then jsonb_build_object('amount', v_refund.amount_halalas)
  end;
  if v_facts is null then
    return jsonb_build_object('alert', v_alert);
  end if;
  return jsonb_build_object('alert', v_alert, 'orderNumber', v_number) || v_facts;
end
$$;

-- 2. The outbox ---------------------------------------------------------------

-- Section 8 of the contract: three tiers instead of two, by the row's priority.
-- Priority 0 (receipt, order_shipped, order_refunded, order_ready, owner_alert:
-- only a payment or a staff action causes them) goes while the day's sends are
-- under p_daily_quota; priority 1 (contact_notice, order_link) only under
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
-- the attempts cap, the 23-hour idempotency window, the suppressions and the
-- monthly quota. A notice or an alert queued for someone who is no longer an
-- active owner (an owner or operations member for a contact notice) is
-- exhausted, not sent.
drop function public.outbox_claim(integer, integer, integer, integer, integer);
create function public.outbox_claim(
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

  update finance.email_outbox o
  set status = 'suppressed', updated_at = now()
  where o.status in ('pending', 'uncertain')
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
      and v_sent_today < p_daily_quota - case o.priority when 0 then 0 when 1 then p_reserve else p_reserve + p_low_reserve end
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

-- An alert is not replayed to someone who is no longer an active owner, nor a
-- contact notice to someone who is no longer an owner or operations member
-- (22023). Otherwise identical to 20260930120000_audit_fixes.sql.
create or replace function public.outbox_replay(p_id bigint, p_accept_duplicate_risk boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
  v_ambiguous boolean;
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can replay email.' using errcode = 'insufficient_privilege';
  end if;
  select * into o from finance.email_outbox where id = p_id for update;
  if not found then
    raise exception 'Message not found.' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(o.recipient)) then
    raise exception 'The recipient is suppressed.' using errcode = 'check_violation';
  end if;
  if o.kind in ('contact_notice', 'owner_alert') and not exists (
    select 1
    from public.staff s
    join auth.users u on u.id = s.user_id
    where s.active and lower(u.email) = o.recipient
      and (s.role = 'owner' or (o.kind = 'contact_notice' and s.role = 'operations'))
  ) then
    raise exception 'The recipient is no longer an active %.',
      case o.kind when 'owner_alert' then 'owner' else 'owner or operations member' end
      using errcode = 'invalid_parameter_value';
  end if;
  if o.status not in ('exhausted', 'uncertain') then
    raise exception 'Only exhausted or uncertain messages can be replayed.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_ambiguous := o.first_attempt_at <= now() - interval '23 hours';
  if v_ambiguous and not p_accept_duplicate_risk then
    raise exception 'This message may already have been sent; confirm the duplicate risk.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update finance.email_outbox
  set status = 'pending', attempts = 0, next_at = now(), last_error = null,
      idempotency_key = case when v_ambiguous then gen_random_uuid() else o.idempotency_key end,
      first_attempt_at = case when v_ambiguous then null else o.first_attempt_at end,
      updated_at = now()
  where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'email.replay', 'email_outbox', p_id::text,
          jsonb_build_object('status', o.status, 'acceptedDuplicateRisk', p_accept_duplicate_risk));
end
$$;

-- The dispatcher closes a row without sending when the state moved on after the
-- mail was queued: the subscriber confirmed or unsubscribed (NOT_PENDING,
-- NOT_CONFIRMED), the file was revoked (NO_FILE). Like RECIPIENT_INACTIVE that
-- is not an open problem: nothing can be replayed or fixed for it. A row closed
-- for another reason (a missing order, a shipment or a refund that is not there)
-- stays listed. Otherwise identical to 20260930140000_audit2_fixes.sql.
create or replace function public.outbox_attention()
returns table (
  id bigint, kind text, recipient text, status text, delivery text, attempts integer,
  last_error text, first_attempt_at timestamptz, created_at timestamptz, replay_needs_confirmation boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see the outbox.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select o.id, o.kind, o.recipient, o.status, o.delivery, o.attempts, o.last_error, o.first_attempt_at, o.created_at,
         (o.status in ('uncertain', 'exhausted') and o.first_attempt_at <= now() - interval '23 hours')
  from finance.email_outbox o
  where (o.status in ('exhausted', 'uncertain', 'suppressed')
         or o.delivery in ('bounced', 'complained', 'failed'))
    and coalesce(o.last_error, '') not in ('RECIPIENT_INACTIVE', 'NOT_PENDING', 'NOT_CONFIRMED', 'NO_FILE')
  order by o.created_at desc
  limit 200;
end
$$;

-- 3. Grants -------------------------------------------------------------------

-- The three data functions and the claim: service_role only (the Edge
-- Functions' role). The claim's old five-argument signature is gone.
revoke all on function public.order_email_data(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.notify_email_data(uuid) from public, anon, authenticated;
revoke all on function public.alert_email_data(jsonb) from public, anon, authenticated;
revoke all on function public.outbox_claim(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.order_email_data(uuid, uuid, uuid[]) to service_role;
grant execute on function public.notify_email_data(uuid) to service_role;
grant execute on function public.alert_email_data(jsonb) to service_role;
grant execute on function public.outbox_claim(integer, integer, integer, integer, integer, integer) to service_role;

-- Staff functions, as before: the role is rechecked inside.
revoke all on function public.outbox_replay(bigint, boolean) from public, anon;
grant execute on function public.outbox_replay(bigint, boolean) to authenticated;
revoke all on function public.outbox_attention() from public, anon;
grant execute on function public.outbox_attention() to authenticated;

-- The helper: nobody calls it through the API, service_role included.
revoke all on function finance.uuid_or_null(text) from public, anon, authenticated, service_role;
