-- P07 round 2: the owner approves the published policy revisions (E03/E08).
--
-- Policies are content (`policies` collection, drafts, versions, publishing);
-- what a buyer accepts at checkout is the revision the OWNER approved into
-- `finance.commerce_settings.policy_revisions` at one moment, snapshotted
-- into each order. In the style of `commerce_settings_save`: only
-- `service_role` executes (the `admin` Edge Function calls it after its own
-- owner + fresh-TOTP check), the actor must be an active owner (42501), the
-- settings row is locked and a stale expected version raises 40001, and one
-- audit row records the approval. `commerce_settings_get()` already returns
-- `policyRevisions` and stays as it is.

create function public.commerce_policies_approve(p_actor uuid, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row finance.commerce_settings;
  v_store integer;
  v_delivery integer;
  v_refund integer;
  v_privacy integer;
  v_revisions jsonb;
begin
  if not exists (
    select 1 from public.staff s
    where s.user_id = p_actor and s.active and s.role = 'owner'
  ) then
    raise exception 'Owner only.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from finance.commerce_settings where id = 1 for update;

  -- `is distinct from`, not `<>`: a null expected version is a conflict too.
  if p_expected_version is distinct from v_row.version then
    raise exception 'Commerce settings changed in another session.'
      using errcode = 'serialization_failure';
  end if;

  select seq into v_store from public.published_documents where collection = 'policies' and doc_id = 'store';
  select seq into v_delivery from public.published_documents where collection = 'policies' and doc_id = 'delivery';
  select seq into v_refund from public.published_documents where collection = 'policies' and doc_id = 'refund';
  select seq into v_privacy from public.published_documents where collection = 'policies' and doc_id = 'privacy';
  if v_store is null or v_delivery is null or v_refund is null then
    raise exception 'Publish the store, delivery and refund policies first.' using errcode = 'raise_exception';
  end if;

  v_revisions := jsonb_build_object('store', v_store, 'delivery', v_delivery, 'refund', v_refund)
    || case when v_privacy is null then '{}'::jsonb else jsonb_build_object('privacy', v_privacy) end;

  update finance.commerce_settings
     set policy_revisions = v_revisions,
         version = v_row.version + 1,
         configured_at = now(),
         approved_by = p_actor
   where id = 1;

  insert into public.audit_events (actor, action, entity, entity_id, summary)
  values (
    p_actor,
    'commerce.policies',
    'commerce_settings',
    '1',
    jsonb_build_object('version', v_row.version + 1, 'revisions', v_revisions)
  );

  return jsonb_build_object('version', v_row.version + 1, 'policyRevisions', v_revisions);
end
$$;

revoke all on function public.commerce_policies_approve(uuid, integer) from public, anon, authenticated;
grant execute on function public.commerce_policies_approve(uuid, integer) to service_role;
