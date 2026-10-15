-- RESIDUALS-1, round R2a: the database items of the round, in one forward
-- migration. Every function is `create or replace` (a changed trigger is
-- dropped first), keeps its signature, return type, language, security and
-- `search_path`, and restates its grants, so the file is re-runnable. The
-- earlier migrations stay untouched. Each section names its item and says what
-- it changed in the function's latest definition (named in the section); the
-- rest is that definition.

-- 1. CONTRACT-03 = DB-POST-06: `refund_settle` of 20261002130000_refunds.sql,
--    with one change in its stale-read branch (the fetched total below
--    `before` and not below the refund's own starting total). That branch had
--    no clock: a provider total that stayed between the two kept the refund in
--    flight for ever, fetched every minute, with no alert, and every refund of
--    the payment answered REFUND_IN_FLIGHT. It now does exactly what the
--    not-landed branch does. Once `now() >= created_at + 15 minutes` the refund
--    is failed `NOT_APPLIED`, with no alert: a stale read is an out-of-order
--    read, not a decrease, and `refund_record_external` adopts a refund that
--    lands late only from `NOT_APPLIED`. Before that the refund backs off as
--    the not-landed branch does (`check_count` plus one, the doubling capped at
--    60 minutes and at the 15th minute of the refund's life) instead of being
--    looked at again in a minute. A total below the refund's own starting total
--    stays PROVIDER_TOTAL_DECREASED with the owner alert
--    `refund_total_decreased`, whatever the refund's age. Otherwise identical:
--
-- An in-flight refund, decided from a fresh fetch of the payment's total (the
-- job and the owner's recheck). The total tells everything:
-- - at least `before + amount`: it landed; anything above that is a refund
--   made outside, recorded in the same transaction;
-- - below this refund's own starting total: the provider's total went down,
--   which the documentation does not allow: failed, and the owners are told. A
--   total below `before` but not below that start is a read made before a
--   dashboard refund this function has since recorded (the job and the owner's
--   recheck fetch with no lock held): stale, so the refund only backs off, as
--   in the next point, and one that is 15 minutes old with its total still
--   below what was recorded is failed `NOT_APPLIED` like one that has not
--   landed;
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
    -- CONTRACT-03: a stale read is an out-of-order read, not a decrease: once the refund is 15 minutes old it ends as the
    -- not-landed branch below ends it, NOT_APPLIED and no alert.
    elsif now() >= v_refund.created_at + interval '15 minutes' then
      perform finance.refund_fail(v_refund.id, 'NOT_APPLIED');
    else
      -- A stale read decides nothing yet: the refund backs off as the not-landed branch below does, and a later fetch decides.
      update finance.refunds r
         set check_count = r.check_count + 1,
             next_check_at = least(
               now() + make_interval(mins => least(power(2, r.check_count), 60)::integer),
               r.created_at + interval '15 minutes'
             ),
             updated_at = now()
       where r.id = v_refund.id;
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
revoke all on function public.refund_settle(uuid, integer) from public, anon, authenticated;
grant execute on function public.refund_settle(uuid, integer) to service_role;

-- 2. DB-POST-09: `finance.refund_succeed` of 20261007110000_fable_audit_operations.sql,
--    with one change: the preorder reservation of a fully refunded item is
--    released only while no fulfilment of that order's line of that variant is
--    `shipped` or `delivered`. A copy that has left the shelf (refunded as
--    goodwill, the buyer keeps it) no longer frees a unit of preorder capacity
--    that cannot be sold again. An unshipped line, and a digital preorder line
--    (it has no fulfilment), release it as before. Otherwise identical:
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
--   their capacity is free again, unless a line of that order for that variant
--   has shipped or been delivered (the copy has left, its capacity stays
--   spent); a linked return becomes `refunded`; one
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
    -- DB-POST-09: not while a line of that variant has shipped or been delivered.
    update finance.inventory_reservations x
       set state = 'released', released_at = now()
     where x.order_id = v_order.id and x.preorder and x.state <> 'released'
       and x.variant_id in (
         select i.variant_id from finance.order_items i
          where i.order_id = v_order.id and coalesce(finance.item_fully_refunded(i.id), false)
       )
       and not exists (
         select 1 from finance.fulfillments f
           join finance.order_items i2 on i2.id = f.order_item_id
          where i2.order_id = x.order_id and i2.variant_id = x.variant_id and f.state in ('shipped', 'delivered')
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

-- 3. CONTRACT-10 = EF-MONEY-10: `public.payments_kick` of 20261002100000_payment_core.sql,
--    with one change: the call's `timeout_milliseconds` is 120000, not 15000.
--    One reconciliation run keeps taking rows for 60 seconds (`RUN_BUDGET_MS`
--    in `_shared/payments.ts`), and the row it is working on when that time is
--    spent can still take long: the usual worst row is an uncertain
--    attempt's adoption, which lists up to 5 pages of invoices (`LIST_PAGES`),
--    each call bounded at 10 seconds (`MOYASAR_TIMEOUT_MS` in
--    `_shared/payments/moyasar.ts`), so 60 seconds of budget plus 50 seconds
--    for that row is 110, which 120 seconds covers. It is not a bound: a
--    refused adoption adds a cancel call, and a pending attempt of a paid order
--    makes a cancel, an invoice fetch and one fetch per charged payment. At 15 seconds the caller
--    could hang up while the run was still working, and nothing here shows
--    what the function does with a request whose caller has gone: if it stops,
--    every run longer than 15 seconds ends without recording itself in
--    `finance.job_runs`. That behaviour is checked on the hosted project at P11
--    (a provider made slow, one attempt due, then `net._http_response` and
--    `finance.job_runs`); this constant only takes the caller's timeout out of
--    the question for runs that end inside 120 seconds. Otherwise identical:
--
-- Wakes the reconciliation job when a row of the three kinds is due, like
-- `outbox_kick`; rows that wait for a person have no due time and never
-- trigger it. Without the Vault values it does nothing.
create or replace function public.payments_kick()
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
  -- CONTRACT-10 = EF-MONEY-10: 120 s, above one run's 60 s budget plus the usual worst row (an uncertain attempt's
  -- adoption lists up to 5 pages at 10 s each: 110 s; not a bound, a refused adoption or a paid order's pending attempt
  -- makes a few more calls); a cold start of the function is inside it. Whether a run survives its caller hanging up is
  -- checked on the hosted project at P11.
  perform net.http_post(
    url := v_url || '/outbox',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('job', 'payments_reconcile'),
    timeout_milliseconds := 120000
  );
  return true;
end
$$;
revoke all on function public.payments_kick() from public, anon, authenticated;
grant execute on function public.payments_kick() to service_role;

-- 4. P08-CKPT-04: `public.payment_attempt_begin` of 20261002100000_payment_core.sql,
--    with one change: the hold's last minute (`HOLD_EXPIRED` under 60 seconds
--    left) no longer hides an invoice the order already has and that can still
--    be paid. A pending attempt whose invoice has not expired is answered
--    (state `pending`, its URL) whatever is left of the hold, by the lookup
--    that was already there; `HOLD_EXPIRED` stays for a new attempt, and for an
--    order whose invoice has ended. Before, a reload of the hold view in that
--    last minute ended the view and forgot the token while the invoice was
--    still payable. A creating or uncertain attempt keeps its place after the
--    check, as before. Otherwise identical:
--
-- The buyer's order by number and token, and the one invoice attempt of the
-- `checkout` function's `create` (p_ip_hash null) and `pay` (the caller's
-- hash, throttled 30 per hour). Business refusals are replies; a throttle
-- raises 54000 like checkout. Every reply after the token check, a refusal
-- included, carries `order`, so `pay` can always answer the order. An invoice
-- the order already has and that can still be paid (a pending attempt that has
-- not expired) is answered even in the hold's last minute: HOLD_EXPIRED is for
-- a new invoice.
create or replace function public.payment_attempt_begin(
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
  -- P08-CKPT-04: the hold's last minute keeps a NEW invoice from being made; an invoice that exists and can still be
  -- paid is answered below (state pending, its URL).
  if v_order.hold_expires_at < now() + interval '60 seconds'
    and not exists (
      select 1 from finance.payment_attempts a
       where a.order_id = v_order.id and a.status = 'pending' and a.invoice_expires_at > now()
    )
  then
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
revoke all on function public.payment_attempt_begin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.payment_attempt_begin(text, text, text, text) to service_role;

-- 5. DB-COMMERCE-04: `finance.order_try_commit` of 20261007100000_fable_audit_payments.sql,
--    with two changes. First, the stock check and the decrement go by the line's
--    reservation, not by the variant's stock column as it is at payment. A line
--    without a reservation needs no stock; a line with one is judged by its
--    reservation's preorder flag as before (the capacity while its variant is
--    still a preorder, the stock otherwise). Round 4's rule gives every line
--    that takes stock a reservation: `checkout_create` reserves each physical
--    or signed line and each preorder line, and the variants table ties stock
--    to the non-digital variants (`(fulfillment = 'digital') = (stock is null)`),
--    so a line with a stock and no reservation can only come from the owner
--    changing the variant after the order (a digital variant made physical
--    with a stock): it is no longer refused for that stock, or made to take a
--    copy out of it, while the buyer gets a file. A line whose variant lost its
--    stock (made digital) has nothing to check or take, as before. Second, a
--    line the order recorded as digital (`order_items.fulfillment`: the buyer
--    gets a file) takes no stock at all, whatever its variant is by payment: it
--    is not judged by the stock and does not decrement it. That is the digital
--    preorder line (it has a reservation) whose variant the owner made
--    physical, no longer a preorder, with a stock, which the first change alone
--    would still have refused for that stock or made to take a copy. A digital
--    preorder line whose variant is still a preorder is judged by the capacity,
--    as before. Otherwise identical:
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
--   still a preorder; every other line that has a reservation and a stock, by
--   the stock, unless the order recorded it as digital; a line without a
--   reservation, or recorded as digital, needs no stock.
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
    select i.variant_id, i.quantity, i.fulfillment, v.stock, v.preorder_capacity,
           coalesce(x.state = 'held' and x.expires_at > now(), false) as own_hold,
           coalesce(x.preorder, false) as res_preorder, v.preorder as var_preorder
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      -- DB-COMMERCE-04: by the line's reservation; a line without one needs no stock.
      join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     order by i.line_no
  loop
    v_own := r.own_hold;
    if r.res_preorder and r.var_preorder then
      v_free := coalesce(r.preorder_capacity, 0) - finance.preorder_committed(r.variant_id)
        - case when v_own then 0 else finance.active_holds(r.variant_id) end;
    -- DB-COMMERCE-04: a line the order recorded as digital takes no stock, whatever its variant is by now.
    elsif r.stock is not null and r.fulfillment <> 'digital' then
      v_free := r.stock - case when v_own then 0 else finance.active_holds(r.variant_id) end;
    else
      continue;
    end if;
    if v_free < r.quantity then
      return false;
    end if;
  end loop;

  -- A preorder hold whose variant is no longer a preorder was judged by the
  -- stock rule above and takes stock below, unless the order recorded the line
  -- as digital (R2a, F5): it is committed as a stocked unit.
  update finance.inventory_reservations x
     set state = 'committed', released_at = null, preorder = x.preorder and v.preorder
    from public.product_variants v
   where v.id = x.variant_id and x.order_id = p_order and x.state <> 'committed'
     and x.variant_id in (
       select i.variant_id from finance.order_items i
        where i.order_id = p_order and not coalesce(finance.item_fully_refunded(i.id), false)
     );

  -- Stock goes down for the stocked lines (every line with a reservation but a
  -- preorder reservation on a variant that is still a preorder, and never a
  -- line the order recorded as digital: R2a, DB-COMMERCE-04 and F5) through an
  -- ordinary UPDATE, so the catalog triggers audit it.
  for r in
    select v.id as variant_id, v.stock, v.low_stock_threshold, i.quantity
      from finance.order_items i
      join public.product_variants v on v.id = i.variant_id
      -- DB-COMMERCE-04: only a line with a reservation takes stock, and never a line the order recorded as digital.
      join finance.inventory_reservations x on x.order_id = i.order_id and x.variant_id = i.variant_id
     where i.order_id = p_order and v.stock is not null and not (coalesce(x.preorder, false) and v.preorder)
       and i.fulfillment <> 'digital'
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

-- 6. DB-COMMERCE-08: the build trigger of `public.products`
--    (20260927160000_catalog_and_checkout.sql), made like the variants' one
--    (20260930140000_audit2_fixes.sql section 8, 20261002100000_payment_core.sql).
--    The statement trigger `update of ...` fired whenever a listed column was in
--    the SET list, changed or not, even for a statement that matched no row,
--    and for a draft product, so every save of a draft, every re-save and every
--    lost version conflict asked for a Pages build (500 a month on the free
--    plan, I32 (3)). The statement trigger now stays for insert and delete
--    only. An update is a row trigger that asks for a build only when a public
--    column changed and the product is or was published (a product leaving or
--    entering the public shelf is a change the pages show).
--
drop trigger if exists products_request_build on public.products;
create trigger products_request_build
  after insert or delete on public.products
  for each statement execute function public.catalog_request_build();
drop trigger if exists products_request_build_update on public.products;
create trigger products_request_build_update
  after update on public.products
  for each row
  when (
    (old.slug, old.title, old.summary, old.body, old.cover_image, old.status, old.sort_order)
    is distinct from
    (new.slug, new.title, new.summary, new.body, new.cover_image, new.status, new.sort_order)
    and (old.status = 'published' or new.status = 'published')
  )
  execute function public.catalog_request_build();

-- 6b. `public.catalog_request_build` of 20260927160000_catalog_and_checkout.sql,
--     with one change: a row call for a variant (the variants' update trigger)
--     asks for no build when neither the product the variant belonged to nor
--     the one it belongs to is published, because a variant of a draft or
--     archived product is on no public page. A price change on such a variant
--     no longer starts a Pages build. The statement calls (insert and delete)
--     and the products' row calls are not filtered here. Otherwise identical:
--
-- Product and variant changes the public pages show ask for a site rebuild
-- (D32), coalesced by `site_build_trigger` like a content publish. A stock
-- change does not: the pages show prices, and the cart reads stock live. A row
-- call for a variant whose product is not published asks for nothing.
create or replace function public.catalog_request_build()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- DB-COMMERCE-08: a variant of a product that is not published, before or after the update, is on no public page.
  if tg_level = 'ROW' and tg_table_name = 'product_variants' then
    if not exists (
      select 1 from public.products p where p.id in (old.product_id, new.product_id) and p.status = 'published'
    ) then
      return null;
    end if;
  end if;
  perform public.site_build_request();
  return null;
end
$$;
revoke all on function public.catalog_request_build() from public, anon, authenticated;

-- 7. DB-COMMERCE-09: the coupon code of `finance.checkout_price` and
--    `public.checkout_create` (both of 20261015120000_residuals_r1.sql). The
--    one normalization both use now folds the Arabic-Indic digits (U+0660 to
--    U+0669) and the Persian ones (U+06F0 to U+06F9) to ASCII, besides case and
--    spaces: a buyer who types EID25 on the Arabic layout (the digits of 25
--    written in Arabic-Indic) gets the coupon, not COUPON_INVALID. The codes
--    are checked as `^[A-Z0-9]{3,32}$` in `public.coupons`, so no stored code
--    holds such a digit. Nothing else in the two functions changes.
--
-- 7a. `finance.checkout_price`:
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
  v_code text := nullif(translate(upper(btrim(coalesce(p_coupon_code, ''))), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '');
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

-- 7b. `public.checkout_create`:
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
  v_code text := nullif(translate(upper(btrim(coalesce(p_coupon_code, ''))), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '');
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

-- 8. CONTRACT-13 with DB-POST-08: `orders_alerts` of 20261007110000_fable_audit_operations.sql,
--    with one more count, `providerStatus`: the paid attempts that
--    `reconciliation_list` lists with the PROVIDER_STATUS reason (the provider
--    no longer calls the payment `paid` or `refunded`, a void for instance, and
--    the ledger's confirmed refunds are below what was captured). Such a payment
--    stays `paid` with its lines in «للشحن», so the owner's «تحتاج مطابقة» showed
--    0 for it. An attempt that `externalRefunds` already counts is counted
--    there only, so one row of the screen is one in the count. The refunds in
--    flight are not widened: M1a-3c's `uncertainRefunds` already counts the
--    ones that need a person (uncertain, or submitting with no check scheduled
--    after 24 hours or parked for the other mode), and the ones whose check is
--    still scheduled are the job's own and stay with the screen. Otherwise
--    identical:
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
-- ledger's confirmed plus in-flight refunds (a refund to record); providerStatus:
-- paid attempts the provider no longer calls paid or refunded (a void) while the
-- ledger's confirmed refunds are below the captured amount, other than the ones
-- `externalRefunds` counts (the PROVIDER_STATUS reason of `reconciliation_list`).
-- «تحتاج مطابقة» (the sum of the five counts above, in the client) leaves to the
-- reconciliation screen the rows the job is still working on: an attempt whose
-- creation is uncertain, a refund submitting with a check scheduled and a webhook
-- event not yet processed. lowStock: the
-- enabled, published, stocked variants at or under their threshold (not the
-- preorder ones: their stock is ignored), the fewest first, at most 100.
-- {needsResolution, review, toShip, uncertainRefunds, unverifiedAttempts,
-- exhaustedEvents, externalRefunds, providerStatus, lowStock: [{variantId, sku, title, stock,
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
    -- CONTRACT-13: the PROVIDER_STATUS reason of `reconciliation_list`, less the attempts `externalRefunds` counts.
    'providerStatus', (
      select count(*) from finance.payment_attempts a
       where a.status = 'paid' and a.provider_status not in ('paid', 'refunded')
         and finance.attempt_refunds_confirmed(a.id) < coalesce(a.captured_halalas, 0)
         and a.provider_refunded_halalas <= finance.attempt_refunds_known(a.id)
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

-- 9. The outbox (EF-ADMIN-13, DB-CORE-07, DB-CORE-04).
--
-- 9a. EF-ADMIN-13: a row that had an attempt of unknown outcome. `possibly_sent`
--     is true once an attempt on the row's current idempotency key ended
--     uncertain (a send that timed out or got no readable answer, a lease that
--     expired mid-send): that attempt may have been delivered. It is set where
--     the row becomes uncertain, kept by every later attempt, and cleared with
--     the key (a replay that rotates it). `outbox_result` and `outbox_replay`
--     read it, so a row that may have been sent never becomes `pending` again (a
--     pending row is claimed whenever it is due, however old its first attempt,
--     and could then go out under an expired key): a retry, a QUOTA or
--     PROVIDER_CONFIG give-back and a replay inside the window all keep it
--     `uncertain`, and the claim's 23-hour guard (an uncertain row is claimed
--     only within 23 hours of its first attempt, the idempotency key lives 24)
--     applies. A row that is already `uncertain` when this file runs is marked
--     by the update below.
--
alter table finance.email_outbox add column if not exists possibly_sent boolean not null default false;
-- A row already `uncertain` is treated as one that may have been sent (nearly always it is: it got there after an attempt of
-- unknown outcome), so the rules of this section apply to it from now on.
update finance.email_outbox set possibly_sent = true where status = 'uncertain' and not possibly_sent;

-- 9b. EF-ADMIN-13: `outbox_result` of 20261007110000_fable_audit_operations.sql,
--     with three changes. An uncertain outcome (which sets the row `uncertain`, or
--     `exhausted` at the attempts cap) sets `possibly_sent`. A plain retry
--     (an outcome `retry` that is not a QUOTA or PROVIDER_CONFIG give-back) of a
--     row with `possibly_sent` leaves it `uncertain`, with the same backoff,
--     where it left it `pending`: a pending row can wait behind the tier caps for
--     more than a day and was then claimed again with an expired key, a duplicate
--     for the buyer. And the give-back branch (QUOTA, PROVIDER_CONFIG) does the
--     same for a row with `possibly_sent`: `uncertain` whatever the wait, with
--     its first attempt kept even when this was its first attempt since a replay
--     (`attempts = 1`: a replay inside the window keeps the key and the mark). A
--     row without the mark keeps the old rule: `uncertain` when it had an
--     earlier attempt and the wait is past the window, `pending` otherwise, and
--     its first attempt cleared when nothing reached the provider. Otherwise
--     identical:
--
-- Two fixes in outbox_result; otherwise identical to 20260930120000_audit_fixes.sql.
--
-- S04.2 follow-up: when the only attempt so far (attempts = 1) was refused
-- with a QUOTA 429, nothing reached the provider, so no idempotency window
-- has started for this key. first_attempt_at is cleared and the window starts
-- at the next real attempt. Left set, a quota wait of a day or more made the
-- next ambiguous send look older than 23 hours, and a person had to confirm a
-- duplicate risk that did not exist. It is kept when attempts > 1 or the row is
-- marked `possibly_sent`, because an earlier attempt may have been sent.
--
-- S04.4 follow-up: the accept reads the delivery events in its UPDATE and the
-- webhook (email_event_record) reads provider_id in its own, each with its own
-- statement snapshot, so two overlapping transactions each missed the other's
-- uncommitted write and the event was applied to no row. Both take this
-- per-message advisory lock first (before any row lock), so the second runs
-- its statements after the first has committed.
--
-- EF-ADMIN-13: `possibly_sent` marks a row that had an attempt of unknown
-- outcome. The uncertain outcomes set it; a plain retry or a give-back of a
-- marked row leaves it `uncertain` (never `pending`), so the claim's 23-hour
-- guard applies to it.
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
    -- EF-ADMIN-13: a row that may have been sent is never pending again, and keeps its first attempt for the claim's guard.
    update finance.email_outbox
    set status = case when o.possibly_sent or (o.attempts > 1 and v_next > o.first_attempt_at + interval '23 hours')
                      then 'uncertain' else 'pending' end,
        attempts = o.attempts - 1, last_error = p_error, next_at = v_next,
        first_attempt_at = case when o.attempts = 1 and not o.possibly_sent then null else o.first_attempt_at end,
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'uncertain' and o.attempts >= o.max_attempts then
    update finance.email_outbox
    set status = 'exhausted', possibly_sent = true, last_error = left(p_error, 120),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('email.exhausted', 'email_outbox', p_id::text,
            jsonb_build_object('status', 'uncertain', 'attempts', o.attempts, 'lastError', left(p_error, 120)));
  elsif p_outcome = 'uncertain' then
    update finance.email_outbox
    set status = 'uncertain', possibly_sent = true, last_error = left(p_error, 120),
        next_at = now() + make_interval(mins => least(power(2, o.attempts), 60)::integer),
        lease_id = null, lease_until = null, updated_at = now()
    where id = p_id;
  elsif p_outcome = 'retry' and o.attempts < o.max_attempts then
    -- EF-ADMIN-13: a row that had an uncertain attempt stays uncertain, so the claim's 23-hour guard applies.
    update finance.email_outbox
    set status = case when o.possibly_sent then 'uncertain' else 'pending' end, last_error = left(p_error, 120),
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

-- 9c. EF-ADMIN-13: `outbox_claim` of 20261007110000_fable_audit_operations.sql,
--     with one change: the expired-lease flip (a send whose outcome is unknown)
--     sets `possibly_sent` too, whether the row goes `uncertain` or `exhausted`.
--     Otherwise identical:
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
--
-- EF-ADMIN-13: the expired-lease flip (the send's outcome is unknown) also sets
-- `possibly_sent`, which `outbox_result` and `outbox_replay` read.
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
        possibly_sent = true,
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

-- 9d. DB-CORE-07 and EF-ADMIN-13: `outbox_replay` of 20261007120000_fable_audit_second_pass.sql,
--     with three changes. A null `p_accept_duplicate_risk` is no consent: past the
--     23-hour window `v_ambiguous and not coalesce(p_accept_duplicate_risk, false)`
--     refuses it as it refuses false (a null made the condition null, the check
--     did not fire, and the row was replayed with a fresh key and no recorded
--     acceptance). The replay clears `possibly_sent` exactly when it rotates
--     the idempotency key (the new key has not been used by any attempt); a
--     replay inside the window keeps the key, the first attempt and the flag.
--     And a row that keeps the flag is queued `uncertain`, not `pending` (it is
--     due at once, and the claim takes it only within 23 hours of its first
--     attempt): a pending row is claimed whenever it is due, and the attempt
--     that follows could go out under an expired key. A row replayed past the
--     window, or a sent mail the provider reported failed, gets a new key and a
--     clear flag and is `pending`, as before. Otherwise identical:
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
  if v_ambiguous and not coalesce(p_accept_duplicate_risk, false) then
    raise exception 'This message may already have been sent; confirm the duplicate risk.' using errcode = 'object_not_in_prerequisite_state';
  end if;
  update finance.email_outbox
  set status = case when o.possibly_sent and not (coalesce(v_ambiguous, false) or v_failed) then 'uncertain' else 'pending' end,
      attempts = 0, next_at = now(), last_error = null,
      idempotency_key = case when v_ambiguous or v_failed then gen_random_uuid() else o.idempotency_key end,
      first_attempt_at = case when v_ambiguous or v_failed then null else o.first_attempt_at end,
      possibly_sent = case when v_ambiguous or v_failed then false else o.possibly_sent end,
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

-- 9e. DB-CORE-04: `outbox_attention` of 20261007120000_fable_audit_second_pass.sql,
--     with one change: the replayable rows (`exhausted`, `uncertain`: what the
--     screen's replay button offers) come first, then the newest, so while fewer
--     than 200 rows are replayable the cap of 200 drops only rows nobody can act
--     on (suppressed rows, and sent mail with a bounce, a complaint or a
--     failure, none of which leaves this list). Before, they were ordered by
--     creation time alone, and as such rows piled up an older exhausted receipt
--     or order link dropped off the list and out of the home's count. Otherwise
--     identical:
--
-- The dispatcher closes a row without sending when the state moved on after the
-- mail was queued: the subscriber confirmed or unsubscribed (NOT_PENDING,
-- NOT_CONFIRMED), the file was revoked (NO_FILE). Like RECIPIENT_INACTIVE that
-- is not an open problem: nothing can be replayed or fixed for it. A row closed
-- for another reason (a missing order, a shipment or a refund that is not there)
-- stays listed. Otherwise identical to 20260930140000_audit2_fixes.sql.
--
-- DB-CORE-04: the replayable rows (exhausted, uncertain) come first, then the
-- newest, so while fewer than 200 rows are replayable the cap of 200 drops only
-- rows nobody can act on.
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
  order by (o.status in ('exhausted', 'uncertain')) desc, o.created_at desc
  limit 200;
end
$$;
revoke all on function public.outbox_attention() from public, anon;
grant execute on function public.outbox_attention() to authenticated;

-- 10. The notifications (DB-OPS-03, -04, -06, -07).
--
-- 10a. DB-OPS-03 = EF-ACCESS-05: `finance.notifications_purge` of 20261002150000_notifications.sql,
--      with one change: a pending row is aged by the later of its last request
--      (`updated_at`) and the confirmation mail it last queued (`confirm_sent_at`),
--      so the row lives as long as the link its mail carries. The hourly backlog
--      queues a held-back confirmation days after the sign-up, and queueing the
--      mail does not touch `updated_at`: the purge used to delete the row, and its
--      unsent mail, at sign-up plus 7 days, however late the mail went, and the
--      link (7 days from `confirm_sent_at`, honoured by the `notify` function)
--      died early or never arrived. Otherwise identical:
--
-- Daily. An `unsubscribed` row goes 30 days after it was unsubscribed and a
-- `pending` one 7 days after its last request or after the confirmation mail it
-- last queued, the later (the link lives 7 days from that mail),
-- with the mail it still had unsent; a `confirmed` row never goes. An availability
-- row that no subscription refers to any more goes too. By then the purge holds
-- notification rows, and a sign-up takes the availability row first, so waiting for
-- one would be the reverse of that order and the two would deadlock: the purge
-- locks the orphan rows that nobody holds (a row a sign-up holds is no orphan, it
-- is getting its subscription) and the next run takes what it passed by. It
-- deletes what it locked in a new statement, which sees what a sign-up committed
-- meanwhile. One count-only audit row, like the buyer-retention purge; no address,
-- no id.
create or replace function finance.notifications_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notes integer;
  v_mail integer;
  v_orphans uuid[];
  v_availability integer;
begin
  with gone as (
    delete from public.notifications n
     where (n.status = 'unsubscribed' and n.unsubscribed_at < now() - interval '30 days')
        or (n.status = 'pending' and greatest(n.updated_at, coalesce(n.confirm_sent_at, n.updated_at)) < now() - interval '7 days')
    returning n.id
  ), mail as (
    delete from finance.email_outbox o
     where o.kind in ('notify_confirm', 'availability')
       and o.payload ->> 'notificationId' in (select g.id::text from gone g)
       and o.status not in ('sent', 'sending')
    returning o.id
  )
  select (select count(*) from gone), (select count(*) from mail) into v_notes, v_mail;

  select coalesce(array_agg(o.variant_id), '{}') into v_orphans
    from (select a.variant_id
            from finance.variant_availability a
           where not exists (select 1 from public.notifications n where n.variant_id = a.variant_id)
             for update skip locked) o;
  delete from finance.variant_availability a
   where a.variant_id = any (v_orphans)
     and not exists (select 1 from public.notifications n where n.variant_id = a.variant_id);
  get diagnostics v_availability = row_count;

  if v_notes + v_mail + v_availability > 0 then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('privacy.notifications_purge', 'notifications', null,
            jsonb_build_object('notifications', v_notes, 'mail', v_mail, 'availability', v_availability));
  end if;
  return v_notes;
end
$$;
revoke all on function finance.notifications_purge() from public, anon, authenticated, service_role;

-- 10b. DB-OPS-04: `public.notify_subscribe` of 20261002150000_notifications.sql,
--      with one change: when the `for update` on the variant's availability row
--      finds no row (the daily purge locked it as an orphan and deleted it while
--      this sign-up waited: the insert before it had conflicted with the live row
--      and stored nothing), the row is inserted again (`on conflict do nothing`)
--      and locked, until a row is held; then the sign-up goes on as before. The
--      subscriber was stored with no availability row, and the sweep, which
--      reads only those rows, could never tell him the item was back.
--      Otherwise identical:
--
-- The visitor's request for a variant that is out of stock. Throttled 5 per hour
-- per caller hash (54000 when over, before anything is read). Then only a variant
-- that is published, enabled and out of stock does anything; for every other
-- variant the answer is the same `{ok: true}`. Creates the row as `pending`, or
-- re-opens an `unsubscribed` one as `pending` (a new subscription: its old links
-- died with the unsubscribe), and leaves a `confirmed` row exactly as it is. The
-- variant's availability row is created with `sellable = false`; a stale `true`
-- (the variant sold out again while nobody confirmed was waiting) is made false,
-- because the variant is out of stock now and its next restock must be a new
-- revision, one that every subscriber is told, whoever was told the last. Both
-- are decided under the availability row's lock, with the state read again: a
-- sign-up that waited behind a sweep which saw a restock stores nothing and
-- leaves the row as the sweep set it.
--
-- The confirmation mail is `finance.notify_confirm_queue`'s, with its caps.
create or replace function public.notify_subscribe(p_ip_hash text, p_email text, p_variant uuid, p_consent_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note public.notifications;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or p_variant is null
    or char_length(v_email) not between 3 and 254
    or v_email !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  then
    raise exception 'Invalid notification request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('notify:ip', p_ip_hash, 5, interval '1 hour') then
    raise exception 'Too many requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  if finance.variant_public_state(p_variant) is distinct from 'out_of_stock' then
    return jsonb_build_object('ok', true);
  end if;

  -- The availability row, locked, and the state read again under it (a new statement sees what was committed while
  -- this one waited): a sweep that held the row may have seen a restock, and the variant is then on sale.
  -- DB-OPS-04: when the purge deleted the row this sign-up waited for, the insert is made again and the new row locked,
  -- until a row is held (ponytail: unbounded, but each further pass needs another purge to delete the row again).
  loop
    insert into finance.variant_availability (variant_id) values (p_variant) on conflict (variant_id) do nothing;
    perform 1 from finance.variant_availability a where a.variant_id = p_variant for update;
    exit when found;
  end loop;
  if finance.variant_public_state(p_variant) is distinct from 'out_of_stock' then
    return jsonb_build_object('ok', true);
  end if;
  update finance.variant_availability a set sellable = false, changed_at = now() where a.variant_id = p_variant and a.sellable;

  -- A confirmed row fails the update's condition: nothing changes and nothing returns.
  insert into public.notifications as n (email, variant_id, status, consent_revision)
  values (v_email, p_variant, 'pending', p_consent_revision)
  on conflict (email, variant_id) do update
    set status = 'pending',
        consent_revision = excluded.consent_revision,
        confirm_sent_at = case when n.status = 'unsubscribed' then null else n.confirm_sent_at end,
        confirmed_at = null,
        unsubscribed_at = null,
        updated_at = now()
    where n.status <> 'confirmed'
  returning n.* into v_note;
  if not found then
    return jsonb_build_object('ok', true);
  end if;

  perform finance.notify_confirm_queue(v_note.id);
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.notify_subscribe(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.notify_subscribe(text, text, uuid, integer) to service_role;

-- 10c. DB-OPS-06: `finance.notify_confirm_backlog` of 20261002150000_notifications.sql,
--      with two changes. It iterates with `for update skip locked`. A row a
--      sign-up holds is left for that sign-up or the next hour, so the backlog
--      never waits for a notification row while it holds the shared
--      `notify-confirm:all` allowance row, which a sign-up for the same address
--      waits for after taking that row: a cycle, and PostgreSQL aborted one side
--      with 40P01 (the visitor's generic error, or the hour's mails rolled
--      back). A second cycle was left between the backlog and a sign-up of the
--      same address for another variant: the sign-up holds the address's own
--      allowance row and asks for the shared one, which the backlog holds from an
--      earlier mail while it asks for that address's allowance row. So the
--      backlog now tries the address's advisory lock (`pg_try_advisory_xact_lock`
--      on the key `finance.notify_confirm_queue` takes, 10d) for each row, and
--      leaves the row for that sign-up or the next hour when it is held.
--      Otherwise identical:
--
-- Hourly. The pending rows a cap left without their confirmation mail (the day's
-- 30 were spent, or the address had its mail for another variant that day), the
-- longest waiting first, until the day's total is spent. It takes notification
-- rows only, one at a time, so it waits for nobody's availability row, and it
-- skips a row another writer holds, and a row whose address a sign-up is
-- queueing a mail for (the address's advisory lock is held). Answers the mails
-- queued.
-- ponytail: the 200 longest waiting per run; a row held by its address's caps is
-- passed over each hour until the purge takes it (7 days after its last request).
create or replace function finance.notify_confirm_backlog()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_queued integer := 0;
begin
  for r in
    select n.id, n.email from public.notifications n
     where n.status = 'pending' and n.confirm_sent_at is null
     order by n.updated_at, n.id
     limit 200
       for update skip locked
  loop
    -- DB-OPS-06: a sign-up of this address is queueing its mail under the address's lock: the row is left for it or the next hour.
    continue when not pg_try_advisory_xact_lock(hashtextextended('notify-confirm:' || r.email, 0));
    v_result := finance.notify_confirm_queue(r.id);
    exit when v_result = 'total';
    if v_result = 'queued' then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end
$$;
revoke all on function finance.notify_confirm_backlog() from public, anon, authenticated, service_role;

-- 10d. DB-OPS-07: `finance.notify_confirm_queue` of 20261007120000_fable_audit_second_pass.sql,
--      with two changes. For a suppressed address (`finance.email_suppressions`:
--      a bounce, a complaint) it answers `address` before the brake and before
--      any allowance is taken. The outbox suppresses that mail at the claim
--      anyway, so queueing it only spent one of the day's 30 confirmation slots
--      and left a `suppressed` row in the mail attention list. And before its
--      first allowance row it takes the address's advisory lock
--      (`pg_advisory_xact_lock` on `hashtextextended('notify-confirm:' ||
--      email, 0)`, held to the end of the transaction), which the hourly backlog
--      (10c) tries for each row and leaves when it is held: a sign-up and the
--      backlog no longer meet over the allowance rows of one address in
--      opposite orders (the cycle PostgreSQL aborted with 40P01). Otherwise
--      identical:
--
-- The confirmation mail of a pending row, queued when the caps allow: one per
-- address per UTC day whatever the variant, five per address in 30 days (counted
-- from the outbox: a stranger who keeps signing a victim up, also after an
-- unsubscribe, is stopped there), and 30 a day in all (the outbox sends at most 30
-- as well). Every cap is silent: the row stays, and the hourly backlog job queues
-- what a cap held back, so a visitor who was told "sent" does get the mail. Queued
-- once per row, version and day (the dedupe key); `confirm_sent_at` records when,
-- which is what the link's seven days run from. Answers `queued`, or which cap
-- refused (`address`, `total`; `address` also for a suppressed address), or
-- `gone` for a row that is not pending.
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
  -- DB-OPS-07: a suppressed address (a bounce, a complaint) gets no confirmation and spends no allowance.
  if exists (select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(v_note.email)) then
    return 'address';
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
  -- DB-OPS-06: one writer at a time per address, taken before any allowance row, so a sign-up and the hourly backlog never
  -- hold the address's allowance row and the shared one in opposite orders.
  perform pg_advisory_xact_lock(hashtextextended('notify-confirm:' || v_note.email, 0));
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

-- 10e. DB-OPS-07: `finance.availability_sweep` of 20261007120000_fable_audit_second_pass.sql,
--      with one change: the due rows skip a suppressed address. The notice used
--      to be queued for him on every restock and closed `suppressed` at the
--      claim, an entry in the mail attention list nobody can act on. His
--      subscription stays as it is (not marked told), so lifting the
--      suppression tells him at the next run. Otherwise identical:
--
-- Every minute. For each availability row that has a confirmed subscriber, and
-- only those: is the variant sellable now (on the public shelf, priced, and
-- `available` or `preorder`)? False to true adds one to the revision; true to
-- false just stores false. While the variant is sellable, each confirmed
-- subscriber who has not been told the row's revision (a suppressed address is
-- skipped) gets one `availability` mail
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
           -- DB-OPS-07: a suppressed address is not told, and not marked told.
           and not exists (
             select 1 from finance.email_suppressions s where s.recipient_hash = finance.recipient_hash(n.email)
           )
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

-- 11. TEST-E2E-03: `public.staff_directory` of 20260925090000_audit_and_staff_directory.sql,
--     with one change: the list is ordered `active desc, created_at desc`. The
--     team screen asks for no range and PostgREST cuts a reply at `max_rows`
--     (1000) without a word, so with the oldest members first the cut dropped
--     the newest, a member just invited among them. Active members come first
--     and the newest first within each group, so the cut keeps the newest
--     1,000, active first: while fewer than 1,000 members are active, only
--     inactive ones are cut (the oldest of them). Otherwise identical:
--
-- staff_directory(): the team screen's list, owner only. Emails stay in
-- auth.users (no copy that could drift); has_totp shows who has enrolled
-- an authenticator app. Active members first, the newest first within each
-- group (TEST-E2E-03: a reply is cut at max_rows, so the cut keeps the newest
-- 1,000, active first; while fewer than 1,000 members are active, only
-- inactive ones are cut).
create or replace function public.staff_directory()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.staff_role,
  active boolean,
  has_totp boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select public.current_staff_role()) is distinct from 'owner' then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.user_id, u.email::text, s.display_name, s.role, s.active,
           exists (
             select 1 from auth.mfa_factors f
             where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'
           ),
           s.created_at
    from public.staff s
    join auth.users u on u.id = s.user_id
    order by s.active desc, s.created_at desc;
end
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;
