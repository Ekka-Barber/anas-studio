-- P08 round 10b: the invoice link ends with the invoice (PLANS/P08-CONTRACT.md
-- sections 7 and 10). An invoice is created with `expired_at` equal to the hold's
-- end, so once `invoice_expires_at` has passed its URL leads to an invoice the
-- buyer cannot pay. `finance.payment_view`, which the return page (`verify`,
-- `payment_state`) and the order page (`order_access`) both read, stops handing
-- out the link from that moment. It is the round 2 definition with that one
-- change: every other field and every caller stay as they are, and a link that
-- is still payable (a hold with time left) is given exactly as before. The state
-- itself is untouched: an attempt stays `pending` until the job closes it, at
-- least 10 minutes after its invoice expired, so a payment made in the hold's
-- last minute is never shown as "expired". `create or replace` keeps the
-- function's owner and its revoked grants.

create or replace function finance.payment_view(p_order_number text, p_access_token_hash text, p_mode text)
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
    'invoiceUrl', case
      when v_token and v_state = 'pending' and v_active.status = 'pending' and v_active.invoice_expires_at > now()
      then v_active.invoice_url
    end,
    'orderId', v_order.id
  ));
end
$$;
