-- RESIDUALS-1, round R3b: the SQL of the admin's commerce screens. One forward migration, idempotent.
--
-- 1. ADMIN-COMMERCE-14: the check "a paid file only on a digital variant" had the name Postgres gave it
--    (`product_variants_check1`), which a failed save shows as nothing but a number. It is named for what it says, so the
--    variant form can answer a failed save of it in words (a variant that holds a file cannot become paper). Only the name changes.
-- 2. ADMIN-COMMERCE-06: `owner_commerce_stats` sums the review payments' amounts and refunds over the riyal ones.

-- 1. ADMIN-COMMERCE-14 ---------------------------------------------------------------------------------------------

-- The constraint is found by its name and its definition (read with `pg_get_constraintdef` before this was written:
-- CHECK (((fulfillment = 'digital'::text) OR (digital_asset IS NULL)))), so no other check can be renamed by mistake; a
-- database where it already has the new name is left alone. One where neither is found is an error, not a silent pass.
do $$
begin
  if exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.product_variants'::regclass
       and c.conname = 'product_variants_check1'
       and pg_get_constraintdef(c.oid) = 'CHECK (((fulfillment = ''digital''::text) OR (digital_asset IS NULL)))'
  ) then
    alter table public.product_variants rename constraint product_variants_check1 to product_variants_file_needs_digital;
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.product_variants'::regclass
       and c.conname = 'product_variants_file_needs_digital'
  ) then
    raise exception 'The paid-file check of public.product_variants was not found under its old name.';
  end if;
end
$$;

-- 2. ADMIN-COMMERCE-06 ---------------------------------------------------------------------------------------------

-- `owner_commerce_stats` (latest definition: 20261002170000_stats_disputes.sql). Only the `review` figures change.
-- A review payment keeps the payment's own minor units and currency (`apply_verified_payment`: an invoice no attempt maps to,
-- or a currency that differs), so a USD 10.00 payment is 1000 and a KWD 10.000 one 10000: added to the riyals' halalas they
-- would read as 10.00 and 100.00 riyals. `review.captured` and `review.refunded` therefore sum the review payments in `SAR`
-- only; `review.open` still counts every currency, since a person has to look at each one. Everything else is as it was.
create or replace function public.owner_commerce_stats(p_from timestamptz, p_to timestamptz, p_environment text)
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
           'captured', coalesce(sum(pr.amount_halalas) filter (where pr.currency = 'SAR'), 0),
           'refunded', coalesce(sum((
             select sum(r.amount_halalas) from finance.refunds r
              where r.review_payment_id = pr.provider_payment_id and r.status = 'succeeded'
           )) filter (where pr.currency = 'SAR'), 0)
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

-- Grants restated: the Edge Function's role only.
revoke all on function public.owner_commerce_stats(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.owner_commerce_stats(timestamptz, timestamptz, text) to service_role;
