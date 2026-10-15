-- RESIDUALS-1, round R2b: what crosses the database, the functions and the
-- screens, in one forward migration. Every function is `create or replace` (a
-- changed signature drops the old form first), keeps its language, security and
-- `search_path`, and restates its grants, so the file is re-runnable. The earlier
-- migrations stay untouched. Each section names its item and says what it
-- changed in the function's latest definition (named in the section); the rest
-- is that definition.

-- 1. P08-CKPT-09: `dispute_record` of 20261007110000_fable_audit_operations.sql,
--    with one change. A call at a place of its reference that is already taken
--    was answered as a repeat whatever it said, so a follow-up typed in a second
--    tab, or by a second owner, was discarded and its author told it was
--    recorded already. It is a repeat only when it says what the stored row
--    says (target, amount, direction, day, reason, resolution, decision and
--    items, the items as a set); a call that says something else answers
--    `{ok: false, code: SEQ_TAKEN}` and writes nothing. The place is judged by
--    `finance.dispute_place`, which now takes the call's facts: the old
--    four-argument form is dropped, and nothing else called it. The rule holds
--    for the call that loses the race for a place too (the unique key decides,
--    and the loser is answered by the same function). Otherwise identical:

create or replace function finance.dispute_place(
  p_kind text, p_ref text, p_seq integer, p_environment text,
  p_attempt uuid, p_review text, p_amount integer, p_direction text, p_occurred_on date,
  p_reason text, p_resolution text, p_decision text, p_items uuid[]
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
           when d.environment <> p_environment then jsonb_build_object('ok', false, 'code', 'REFERENCE_IN_USE')
           when d.attempt_id is not distinct from p_attempt and d.review_payment_id is not distinct from p_review
             and d.amount_halalas = p_amount and d.direction = p_direction and d.occurred_on = p_occurred_on
             and d.reason = p_reason and d.resolution is not distinct from p_resolution and d.decision = p_decision
             and d.item_ids @> p_items and d.item_ids <@ p_items
             then jsonb_build_object('ok', true, 'duplicate', true, 'dispute', finance.dispute_json(d))
           else jsonb_build_object('ok', false, 'code', 'SEQ_TAKEN')
         end
    from finance.disputes d
   where d.kind = p_kind and d.provider_ref = p_ref and d.seq = p_seq
$$;
drop function if exists finance.dispute_place(text, text, integer, text);
revoke all on function finance.dispute_place(text, text, integer, text, uuid, text, integer, text, date, text, text, text, uuid[])
  from public, anon, authenticated, service_role;

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
-- - A repeat: when the row at seq `p_follows + 1` already exists and the call says
--   what it says it is answered (`duplicate: true`) before anything else is
--   judged, and nothing changes, so a repeated reconciliation never counts twice;
--   two identical calls at once for the same place end the same way (the unique
--   key decides: one inserts, the other answers that row). A call at that place
--   that says something else is `SEQ_TAKEN` (another row was recorded there
--   meanwhile: the owner reopens the reference), and a row of the other
--   environment at that place is `REFERENCE_IN_USE`.
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
-- NOT_DISPUTABLE | NO_PREDECESSOR | TARGET_MISMATCH | INVALID_ITEMS |
-- REFERENCE_IN_USE | SEQ_TAKEN}.
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

  v_reply := finance.dispute_place(
    p_kind, p_provider_ref, p_follows + 1, p_environment,
    p_attempt, p_review_payment, p_amount, p_direction, p_occurred_on, p_reason, p_resolution, p_decision, v_items
  );
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
    -- reference with no order has no lock to queue on): its row is judged
    -- against this call, a repeat or SEQ_TAKEN.
    return finance.dispute_place(
      p_kind, p_provider_ref, p_follows + 1, p_environment,
      p_attempt, p_review_payment, p_amount, p_direction, p_occurred_on, p_reason, p_resolution, p_decision, v_items
    );
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

-- 4. EF-ADMIN-05 with ADMIN-CMS-15: the upload ticket's window.
--    `media_upload_tickets.expires_at` defaulted to `now() + interval '5 minutes'`
--    (20260926090000_media_library.sql). The browser asks for the ticket and only
--    then uploads the original (up to 15 MiB) and up to four derivatives (up to
--    4 MiB each) one after the other, and the completion refuses an expired
--    ticket (GONE), so on a slow uplink every byte arrived and the ticket was
--    dead, and the retry raced the same clock. The ticket now lives 30 minutes
--    after its creation; the signed upload URLs still bound the upload, and the
--    10 open tickets an actor may hold (`media_create_ticket`) are unchanged.
--    Tickets already open keep their expiry. (The comment on
--    `media_tickets_purge` in 20260927120000_rebuild_delivery_and_media_sweep.sql
--    still says five minutes; that purge keeps a ticket for a day.)
alter table public.media_upload_tickets alter column expires_at set default now() + interval '30 minutes';

-- 5. EF-ACCESS-10: the return request's key. A request filed whose reply was
--    lost was filed again by the buyer's next press (a second request for the
--    same parcel, or a refusal that the quantities were already taken though the
--    request had gone through). The page now sends a key it keeps until the form
--    changes; `finance.return_requests` stores it, unique within an order, and a
--    call that repeats a key of the order answers that request's id and writes
--    nothing. The key is optional (a call without one is filed as before) and
--    scoped to the order, so one order's key reveals nothing of another's.
alter table finance.return_requests add column if not exists request_key uuid;
create unique index if not exists return_requests_order_key on finance.return_requests (order_id, request_key);

-- `return_request_create` of 20261002140000_delivery.sql, with one more
-- parameter and one more step: under the order's lock, before the status, the
-- day's cap and the quantities are judged (a repeat would fail them: the first
-- request took the quantities, and may have been the fifth of the day), a key
-- of this order that was filed already is answered by its request's id. The new
-- parameter changes the signature, so the old form is dropped. Otherwise
-- identical:
--
-- A request for a `paid` order whose physical or signed items have shipped:
-- `[{itemId, quantity}]`, each quantity within `finance.item_returnable`. At most
-- 5 requests a day per order (counted under the order's lock, so two at once
-- cannot both be the fifth) and 20 an hour per IP hash. Nothing is refunded and no
-- stock moves: the staff decide (round 7b). NOT_FOUND for a wrong number or token;
-- NOT_RETURNABLE when the order is not paid or an item cannot be returned (digital,
-- not shipped); INVALID_ITEMS for a malformed list, an item that is not the
-- order's, a repeated item or a quantity above what is still returnable.
drop function if exists public.return_request_create(text, text, jsonb, text, text, text);
create or replace function public.return_request_create(
  p_order_number text, p_access_token_hash text, p_items jsonb, p_reason text, p_ip_hash text, p_mode text,
  p_request_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order finance.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_items jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  e jsonb;
  v_item uuid;
  v_qty integer;
  v_max integer;
  v_id uuid;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or char_length(v_reason) not between 1 and 500 or v_reason ~ '[[:cntrl:]]'
    or p_mode is null or p_mode not in ('test', 'live')
  then
    raise exception 'Invalid return request.' using errcode = 'invalid_parameter_value';
  end if;
  if not finance.rate_limit_take('return-request:ip', p_ip_hash, 20, interval '1 hour') then
    raise exception 'Too many return requests; try again later.' using errcode = 'program_limit_exceeded';
  end if;

  -- The token is checked before the row is locked, so guessed tokens never
  -- queue behind a real change to the order.
  select * into v_order
    from finance.orders o
   where o.order_number = upper(btrim(coalesce(p_order_number, ''))) and o.environment = p_mode;
  if not found
    or v_order.access_token_hash is distinct from p_access_token_hash
    or v_order.access_token_expires_at <= now()
  then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  select * into v_order from finance.orders o where o.id = v_order.id for update;
  -- A repeat of a request already filed (its reply was lost): the same id, and nothing is written.
  if p_request_key is not null then
    select q.id into v_id from finance.return_requests q where q.order_id = v_order.id and q.request_key = p_request_key;
    if found then
      return jsonb_build_object('ok', true, 'returnId', v_id);
    end if;
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'code', 'NOT_RETURNABLE');
  end if;
  if (
    select count(*) from finance.return_requests q
     where q.order_id = v_order.id and q.created_at > now() - interval '1 day'
  ) >= 5 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_REQUESTS');
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;
  for e in select x.value from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(e) <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('itemId', 'quantity')) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if coalesce(e ->> 'itemId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e -> 'quantity') is distinct from 'number'
    then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    if (e ->> 'quantity') !~ '^[1-9][0-9]{0,2}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_item := (e ->> 'itemId')::uuid;
    v_qty := (e ->> 'quantity')::integer;
    if v_item = any (v_seen) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_seen := v_seen || v_item;
    perform 1 from finance.order_items i where i.id = v_item and i.order_id = v_order.id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_max := finance.item_returnable(v_item);
    if v_max is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_RETURNABLE');
    end if;
    if v_qty > v_max then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
    end if;
    v_items := v_items || jsonb_build_object('itemId', v_item, 'quantity', v_qty);
  end loop;

  insert into finance.return_requests (order_id, items, reason, request_key)
  values (v_order.id, v_items, v_reason, p_request_key)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'returnId', v_id);
end
$$;
revoke all on function public.return_request_create(text, text, jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.return_request_create(text, text, jsonb, text, text, text, uuid) to service_role;

-- 6. EF-ACCESS-04: link recovery after a pepper change. `order_recover_apply`
--    of 20261002140000_delivery.sql renewed the expiry of a link that had not
--    expired and queued its mail, whatever the stored hash was. After
--    `TOKEN_HASH_PEPPER` is replaced (lost in a restore, or rotated after a
--    leak) the stored hash was made with the old pepper, the mail's token is
--    derived with the new one, and the two never match: a buyer who kept
--    asking was mailed a dead link, each time with the dead one renewed for
--    another 7 days. A link that had not expired when listed now carries two
--    hashes from the function (`recoveryItems`): `currentHash`, what the
--    current pepper makes of the listed version's token, and `nextHash`, of the
--    next version's. The expiry is renewed only when the stored hash is
--    `currentHash`. Otherwise the stored hash is no token this pepper issues,
--    and the link is replaced as an expired one is: the next version, its hash
--    `nextHash`, 7 days, one mail (its dedupe key names the version the order
--    has now). An item without `currentHash` renews nothing and replaces
--    nothing. The guards of the other cases are as they were (an expired link
--    gets `tokenHash` at the next version once, a link that expired between the
--    list and the apply is never brought back, one that came back to life is
--    left alone). Otherwise identical:
--
-- Applies what the function derived from the list: `[{orderId, version, tokenHash?,
-- currentHash?, nextHash?}]`. A working link is never replaced: the order keeps its token and
-- only its expiry is renewed (and only while the token is still unexpired, at the version the
-- list showed, and the stored hash is the one the current pepper makes of it). An expired link
-- gets the next version's hash, once: the update is guarded on the version the list showed, so
-- two requests at once agree on one new token and the second finds nothing to change. A link
-- that has come back to life since the list (a file attached) is left alone. Each order that
-- changed gets at most one `order_link` mail per UTC day, and at most 20 such mails are
-- queued a day in all (the dispatcher sends at most 20 as well). The orders are taken in
-- ascending id. Answers how many mails it queued.
create or replace function public.order_recover_apply(p_ip_hash text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_email text;
  v_version integer;
  v_key text;
  v_queued integer := 0;
  v_day text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 5 then
    raise exception 'Invalid recovery request.' using errcode = 'invalid_parameter_value';
  end if;
  for r in
    select (x.value ->> 'orderId')::uuid as order_id, (x.value ->> 'version')::integer as version, x.value ->> 'tokenHash' as token_hash,
           x.value ->> 'currentHash' as current_hash, x.value ->> 'nextHash' as next_hash
      from jsonb_array_elements(p_items) x
     order by 1
  loop
    v_email := null;
    if r.token_hash is null then
      update finance.orders o
         set access_token_expires_at = now() + interval '7 days', updated_at = now()
       where o.id = r.order_id and o.access_token_version = r.version and o.access_token_expires_at > now()
         and o.access_token_hash = r.current_hash
      returning o.customer_email, o.access_token_version into v_email, v_version;
      if v_email is null and r.current_hash is not null and r.next_hash is not null then
        update finance.orders o
           set access_token_hash = r.next_hash, access_token_version = r.version + 1,
               access_token_expires_at = now() + interval '7 days', updated_at = now()
         where o.id = r.order_id and o.access_token_version = r.version and o.access_token_expires_at > now()
           and o.access_token_hash is distinct from r.current_hash
        returning o.customer_email, o.access_token_version into v_email, v_version;
      end if;
    else
      update finance.orders o
         set access_token_hash = r.token_hash, access_token_version = r.version,
             access_token_expires_at = now() + interval '7 days', updated_at = now()
       where o.id = r.order_id and o.access_token_version = r.version - 1 and o.access_token_expires_at <= now()
      returning o.customer_email, o.access_token_version into v_email, v_version;
    end if;
    continue when v_email is null;

    v_key := 'order_link:' || r.order_id::text || ':' || v_version::text || ':' || v_day;
    if not exists (select 1 from finance.email_outbox m where m.dedupe_key = v_key)
      and finance.rate_limit_take('order-link:day', repeat('0', 64), 20, interval '1 day')
    then
      insert into finance.email_outbox (dedupe_key, kind, priority, recipient, payload)
      values (v_key, 'order_link', 1, lower(btrim(v_email)), jsonb_build_object('orderId', r.order_id))
      on conflict (dedupe_key) do nothing;
      if found then
        v_queued := v_queued + 1;
      end if;
    end if;
  end loop;
  return v_queued;
end
$$;
revoke all on function public.order_recover_apply(text, jsonb) from public, anon, authenticated;
grant execute on function public.order_recover_apply(text, jsonb) to service_role;

-- 7. CONTRACT-04 with ADMIN-COMMERCE-08 and ADMIN-COMMERCE-17: the other
--    payment mode after the switch. Work of the mode that was left cannot be
--    checked with the configured key, and nothing could end it: a refund of the
--    other mode stayed in flight for ever (its recheck answered that the
--    provider was unreachable), a parked attempt stayed on the reconciliation
--    screen and in «تحتاج مطابقة» for ever, and the screens still offered money
--    controls that each answered that the payment does not exist.

-- 7a. `finance.refund_json` of 20261002145000_order_operations.sql, with one more
--     key, `environment`: the mode of the payment the refund belongs to (its
--     attempt's, or its review payment's), so that a screen can tell a refund of
--     the other mode. Otherwise identical.
create or replace function finance.refund_json(r finance.refunds)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'orderId', r.order_id, 'attemptId', r.attempt_id, 'reviewPaymentId', r.review_payment_id,
    'environment', coalesce(
      (select a.environment from finance.payment_attempts a where a.id = r.attempt_id),
      (select pr.environment from finance.payment_reviews pr where pr.provider_payment_id = r.review_payment_id)
    ),
    'returnId', r.return_id, 'status', r.status, 'amount', r.amount_halalas, 'reason', r.reason,
    'source', r.source, 'allocation', r.allocation,
    'providerRefundedBefore', r.provider_refunded_before, 'providerRefundedAfter', r.provider_refunded_after,
    'error', r.error, 'nextCheckAt', r.next_check_at, 'createdAt', r.created_at, 'succeededAt', r.succeeded_at
  )
$$;
revoke all on function finance.refund_json(finance.refunds) from public, anon, authenticated, service_role;

-- 7b. `refund_ref` of 20261002130000_refunds.sql, which takes the configured
--     mode as `payment_attempt_ref` does and answers NOT_FOUND for a refund
--     whose attempt or review payment is of another environment: the recheck
--     fetched the payment with a key that cannot see it and answered, for ever,
--     that the provider was unreachable. The two-argument form is dropped.
--     Otherwise identical:
--
-- The owner's «أعد الفحص» on one refund: its status and the provider payment
-- it concerns, rechecked against the owner's active role.
drop function if exists public.refund_ref(uuid, uuid);
create or replace function public.refund_ref(p_actor uuid, p_refund uuid, p_mode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_refund finance.refunds;
  v_payment text;
  v_environment text;
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
  select a.provider_payment_id, a.environment into v_payment, v_environment
    from finance.payment_attempts a where a.id = v_refund.attempt_id;
  if v_refund.attempt_id is null then
    select pr.environment into v_environment
      from finance.payment_reviews pr where pr.provider_payment_id = v_refund.review_payment_id;
  end if;
  if v_environment is distinct from p_mode then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object(
    'ok', true, 'refundId', v_refund.id, 'status', v_refund.status,
    'providerPaymentId', coalesce(v_payment, v_refund.review_payment_id)
  );
end
$$;
revoke all on function public.refund_ref(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_ref(uuid, uuid, text) to service_role;

-- 7c. `payment_reconcile_claim` of 20261007100000_fable_audit_payments.sql,
--     with one change: an in-flight refund of the other mode that it parks
--     leaves flight. It is failed `MODE_CHANGED` through `finance.refund_fail`
--     (the audit row, the balance free) instead of staying `submitting` or
--     `uncertain` with no due time, where no screen or action could end it. The
--     one owner alert it queues first is unchanged (it is test money that only
--     Moyasar's dashboard can settle). Only a refund the claim parks now, one
--     that is due, is failed: a refund of the other mode that has no due time
--     (in flight for more than 24 hours) is not touched, and nor is one parked
--     before this migration. Otherwise identical:
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
  -- purge for ever) and an attempt is marked, for a person to settle from the
  -- dashboard and close (`attempt_dismiss`); a refund is failed, as it can no
  -- longer be checked here. So that a person knows to, an active attempt that
  -- has an invoice (a buyer may still pay it) and an in-flight refund are each
  -- alerted first, under the row's lock, once: the alert's subject is the row,
  -- and a parked row is not due again.
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
  perform finance.refund_fail(s.id, 'MODE_CHANGED')
     from (
       select r.id
         from finance.refunds r
        where r.status in ('submitting', 'uncertain') and r.next_check_at <= now()
          and coalesce(
                (select a.environment from finance.payment_attempts a where a.id = r.attempt_id),
                (select pr.environment from finance.payment_reviews pr where pr.provider_payment_id = r.review_payment_id)
              ) <> p_mode
        order by r.id
        for update
     ) s;

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

-- 7d. `attempt_dismiss`: the owner has looked at an attempt the claim parked for
--     the other mode (the provider's dashboard of that mode shows what became of
--     its invoice) and closes it, as `event_dismiss` closes an exhausted
--     webhook event. The mark `MODE_CHANGED` is cleared, so the attempt leaves
--     the reconciliation list and «تحتاج مطابقة» (and its order may be erased
--     by the retention rule again); an audit row `payment.attempt_dismissed`.
--     Only an attempt that carries the mark, is not paid or in review, and whose
--     invoice can no longer be paid: any other is refused with a code, NOT_FOUND
--     (no such attempt), INVOICE_OPEN (parked, but its invoice is within the
--     job's 10-minute grace or not yet expired) or NOT_PARKED (it is not one the
--     claim parked, or it was closed already; RESIDUALS-1 R2b audit). The screens
--     offer it for an attempt of the other mode only. Owner only, as
--     `event_dismiss`. {ok: true, attemptId} or {ok: false, code}.
create or replace function public.attempt_dismiss(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
begin
  perform finance.require_staff(true);
  if p_attempt is null then
    raise exception 'Invalid attempt.' using errcode = 'invalid_parameter_value';
  end if;
  -- Only once its invoice is past paying: a buyer may complete a payment begun in the hold's last minute, so the job's
  -- own grace (10 minutes after the invoice expired) applies. Until then the mark stays, and with it the order's
  -- protection from erasure: a payment that still arrives is closed `mode_mismatch`, and the mark keeps it in view.
  update finance.payment_attempts a
     set last_error = null, updated_at = now()
   where a.id = p_attempt and a.last_error = 'MODE_CHANGED' and a.status not in ('paid', 'review')
     and a.invoice_expires_at <= now() - interval '10 minutes'
  returning a.order_id into v_order;
  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', case
        when not exists (select 1 from finance.payment_attempts a where a.id = p_attempt) then 'NOT_FOUND'
        when exists (
          select 1 from finance.payment_attempts a
           where a.id = p_attempt and a.last_error = 'MODE_CHANGED' and a.status not in ('paid', 'review')
        ) then 'INVOICE_OPEN'
        else 'NOT_PARKED'
      end
    );
  end if;
  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values ((select auth.uid()), 'payment.attempt_dismissed', 'payment_attempt', p_attempt::text, jsonb_build_object('orderId', v_order));
  return jsonb_build_object('ok', true, 'attemptId', p_attempt);
end
$$;
revoke all on function public.attempt_dismiss(uuid) from public, anon;
grant execute on function public.attempt_dismiss(uuid) to authenticated;
