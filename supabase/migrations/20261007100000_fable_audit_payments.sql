-- FABLE-AUDIT, round M1a: the payment findings, in one forward migration.
-- The earlier migrations stay untouched. Every replaced function keeps its
-- exact signature, return type, language, security and `search_path`
-- (`create or replace`), starts from its final definition (named in its
-- section), changes only what its section says, and restates its grants.
-- Money is integer halalas; reasons, errors and alert names are ASCII codes.
--
-- 1. A review reason for a payment refunded in full before it settled.
-- 2. `finance.order_try_commit`: a preorder hold whose variant is no longer a
--    preorder is judged and committed by stock.
-- 3. `payment_attempt_close`: a refused invoice creation alerts the owners,
--    once a UTC day.
-- 4. `apply_verified_payment`: money already refunded at the provider when it
--    is first verified is never fulfilled in full, and a partial refund is
--    recorded.
-- 5. `payment_callback_begin`: the throttle is the invoice's, not the
--    caller's address.
-- 6. Work of the other mode: alerted when the job parks it, listed for the
--    owner, counted on the admin home and kept from erasure.
-- 7. `order_resolve`: refuses an order whose money went back at the
--    provider, and marks a coupon committed past its limit.
-- 8. `payments_due_since`: since when payment work has been waiting.

-- 1. The review reasons of 20261002100000_payment_core.sql, plus
--    REFUNDED_BEFORE_SETTLE: a charged payment that the provider already shows
--    refunded in full when it is first verified (section 4).
alter table finance.payment_reviews drop constraint payment_reviews_reason_check;
alter table finance.payment_reviews
  add constraint payment_reviews_reason_check
    check (reason in (
      'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNEXPECTED_STATUS', 'SECOND_PAYMENT', 'ORDER_ALREADY_PAID', 'UNMAPPED_INVOICE',
      'REFUNDED_BEFORE_SETTLE'
    ));

-- 2. The commit logic of 20261002100000_payment_core.sql, with one change:
--    the capacity rule applies to a preorder reservation only while its
--    variant is still a preorder. When the owner switches a preorder off, the
--    variant form clears its capacity, so a hold made while it was one failed
--    for ever, and `order_resolve` with it (STOCK_UNAVAILABLE). Such a line is
--    now judged by the stock rule like any stocked line and takes its stock,
--    and its reservation is committed as a stocked unit (`preorder` false), so
--    what reads that flag later (a return's restock, a refund's release of
--    preorder capacity, `finance.preorder_committed`, the variant form's
--    `preorderUnits`) counts it where its unit came from. Otherwise identical:
--
-- The commit logic, in one place: used by `apply_verified_payment` and by
-- `order_resolve`. The caller holds the order and the attempt row. Under those
-- locks it takes every variant of the order in ascending id (digital ones
-- included), the coupon and the reservations, and checks every line that is
-- not fully refunded:
-- - a line whose own hold is still held and unexpired needs only the units
--   to exist (`stock >= quantity`, or for a preorder `capacity - committed
--   preorder units >= quantity`): other orders' holds do not count against
--   it, it fails only when the owner lowered the stock or the capacity;
-- - a line whose hold was released or has expired is reacquired by the full
--   availability rule, other orders' holds included;
-- - a preorder reservation is judged by the capacity while its variant is
--   still a preorder; every other line that has a stock, by the stock.
-- When every line passes it commits and returns true; when a line fails it
-- returns false and has changed nothing.
create or replace function finance.order_try_commit(p_order uuid, p_receipt_key text)
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
           coalesce(x.preorder, false) as res_preorder, v.preorder as var_preorder
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      left join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     order by i.line_no
  loop
    v_own := r.own_hold;
    if r.res_preorder and r.var_preorder then
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

  -- A preorder hold whose variant is no longer a preorder was judged by the
  -- stock rule above and takes stock below: it is committed as a stocked unit.
  update finance.inventory_reservations x
     set state = 'committed', released_at = null, preorder = x.preorder and v.preorder
    from public.product_variants v
   where v.id = x.variant_id and x.order_id = p_order and x.state <> 'committed'
     and x.variant_id in (
       select i.variant_id from finance.order_items i
        where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     );

  -- Stock goes down for the stocked lines (every line but a preorder
  -- reservation on a variant that is still a preorder) through an ordinary
  -- UPDATE, so the catalog triggers audit it.
  for r in
    select v.id as variant_id, v.stock, v.low_stock_threshold, i.quantity
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      left join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and v.stock is not null and not (coalesce(x.preorder, false) and v.preorder)
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
revoke all on function finance.order_try_commit(uuid, text) from public, anon, authenticated, service_role;

-- 3. `payment_attempt_close` of 20261002100000_payment_core.sql, with one
--    addition: an invoice creation the provider refused (`CREATE_REFUSED`,
--    followed by the provider's HTTP status when it gave one, as in
--    `CREATE_REFUSED_401`) is a problem of the account or the configuration,
--    not of one buyer, and every buyer after this one meets it too. It queues
--    one owner alert a UTC day (`payment_create_refused:<YYYY-MM-DD>`, the
--    first refusal's attempt, order and code as its payload). A throttle
--    (`CREATE_RATE_LIMITED`) passes and is not alerted. Otherwise identical:
--
-- The allowed moves only: creating to failed or uncertain, uncertain to
-- abandoned, pending to cancelled or expired. A closed attempt with an
-- invoice id gets one last check after its invoice expired plus 10 minutes;
-- one without an invoice id has nothing to check; uncertain is due at once.
create or replace function public.payment_attempt_close(p_attempt uuid, p_status text, p_error text)
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
  if p_status = 'failed' and p_error ~ '^CREATE_REFUSED' then
    perform finance.owner_alert(
      'payment_create_refused', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('attemptId', p_attempt, 'orderId', v_attempt.order_id, 'error', p_error)
    );
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end
$$;
revoke all on function public.payment_attempt_close(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payment_attempt_close(uuid, text, text) to service_role;

-- 4. `apply_verified_payment` of 20261002100000_payment_core.sql, with two
--    changes for the first verified payment of an order:
--    - a payment the provider already shows refunded in full is not
--      committed: it is a review payment (REFUNDED_BEFORE_SETTLE, the last of
--      the reasons, so every other reason still wins), and nothing is
--      decremented, granted, shipped or receipted for money that went back;
--    - a payment refunded in part is committed as before, and in the same
--      transaction that refund is recorded through the dashboard path
--      (`finance.refund_dashboard`, the path of `refund_settle` and
--      `refund_record_external`), so the ledger equals the provider, its
--      success effects run once (one `order_refunded` mail) and no
--      `external_refund` alert is left to raise. A replay of the same payment
--      answers `already_paid` before this step, so it is recorded once.
--    Otherwise identical:
--
-- The one decision: is this fetched payment a settled one? Called by the
-- webhook, the invoice callback, the return page's verify and the job, always
-- with objects fetched by the secret key. Decides in the contract's order and
-- never raises for stock. See the contract, section 6, for each step.
create or replace function public.apply_verified_payment(
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
  elsif v_refunded >= v_amount then
    -- Refunded in full at the provider before it settled: the money went back,
    -- so nothing is delivered for it; a person looks at it.
    v_reason := 'REFUNDED_BEFORE_SETTLE';
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
  -- Refunded in part at the provider before it settled (in full it is a
  -- review payment, above): that refund is recorded now through the dashboard
  -- path, from nothing (a refund needs a paid attempt, so the ledger holds none
  -- of this one yet) to the provider's total, so the ledger equals the
  -- provider and the buyer gets its one `order_refunded` mail.
  if v_refunded > 0 then
    perform finance.refund_dashboard(
      v_order.id, v_attempt.id, null, 0, v_refunded, 'استرداد أُجري من لوحة بوابة الدفع', null
    );
  end if;
  -- Whatever the ledger still does not hold is alerted, as on any fetch.
  perform finance.attempt_provider_alerts(v_attempt.id, v_status);
  return jsonb_build_object('outcome', v_outcome, 'orderNumber', v_order.order_number);
end
$$;
revoke all on function public.apply_verified_payment(text, jsonb, jsonb, text, boolean, text) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(text, jsonb, jsonb, text, boolean, text) to service_role;

-- 5. `payment_callback_begin` of 20261002100000_payment_core.sql, throttled
--    by the invoice instead of the caller's address. Its only genuine caller
--    is the provider's server, which sends every shop's callbacks from a few
--    addresses, so 60 an hour per address dropped genuine callbacks once more
--    than 60 invoices an hour were paid. Now: 20 an hour per invoice (the
--    sha256 of its id, like `checkout-cancel:order`), taken only for an invoice
--    that an attempt of this mode holds, so a made-up id writes nothing, and no
--    address is counted. `p_ip_hash` stays in the signature (the `payments`
--    function sends it) and is still validated, but it is no longer used.
--    Otherwise identical:
--
-- The invoice callback (unauthenticated): which attempt to fetch, under the
-- same "worth asking" and 5-second rules. Over the limit it answers {}
-- silently.
create or replace function public.payment_callback_begin(p_invoice_id text, p_ip_hash text, p_mode text)
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
  if coalesce(p_invoice_id, '') = ''
    or not exists (
      select 1 from finance.payment_attempts x where x.provider_invoice_id = p_invoice_id and x.environment = p_mode
    )
  then
    return '{}'::jsonb;
  end if;
  if not finance.rate_limit_take(
    'payment-callback:invoice', encode(sha256(convert_to(p_invoice_id, 'UTF8')), 'hex'), 20, interval '1 hour'
  ) then
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
revoke all on function public.payment_callback_begin(text, text, text) from public, anon, authenticated;
grant execute on function public.payment_callback_begin(text, text, text) to service_role;

-- 6. Work of the other mode, which the configured key cannot check. The
--    job's claim parks it (no due time, marked MODE_CHANGED) for a person to
--    settle at the provider, and until now nothing told that person. The claim
--    now alerts the owners; the reconciliation screen lists such an attempt
--    (a parked refund stays in flight, so it was listed already); the admin
--    home counts both; and the retention purge and a buyer's erase keep the
--    order of such an attempt. An attempt counts while it has an invoice (there
--    is something at the provider to settle) and no payment settled it.

-- 6a. `payment_reconcile_claim` of 20261002100000_payment_core.sql: before it
--     parks them, an active attempt of the other mode that has an invoice
--     queues one owner alert `attempt_mode_changed:<attemptId>`, and an
--     in-flight refund of the other mode `refund_mode_changed:<refundId>`.
--     Otherwise identical:
--
-- The reconciliation job's work, leased: due attempts and refunds of the
-- configured mode and due events (an event of the other mode is closed by the
-- job as a mode mismatch). Due rows of the other mode are parked first. A lease pushes `next_check_at` two
-- minutes ahead, so an overlapping run does not take the same row; a
-- creating row older than 30 seconds first becomes uncertain.
create or replace function public.payment_reconcile_claim(p_mode text)
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
  -- So that a person knows to, an active attempt that has an invoice (a buyer
  -- may still pay it) and an in-flight refund are each alerted first, under
  -- the row's lock, once: the alert's subject is the row, and a parked row is
  -- not due again.
  perform finance.owner_alert(
            'attempt_mode_changed', s.id::text, jsonb_build_object('attemptId', s.id, 'orderId', s.order_id)
          )
     from (
       select a.id, a.order_id
         from finance.payment_attempts a
        where a.environment <> p_mode and a.next_check_at <= now()
          and a.status in ('creating', 'pending', 'uncertain') and a.provider_invoice_id is not null
        order by a.id
        for update
     ) s;
  perform finance.owner_alert(
            'refund_mode_changed', s.id::text, jsonb_build_object('refundId', s.id, 'orderId', s.order_id)
          )
     from (
       select r.id, r.order_id
         from finance.refunds r
        where r.status in ('submitting', 'uncertain') and r.next_check_at <= now()
          and coalesce(
                (select a.environment from finance.payment_attempts a where a.id = r.attempt_id),
                (select pr.environment from finance.payment_reviews pr where pr.provider_payment_id = r.review_payment_id)
              ) <> p_mode
        order by r.id
        for update
     ) s;
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
revoke all on function public.payment_reconcile_claim(text) from public, anon, authenticated;
grant execute on function public.payment_reconcile_claim(text) to service_role;

-- 6b. `reconciliation_list` of 20261002145000_order_operations.sql, with one
--     more reason, MODE_CHANGED. Otherwise identical:
--
-- What needs a person at the payment ledger, for the owner: attempts that are
-- uncertain, UNVERIFIED (and not settled since), paid with a provider status
-- other than paid or refunded (unless the money has all been refunded, which
-- is how a void ends), paid with a provider refunded total above the ledger's
-- confirmed plus in-flight refunds, or parked by the job for the other mode
-- with an invoice and not settled since (MODE_CHANGED); open review payments;
-- in-flight refunds (a refund parked for the other mode among them);
-- unprocessed webhook events and the exhausted ones that still need a person.
-- Each list is the newest 100.
-- {attempts: [attempt + orderNumber, refunded, reasons], reviews: [review +
-- orderNumber], refunds: [refund + orderNumber], events: [event]}; `reasons`
-- holds UNCERTAIN, UNVERIFIED, PROVIDER_STATUS, EXTERNAL_REFUND, MODE_CHANGED.
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

-- 6c. `orders_alerts` of 20261002145000_order_operations.sql, with two counts
--     widened (no key renamed). Otherwise identical:
--
-- The admin home's alerts, for owner and operations: counts only, plus the
-- low-stock list. needsResolution: orders waiting for `order_resolve`; review:
-- open review payments; toShip: paid orders with a line still to ship (the
-- `to_ship` filter); uncertainRefunds: refunds whose outcome is unknown, and
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

-- 6d. `finance.order_erasable` of 20261002170000_stats_disputes.sql, which
--     keeps an order whose attempt was parked for the other mode with an
--     invoice (MODE_CHANGED) exactly as it keeps an UNVERIFIED one: the
--     provider may hold money for it. Otherwise identical:
--
-- The retention rule (D42, round 2): an order that holds no money and no work.
-- It is expired or cancelled; none of its payment attempts is creating,
-- pending, uncertain, paid or review, still due for a check, marked
-- UNVERIFIED, or marked MODE_CHANGED with an invoice; it has no review payment
-- (open or closed: the row refers to the order) and no dispute. The daily
-- purge adds its 90 days; a buyer's erase has no age to wait for. Takes the
-- row, so the caller's own lock and snapshot of it are what is judged.
create or replace function finance.order_erasable(p_order finance.orders)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_order.status in ('expired', 'cancelled')
     and not exists (
       select 1 from finance.payment_attempts a
        where a.order_id = p_order.id
          and (a.status in ('creating', 'pending', 'uncertain', 'paid', 'review')
               or a.next_check_at is not null
               or a.last_error = 'UNVERIFIED'
               or (a.last_error = 'MODE_CHANGED' and a.provider_invoice_id is not null))
     )
     and not exists (select 1 from finance.payment_reviews r where r.order_id = p_order.id)
     and not exists (
       select 1 from finance.disputes d
        where d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = p_order.id)
     )
$$;
revoke all on function finance.order_erasable(finance.orders) from public, anon, authenticated, service_role;

-- 7. `order_resolve` of 20261002145000_order_operations.sql, with two
--    changes: before it commits, PAYMENT_REVERSED when the paying attempt's
--    money went back at the provider (its fetched status is refunded or
--    voided, or the provider's refunded total reaches what was captured), and
--    a commit that takes the order's coupon past its usage limit marks the
--    audit row `couponOverLimit`, as `apply_verified_payment` does. Otherwise
--    identical:
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
  -- records it, nothing is delivered.
  if v_attempt.provider_status in ('refunded', 'voided')
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

-- 8. Since when payment work has been waiting, like `outbox_due_since` for
--    the outbox (20260927150000_outbox_due_since.sql): the earliest due time
--    among the rows `payments_kick` wakes the reconciliation job for (an
--    attempt or a webhook event whose `next_check_at` has come, an in-flight
--    refund whose `next_check_at` has come), null when nothing is due. Rows
--    that wait for a person have no due time and never count. Private
--    (`finance` is not exposed) and invoker-owned.
create function finance.payments_due_since()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(
    (select min(a.next_check_at) from finance.payment_attempts a where a.next_check_at <= now()),
    (select min(e.next_check_at) from finance.payment_events e where e.next_check_at <= now()),
    (select min(r.next_check_at) from finance.refunds r
      where r.status in ('submitting', 'uncertain') and r.next_check_at <= now())
  )
$$;
revoke all on function finance.payments_due_since() from public, anon, authenticated, service_role;

-- The same answer for the admin home, behind the staff-role check of
-- `outbox_due_since`: an owner or operations.
create function public.payments_due_since()
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_staff_role()::text, '') not in ('owner', 'operations') then
    raise exception 'Only an owner or operations can see the payment work.' using errcode = 'insufficient_privilege';
  end if;
  return finance.payments_due_since();
end
$$;
revoke all on function public.payments_due_since() from public, anon;
grant execute on function public.payments_due_since() to authenticated;
