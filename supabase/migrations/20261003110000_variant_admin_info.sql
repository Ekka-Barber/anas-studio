-- P08 round 11c: what the variant form shows beside the row (PLANS/P08-CONTRACT.md
-- section 6, "Admin reads (round 11c)"). One read function, granted to
-- `authenticated`, which rechecks the caller's role inside like the round 7b
-- functions (`finance.require_staff`): an owner or an operations member. Anon, an
-- editor and a revoked or inactive member are refused with 42501, before the
-- variant is looked up.
--
-- - preorderUnits: the units of the variant's committed reservations whose own
--   preorder flag is true and whose order line has not been shipped or delivered
--   yet: the confirmed preorders still owed from the stock on hand. A held or
--   released reservation is not counted, nor is one committed while the variant
--   was not a preorder, nor one already shipped (its copies left the stock the
--   owner counts). The owner enters the real stock net of these units. (The
--   capacity rule, `finance.preorder_committed`, still counts every committed one.)
-- - file: the paid file the variant points at (the `finance.paid_assets` row whose
--   `storage_key` is the variant's `digital_asset`), or null: its name, type, size
--   and time. The storage key never leaves the database, and no order or buyer is
--   named.
--
-- Read only and no lock: a count and a row that may change a moment later is what
-- a form needs, and the writers (`paid_asset_set`, the payment) keep their own
-- locks. {ok: true, preorderUnits, file: {filename, mime, bytes, createdAt} | null}
-- or {ok: false, code: 'NOT_FOUND'}.
create function public.variant_admin_info(p_variant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asset text;
begin
  perform finance.require_staff(false);
  select v.digital_asset into v_asset from public.product_variants v where v.id = p_variant;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  return jsonb_build_object(
    'ok', true,
    'preorderUnits', (
      select coalesce(sum(r.quantity), 0)::integer
        from finance.inventory_reservations r
       where r.variant_id = p_variant and r.state = 'committed' and r.preorder
         and not exists (
           select 1
             from finance.order_items i
             join finance.fulfillments f on f.order_item_id = i.id
            where i.order_id = r.order_id and i.variant_id = r.variant_id and f.state in ('shipped', 'delivered')
         )
    ),
    'file', (
      select jsonb_build_object('filename', a.filename, 'mime', a.mime, 'bytes', a.bytes, 'createdAt', a.created_at)
        from finance.paid_assets a
       where a.variant_id = p_variant and a.storage_key = v_asset
    )
  );
end
$$;

revoke all on function public.variant_admin_info(uuid) from public, anon;
grant execute on function public.variant_admin_info(uuid) to authenticated;
