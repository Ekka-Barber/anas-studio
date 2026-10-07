-- FABLE-AUDIT, round M2: the second pass over the SQL, in one forward
-- migration. The earlier migrations stay untouched. Every replaced function
-- keeps its exact signature, return type, language, security and
-- `search_path` (`create or replace`), starts from its final definition (named
-- in its section), changes only what its section says, and restates its
-- grants. Money is integer halalas; codes are ASCII.
--
-- 1. `order_resolve`: a partial refund at the provider is no reversal.
-- 2. `fulfillment_update` no longer infers a correction; `fulfillment_correct`
--    corrects the carrier and tracking of shipped items on purpose.
-- 3. `refund_request`: STALE when the owner's screen was built from another
--    confirmed refunded total.
-- 4. `finance.checkout_price`: the digital quantity refusal says `maximum: 1`.
-- 5. `cron_failures_recent`: the scheduled jobs that failed in the last day.
-- 6. `finance.notify_confirm_queue`: a brake on bounced confirmation mail.
-- 7. `finance.availability_sweep`: waits while checkout is closed in effect.
-- 8. `policies_reset_approval`: a policy publish and an approval serialise.
-- 9. A library image's alt text or caption edit asks for a site build.
-- 10. `email_event_record`: an Undetermined bounce suppresses nothing.
-- 11. `outbox_replay`: a sent mail the provider reports failed can be replayed.
-- 12. `finance.order_erasable` and `finance.orders_delete`: a test-environment
--     order that holds no work is erasable whatever its payment.
-- 13. `notify_email_data` says `preorder`; `alert_email_data` gives the facts
--     of the alerts it answered with their code alone.
-- 14. `outbox_close`: staff close an uncertain or exhausted mail.
-- 15. `public.audit_events` refuses TRUNCATE.

-- 1. `order_resolve` of 20261007100000_fable_audit_payments.sql, with one
--    change: PAYMENT_REVERSED is decided by the money (the provider's refunded
--    total reaches what was captured) and by a void, no longer by the fetched
--    status `refunded`, which Moyasar also gives a payment refunded in part
--    (docs.moyasar.com/docs/guides/payment-operations, «Partial Refund»). So
--    the order stays resolvable after the owner refunds the line that could
--    not be delivered, as STOCK_UNAVAILABLE tells him to. Otherwise identical:
--
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
-- PAYMENT_REVERSED | STOCK_UNAVAILABLE}.
create or replace function public.order_resolve(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_attempt finance.payment_attempts;
  v_over boolean;
begin
  perform finance.require_staff(true);
  select * into v_order from finance.orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'paid_needs_resolution' then
    return jsonb_build_object('ok', false, 'code', 'NOT_RESOLVABLE', 'status', v_order.status);
  end if;
  select * into v_attempt from finance.payment_attempts a where a.order_id = p_order and a.status = 'paid' for update;
  -- `refund_request` takes the order's lock too, so none can begin from here on.
  if exists (
    select 1 from finance.refunds r
     where r.order_id = p_order and r.attempt_id is not null and r.status in ('submitting', 'uncertain')
  ) then
    return jsonb_build_object('ok', false, 'code', 'REFUND_IN_FLIGHT');
  end if;
  -- The money went back at the provider and the ledger does not hold that
  -- refund yet (a recorded full refund makes the order `refunded`): the owner
  -- records it, nothing is delivered. Decided by the money and by a void: a
  -- payment refunded in part is `refunded` at the provider too.
  if v_attempt.provider_status = 'voided'
    or v_attempt.provider_refunded_halalas >= v_attempt.captured_halalas
  then
    return jsonb_build_object('ok', false, 'code', 'PAYMENT_REVERSED');
  end if;

  if not finance.order_try_commit(p_order, 'receipt:' || p_order::text || ':resolved') then
    return jsonb_build_object('ok', false, 'code', 'STOCK_UNAVAILABLE');
  end if;
  update finance.orders o
     set status = 'paid', access_token_expires_at = now() + interval '7 days', version = o.version + 1, updated_at = now()
   where o.id = p_order;
  -- The coupon was committed whatever its limit says (the price was charged);
  -- a commit past the limit is marked, as `apply_verified_payment` marks it.
  v_over := v_order.coupon_id is not null and exists (
    select 1 from public.coupons c
     where c.id = v_order.coupon_id and c.usage_limit is not null and finance.coupon_uses(c.id) > c.usage_limit
  );
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'order.resolved', 'order', p_order::text,
          jsonb_build_object('orderNumber', v_order.order_number, 'amount', v_order.total_halalas)
            || case when v_over then jsonb_build_object('couponOverLimit', true) else '{}'::jsonb end);
  return jsonb_build_object('ok', true, 'orderNumber', v_order.order_number, 'status', 'paid');
end
$$;
revoke all on function public.order_resolve(uuid) from public, anon;
grant execute on function public.order_resolve(uuid) to authenticated;

-- 2a. `fulfillment_update` of 20261007110000_fable_audit_operations.sql,
--     without the correction round M1b inferred: a second «تم الشحن» from a
--     stale screen rewrote another member's carrier and tracking and mailed
--     nothing. A shipped item named again under `shipped` with another carrier
--     or tracking is BAD_TRANSITION again, as before M1b; `fulfillment_correct`
--     (2b) is the correction. REFUND_IN_FLIGHT, FULFILLMENT_STOPPED and the
--     renewed link stay. Otherwise identical:
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
-- another carrier or tracking, is BAD_TRANSITION; an item a dispute stopped
-- (`finance.order_stopped_items`) is FULFILLMENT_STOPPED for `shipped`; a
-- signed item without `dedication_done` is DEDICATION_NOT_DONE; an order that
-- is not `paid` is ORDER_NOT_PAID. The call is all or nothing. A repeat of a
-- call that already holds (the same state, and for `shipped` the same carrier
-- and tracking) changes nothing and queues nothing. One `order_shipped` mail
-- per call that moved something to shipped
-- (`order_shipped:<orderId>:<md5 of the moved item ids, sorted, joined by commas>`,
-- payload {orderId, itemIds}), with the order's link renewed to at least 7
-- days from now, and one audit row per call that changed anything.
-- {ok: true, changed, itemIds} where itemIds are the items that changed, or
-- {ok: false, code[, itemIds: the items at fault][, status]}.
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

-- 2b. The correction of what has shipped, asked for on purpose: the carrier
--     and tracking of items whose state is `shipped`. The same checks as
--     `fulfillment_update` for the caller (an owner or operations), the
--     carrier and the tracking (trimmed, 1 to 80 and 1 to 120 characters, one
--     line each; a malformed call raises 22023), the order (NOT_FOUND, and
--     ORDER_NOT_PAID unless it is `paid`) and the ids (INVALID_ITEMS unless each
--     is the fulfilment of an item of this order, once). An item that is not
--     `shipped` (still being prepared, or delivered) is BAD_TRANSITION, with
--     those items, and nothing changes. The rows whose carrier or tracking
--     differ take the new ones (their state and shipping time stay), under one
--     audit row `fulfillment.corrected` {orderNumber, itemIds} (never the text
--     typed); no mail is queued, since the buyer's shipped mail renders the
--     current values. Under the order's lock, like `fulfillment_update`.
--     {ok: true, changed, itemIds, corrected: true}, {ok: true, changed: 0,
--     itemIds: []} when nothing differs, or {ok: false, code[, itemIds][, status]}.
create function public.fulfillment_correct(p_order uuid, p_item_ids uuid[], p_carrier text, p_tracking text)
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
  v_done uuid[];
begin
  perform finance.require_staff(false);
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 50
    or exists (select 1 from unnest(p_item_ids) u(id) where u.id is null)
    or char_length(v_carrier) not between 1 and 80 or v_carrier ~ '[[:cntrl:]]'
    or char_length(v_tracking) not between 1 and 120 or v_tracking ~ '[[:cntrl:]]'
  then
    raise exception 'Invalid fulfilment correction.' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_order from finance.orders o where o.id = p_order for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_PAID', 'status', v_order.status);
  end if;

  select coalesce(array_agg(u.id order by u.id), '{}') into v_bad
    from unnest(p_item_ids) u(id)
   where not exists (select 1 from finance.fulfillments f where f.order_item_id = u.id and f.order_id = p_order);
  if cardinality(v_bad) > 0 or (select count(distinct u.id) from unnest(p_item_ids) u(id)) <> cardinality(p_item_ids) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS', 'itemIds', to_jsonb(v_bad));
  end if;

  select coalesce(array_agg(f.order_item_id order by f.order_item_id), '{}') into v_bad
    from finance.fulfillments f
   where f.order_id = p_order and f.order_item_id = any (p_item_ids) and f.state <> 'shipped';
  if cardinality(v_bad) > 0 then
    return jsonb_build_object('ok', false, 'code', 'BAD_TRANSITION', 'itemIds', to_jsonb(v_bad));
  end if;

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
end
$$;
revoke all on function public.fulfillment_correct(uuid, uuid[], text, text) from public, anon;
grant execute on function public.fulfillment_correct(uuid, uuid[], text, text) to authenticated;

-- 3. `refund_request` of 20261007110000_fable_audit_operations.sql, with one
--    more refusal, STALE. The signature stays: the owner's screen sends the
--    confirmed refunded total it was built from as `expectedRefunded` beside
--    the allocation (an integer of halalas; anything else is a malformed call
--    and raises 22023). It is taken out before the allocation is checked or
--    stored, so the allocation rules and the stored row are as before. It is
--    compared after the idempotency key (a replay answers the stored refund
--    whatever it expected) and after REFUND_IN_FLIGHT, before anything is
--    written: when the confirmed total of the attempt (or of the review
--    payment) is another, the answer is {ok: false, code: 'STALE', refunded:
--    <the confirmed total>} and the owner reads the order again, so a stale
--    screen never refunds the same money twice. Without the key every path is
--    unchanged. Otherwise identical:
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
  v_expected integer;
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
  -- The confirmed total the owner's screen was built from travels beside the
  -- allocation and is not part of it.
  if jsonb_typeof(v_allocation) = 'object' and v_allocation ? 'expectedRefunded' then
    if jsonb_typeof(v_allocation -> 'expectedRefunded') is distinct from 'number'
      or (v_allocation ->> 'expectedRefunded') !~ '^[0-9]{1,9}$'
    then
      raise exception 'Invalid refund.' using errcode = 'invalid_parameter_value';
    end if;
    v_expected := (v_allocation ->> 'expectedRefunded')::integer;
    v_allocation := v_allocation - 'expectedRefunded';
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
  -- A refund was confirmed since the owner's screen was read: asking again
  -- from it could pay the same money twice. Nothing is written.
  if v_expected is not null and v_expected <> v_confirmed then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'refunded', v_confirmed);
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

-- 4. `finance.checkout_price` of 20261007110000_fable_audit_operations.sql,
--    with one change: the refusal of a digital line whose quantity is not 1
--    says `maximum: 1` (and only that refusal), so the cart can tell it from
--    the 1 to 20 rule, which keeps its shape {code, line, variantId}. Otherwise
--    identical:
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
    -- a quantity above one would be charged for copies never given. The
    -- refusal names its maximum, which the 1 to 20 rule above does not.
    if v_row.fulfillment = 'digital' and v_qty <> 1 then
      v_errors := v_errors || jsonb_build_object('code', 'INVALID_QUANTITY', 'line', v_index, 'variantId', v_variant_id, 'maximum', 1);
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

-- 5. The scheduled jobs that failed in the last 24 hours, for the admin home:
--    eleven pg_cron jobs run SQL whose failure nobody saw. Read from pg_cron's
--    own log (`cron.job_run_details`, kept 7 days by `cron-run-details-purge`)
--    joined with `cron.job` for the name: [{jobname, failures, lastFailedAt}],
--    the latest failure first, never the command or the error text (which can
--    quote data). A run counts by when it ended (when it started, while it has
--    no end). The migration role owns the function and may read both tables:
--    it holds every right on `job_run_details` and select on `job`, both under
--    pg_cron's own row policy (`username = current_user`), which the jobs the
--    migrations scheduled pass (they are the migration role's) and which that
--    role, with BYPASSRLS on Supabase, is not held to anyway. Behind the
--    staff-role check of `outbox_due_since`: an owner or operations.
create function public.cron_failures_recent()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see the scheduled jobs.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object('jobname', f.jobname, 'failures', f.failures, 'lastFailedAt', f.last_failed_at)
             order by f.last_failed_at desc, f.jobname
           )
      from (
        select j.jobname, count(*)::integer as failures, max(coalesce(d.end_time, d.start_time)) as last_failed_at
          from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
         where d.status = 'failed' and coalesce(d.end_time, d.start_time) > now() - interval '24 hours'
         group by j.jobname
      ) f
  ), '[]'::jsonb);
end
$$;
revoke all on function public.cron_failures_recent() from public, anon;
grant execute on function public.cron_failures_recent() to authenticated;

-- 6. `finance.notify_confirm_queue` of 20261002150000_notifications.sql, with
--    a brake. A confirmation goes to an address a visitor typed, so bounces and
--    complaints among them (Resend's webhook sets `delivery` on the outbox row,
--    `bounced` or `complained`, through `email_event_record`) are what a form
--    fed with other people's addresses produces, and they cost the sending
--    domain its reputation. When more than 3 confirmation mails sent in the
--    last 7 days bounced or drew a complaint, nothing more is queued (the
--    answer is `total`, as when the day's total is spent, so the hourly backlog
--    stops the same way and the rows wait), no allowance is taken, and the
--    owners are told once a UTC day while it holds (`confirm_mail_braked`,
--    {bounced}). Otherwise identical:
--
-- The confirmation mail of a pending row, queued when the caps allow: one per
-- address per UTC day whatever the variant, five per address in 30 days (counted
-- from the outbox: a stranger who keeps signing a victim up, also after an
-- unsubscribe, is stopped there), and 30 a day in all (the outbox sends at most 30
-- as well). Every cap is silent: the row stays, and the hourly backlog job queues
-- what a cap held back, so a visitor who was told "sent" does get the mail. Queued
-- once per row, version and day (the dedupe key); `confirm_sent_at` records when,
-- which is what the link's seven days run from. Answers `queued`, or which cap
-- refused (`address`, `total`), or `gone` for a row that is not pending.
create or replace function finance.notify_confirm_queue(p_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_note public.notifications;
  v_bounced integer;
begin
  select * into v_note from public.notifications n where n.id = p_id and n.status = 'pending' for update;
  if not found then
    return 'gone';
  end if;
  -- The brake, before any allowance is taken.
  select count(*) into v_bounced
    from finance.email_outbox o
   where o.kind = 'notify_confirm' and o.sent_at > now() - interval '7 days'
     and o.delivery in ('bounced', 'complained');
  if v_bounced > 3 then
    perform finance.owner_alert(
      'confirm_mail_braked', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), jsonb_build_object('bounced', v_bounced)
    );
    return 'total';
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
revoke all on function finance.notify_confirm_queue(uuid) from public, anon, authenticated, service_role;

-- 7. `finance.availability_sweep` of 20261002150000_notifications.sql, with
--    one change: it waits while checkout is closed in effect, not only while
--    the switch is off: the switch on, the seller named and registered, and the
--    policies approved (the predicate of `commerce_settings_get`'s
--    `checkoutOpen` and of the cart). A policy change resets the approval
--    while the switch stays on, and a notice then would tell a subscriber that
--    something is back that nobody can buy, and spend that notice. Otherwise
--    identical:
--
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
-- availability row before its notifications. While checkout is closed (the
-- switch off, the seller unset or the policies unapproved) the sweep does
-- nothing at all: nobody is told that something is back while nothing
-- can be bought, and no row moves, so opening the shop is what tells the
-- subscribers of what came back meanwhile, and closing and opening it again tells
-- nobody twice. Answers the mails queued.
create or replace function finance.availability_sweep()
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
  if not coalesce((
    select s.checkout_enabled and s.seller_legal_name is not null and s.seller_registration is not null
           and s.policy_revisions <> '{}'::jsonb
      from finance.commerce_settings s where s.id = 1
  ), false) then
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
revoke all on function finance.availability_sweep() from public, anon, authenticated, service_role;

-- 8. `policies_reset_approval` of 20261007110000_fable_audit_operations.sql,
--    with one change: for a policy document it locks the settings row first,
--    whatever the approval holds. Its update matched no row, and so took no
--    lock, when the approval set was empty (a first approval), so a publish
--    overlapping that approval let it read the old seq and pin it. Now the
--    publish holds the settings row from its trigger to its commit, and that
--    row is the first thing `commerce_policies_approve` locks: an approval
--    that comes second waits, then reads the new seq (or, when this reset
--    bumped the version, is refused as stale); an approval that came first has
--    committed before this trigger's update runs, and the update sees it and
--    resets it. Other collections take no lock. Otherwise identical:
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
  -- Taken even when nothing below matches: an approval running now waits for
  -- this publish, and one that went first is seen by the update.
  perform 1 from finance.commerce_settings where id = 1 for update;
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

-- 9. A library image's alt text or caption is what the public pages print
--    with it, and they are static files: an edit of either asks for a site
--    build, as a publish does (`site_build_request`, coalesced by
--    `site_build_trigger`), when the image is public (`media_is_published`: a
--    published document or a published product uses it). An edit of an image
--    nobody shows, or of its name, folder or rights, asks for nothing. The
--    library edits the row through the Data API as the signed-in staff member,
--    so the trigger function runs as its owner to reach the request.
create function public.media_request_build()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.media_is_published(new.id) then
    perform public.site_build_request();
  end if;
  return null;
end
$$;
revoke all on function public.media_request_build() from public, anon, authenticated;
create trigger media_request_build
  after update on public.media
  for each row
  when (old.alt_ar is distinct from new.alt_ar or old.caption is distinct from new.caption)
  execute function public.media_request_build();

-- 10. `email_event_record` of 20260930140000_audit2_fixes.sql, with one
--     change: Resend gives a bounce the type Permanent, Transient or
--     Undetermined; an Undetermined one is treated like a Transient one: the
--     event is recorded and the address is not suppressed, so the next mail to
--     it still goes. Otherwise identical:
--
-- A verified provider event, recorded once, under the per-message advisory lock
-- `outbox_result` takes too (S04.4). Complaints and provider suppressions
-- suppress the recipient for every sender. A bounce suppresses unless its type
-- is temporary, soft, transient or undetermined, lowercased here from the
-- `p_bounce_type` argument or the evidence `bounceType` key: such a bounce only
-- records the event, because the address may deliver later. Permanent, a
-- missing or an undocumented type suppresses conservatively; the raw type stays
-- in the evidence for an owner's manual un-suppression. A later "delivered"
-- never clears a suppression, and never overwrites a bounce or complaint on the
-- row.
create or replace function public.email_event_record(
  p_event_id text, p_type text, p_provider_message_id text, p_recipient text,
  p_occurred_at timestamptz, p_evidence jsonb, p_bounce_type text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := case when p_recipient is null then null else finance.recipient_hash(p_recipient) end;
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_bounce_type text := coalesce(
    nullif(lower(btrim(v_evidence->>'bounceType')), ''),
    nullif(lower(btrim(p_bounce_type)), '')
  );
  v_delivery text;
begin
  if p_provider_message_id is not null then
    perform pg_advisory_xact_lock(hashtext('email:' || p_provider_message_id));
  end if;
  insert into finance.email_delivery_events
    (provider_event_id, provider_message_id, type, recipient_hash, occurred_at, evidence)
  values (p_event_id, p_provider_message_id, p_type, v_hash, p_occurred_at, v_evidence)
  on conflict (provider_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_hash is not null and (
    p_type in ('email.complained', 'email.suppressed')
    or (
      p_type = 'email.bounced'
      and coalesce(v_bounce_type, '') not in ('temporary', 'soft', 'transient', 'undetermined')
    )
  ) then
    insert into finance.email_suppressions (recipient_hash, reason)
    values (
      v_hash,
      case p_type when 'email.bounced' then 'bounced' when 'email.complained' then 'complained' else 'provider_suppressed' end
    )
    on conflict (recipient_hash) do nothing;
  end if;

  v_delivery := case p_type
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    when 'email.suppressed' then 'failed'
    else null
  end;
  if v_delivery is not null and p_provider_message_id is not null then
    update finance.email_outbox o
    set delivery = v_delivery, updated_at = now()
    where o.provider_id = p_provider_message_id
      and (
        o.delivery is null
        or (o.delivery = 'delayed' and v_delivery <> 'delayed')
        or (o.delivery = 'delivered' and v_delivery in ('bounced', 'complained'))
      );
  end if;
  return 'recorded';
end
$$;
revoke all on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.email_event_record(text, text, text, text, timestamptz, jsonb, text) to service_role;

-- 11. `outbox_replay` of 20261002120000_order_emails.sql, with one change: a
--     mail Resend accepted and later reported as `email.failed` (the row is
--     `sent` with `delivery = 'failed'`, as `email_event_record` writes it)
--     can be replayed too, under the same 23-hour duplicate-risk rule. It
--     always gets a new idempotency key: the provider keeps a key's answer for
--     24 hours, and the old key would only answer the stored, failed result.
--     Its window starts again at the next attempt (`first_attempt_at`
--     cleared), and its delivery is cleared, so the pending row no longer reads
--     as failed (the next acceptance sets it for the new message). A suppressed
--     recipient is still refused, which covers an `email.suppressed` failure.
--     Otherwise identical:
--
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
  v_failed boolean;
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
  v_failed := o.status = 'sent' and o.delivery is not distinct from 'failed';
  if o.status not in ('exhausted', 'uncertain') and not v_failed then
    raise exception 'Only exhausted, uncertain or failed messages can be replayed.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  v_ambiguous := o.first_attempt_at <= now() - interval '23 hours';
  if v_ambiguous and not p_accept_duplicate_risk then
    raise exception 'This message may already have been sent; confirm the duplicate risk.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update finance.email_outbox
  set status = 'pending', attempts = 0, next_at = now(), last_error = null,
      idempotency_key = case when v_ambiguous or v_failed then gen_random_uuid() else o.idempotency_key end,
      first_attempt_at = case when v_ambiguous or v_failed then null else o.first_attempt_at end,
      delivery = case when v_failed then null else o.delivery end,
      updated_at = now()
  where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'email.replay', 'email_outbox', p_id::text,
          jsonb_build_object('status', o.status, 'acceptedDuplicateRisk', p_accept_duplicate_risk));
end
$$;
revoke all on function public.outbox_replay(bigint, boolean) from public, anon;
grant execute on function public.outbox_replay(bigint, boolean) to authenticated;

-- 12a. `finance.order_erasable` of 20261007100000_fable_audit_payments.sql,
--      with one change: an order of the test environment (sandbox payments, no
--      money) is not kept for the accounting retention. Paid or refunded, it
--      is erasable once no work is attached to it, like an expired or
--      cancelled order; its attempts may be paid or in review and its review
--      payments closed. The other guards hold for both environments: no
--      attempt creating, pending or uncertain, still due for a check, marked
--      UNVERIFIED, or marked MODE_CHANGED with an invoice; no open review
--      payment; no refund in flight; no dispute on its attempts or its review
--      payments (dispute rows are append-only and refer to them). A live order
--      is judged exactly as before: expired or cancelled, no attempt paid or in
--      review, no review payment at all (it had no refund or review dispute to
--      find either). An order waiting for the owner's resolution, or still
--      open, is never erasable.
--
-- The retention rule (D42, round 2): an order that holds no money and no work.
-- The daily purge adds its 90 days; a buyer's erase has no age to wait for.
-- Takes the row, so the caller's own lock and snapshot of it are what is
-- judged.
create or replace function finance.order_erasable(p_order finance.orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (p_order.status in ('expired', 'cancelled')
          or (p_order.environment = 'test' and p_order.status in ('paid', 'refunded')))
     and not exists (
       select 1 from finance.payment_attempts a
        where a.order_id = p_order.id
          and (a.status in ('creating', 'pending', 'uncertain')
               or (a.status in ('paid', 'review') and p_order.environment is distinct from 'test')
               or a.next_check_at is not null
               or a.last_error = 'UNVERIFIED'
               or (a.last_error = 'MODE_CHANGED' and a.provider_invoice_id is not null))
     )
     and not exists (
       select 1 from finance.payment_reviews r
        where r.order_id = p_order.id and (r.closed_at is null or p_order.environment is distinct from 'test')
     )
     and not exists (
       select 1 from finance.refunds f
        where f.order_id = p_order.id and f.status in ('submitting', 'uncertain')
     )
     and not exists (
       select 1 from finance.disputes d
        where d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = p_order.id)
           or d.review_payment_id in (select r.provider_payment_id from finance.payment_reviews r where r.order_id = p_order.id)
     )
$$;
revoke all on function finance.order_erasable(finance.orders) from public, anon, authenticated, service_role;

-- 12b. `finance.orders_delete` of 20261002170000_stats_disputes.sql, with the
--      rows only a paid order has, which an erasable test-environment order
--      may now hold: the download tokens of its entitlements, the entitlements
--      and the fulfilments; its refunds (of the order, of its attempts, of its
--      review payments) and its returns, in one statement because a refund and
--      the return it settled refer to each other (the foreign keys are checked
--      at the end of the statement); and its review payments, closed (the rule
--      keeps an order with an open one). An order that was never paid has none
--      of them, and its deletes are as before. Otherwise identical:
--
-- The deletes of an erasable order, in the one order the foreign keys allow: the
-- webhook events of its attempts' payments, the attempts, items, reservations
-- and coupon uses, then the orders. The caller holds the order locks and has
-- judged them with `finance.order_erasable`. Answers how many orders went.
create or replace function finance.orders_delete(p_orders uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from finance.payment_events e
   where e.provider_payment_id in (
     select a.provider_payment_id from finance.payment_attempts a
      where a.order_id = any (p_orders) and a.provider_payment_id is not null
   );
  delete from finance.download_tokens t
   where t.entitlement_id in (select e.id from finance.entitlements e where e.order_id = any (p_orders));
  delete from finance.entitlements where order_id = any (p_orders);
  delete from finance.fulfillments where order_id = any (p_orders);
  with refunds as (
    delete from finance.refunds r
     where r.order_id = any (p_orders)
        or r.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = any (p_orders))
        or r.review_payment_id in (select pr.provider_payment_id from finance.payment_reviews pr where pr.order_id = any (p_orders))
    returning r.id
  )
  delete from finance.return_requests q where q.order_id = any (p_orders);
  delete from finance.payment_reviews pr
   where pr.order_id = any (p_orders)
      or pr.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = any (p_orders));
  delete from finance.payment_attempts where order_id = any (p_orders);
  delete from finance.order_items where order_id = any (p_orders);
  delete from finance.inventory_reservations where order_id = any (p_orders);
  delete from finance.coupon_redemptions where order_id = any (p_orders);
  delete from finance.orders where id = any (p_orders);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function finance.orders_delete(uuid[]) from public, anon, authenticated, service_role;

-- 13a. `notify_email_data` of 20261002120000_order_emails.sql, with
--      `preorder`: the variant is sold as a preorder now, so the availability
--      notice says it can be preordered. Otherwise identical:
--
-- What a confirmation or an availability mail shows about a subscription. The
-- dispatcher rechecks `status` itself: a confirmation goes only while the row
-- is `pending`, an availability notice only while it is `confirmed`. Null when
-- the subscription is gone.
create or replace function public.notify_email_data(p_id uuid)
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
           'slug', p.slug,
           'preorder', v.preorder
         )
    from public.notifications n
    join public.product_variants v on v.id = n.variant_id
    join public.products p on p.id = v.product_id
   where n.id = p_id
$$;
revoke all on function public.notify_email_data(uuid) from public, anon, authenticated;
grant execute on function public.notify_email_data(uuid) to service_role;

-- 13b. `alert_email_data` of 20261002120000_order_emails.sql, with the facts of
--      the alerts written since, which it answered with their code alone:
--      `attempt_mode_changed` and `refund_mode_changed` the order number (from
--      the payload's `orderId`), `payment_create_refused` that and the
--      refusal's `error` code, `policies_reset` the `policy` and its `seq`
--      (null when it was taken down), and `confirm_mail_braked` the `bounced`
--      count. Otherwise identical:
--
-- The few facts an owner alert shows, by alert type: the order number, a SKU
-- and its stock, amounts in halalas, the reason code. Never a buyer's contact
-- details, a token, a card, an address or a provider payload. Every alert name
-- the migrations write so far is covered, and the three the refund round will
-- (`refund_mismatch`, `refund_unverified`, `refund_total_decreased`, which carry
-- a `refundId`); an alert
-- not known here, or whose rows are gone, answers `{alert}` alone and the
-- dispatcher sends a generic line with its code.
create or replace function public.alert_email_data(p_payload jsonb)
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
    when 'attempt_mode_changed' then '{}'::jsonb
    when 'refund_mode_changed' then '{}'::jsonb
    when 'payment_create_refused' then jsonb_build_object('error', p_payload ->> 'error')
    when 'policies_reset' then jsonb_build_object('policy', p_payload ->> 'policy', 'seq', p_payload -> 'seq')
    when 'confirm_mail_braked' then jsonb_build_object('bounced', p_payload -> 'bounced')
  end;
  if v_facts is null then
    return jsonb_build_object('alert', v_alert);
  end if;
  return jsonb_build_object('alert', v_alert, 'orderNumber', v_number) || v_facts;
end
$$;
revoke all on function public.alert_email_data(jsonb) from public, anon, authenticated;
grant execute on function public.alert_email_data(jsonb) to service_role;

-- 14a. A mail can be closed: `closed` joins the outbox statuses.
alter table finance.email_outbox drop constraint email_outbox_status_check;
alter table finance.email_outbox add constraint email_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'uncertain', 'exhausted', 'suppressed', 'closed'));

-- 14b. An owner or operations member closes an `uncertain` or `exhausted` mail
--      that needs nothing more (the runbook's «let it go»: the owner found it
--      delivered, or it no longer matters): it becomes `closed` with
--      `last_error` CLOSED_BY_STAFF, is never claimed or replayed again, and
--      leaves the attention list and with it the home's count; one audit row
--      `email.closed` with the status it had. Under the row's lock, so a claim
--      that took the row first leaves it `sending`, which is refused. {ok:
--      true, id, status: 'closed'} or {ok: false, code: NOT_FOUND | BAD_STATUS
--      (with `status`)}.
create function public.outbox_close(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o finance.email_outbox;
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can close email.' using errcode = 'insufficient_privilege';
  end if;
  select * into o from finance.email_outbox where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if o.status not in ('uncertain', 'exhausted') then
    return jsonb_build_object('ok', false, 'code', 'BAD_STATUS', 'status', o.status);
  end if;
  update finance.email_outbox
     set status = 'closed', last_error = 'CLOSED_BY_STAFF', updated_at = now()
   where id = p_id;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'email.closed', 'email_outbox', p_id::text, jsonb_build_object('status', o.status));
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'closed');
end
$$;
revoke all on function public.outbox_close(bigint) from public, anon;
grant execute on function public.outbox_close(bigint) to authenticated;

-- 14c. `outbox_attention` of 20261002120000_order_emails.sql, with one
--      change: a closed row is left out (a person closed it; the home counts
--      the replayable rows of this list). Otherwise identical:
--
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
    and o.status <> 'closed'
  order by o.created_at desc
  limit 200;
end
$$;
revoke all on function public.outbox_attention() from public, anon;
grant execute on function public.outbox_attention() to authenticated;

-- 15. `public.audit_events` is append-only (20260925090000), but its row
--     trigger never sees a TRUNCATE, and the default privileges gave
--     `service_role` TRUNCATE on the table. A statement trigger refuses it for
--     every role, the table's owner included, with the same error as an update
--     or a delete; and `service_role` loses the privilege.
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.audit_events_immutable();
revoke truncate on public.audit_events from service_role;
