-- P08 round 6: refunds (PLANS/P08-CONTRACT.md section 6, "Refunds (round 6)").
-- Functions only: the refund tables, their in-flight indexes and the job's
-- lease (`payment_reconcile_claim`) are round 2's and stay as they are.
--
-- The provider documents no refund id: the evidence of a refund is the
-- payment's own `refunded` total. So the Edge Function reads that total first,
-- `refund_request` reserves the balance under the locks and keeps the total it
-- was given as `provider_refunded_before`, and the provider call is made with
-- no lock held. What comes back is only a prompt: `refund_result` accepts a
-- success only when the total rose by exactly the amount, and `refund_settle`
-- (the reconciliation job, the owner's recheck) decides from a fresh fetch.
-- At most one refund per payment is in flight, and every in-flight refund
-- ends: within 15 minutes of its creation once the provider answers, and by
-- the owner's recheck when it could not be read for 24 hours.
--
-- One lock order for every writer (contract, rules at the top): the order row,
-- the attempt row (a review payment's row in its place, alone when it has no
-- order), the linked return, the order's variants in ascending id, the coupon,
-- the reservations, then the refund row. A function that finds its order
-- through a refund reads the refund without a lock, locks in this order and
-- reads the refund again before it decides. Every check is made under the
-- locks, so two connections can never reserve the same balance.
--
-- Money is integer halalas. `code`s are ASCII; `error` holds codes, never a
-- provider message; no provider payload is stored.

-- The provider's total when a refund was requested, kept as it was. A
-- dashboard refund that lands while ours is in flight moves
-- `provider_refunded_before`; this one never moves, so a total that is below
-- `before` can be told apart: below the origin the provider's total really
-- went down, between the two it is only a read made before that dashboard
-- refund was recorded.
alter table finance.refunds add column provider_refunded_origin integer;

-- 1. Internal helpers (finance: no API role, service_role included) ---------

-- After the order and the attempt, the rest of what the success effects touch,
-- in the contract's order. Stock is never written by a refund: the variants
-- and the coupon are locked only so this transaction queues like every other
-- writer of the order does.
create or replace function finance.refund_lock_rows(p_order uuid, p_return uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_return is not null then
    perform 1 from finance.return_requests q where q.id = p_return for update;
  end if;
  perform 1 from public.product_variants v
   where v.id in (select i.variant_id from finance.order_items i where i.order_id = p_order)
   order by v.id for update;
  perform 1 from public.coupons c
   where c.id = (select o.coupon_id from finance.orders o where o.id = p_order) for update;
  perform 1 from finance.inventory_reservations x where x.order_id = p_order order by x.id for update;
end
$$;

-- One refund and everything above it, locked in the contract's order. Answers
-- the refund as it is after the locks (a null row for an unknown id).
-- `p_effects` also takes the rows a success writes.
create or replace function finance.refund_lock(p_refund uuid, p_effects boolean)
returns finance.refunds
language plpgsql
set search_path = ''
as $$
declare
  v_refund finance.refunds;
begin
  select * into v_refund from finance.refunds r where r.id = p_refund;
  if not found then
    return null;
  end if;
  if v_refund.order_id is not null then
    perform 1 from finance.orders o where o.id = v_refund.order_id for update;
  end if;
  if v_refund.attempt_id is not null then
    perform 1 from finance.payment_attempts a where a.id = v_refund.attempt_id for update;
    if p_effects then
      perform finance.refund_lock_rows(v_refund.order_id, v_refund.return_id);
    end if;
  else
    perform 1 from finance.payment_reviews pr where pr.provider_payment_id = v_refund.review_payment_id for update;
  end if;
  select * into v_refund from finance.refunds r where r.id = p_refund for update;
  return v_refund;
end
$$;

-- Whether an owner's allocation fits the paying attempt and the amount: the
-- shape `{items: [{itemId, amount}], shipping}`, every item one of the order's
-- (once), every amount a positive integer, each item's refunded total within
-- what it cost (line subtotal less its discount), the shipping within the
-- order's, and the parts adding up to the amount. Only succeeded refunds
-- count: the caller has already refused while one is in flight.
create or replace function finance.refund_allocation_ok(p_order uuid, p_attempt uuid, p_amount integer, p_allocation jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_items jsonb;
  v_shipping integer := 0;
  v_sum bigint;
  v_seen uuid[] := array[]::uuid[];
  v_item uuid;
  v_amount integer;
  v_paid integer;
  v_done integer;
  v_shipping_cap integer;
  v_shipping_done integer;
  e jsonb;
begin
  if jsonb_typeof(p_allocation) is distinct from 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p_allocation) k where k not in ('items', 'shipping')) then
    return false;
  end if;
  v_items := coalesce(p_allocation -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    return false;
  end if;
  if p_allocation ? 'shipping' then
    if jsonb_typeof(p_allocation -> 'shipping') <> 'number' then
      return false;
    end if;
    if (p_allocation ->> 'shipping') !~ '^[0-9]{1,9}$' then
      return false;
    end if;
    v_shipping := (p_allocation ->> 'shipping')::integer;
  end if;
  v_sum := v_shipping;
  for e in select x.value from jsonb_array_elements(v_items) x loop
    if jsonb_typeof(e) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('itemId', 'amount')) then
      return false;
    end if;
    if coalesce(e ->> 'itemId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
    if jsonb_typeof(e -> 'amount') is distinct from 'number' then
      return false;
    end if;
    if (e ->> 'amount') !~ '^[1-9][0-9]{0,8}$' then
      return false;
    end if;
    v_item := (e ->> 'itemId')::uuid;
    v_amount := (e ->> 'amount')::integer;
    if v_item = any (v_seen) then
      return false;
    end if;
    v_seen := v_seen || v_item;
    select i.line_subtotal_halalas - i.discount_halalas into v_paid
      from finance.order_items i where i.id = v_item and i.order_id = p_order;
    if not found then
      return false;
    end if;
    select coalesce(sum((a.value ->> 'amount')::integer), 0)::integer into v_done
      from finance.refunds r
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(r.allocation -> 'items') = 'array' then r.allocation -> 'items' else '[]'::jsonb end
     ) a
     where r.attempt_id = p_attempt and r.status = 'succeeded' and a.value ->> 'itemId' = v_item::text;
    if v_done + v_amount > v_paid then
      return false;
    end if;
    v_sum := v_sum + v_amount;
  end loop;
  if v_shipping > 0 then
    select o.shipping_halalas into v_shipping_cap from finance.orders o where o.id = p_order;
    select coalesce(sum(case when (r.allocation ->> 'shipping') ~ '^[0-9]{1,9}$' then (r.allocation ->> 'shipping')::integer else 0 end), 0)::integer
      into v_shipping_done
      from finance.refunds r where r.attempt_id = p_attempt and r.status = 'succeeded';
    if v_shipping_done + v_shipping > v_shipping_cap then
      return false;
    end if;
  end if;
  return v_sum = p_amount;
end
$$;

-- The success effects, in one place, shared by `refund_result`,
-- `refund_settle` and `refund_record_external`. The caller holds every lock of
-- the refund (`finance.refund_lock` with effects) and has checked that the
-- refund may succeed. Marks the refund succeeded and then:
-- - a paying attempt: its provider total; the order becomes `refunded` when the
--   confirmed refunds equal the captured amount; an entitlement is revoked for
--   an item whose refunded total is above zero and equals what it cost, and for
--   every item (a zero-paid one included) once the order is refunded, which is
--   how an unallocated full refund revokes everything
--   (`finance.item_fully_refunded` is that rule); the preorder reservations of
--   such items are released, so their capacity is free again; a linked return
--   becomes `refunded`; one `order_refunded` mail. Stock is never touched: an
--   unshipped refunded unit goes back on sale only when the owner edits it.
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
    update finance.entitlements e
       set revoked_at = now(), revoke_reason = 'refund'
     where e.order_id = v_order.id and e.revoked_at is null
       and coalesce(finance.item_fully_refunded(e.order_item_id), false);
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

-- A refund that ended without money moving: its balance is free again.
create or replace function finance.refund_fail(p_refund uuid, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update finance.refunds r
     set status = 'failed', error = p_error, next_check_at = null, updated_at = now()
   where r.id = p_refund;
  insert into public.audit_events (action, entity, entity_id, summary)
  select 'refund.failed', 'refund', r.id::text, jsonb_build_object('amount', r.amount_halalas, 'error', p_error)
    from finance.refunds r where r.id = p_refund;
end
$$;

-- A refund the provider made that the ledger did not hold (the dashboard, or
-- the surplus a fetch showed): one succeeded, unallocated refund from
-- `p_before` to `p_after` and its success effects.
create or replace function finance.refund_dashboard(
  p_order uuid, p_attempt uuid, p_review text, p_before integer, p_after integer, p_reason text, p_actor uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into finance.refunds (
    order_id, attempt_id, review_payment_id, amount_halalas, reason, allocation, status, source,
    provider_refunded_before, provider_refunded_after, requested_by, succeeded_at
  )
  values (p_order, p_attempt, p_review, p_after - p_before, p_reason, '{}'::jsonb, 'succeeded', 'provider_dashboard',
          p_before, p_after, p_actor, now())
  returning id into v_id;
  perform finance.refund_succeed(v_id, p_after, p_actor, 'refund.external');
  return v_id;
end
$$;

-- 2. The refund functions (service_role) -----------------------------------

-- Reserves the balance for one refund, under the locks. `p_provider_refunded`
-- is the payment's `refunded` total the Edge Function fetched a moment ago.
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

-- What the provider answered to the refund call. It acts only on a refund that
-- is still in flight; on any other it changes nothing, and a success that
-- arrives for a refund already closed as failed is raised to the owners.
-- `succeeded` is accepted only when the total rose by exactly the amount; any
-- other total is left to the job. `failed` is a 4xx: nothing moved, the balance
-- is free again.
create or replace function public.refund_result(p_refund uuid, p_outcome text, p_provider_refunded integer, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund finance.refunds;
begin
  if p_refund is null or p_outcome is null or p_outcome not in ('succeeded', 'failed', 'uncertain')
    or (p_outcome = 'succeeded' and (p_provider_refunded is null or p_provider_refunded < 0))
    or (p_error is not null and p_error !~ '^[A-Za-z0-9_.:-]{1,120}$')
  then
    raise exception 'Invalid refund result.' using errcode = 'invalid_parameter_value';
  end if;
  v_refund := finance.refund_lock(p_refund, p_outcome = 'succeeded');
  if v_refund.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_refund.status not in ('submitting', 'uncertain') then
    if p_outcome = 'succeeded' and v_refund.status = 'failed' then
      perform finance.owner_alert(
        'refund_mismatch', v_refund.id::text, jsonb_build_object('refundId', v_refund.id, 'orderId', v_refund.order_id)
      );
    end if;
    return jsonb_build_object(
      'ok', false, 'code', 'NOT_IN_FLIGHT', 'refundId', v_refund.id, 'status', v_refund.status,
      'amount', v_refund.amount_halalas
    );
  end if;

  if p_outcome = 'succeeded' then
    if p_provider_refunded = coalesce(v_refund.provider_refunded_before, 0) + v_refund.amount_halalas then
      perform finance.refund_succeed(v_refund.id, p_provider_refunded, null, 'refund.succeeded');
    else
      update finance.refunds r set status = 'uncertain', error = 'TOTAL_MISMATCH', updated_at = now() where r.id = v_refund.id;
    end if;
  elsif p_outcome = 'failed' then
    perform finance.refund_fail(v_refund.id, coalesce(p_error, 'REFUND_REFUSED'));
  else
    update finance.refunds r set status = 'uncertain', error = coalesce(p_error, r.error), updated_at = now() where r.id = v_refund.id;
  end if;
  select * into v_refund from finance.refunds r where r.id = p_refund;
  return jsonb_build_object('ok', true, 'refundId', v_refund.id, 'status', v_refund.status, 'amount', v_refund.amount_halalas);
end
$$;

-- An in-flight refund, decided from a fresh fetch of the payment's total (the
-- job and the owner's recheck). The total tells everything:
-- - at least `before + amount`: it landed; anything above that is a refund
--   made outside, recorded in the same transaction;
-- - below this refund's own starting total: the provider's total went down,
--   which the documentation does not allow: failed, and the owners are told. A
--   total below `before` but not below that start is a read made before a
--   dashboard refund this function has since recorded (the job and the owner's
--   recheck fetch with no lock held): stale, so the refund is only looked at
--   again in a minute;
-- - otherwise it has not landed (yet). A total strictly between is a refund
--   made outside while ours was in flight: its difference is recorded and this
--   refund's `before` becomes the fetched total (it is never failed early:
--   our own call may still land). Then the 15-minute rule: a refund younger
--   than 15 minutes only backs off (1, 2, 4, 8 minutes, never past the 15th);
--   an older one is failed `NOT_APPLIED`. A refund that lands after that is
--   caught by the next `refund_request` (`PROVIDER_AHEAD`) and adopted by
--   `refund_record_external`.
-- So every fresh read ends the refund within 15 minutes of its creation.
create or replace function public.refund_settle(p_refund uuid, p_provider_refunded integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_dashboard constant text := 'استرداد أُجري من لوحة بوابة الدفع';
  v_refund finance.refunds;
  v_before integer;
  v_target integer;
  v_origin integer;
begin
  if p_refund is null or p_provider_refunded is null or p_provider_refunded < 0 then
    raise exception 'Invalid refund check.' using errcode = 'invalid_parameter_value';
  end if;
  v_refund := finance.refund_lock(p_refund, true);
  if v_refund.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_refund.status not in ('submitting', 'uncertain') then
    return jsonb_build_object(
      'ok', false, 'code', 'NOT_IN_FLIGHT', 'refundId', v_refund.id, 'status', v_refund.status,
      'amount', v_refund.amount_halalas
    );
  end if;
  -- Never null for a refund `refund_request` wrote.
  v_before := coalesce(v_refund.provider_refunded_before, 0);
  v_target := v_before + v_refund.amount_halalas;

  if p_provider_refunded >= v_target then
    if p_provider_refunded > v_target then
      perform finance.refund_dashboard(
        v_refund.order_id, v_refund.attempt_id, v_refund.review_payment_id, v_target, p_provider_refunded, c_dashboard, null
      );
    end if;
    perform finance.refund_succeed(v_refund.id, v_target, null, 'refund.succeeded');
  elsif p_provider_refunded < v_before then
    -- What the provider's total was when this refund was requested.
    v_origin := coalesce(v_refund.provider_refunded_origin, v_before);
    if p_provider_refunded < v_origin then
      perform finance.refund_fail(v_refund.id, 'PROVIDER_TOTAL_DECREASED');
      perform finance.owner_alert(
        'refund_total_decreased', v_refund.id::text, jsonb_build_object('refundId', v_refund.id, 'orderId', v_refund.order_id)
      );
    else
      -- A stale read decides nothing: the next fetch does.
      update finance.refunds r set next_check_at = now() + interval '1 minute', updated_at = now() where r.id = v_refund.id;
    end if;
  else
    if p_provider_refunded > v_before then
      perform finance.refund_dashboard(
        v_refund.order_id, v_refund.attempt_id, v_refund.review_payment_id, v_before, p_provider_refunded, c_dashboard, null
      );
      update finance.refunds r set provider_refunded_before = p_provider_refunded, updated_at = now() where r.id = v_refund.id;
    end if;
    if now() >= v_refund.created_at + interval '15 minutes' then
      perform finance.refund_fail(v_refund.id, 'NOT_APPLIED');
    else
      update finance.refunds r
         set check_count = r.check_count + 1,
             next_check_at = least(
               now() + make_interval(mins => least(power(2, r.check_count), 60)::integer),
               r.created_at + interval '15 minutes'
             ),
             updated_at = now()
       where r.id = v_refund.id;
    end if;
  end if;
  select * into v_refund from finance.refunds r where r.id = p_refund;
  return jsonb_build_object('ok', true, 'refundId', v_refund.id, 'status', v_refund.status, 'amount', v_refund.amount_halalas);
end
$$;

-- A fetch of the payment that failed (the job's, for an in-flight refund): the
-- refund backs off 1, 2, 4 ... 60 minutes. One in flight for more than 24
-- hours is no longer scheduled and the owners are told once; it then waits for
-- the owner's «أعد الفحص». A refund that is not in flight is left alone.
create or replace function public.refund_checked(p_refund uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund finance.refunds;
  v_next timestamptz;
begin
  if p_refund is null or (p_error is not null and p_error !~ '^[A-Za-z0-9_.:-]{1,120}$') then
    raise exception 'Invalid refund check.' using errcode = 'invalid_parameter_value';
  end if;
  v_refund := finance.refund_lock(p_refund, false);
  if v_refund.id is null or v_refund.status not in ('submitting', 'uncertain') then
    return;
  end if;
  v_next := case
    when now() > v_refund.created_at + interval '24 hours' then null
    else now() + make_interval(mins => least(power(2, v_refund.check_count), 60)::integer)
  end;
  update finance.refunds r
     set check_count = r.check_count + 1, error = coalesce(p_error, r.error), next_check_at = v_next, updated_at = now()
   where r.id = v_refund.id;
  if v_next is null then
    perform finance.owner_alert(
      'refund_unverified', v_refund.id::text, jsonb_build_object('refundId', v_refund.id, 'orderId', v_refund.order_id)
    );
  end if;
end
$$;

-- A refund the provider made that the ledger does not hold (the dashboard, or
-- a void): the owner records it from the payment's fetched total. No refund of
-- the target may be in flight. The delta is the provider's total less the
-- confirmed refunds (for a `voided` payment, the whole unrefunded amount) and
-- must be positive. A delta equal to the most recent `NOT_APPLIED` refund's
-- amount is that refund landing late: it is reopened as succeeded with its own
-- allocation, as long as that allocation still fits (the owner may have
-- refunded the same item again since: an item is never allocated more than it
-- cost); otherwise one succeeded, unallocated refund from the dashboard.
create or replace function public.refund_record_external(
  p_actor uuid, p_attempt uuid, p_review_payment text, p_provider_refunded integer, p_provider_status text, p_reason text
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
  v_late finance.refunds;
  v_captured integer;
  v_confirmed integer;
  v_in_flight boolean;
  v_delta integer;
  v_id uuid;
begin
  if not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  if (p_attempt is null) = (p_review_payment is null) or p_provider_refunded is null or p_provider_refunded < 0
    or (p_provider_status is not null and char_length(p_provider_status) > 60)
    or p_reason is null or char_length(p_reason) not between 1 and 300 or p_reason ~ '[[:cntrl:]]'
  then
    raise exception 'Invalid external refund.' using errcode = 'invalid_parameter_value';
  end if;

  -- The order, then the attempt (or the review payment), as `refund_request`.
  if p_attempt is not null then
    select a.order_id into v_order_id from finance.payment_attempts a where a.id = p_attempt;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    perform 1 from finance.orders o where o.id = v_order_id for update;
    select * into v_attempt from finance.payment_attempts a where a.id = p_attempt for update;
    if v_attempt.status <> 'paid' then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    v_captured := coalesce(v_attempt.captured_halalas, 0);
    select coalesce(sum(r.amount_halalas) filter (where r.status = 'succeeded'), 0)::integer,
           coalesce(bool_or(r.status in ('submitting', 'uncertain')), false)
      into v_confirmed, v_in_flight
      from finance.refunds r where r.attempt_id = p_attempt;
  else
    select pr.order_id into v_order_id from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    if v_order_id is not null then
      perform 1 from finance.orders o where o.id = v_order_id for update;
    end if;
    select * into v_review from finance.payment_reviews pr where pr.provider_payment_id = p_review_payment for update;
    v_order_id := v_review.order_id;
    if v_review.closed_at is not null and v_review.closed_reason is not distinct from 'refunded' then
      return jsonb_build_object('ok', false, 'code', 'NOT_REFUNDABLE');
    end if;
    v_captured := coalesce(v_review.amount_halalas, 0);
    select coalesce(sum(r.amount_halalas) filter (where r.status = 'succeeded'), 0)::integer,
           coalesce(bool_or(r.status in ('submitting', 'uncertain')), false)
      into v_confirmed, v_in_flight
      from finance.refunds r where r.review_payment_id = p_review_payment;
  end if;
  if v_in_flight then
    return jsonb_build_object('ok', false, 'code', 'REFUND_IN_FLIGHT');
  end if;

  v_delta := case when p_provider_status = 'voided' then v_captured - v_confirmed else p_provider_refunded - v_confirmed end;
  if v_delta <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_DELTA');
  end if;
  if v_confirmed::bigint + v_delta > v_captured then
    return jsonb_build_object('ok', false, 'code', 'EXCEEDS_BALANCE');
  end if;

  select * into v_late
    from finance.refunds r
   where r.status = 'failed' and r.error = 'NOT_APPLIED'
     and ((p_attempt is not null and r.attempt_id = p_attempt) or (p_review_payment is not null and r.review_payment_id = p_review_payment))
   order by r.created_at desc, r.id desc
   limit 1;
  if found and (
    v_late.amount_halalas <> v_delta
    -- `v_late` is failed, so the check counts only what succeeded since.
    or (p_attempt is not null and not finance.refund_allocation_ok(v_order_id, p_attempt, v_delta, v_late.allocation))
  ) then
    v_late := null;
  end if;

  if p_attempt is not null then
    perform finance.refund_lock_rows(v_order_id, v_late.return_id);
  end if;
  if v_late.id is not null then
    perform 1 from finance.refunds r where r.id = v_late.id for update;
    update finance.refunds r
       set status = 'succeeded', succeeded_at = now(), provider_refunded_before = v_confirmed,
           error = null, next_check_at = null, updated_at = now()
     where r.id = v_late.id;
    perform finance.refund_succeed(v_late.id, v_confirmed + v_delta, p_actor, 'refund.late_applied');
    -- The owner's recording is audited as such in every case; the late landing is the extra row above.
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (p_actor, 'refund.external', 'refund', v_late.id::text, jsonb_build_object('amount', v_delta, 'lateApplied', true));
    v_id := v_late.id;
  else
    v_id := finance.refund_dashboard(v_order_id, p_attempt, p_review_payment, v_confirmed, v_confirmed + v_delta, p_reason, p_actor);
  end if;
  return jsonb_build_object('ok', true, 'refundId', v_id, 'status', 'succeeded', 'amount', v_delta);
end
$$;

-- The owner's «أعد الفحص» on one refund: its status and the provider payment
-- it concerns, rechecked against the owner's active role.
create or replace function public.refund_ref(p_actor uuid, p_refund uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refund finance.refunds;
  v_payment text;
begin
  if not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_refund from finance.refunds r where r.id = p_refund;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select a.provider_payment_id into v_payment from finance.payment_attempts a where a.id = v_refund.attempt_id;
  return jsonb_build_object(
    'ok', true, 'refundId', v_refund.id, 'status', v_refund.status,
    'providerPaymentId', coalesce(v_payment, v_refund.review_payment_id)
  );
end
$$;

-- 3. Grants ------------------------------------------------------------------

revoke all on function public.refund_request(uuid, uuid, uuid, text, integer, text, jsonb, uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_result(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.refund_settle(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_checked(uuid, text) from public, anon, authenticated;
revoke all on function public.refund_record_external(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.refund_ref(uuid, uuid) from public, anon, authenticated;

grant execute on function public.refund_request(uuid, uuid, uuid, text, integer, text, jsonb, uuid, text, uuid, integer) to service_role;
grant execute on function public.refund_result(uuid, text, integer, text) to service_role;
grant execute on function public.refund_settle(uuid, integer) to service_role;
grant execute on function public.refund_checked(uuid, text) to service_role;
grant execute on function public.refund_record_external(uuid, uuid, text, integer, text, text) to service_role;
grant execute on function public.refund_ref(uuid, uuid) to service_role;

revoke all on function finance.refund_lock_rows(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function finance.refund_lock(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function finance.refund_allocation_ok(uuid, uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function finance.refund_succeed(uuid, integer, uuid, text) from public, anon, authenticated, service_role;
revoke all on function finance.refund_fail(uuid, text) from public, anon, authenticated, service_role;
revoke all on function finance.refund_dashboard(uuid, uuid, text, integer, integer, text, uuid) from public, anon, authenticated, service_role;
