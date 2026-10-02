-- P08 round 9: statistics that equal the ledger, append-only disputes, and the
-- buyer's privacy export and erase (PLANS/P08-CONTRACT.md section 6,
-- "Statistics, disputes, privacy (round 9)"). Functions only: the tables are
-- round 2's. Two earlier functions are replaced, each so that this round reuses
-- what it needs instead of copying it, and each otherwise exactly as written:
-- `finance.refund_succeed` (round 6: its entitlement revocation moves into
-- `finance.entitlements_revoke`, which a dispute's `entitlement_revoked` calls
-- too) and `finance.buyer_retention_purge` (round 2: its rule for which orders
-- may go moves into `finance.order_erasable` and its deletes into
-- `finance.orders_delete`, which the buyer's erase uses too). The daily purge of
-- processed webhook events older than 180 days, which round 2's contract left to
-- this round, is `finance.payment_events_purge`.
--
-- One lock order for every writer (contract, rules at the top): `dispute_record`
-- takes the order row first when its target has an order, then the attempt (a
-- review payment's row in its place), and writes no stock, no reservation, no
-- coupon and no refund. `privacy_buyer_erase` locks every order of the address
-- in ascending id before it touches any notification, mail or order row.
--
-- Business refusals are replies (`{ok: false, code}`); a malformed call raises
-- 22023. Money is integer halalas. Nothing here stores a token or a secret, and
-- no free text a person typed is copied into an audit row.

-- 1. Internal helpers (finance: no API role, service_role included) ---------

-- The one place an entitlement is revoked: the named items of an order, those
-- not revoked yet (a revoked one keeps its first reason). A download that was
-- issued before is closed by this alone (`download_redeem` and `download_issue`
-- read `revoked_at`). Answers how many entitlements it revoked.
create function finance.entitlements_revoke(p_order uuid, p_items uuid[], p_reason text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update finance.entitlements e
     set revoked_at = now(), revoke_reason = p_reason
   where e.order_id = p_order and e.order_item_id = any (p_items) and e.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- The retention rule (D42, round 2): an order that holds no money and no work.
-- It is expired or cancelled; none of its payment attempts is creating,
-- pending, uncertain, paid or review, still due for a check, or marked
-- UNVERIFIED; it has no review payment (open or closed: the row refers to the
-- order) and no dispute. The daily purge adds its 90 days; a buyer's erase has
-- no age to wait for. Takes the row, so the caller's own lock and snapshot of it
-- are what is judged.
create function finance.order_erasable(p_order finance.orders)
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
               or a.last_error = 'UNVERIFIED')
     )
     and not exists (select 1 from finance.payment_reviews r where r.order_id = p_order.id)
     and not exists (
       select 1 from finance.disputes d
        where d.attempt_id in (select a.id from finance.payment_attempts a where a.order_id = p_order.id)
     )
$$;

-- The deletes of an erasable order, in the one order the foreign keys allow: the
-- webhook events of its attempts' payments, the attempts, items, reservations
-- and coupon uses, then the orders. The caller holds the order locks and has
-- judged them with `finance.order_erasable`. Answers how many orders went.
create function finance.orders_delete(p_orders uuid[])
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
  delete from finance.payment_attempts where order_id = any (p_orders);
  delete from finance.order_items where order_id = any (p_orders);
  delete from finance.inventory_reservations where order_id = any (p_orders);
  delete from finance.coupon_redemptions where order_id = any (p_orders);
  delete from finance.orders where id = any (p_orders);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- A buyer's address as checkout stores it (`lower(btrim())`, the contact
-- grammar); anything else is a malformed call. The domain of an internationalized
-- address is its punycode form, as the functions store it.
create function finance.buyer_address(p_email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) not between 3 and 254
    or v_email !~ '^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.([A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})$'
  then
    raise exception 'Invalid address.' using errcode = 'invalid_parameter_value';
  end if;
  return v_email;
end
$$;

-- A dispute row as the staff see it: the shape `order_detail` shows.
create function finance.dispute_json(d finance.disputes)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'providerRef', d.provider_ref, 'seq', d.seq,
    'attemptId', d.attempt_id, 'reviewPaymentId', d.review_payment_id, 'environment', d.environment,
    'amount', d.amount_halalas, 'direction', d.direction, 'occurredOn', d.occurred_on,
    'reason', d.reason, 'resolution', d.resolution, 'decision', d.decision, 'itemIds', d.item_ids,
    'createdAt', d.created_at
  )
$$;

-- What answers a call whose place in its reference is already taken: the row
-- that holds it, as a repeat; or a refusal when that row belongs to the other
-- environment (the unique key has no environment, so a reference of the test
-- site cannot be reused on the live one). Null when the place is free.
create function finance.dispute_place(p_kind text, p_ref text, p_seq integer, p_environment text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
           when d.environment <> p_environment then jsonb_build_object('ok', false, 'code', 'REFERENCE_IN_USE')
           else jsonb_build_object('ok', true, 'duplicate', true, 'dispute', finance.dispute_json(d))
         end
    from finance.disputes d
   where d.kind = p_kind and d.provider_ref = p_ref and d.seq = p_seq
$$;

-- 2. Earlier functions, replaced to share what this round reuses -----------

-- Round 6's success effects, with one change: the entitlements of the fully
-- refunded items are revoked through `finance.entitlements_revoke` (the items
-- are the ones `finance.item_fully_refunded` names, as before). Everything else
-- is as 20261002130000_refunds.sql wrote it.
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

-- Round 2's retention purge, with the order rule and the deletes moved into
-- `finance.order_erasable` and `finance.orders_delete` (the buyer's erase uses
-- them too). Everything else is as 20261002100000_payment_core.sql wrote it.
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
    where finance.order_erasable(o)
      and o.updated_at < now() - interval '90 days'
    for update of o skip locked
  ) x;

  if v_orders is not null then
    v_order_count := finance.orders_delete(v_orders);
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

-- 3. Statistics (service_role: the `admin` function's `stats` action) -------

-- The commerce figures of one environment over [p_from, p_to): `p_from` is
-- inclusive and `p_to` exclusive. A malformed range (null, from after to, over
-- 366 days) or environment raises 22023. They are sums of ledger rows, read in
-- one snapshot (the function is stable), and nothing else:
-- - grossPaid: `captured_halalas` of the `paid` attempts whose `paid_at` is in
--   the range; paidOrders: those attempts' orders (a paid_needs_resolution or
--   later refunded order still counts: the money was collected); customers: the
--   distinct buyers of those orders;
-- - refundsConfirmed: the `succeeded` refunds of paying attempts whose
--   `succeeded_at` is in the range, whenever the payment was; netCollected: gross
--   less those refunds (it may be negative for a range that refunds older sales).
-- Beside them, in none of them: `review` is the review payments that arrived in
-- the range (`created_at`, the only date the row has): how many are still open,
-- their amounts, and what has been refunded of them; `disputes` is the latest
-- row of each reference whose `occurred_on` falls in the range (the start of
-- that day in Asia/Riyadh is in [p_from, p_to)): how many, and the halalas
-- `againstSeller` and `forSeller`. Test and live never mix: every row is of
-- `p_environment`.
-- ponytail: no index on `paid_at` or `succeeded_at`: a shop's attempts are in
-- the thousands, so the scans are milliseconds; add a partial index on `paid_at`
-- where `status = 'paid'` if a plan ever shows them.
create function public.owner_commerce_stats(p_from timestamptz, p_to timestamptz, p_environment text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gross bigint;
  v_orders bigint;
  v_customers bigint;
  v_refunds bigint;
  v_review jsonb;
  v_disputes jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > interval '366 days'
    or p_environment is null or p_environment not in ('test', 'live')
  then
    raise exception 'Invalid statistics range.' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(sum(a.captured_halalas), 0), count(distinct a.order_id), count(distinct o.customer_id)
    into v_gross, v_orders, v_customers
    from finance.payment_attempts a
    join finance.orders o on o.id = a.order_id
   where a.status = 'paid' and a.environment = p_environment
     and a.paid_at >= p_from and a.paid_at < p_to;

  select coalesce(sum(r.amount_halalas), 0)
    into v_refunds
    from finance.refunds r
    join finance.payment_attempts a on a.id = r.attempt_id
   where r.status = 'succeeded' and a.status = 'paid' and a.environment = p_environment
     and r.succeeded_at >= p_from and r.succeeded_at < p_to;

  select jsonb_build_object(
           'open', count(*) filter (where pr.closed_at is null),
           'captured', coalesce(sum(pr.amount_halalas), 0),
           'refunded', coalesce(sum((
             select sum(r.amount_halalas) from finance.refunds r
              where r.review_payment_id = pr.provider_payment_id and r.status = 'succeeded'
           )), 0)
         )
    into v_review
    from finance.payment_reviews pr
   where pr.environment = p_environment and pr.created_at >= p_from and pr.created_at < p_to;

  select jsonb_build_object(
           'count', count(*),
           'againstSeller', coalesce(sum(l.amount_halalas) filter (where l.direction = 'against_seller'), 0),
           'forSeller', coalesce(sum(l.amount_halalas) filter (where l.direction = 'for_seller'), 0)
         )
    into v_disputes
    from (
      select distinct on (d.kind, d.provider_ref) d.*
        from finance.disputes d
       where d.environment = p_environment
       order by d.kind, d.provider_ref, d.seq desc
    ) l
   where (l.occurred_on::timestamp at time zone 'Asia/Riyadh') >= p_from
     and (l.occurred_on::timestamp at time zone 'Asia/Riyadh') < p_to;

  return jsonb_build_object(
    'environment', p_environment,
    'paidOrders', v_orders,
    'grossPaid', v_gross,
    'refundsConfirmed', v_refunds,
    'netCollected', v_gross - v_refunds,
    'customers', v_customers,
    'review', v_review,
    'disputes', v_disputes
  );
end
$$;

-- 4. Disputes ----------------------------------------------------------------

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
--   `fulfillment_stopped` names items whose fulfilment is still `preparing` and
--   is only recorded; `INVALID_ITEMS` otherwise (an order the target does not
--   have included). A dispute never creates a refund and never changes an
--   attempt, an order's status, a fulfilment or stock.
-- Locks: the order row first when the target has an order, then the attempt (a
-- review payment's row in its place). A review payment can be linked to its
-- order between the first read and its lock; the order is then the row it has
-- after the lock, as in `refund_request`.
-- Audit `dispute.recorded`: the reference, the amount, the kind and the decision,
-- never the reason or the resolution. {ok: true, duplicate, dispute} with the row
-- as `finance.dispute_json` shows it, or {ok: false, code: NOT_FOUND |
-- NOT_DISPUTABLE | NO_PREDECESSOR | TARGET_MISMATCH | INVALID_ITEMS | REFERENCE_IN_USE}.
create function public.dispute_record(
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
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (p_actor, 'dispute.recorded', 'dispute', v_row.id::text,
          jsonb_build_object('reference', p_provider_ref, 'amount', p_amount, 'kind', p_kind, 'decision', p_decision));
  return jsonb_build_object('ok', true, 'duplicate', false, 'dispute', finance.dispute_json(v_row));
end
$$;

-- Every reference with its rows in seq order, the newest reference first (by
-- when its first row was recorded), for the owner. A row is `finance.dispute_json`
-- with the order number of its target's order (null for a payout or a fee
-- difference, and for a review payment with no order). Both environments are
-- listed, each row with its own, like the order screens.
-- {references: [{kind, providerRef, rows: [...]}]}.
create function public.disputes_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform finance.require_staff(true);
  return jsonb_build_object('references', coalesce((
    select jsonb_agg(
             jsonb_build_object('kind', g.kind, 'providerRef', g.provider_ref, 'rows', g.rows)
             order by g.first_at desc, g.provider_ref, g.kind
           )
      from (
        select d.kind, d.provider_ref, min(d.created_at) as first_at,
               jsonb_agg(
                 finance.dispute_json(d) || jsonb_build_object('orderNumber', o.order_number)
                 order by d.seq
               ) as rows
          from finance.disputes d
          left join finance.payment_attempts a on a.id = d.attempt_id
          left join finance.payment_reviews pr on pr.provider_payment_id = d.review_payment_id
          left join finance.orders o on o.id = coalesce(a.order_id, pr.order_id)
         group by d.kind, d.provider_ref
      ) g
  ), '[]'::jsonb));
end
$$;

-- 5. Privacy (no API grant at all: the owner runs them as the migration role) ---

-- What the system holds of one buyer address, for a request to see it
-- (docs/privacy-data-map.md): the customer row, the orders matched through the
-- address's hash or the customer row, and their items, fulfilments (carrier and
-- tracking), entitlements, refunds and returns; the address's notification rows
-- and the mails sent to it (kind, time, status). Never a staff note (a return's,
-- a refund's reason), a token or its hash, an idempotency key, a request hash,
-- a checkout session, a storage key or a provider id. Read only, so safe to
-- repeat. Every part is an array of rows that name their order by its number;
-- `customer` is null when the address has none.
create function public.privacy_buyer_export(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := finance.buyer_address(p_email);
  v_hash text := finance.recipient_hash(v_email);
  v_customer uuid := (select c.id from public.customers c where c.email = v_email);
  v_orders uuid[];
begin
  select coalesce(array_agg(o.id), '{}'::uuid[]) into v_orders
    from finance.orders o where o.email_hash = v_hash or o.customer_id = v_customer;

  return jsonb_build_object(
    'email', v_email,
    'customer', (
      select jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone, 'createdAt', c.created_at, 'updatedAt', c.updated_at)
        from public.customers c where c.id = v_customer
    ),
    'orders', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'status', o.status, 'environment', o.environment,
                 'createdAt', o.created_at, 'paidAt', o.paid_at, 'name', o.customer_name, 'email', o.customer_email,
                 'phone', o.customer_phone, 'city', o.city_name_ar, 'address', o.address,
                 'subtotal', o.subtotal_halalas, 'discount', o.discount_halalas, 'shipping', o.shipping_halalas,
                 'total', o.total_halalas, 'currency', o.currency, 'couponCode', o.coupon_code
               )
               order by o.created_at, o.id
             )
        from finance.orders o where o.id = any (v_orders)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'lineNo', i.line_no, 'sku', i.sku, 'productTitle', i.product_title,
                 'variantTitle', i.variant_title, 'fulfillment', i.fulfillment, 'quantity', i.quantity,
                 'unitPrice', i.unit_price_halalas, 'discount', i.discount_halalas, 'dedication', i.dedication,
                 'preorderShipsOn', i.preorder_ships_on, 'preorderNote', i.preorder_note
               )
               order by o.created_at, o.id, i.line_no
             )
        from finance.order_items i join finance.orders o on o.id = i.order_id
       where i.order_id = any (v_orders)
    ), '[]'::jsonb),
    'fulfillments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'lineNo', i.line_no, 'state', f.state, 'carrier', f.carrier,
                 'tracking', f.tracking, 'shippedAt', f.shipped_at, 'deliveredAt', f.delivered_at
               )
               order by o.created_at, o.id, i.line_no
             )
        from finance.fulfillments f
        join finance.order_items i on i.id = f.order_item_id
        join finance.orders o on o.id = f.order_id
       where f.order_id = any (v_orders)
    ), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'lineNo', i.line_no, 'grantedAt', e.granted_at,
                 'revokedAt', e.revoked_at, 'hasFile', e.asset_id is not null
               )
               order by o.created_at, o.id, i.line_no
             )
        from finance.entitlements e
        join finance.order_items i on i.id = e.order_item_id
        join finance.orders o on o.id = e.order_id
       where e.order_id = any (v_orders)
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'amount', r.amount_halalas, 'status', r.status, 'source', r.source,
                 'createdAt', r.created_at, 'succeededAt', r.succeeded_at
               )
               order by o.created_at, o.id, r.created_at, r.id
             )
        from finance.refunds r join finance.orders o on o.id = r.order_id
       where r.order_id = any (v_orders)
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'orderNumber', o.order_number, 'state', q.state, 'items', q.items, 'reason', q.reason,
                 'createdAt', q.created_at, 'updatedAt', q.updated_at
               )
               order by o.created_at, o.id, q.created_at, q.id
             )
        from finance.return_requests q join finance.orders o on o.id = q.order_id
       where q.order_id = any (v_orders)
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'sku', v.sku, 'productTitle', p.title, 'variantTitle', v.title, 'status', n.status,
                 'consentRevision', n.consent_revision, 'createdAt', n.created_at, 'confirmedAt', n.confirmed_at,
                 'unsubscribedAt', n.unsubscribed_at
               )
               order by n.created_at, n.id
             )
        from public.notifications n
        join public.product_variants v on v.id = n.variant_id
        join public.products p on p.id = v.product_id
       where n.email = v_email
    ), '[]'::jsonb),
    'mail', coalesce((
      select jsonb_agg(
               jsonb_build_object('kind', m.kind, 'status', m.status, 'createdAt', m.created_at, 'sentAt', m.sent_at)
               order by m.created_at, m.id
             )
        from finance.email_outbox m where m.recipient = v_email
    ), '[]'::jsonb)
  );
end
$$;

-- A buyer's request to be erased. For one address (normalized like checkout, its
-- orders matched through the address's hash and the customer row):
-- - its orders are locked first (ascending id), before any other row is touched
--   (the one lock order: a writer that holds an order and queues mail to the
--   address then never waits for a row this call holds);
-- - its notification rows go, and the mail still unsent to it; the address is
--   replaced in the outbox rows that remain (sent history), as
--   `privacy_erase_staff` does, by one placeholder per call. Only the mail a
--   buyer receives as a buyer: when the address is also a staff address, its
--   owner alerts and contact notices are not the buyer's and stay as they are;
-- - the expired and cancelled orders that `finance.order_erasable` allows (the
--   retention purge's own rule: no attempt creating, pending, uncertain, paid or
--   review, none unverified or still due, no review payment, no dispute) are
--   deleted with their attempts, items, reservations and coupon uses;
-- - the customer row goes when no order of it is left;
-- - every order that is kept is reported with its reason: ACCOUNTING_RETENTION
--   (a paid, paid_needs_resolution or refunded order: the accounting retention E08
--   sets), OPEN_HOLD (a pending_payment order), PAYMENT_RECORDS (an expired or
--   cancelled order that has money or work attached).
-- Safe to repeat: a second call finds nothing to remove and audits nothing. One
-- count-only audit row, with no address and no id. The kept orders keep their
-- contact snapshot; the reply names them by number for the deletion ledger.
-- {notifications, orders, outbox_dropped, outbox_redacted, customers, kept:
-- [{orderNumber, status, reason}]}.
create function public.privacy_buyer_erase(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := finance.buyer_address(p_email);
  v_hash text := finance.recipient_hash(v_email);
  v_customer uuid := (select c.id from public.customers c where c.email = v_email);
  v_placeholder text := 'erased-' || gen_random_uuid() || '@erased.invalid';
  -- The kinds of mail a buyer's address receives as a buyer (not `owner_alert`
  -- or `contact_notice`, which go to staff).
  v_kinds constant text[] := array['receipt', 'order_link', 'order_shipped', 'order_refunded', 'order_ready', 'notify_confirm', 'availability'];
  v_gone uuid[];
  v_notifications integer;
  v_orders integer := 0;
  v_dropped integer;
  v_redacted integer;
  v_customers integer := 0;
  v_kept jsonb;
begin
  -- Every order of the address is locked before any row of anything else is
  -- touched, and the rule is applied to what is read under the locks.
  perform 1 from finance.orders o where o.email_hash = v_hash or o.customer_id = v_customer order by o.id for update;

  delete from public.notifications n where n.email = v_email;
  get diagnostics v_notifications = row_count;

  -- Unsent mail is dropped, the address leaves the rest.
  delete from finance.email_outbox o
   where o.recipient = v_email and o.kind = any (v_kinds) and o.status in ('pending', 'uncertain', 'exhausted');
  get diagnostics v_dropped = row_count;
  update finance.email_outbox o set recipient = v_placeholder, updated_at = now()
   where o.recipient = v_email and o.kind = any (v_kinds);
  get diagnostics v_redacted = row_count;

  select coalesce(array_agg(o.id), '{}'::uuid[]) into v_gone
    from finance.orders o
   where (o.email_hash = v_hash or o.customer_id = v_customer) and finance.order_erasable(o);
  if cardinality(v_gone) > 0 then
    v_orders := finance.orders_delete(v_gone);
  end if;

  delete from public.customers c
   where c.id = v_customer and not exists (select 1 from finance.orders o where o.customer_id = c.id);
  get diagnostics v_customers = row_count;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'orderNumber', o.order_number, 'status', o.status,
             'reason', case
                         when o.status in ('paid', 'paid_needs_resolution', 'refunded') then 'ACCOUNTING_RETENTION'
                         when o.status = 'pending_payment' then 'OPEN_HOLD'
                         else 'PAYMENT_RECORDS'
                       end
           )
           order by o.created_at, o.id
         ), '[]'::jsonb)
    into v_kept
    from finance.orders o
   where o.email_hash = v_hash or o.customer_id = v_customer;

  if v_notifications + v_orders + v_dropped + v_redacted + v_customers > 0 then
    insert into public.audit_events (actor, action, entity, entity_id, summary)
    values (null, 'privacy.erase_buyer', 'orders', null,
            jsonb_build_object(
              'notifications', v_notifications, 'orders', v_orders, 'outbox', v_dropped + v_redacted,
              'customers', v_customers, 'kept', jsonb_array_length(v_kept)
            ));
  end if;
  return jsonb_build_object(
    'notifications', v_notifications, 'orders', v_orders, 'outbox_dropped', v_dropped,
    'outbox_redacted', v_redacted, 'customers', v_customers, 'kept', v_kept
  );
end
$$;

-- 6. Webhook events (retention) -----------------------------------------------

-- A webhook event is kept for 180 days after it was processed, then goes (contract
-- section 4: round 2 keeps them, this round adds the daily job). What is still
-- the owner's work stays whatever its age: an event not processed yet (it has no
-- `processed_at`) and an exhausted one that still needs a person
-- (`finance.event_needs_person`: its payment is neither settled in the ledger nor
-- dismissed), because the alerts and the reconciliation screen count it. The
-- events of a deleted order's payment already go with the order
-- (`finance.orders_delete`). One count-only audit row when something went;
-- answers how many.
-- ponytail: no index on `processed_at`: a daily scan of a table of a few thousand
-- rows. Add a partial index on it if a plan ever shows the scan.
create function finance.payment_events_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from finance.payment_events e
   where e.processed_at < now() - interval '180 days'
     and not finance.event_needs_person(e);
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_events (action, entity, entity_id, summary)
    values ('payments.events_purge', 'payment_events', null, jsonb_build_object('events', v_count));
  end if;
  return v_count;
end
$$;

select cron.schedule('payment-events-purge', '47 3 * * *', 'select finance.payment_events_purge()');

-- 7. Grants ----------------------------------------------------------------------

-- The Edge Function's role only.
revoke all on function public.owner_commerce_stats(timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.dispute_record(uuid, text, text, integer, uuid, text, integer, text, date, text, text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.owner_commerce_stats(timestamptz, timestamptz, text) to service_role;
grant execute on function public.dispute_record(uuid, text, text, integer, uuid, text, integer, text, date, text, text, text, uuid[], text) to service_role;

-- The owner's screen: signed-in staff, the owner rechecked inside.
revoke all on function public.disputes_list() from public, anon;
grant execute on function public.disputes_list() to authenticated;

-- No API role at all, the service role included, like the P06 privacy functions:
-- the owner runs them as the migration role (docs/privacy-data-map.md).
revoke all on function public.privacy_buyer_export(text) from public, anon, authenticated, service_role;
revoke all on function public.privacy_buyer_erase(text) from public, anon, authenticated, service_role;

-- The helpers, and the two replaced functions with the grants they had.
revoke all on function finance.entitlements_revoke(uuid, uuid[], text) from public, anon, authenticated, service_role;
revoke all on function finance.order_erasable(finance.orders) from public, anon, authenticated, service_role;
revoke all on function finance.orders_delete(uuid[]) from public, anon, authenticated, service_role;
revoke all on function finance.buyer_address(text) from public, anon, authenticated, service_role;
revoke all on function finance.dispute_json(finance.disputes) from public, anon, authenticated, service_role;
revoke all on function finance.dispute_place(text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function finance.refund_succeed(uuid, integer, uuid, text) from public, anon, authenticated, service_role;
revoke all on function finance.buyer_retention_purge() from public, anon, authenticated, service_role;
revoke all on function finance.payment_events_purge() from public, anon, authenticated, service_role;
