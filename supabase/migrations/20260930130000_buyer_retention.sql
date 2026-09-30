-- D42 (owner, 2026-09-30: "after 90 days"): buyer retention for checkout
-- holds that never became a payment. A daily job deletes every expired or
-- cancelled order, with its items, stock reservations and coupon uses, 90
-- days after it ended (`updated_at` is set when a hold expires or is
-- cancelled), then every customer profile left with no order and unchanged
-- for 90 days. Only 'expired' and 'cancelled' qualify, so an open hold and
-- every paid state P08 adds are never touched; paid orders keep the
-- accounting retention E08 sets. The audit trail keeps what it already holds:
-- `order.expired` rows carry the order number, and `customers.delete` rows
-- name the changed fields, never their values (`public.catalog_audit`).
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
  select array_agg(o.id) into v_orders
  from finance.orders o
  where o.status in ('expired', 'cancelled')
    and o.updated_at < now() - interval '90 days';

  if v_orders is not null then
    delete from finance.order_items where order_id = any (v_orders);
    delete from finance.inventory_reservations where order_id = any (v_orders);
    delete from finance.coupon_redemptions where order_id = any (v_orders);
    delete from finance.orders where id = any (v_orders);
    get diagnostics v_order_count = row_count;
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

-- Like `finance.contacts_purge`: the migration role and pg_cron only.
revoke all on function finance.buyer_retention_purge()
  from public, anon, authenticated, service_role;

select cron.schedule('buyer-retention', '53 3 * * *', 'select finance.buyer_retention_purge()');
